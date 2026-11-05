"""Votação, decisão do admin e expiração (spec
docs/superpowers/specs/2026-11-02-colaborativo-design.md, 6).

Cada operação trava a linha da barreira (`FOR UPDATE`), decide o status com
`moderacao.decidir_status`, grava eventos e, quando a barreira passa a
afetar rotas ou deixa de afetar, apaga as rotas em cache da região.
"""

from __future__ import annotations

from datetime import datetime

from shapely.geometry import Point
from sqlalchemy import text
from sqlalchemy.engine import Row
from sqlalchemy.orm import Session

from app.auth import UsuarioAtual
from app.schemas.barreira import BarreiraOut
from app.services.barreiras import obter, registrar_evento
from app.services.cache_rota import invalidar_regiao
from app.services.erros import AutorNaoVota, BarreiraEncerrada, NaoEncontrada
from app.services.fotos import ArmazenamentoFotos, apagar_foto_da_barreira_removida
from app.services.moderacao import (
    STATUS_ENCERRADOS,
    Contagem,
    afeta_rota,
    decidir_status,
    expressao_status_efetivo,
    status_efetivo,
)

_SQL_TRAVAR = text(
    """
    SELECT id, autor_id, severidade, status, criado_em, ultima_confirmacao_em,
           ST_X(geom) AS lon, ST_Y(geom) AS lat
    FROM barreira_colaborativa WHERE id = :id FOR UPDATE
    """
)

_SQL_VOTO_ANTERIOR = text("SELECT voto FROM confirmacao WHERE barreira_id = :b AND usuario_id = :u")

_SQL_GRAVAR_VOTO = text(
    """
    INSERT INTO confirmacao (barreira_id, usuario_id, voto, criado_em, atualizado_em)
    VALUES (:b, :u, :voto, :agora, :agora)
    ON CONFLICT ON CONSTRAINT confirmacao_voto_unico
    DO UPDATE SET voto = EXCLUDED.voto, atualizado_em = EXCLUDED.atualizado_em
    """
)

_SQL_CONTAGEM = text(
    """
    SELECT count(*) FILTER (WHERE voto = 'confirma') AS confirma,
           count(*) FILTER (WHERE voto = 'contesta') AS contesta,
           count(*) FILTER (WHERE voto = 'resolvida') AS resolvida
    FROM confirmacao WHERE barreira_id = :b
    """
)

_SQL_ATUALIZAR = text(
    """
    UPDATE barreira_colaborativa
    SET status = :status, confirmacoes = :confirmacoes,
        ultima_confirmacao_em = :ultima, atualizado_em = :agora
    WHERE id = :id
    """
)

_SQL_VENCIDAS = text(
    f"""
    SELECT id, autor_id, severidade, status, criado_em, ultima_confirmacao_em,
           ST_X(geom) AS lon, ST_Y(geom) AS lat
    FROM barreira_colaborativa
    WHERE status IN ('pendente', 'validada')
      AND {expressao_status_efetivo("barreira_colaborativa", ":agora")} = 'expirada'
    ORDER BY id
    FOR UPDATE
    """
)


def _travar(db: Session, barreira_id: int) -> Row:
    linha = db.execute(_SQL_TRAVAR, {"id": barreira_id}).first()
    if linha is None:
        raise NaoEncontrada()
    return linha


def _invalidar_se_mudou(db: Session, linha: Row, antes: str, depois: str) -> None:
    if afeta_rota(antes, linha.severidade) != afeta_rota(depois, linha.severidade):
        invalidar_regiao(db, Point(linha.lon, linha.lat))


def votar(
    db: Session, usuario: UsuarioAtual, barreira_id: int, voto: str, agora: datetime
) -> BarreiraOut:
    linha = _travar(db, barreira_id)
    if linha.status == "removida":
        raise NaoEncontrada()
    if linha.autor_id == usuario.id:
        raise AutorNaoVota()
    atual = status_efetivo(linha.status, linha.criado_em, linha.ultima_confirmacao_em, agora)
    if atual in STATUS_ENCERRADOS:
        raise BarreiraEncerrada()

    parametros = {"b": barreira_id, "u": usuario.id}
    anterior = db.execute(_SQL_VOTO_ANTERIOR, parametros).scalar_one_or_none()
    db.execute(_SQL_GRAVAR_VOTO, {**parametros, "voto": voto, "agora": agora})
    contagem = Contagem(**db.execute(_SQL_CONTAGEM, {"b": barreira_id}).one()._mapping)
    novo = decidir_status(atual, linha.severidade, contagem, voto)
    ultima = agora if voto == "confirma" else linha.ultima_confirmacao_em
    db.execute(
        _SQL_ATUALIZAR,
        {
            "id": barreira_id,
            "status": novo,
            "confirmacoes": contagem.confirma,
            "ultima": ultima,
            "agora": agora,
        },
    )
    registrar_evento(
        db,
        tipo="voto",
        agora=agora,
        barreira_id=barreira_id,
        usuario_id=usuario.id,
        detalhe={"voto": voto, "anterior": anterior},
    )
    if novo != atual:
        registrar_evento(
            db,
            tipo="status",
            agora=agora,
            barreira_id=barreira_id,
            usuario_id=usuario.id,
            de_status=atual,
            para_status=novo,
        )
    _invalidar_se_mudou(db, linha, atual, novo)
    return obter(db, barreira_id, agora)


def mudar_status_admin(
    db: Session,
    admin: UsuarioAtual,
    barreira_id: int,
    status: str,
    motivo: str,
    agora: datetime,
    *,
    armazenamento: ArmazenamentoFotos | None = None,
) -> BarreiraOut:
    linha = _travar(db, barreira_id)
    atual = status_efetivo(linha.status, linha.criado_em, linha.ultima_confirmacao_em, agora)
    # validar pelo admin conta como confirmação: a barreira não nasce já vencida
    ultima = agora if status == "validada" else linha.ultima_confirmacao_em
    confirmacoes = db.execute(_SQL_CONTAGEM, {"b": barreira_id}).one().confirma
    db.execute(
        _SQL_ATUALIZAR,
        {
            "id": barreira_id,
            "status": status,
            "confirmacoes": confirmacoes,
            "ultima": ultima,
            "agora": agora,
        },
    )
    registrar_evento(
        db,
        tipo="admin",
        agora=agora,
        barreira_id=barreira_id,
        usuario_id=admin.id,
        de_status=atual,
        para_status=status,
        detalhe={"motivo": motivo},
    )
    if status == "removida":
        apagar_foto_da_barreira_removida(db, admin, barreira_id, armazenamento, agora)
    _invalidar_se_mudou(db, linha, atual, status)
    return obter(db, barreira_id, agora, incluir_removida=True)


def expirar_vencidas(db: Session, agora: datetime) -> list[int]:
    """Grava `expirada` (e o evento) nas barreiras que a leitura já trata como
    vencidas. Roda pelo script `scripts/expirar.py`."""
    expiradas: list[int] = []
    for linha in db.execute(_SQL_VENCIDAS, {"agora": agora}).all():
        db.execute(
            text(
                "UPDATE barreira_colaborativa SET status = 'expirada', atualizado_em = :agora "
                "WHERE id = :id"
            ),
            {"id": linha.id, "agora": agora},
        )
        registrar_evento(
            db,
            tipo="status",
            agora=agora,
            barreira_id=linha.id,
            de_status=linha.status,
            para_status="expirada",
            detalhe={"motivo": "prazo"},
        )
        _invalidar_se_mudou(db, linha, linha.status, "expirada")
        expiradas.append(linha.id)
    return expiradas

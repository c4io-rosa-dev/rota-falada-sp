"""Cadastro e leitura de barreiras colaborativas (spec
docs/superpowers/specs/2026-11-02-colaborativo-design.md, 5 e 6.3).

Leituras aplicam a expiração na hora (`expressao_status_efetivo`) e nunca
devolvem autor nem votantes. `registrar_evento` é a única porta de escrita
em `barreira_evento` (só inserção).
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Row
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import UsuarioAtual
from app.config import settings
from app.schemas.barreira import BarreiraIn, BarreiraOut, EventoOut, Votos
from app.services.erros import ForaDaArea, LimiteDiario, NaoEncontrada
from app.services.moderacao import (
    expressao_status_efetivo,
    severidade_da_categoria,
    status_inicial,
)

LIMITE_DIARIO = 20
BUCKET_FOTOS = "fotos-barreiras"

_SELECT_FICHA = f"""
    SELECT b.id, b.categoria, b.severidade,
           {expressao_status_efetivo("b", ":agora")} AS status,
           b.descricao, ST_Y(b.geom) AS lat, ST_X(b.geom) AS lon,
           b.criado_em, b.ultima_confirmacao_em, b.foto_caminho, b.foto_descricao,
           count(c.id) FILTER (WHERE c.voto = 'confirma') AS confirma,
           count(c.id) FILTER (WHERE c.voto = 'contesta') AS contesta,
           count(c.id) FILTER (WHERE c.voto = 'resolvida') AS resolvida
    FROM barreira_colaborativa b
    LEFT JOIN confirmacao c ON c.barreira_id = b.id
"""

_SQL_OBTER = text(
    _SELECT_FICHA
    + " WHERE b.id = :id AND (:incluir_removida OR b.status <> 'removida') GROUP BY b.id"
)

_SQL_LISTAR = text(
    _SELECT_FICHA
    + """
    WHERE b.status <> 'removida'
      AND ST_DWithin(b.geom::geography,
                     ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, :raio)
    GROUP BY b.id
    ORDER BY ST_Distance(b.geom::geography,
                         ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography), b.id
    """
)

# fila de moderação: compara com o status EFETIVO, inclusive `removida`
_SQL_FILA = text(
    _SELECT_FICHA
    + f"""
    WHERE (CAST(:status AS text) IS NULL
           OR {expressao_status_efetivo("b", ":agora")} = CAST(:status AS text))
      AND (CAST(:antes_de AS bigint) IS NULL OR b.id < CAST(:antes_de AS bigint))
    GROUP BY b.id
    ORDER BY b.id DESC
    LIMIT :limite
    """
)

_SQL_POR_CHAVE = text(
    "SELECT id FROM barreira_colaborativa WHERE autor_id = :autor AND chave_idempotencia = :chave"
)

_SQL_DENTRO_DA_AREA = text(
    "SELECT EXISTS (SELECT 1 FROM area_piloto "
    "WHERE ST_Covers(geom, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)))"
)

_SQL_CRIADAS_24H = text(
    "SELECT count(*) FROM barreira_colaborativa "
    "WHERE autor_id = :autor AND criado_em > CAST(:agora AS timestamptz) - interval '24 hours' "
    "AND criado_em <= CAST(:agora AS timestamptz)"
)

_SQL_INSERIR = text(
    """
    INSERT INTO barreira_colaborativa
      (categoria, severidade, descricao, status, confirmacoes, geom, fonte_id,
       data_referencia, criado_em, atualizado_em, autor_id, chave_idempotencia)
    VALUES
      (:categoria, :severidade, :descricao, :status, 0,
       ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
       (SELECT id FROM fonte_dados WHERE chave = 'colaborativo'),
       :data_referencia, :agora, :agora, :autor, :chave)
    RETURNING id
    """
)

_SQL_EVENTO = text(
    """
    INSERT INTO barreira_evento
      (barreira_id, usuario_id, tipo, de_status, para_status, detalhe, criado_em)
    VALUES
      (:barreira_id, :usuario_id, :tipo, :de_status, :para_status, CAST(:detalhe AS jsonb), :agora)
    """
)

_SQL_EVENTOS = text(
    "SELECT id, barreira_id, usuario_id, tipo, de_status, para_status, detalhe, criado_em "
    "FROM barreira_evento WHERE barreira_id = :id ORDER BY id"
)


def url_publica_foto(caminho: str | None) -> str | None:
    if caminho is None or not settings.supabase_url:
        return None
    base = settings.supabase_url.rstrip("/")
    return f"{base}/storage/v1/object/public/{BUCKET_FOTOS}/{caminho}"


def _ficha(linha: Row) -> BarreiraOut:
    return BarreiraOut(
        id=linha.id,
        categoria=linha.categoria,
        severidade=linha.severidade,
        status=linha.status,
        votos=Votos(confirma=linha.confirma, contesta=linha.contesta, resolvida=linha.resolvida),
        descricao=linha.descricao,
        lat=linha.lat,
        lon=linha.lon,
        criada_em=linha.criado_em,
        ultima_confirmacao_em=linha.ultima_confirmacao_em,
        foto_url=url_publica_foto(linha.foto_caminho),
        foto_descricao=linha.foto_descricao,
    )


def registrar_evento(
    db: Session,
    *,
    tipo: str,
    agora: datetime,
    barreira_id: int | None = None,
    usuario_id=None,
    de_status: str | None = None,
    para_status: str | None = None,
    detalhe: dict[str, Any] | None = None,
) -> None:
    db.execute(
        _SQL_EVENTO,
        {
            "barreira_id": barreira_id,
            "usuario_id": usuario_id,
            "tipo": tipo,
            "de_status": de_status,
            "para_status": para_status,
            "detalhe": json.dumps(detalhe or {}, ensure_ascii=False),
            "agora": agora,
        },
    )


def obter(
    db: Session, barreira_id: int, agora: datetime, *, incluir_removida: bool = False
) -> BarreiraOut:
    linha = db.execute(
        _SQL_OBTER, {"id": barreira_id, "agora": agora, "incluir_removida": incluir_removida}
    ).first()
    if linha is None:
        raise NaoEncontrada()
    return _ficha(linha)


def listar_proximas(
    db: Session, lat: float, lon: float, raio_m: float, agora: datetime
) -> list[BarreiraOut]:
    linhas = db.execute(_SQL_LISTAR, {"lat": lat, "lon": lon, "raio": raio_m, "agora": agora}).all()
    return [_ficha(linha) for linha in linhas]


def listar_fila(
    db: Session, agora: datetime, status: str | None, limite: int, antes_de: int | None
) -> list[BarreiraOut]:
    parametros = {"agora": agora, "status": status, "limite": limite, "antes_de": antes_de}
    return [_ficha(linha) for linha in db.execute(_SQL_FILA, parametros).all()]


def criar(
    db: Session, usuario: UsuarioAtual, entrada: BarreiraIn, agora: datetime
) -> tuple[BarreiraOut, bool]:
    """Cria a barreira, ou devolve a já criada com a mesma chave pelo mesmo
    autor (idempotência). O bool diz se foi criada agora."""
    chave = {"autor": usuario.id, "chave": entrada.chave_idempotencia}
    existente = db.execute(_SQL_POR_CHAVE, chave).scalar_one_or_none()
    if existente is not None:
        return obter(db, existente, agora), False
    if not db.execute(_SQL_DENTRO_DA_AREA, {"lon": entrada.lon, "lat": entrada.lat}).scalar_one():
        raise ForaDaArea()
    if (
        db.execute(_SQL_CRIADAS_24H, {"autor": usuario.id, "agora": agora}).scalar_one()
        >= LIMITE_DIARIO
    ):
        raise LimiteDiario()

    severidade = severidade_da_categoria(entrada.categoria)
    status = status_inicial(severidade)
    try:
        with db.begin_nested():
            barreira_id = db.execute(
                _SQL_INSERIR,
                {
                    **chave,
                    "categoria": entrada.categoria,
                    "severidade": severidade,
                    "descricao": entrada.descricao,
                    "status": status,
                    "lon": entrada.lon,
                    "lat": entrada.lat,
                    "data_referencia": agora.date(),
                    "agora": agora,
                },
            ).scalar_one()
    except IntegrityError:
        # outra requisição com a mesma chave venceu a corrida; sem linha para
        # (autor, chave), o erro era outro (ex.: FK) e não pode ser engolido
        existente = db.execute(_SQL_POR_CHAVE, chave).scalar_one_or_none()
        if existente is None:
            raise
        return obter(db, existente, agora), False

    registrar_evento(
        db,
        tipo="criada",
        agora=agora,
        barreira_id=barreira_id,
        usuario_id=usuario.id,
        para_status=status,
        detalhe={"categoria": entrada.categoria},
    )
    return obter(db, barreira_id, agora), True


def listar_eventos(db: Session, barreira_id: int) -> list[EventoOut]:
    existe = db.execute(
        text("SELECT 1 FROM barreira_colaborativa WHERE id = :id"), {"id": barreira_id}
    ).first()
    if existe is None:
        raise NaoEncontrada()
    return [
        EventoOut.model_validate(dict(linha._mapping))
        for linha in db.execute(_SQL_EVENTOS, {"id": barreira_id})
    ]

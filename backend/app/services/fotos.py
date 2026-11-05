"""Foto opcional da barreira (spec 2026-11-02-colaborativo-design.md, 7).

Toda foto é reprocessada (rotação do EXIF aplicada, lado maior ≤ 1600 px,
WebP sem metadados) antes de ir ao Supabase Storage: é o que garante que o
GPS gravado pela câmera nunca seja publicado (LGPD). As imagens são servidas
pela CDN do Supabase, não pelo Render.
"""

from __future__ import annotations

import io
import threading
import uuid
from datetime import datetime
from typing import Protocol

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from app.auth import UsuarioAtual
from app.schemas.barreira import BarreiraOut
from app.services.barreiras import BUCKET_FOTOS, obter, registrar_evento
from app.services.erros import (
    DescricaoFotoInvalida,
    FotoFormato,
    FotoGrande,
    NaoEncontrada,
    SemPermissao,
    StorageIndisponivel,
)

TAMANHO_MAX_BYTES = 5 * 1024 * 1024
PIXELS_MAX = 40_000_000
LADO_MAX = 1600
_FORMATOS_ACEITOS = frozenset({"JPEG", "PNG", "WEBP"})
_DESCRICAO_MIN, _DESCRICAO_MAX = 5, 300
# um PNG de poucos KB pode descomprimir em 160 MB: uma imagem de cada vez, e a fila não é infinita
_VAGA_REPROCESSAR = threading.BoundedSemaphore(1)
ESPERA_VAGA_S = 30.0


def reprocessar(conteudo: bytes) -> bytes:
    if len(conteudo) > TAMANHO_MAX_BYTES:
        raise FotoGrande()
    if not _VAGA_REPROCESSAR.acquire(timeout=ESPERA_VAGA_S):
        raise StorageIndisponivel()
    try:
        return _reprocessar(conteudo)
    finally:
        _VAGA_REPROCESSAR.release()


def _reprocessar(conteudo: bytes) -> bytes:
    """Sem cópias da imagem inteira: cada uma custa até 160 MB a 40 megapixels."""
    try:
        with Image.open(io.BytesIO(conteudo)) as imagem:
            if imagem.format not in _FORMATOS_ACEITOS:
                raise FotoFormato()
            if imagem.width * imagem.height > PIXELS_MAX:
                raise FotoFormato()
            imagem.draft(None, (LADO_MAX, LADO_MAX))  # JPEG já decodifica reduzido
            imagem.load()
            ImageOps.exif_transpose(imagem, in_place=True)
            limpa = imagem if imagem.mode == "RGB" else imagem.convert("RGB")
            if limpa is not imagem:
                imagem.close()  # o original sai da memória antes de reduzir
            limpa.thumbnail((LADO_MAX, LADO_MAX))
            saida = io.BytesIO()
            limpa.save(saida, "WEBP", quality=80)  # sem exif=: nenhum metadado é gravado
            return saida.getvalue()
    except (
        UnidentifiedImageError,
        Image.DecompressionBombError,
        OSError,
        SyntaxError,
        ValueError,
    ) as erro:
        raise FotoFormato() from erro


class ArmazenamentoFotos(Protocol):
    def enviar(self, caminho: str, conteudo: bytes) -> None: ...

    def remover(self, caminho: str) -> None: ...


class ArmazenamentoSupabase:
    def __init__(self, url: str, chave: str, timeout_s: float = 15.0) -> None:
        self._base = f"{url.rstrip('/')}/storage/v1/object/{BUCKET_FOTOS}"
        self._cabecalhos = {"Authorization": f"Bearer {chave}", "apikey": chave}
        self._timeout = timeout_s

    def enviar(self, caminho: str, conteudo: bytes) -> None:
        try:
            resposta = httpx.post(
                f"{self._base}/{caminho}",
                content=conteudo,
                headers={**self._cabecalhos, "Content-Type": "image/webp", "x-upsert": "true"},
                timeout=self._timeout,
            )
            resposta.raise_for_status()
        except httpx.HTTPError as erro:
            raise StorageIndisponivel() from erro

    def remover(self, caminho: str) -> None:
        try:
            resposta = httpx.request(
                "DELETE",
                self._base,
                json={"prefixes": [caminho]},
                headers=self._cabecalhos,
                timeout=self._timeout,
            )
            resposta.raise_for_status()
        except httpx.HTTPError as erro:
            raise StorageIndisponivel() from erro


class ArmazenamentoMemoria:
    """Armazenamento falso para testes e desenvolvimento local."""

    def __init__(self) -> None:
        self.objetos: dict[str, bytes] = {}

    def enviar(self, caminho: str, conteudo: bytes) -> None:
        self.objetos[caminho] = conteudo

    def remover(self, caminho: str) -> None:
        self.objetos.pop(caminho, None)


def criar_armazenamento(supabase_url: str | None, chave: str | None) -> ArmazenamentoFotos | None:
    if not supabase_url or not chave:
        return None
    return ArmazenamentoSupabase(supabase_url, chave)


_SQL_LER = text("SELECT autor_id, status FROM barreira_colaborativa WHERE id = :id")
_SQL_TRAVAR = text(
    "SELECT autor_id, status, foto_caminho FROM barreira_colaborativa WHERE id = :id FOR UPDATE"
)
_SQL_GRAVAR_FOTO = text(
    "UPDATE barreira_colaborativa SET foto_caminho = :caminho, foto_descricao = :descricao, "
    "atualizado_em = :agora WHERE id = :id"
)


def _verificar(linha, usuario: UsuarioAtual) -> None:
    if linha is None or linha.status == "removida":
        raise NaoEncontrada()
    if not (usuario.admin or linha.autor_id == usuario.id):
        raise SemPermissao()


def _checar_permissao(db: Session, usuario: UsuarioAtual, barreira_id: int) -> None:
    """Checagem sem trava, antes das etapas lentas (reprocessar e enviar)."""
    _verificar(db.execute(_SQL_LER, {"id": barreira_id}).first(), usuario)


def _travar_com_permissao(db: Session, usuario: UsuarioAtual, barreira_id: int):
    linha = db.execute(_SQL_TRAVAR, {"id": barreira_id}).first()
    _verificar(linha, usuario)
    return linha


def _remover_sem_falhar(armazenamento: ArmazenamentoFotos, caminho: str | None) -> None:
    """Uma foto antiga que não sai do Storage vira só um arquivo órfão; não
    pode impedir a troca nem a remoção."""
    if caminho is None:
        return
    try:
        armazenamento.remover(caminho)
    except StorageIndisponivel:
        pass


def _remover_apos_commit(db: Session, armazenamento: ArmazenamentoFotos, caminho: str | None):
    """Só apaga o objeto antigo depois que a transação confirma; se o commit
    falhar, o banco ainda aponta para ele."""
    if caminho is None:
        return
    event.listen(
        db,
        "after_commit",
        lambda _sessao: _remover_sem_falhar(armazenamento, caminho),
        once=True,
    )


def anexar_foto(
    db: Session,
    usuario: UsuarioAtual,
    barreira_id: int,
    conteudo: bytes,
    descricao: str,
    armazenamento: ArmazenamentoFotos | None,
    agora: datetime,
) -> BarreiraOut:
    if armazenamento is None:
        raise StorageIndisponivel()
    descricao = descricao.strip()
    if "\x00" in descricao or not _DESCRICAO_MIN <= len(descricao) <= _DESCRICAO_MAX:
        raise DescricaoFotoInvalida()
    _checar_permissao(db, usuario, barreira_id)
    webp = reprocessar(conteudo)
    caminho = f"{barreira_id}/{uuid.uuid4().hex}.webp"
    armazenamento.enviar(caminho, webp)
    # a trava só vale a partir daqui: lê a foto ATUAL e grava
    linha = _travar_com_permissao(db, usuario, barreira_id)
    db.execute(
        _SQL_GRAVAR_FOTO,
        {"id": barreira_id, "caminho": caminho, "descricao": descricao, "agora": agora},
    )
    registrar_evento(
        db,
        tipo="foto",
        agora=agora,
        barreira_id=barreira_id,
        usuario_id=usuario.id,
        detalhe={"acao": "anexada"},
    )
    _remover_apos_commit(db, armazenamento, linha.foto_caminho)
    return obter(db, barreira_id, agora)


def remover_foto(
    db: Session,
    usuario: UsuarioAtual,
    barreira_id: int,
    armazenamento: ArmazenamentoFotos | None,
    agora: datetime,
) -> BarreiraOut:
    if armazenamento is None:
        raise StorageIndisponivel()
    linha = _travar_com_permissao(db, usuario, barreira_id)
    db.execute(
        _SQL_GRAVAR_FOTO, {"id": barreira_id, "caminho": None, "descricao": None, "agora": agora}
    )
    registrar_evento(
        db,
        tipo="foto",
        agora=agora,
        barreira_id=barreira_id,
        usuario_id=usuario.id,
        detalhe={"acao": "removida"},
    )
    _remover_apos_commit(db, armazenamento, linha.foto_caminho)
    return obter(db, barreira_id, agora)

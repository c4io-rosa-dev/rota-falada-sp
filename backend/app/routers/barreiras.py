"""Rotas da camada colaborativa (spec 2026-11-02-colaborativo-design.md, 5.1 e 5.2).
Só validam e traduzem `ErroDominio`; a lógica está em `services/`."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.auth import UsuarioAtual, usuario_atual
from app.db import get_db
from app.schemas.barreira import BarreiraIn, BarreiraOut, VotoIn
from app.services import barreiras, fotos, votacao
from app.services.erros import ErroDominio
from app.services.fotos import TAMANHO_MAX_BYTES, ArmazenamentoFotos

router = APIRouter(prefix="/api", tags=["barreiras"])

MSG_INDISPONIVEL = "Serviço de barreiras indisponível no momento."


def obter_agora() -> datetime:
    return datetime.now(UTC)


def obter_armazenamento(request: Request) -> ArmazenamentoFotos | None:
    """O único armazenamento de fotos do processo, criado em `main.create_app`."""
    return request.app.state.armazenamento_fotos


@contextmanager
def transacao(db: Session) -> Iterator[None]:
    """Commit no sucesso; `ErroDominio` vira HTTP com a mensagem do domínio."""
    try:
        yield
    except ErroDominio as erro:
        db.rollback()
        raise HTTPException(status_code=erro.status_http, detail=str(erro)) from erro
    except OperationalError as erro:
        db.rollback()
        raise HTTPException(status_code=503, detail=MSG_INDISPONIVEL) from erro
    else:
        db.commit()


Db = Annotated[Session, Depends(get_db)]
Agora = Annotated[datetime, Depends(obter_agora)]
Usuario = Annotated[UsuarioAtual, Depends(usuario_atual)]
Armazenamento = Annotated[ArmazenamentoFotos | None, Depends(obter_armazenamento)]


@router.get("/barreiras", response_model=list[BarreiraOut])
def listar(
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    db: Db,
    agora: Agora,
    raio_m: Annotated[int, Query(ge=10, le=500)] = 200,
) -> list[BarreiraOut]:
    with transacao(db):
        return barreiras.listar_proximas(db, lat, lon, raio_m, agora)


@router.get("/barreiras/{barreira_id}", response_model=BarreiraOut)
def obter(barreira_id: int, db: Db, agora: Agora) -> BarreiraOut:
    with transacao(db):
        return barreiras.obter(db, barreira_id, agora)


@router.post("/barreiras", response_model=BarreiraOut, status_code=201)
def criar(
    entrada: BarreiraIn, response: Response, db: Db, agora: Agora, usuario: Usuario
) -> BarreiraOut:
    with transacao(db):
        barreira, criada = barreiras.criar(db, usuario, entrada, agora)
    if not criada:
        response.status_code = 200
    return barreira


@router.put("/barreiras/{barreira_id}/voto", response_model=BarreiraOut)
def votar(barreira_id: int, entrada: VotoIn, db: Db, agora: Agora, usuario: Usuario) -> BarreiraOut:
    with transacao(db):
        return votacao.votar(db, usuario, barreira_id, entrada.voto, agora)


@router.post("/barreiras/{barreira_id}/foto", response_model=BarreiraOut)
def anexar_foto(
    barreira_id: int,
    arquivo: Annotated[UploadFile, File()],
    descricao: Annotated[str, Form()],
    db: Db,
    agora: Agora,
    usuario: Usuario,
    armazenamento: Armazenamento,
) -> BarreiraOut:
    conteudo = arquivo.file.read(TAMANHO_MAX_BYTES + 1)
    with transacao(db):
        return fotos.anexar_foto(
            db, usuario, barreira_id, conteudo, descricao, armazenamento, agora
        )


@router.delete("/barreiras/{barreira_id}/foto", response_model=BarreiraOut)
def remover_foto(
    barreira_id: int, db: Db, agora: Agora, usuario: Usuario, armazenamento: Armazenamento
) -> BarreiraOut:
    with transacao(db):
        return fotos.remover_foto(db, usuario, barreira_id, armazenamento, agora)

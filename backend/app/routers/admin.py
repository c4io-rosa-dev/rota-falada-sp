"""Rotas de admin (spec 2026-11-02-colaborativo-design.md, 5.3)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.auth import UsuarioAtual, exigir_admin
from app.routers.barreiras import Agora, Db, transacao
from app.schemas.barreira import BarreiraOut, EventoOut, StatusAdminIn, StatusBarreira
from app.services import barreiras, votacao

router = APIRouter(prefix="/api/admin", tags=["admin"])

Admin = Annotated[UsuarioAtual, Depends(exigir_admin)]

BIGINT_MAX = 2**63 - 1


@router.get("/barreiras", response_model=list[BarreiraOut])
def fila(
    db: Db,
    agora: Agora,
    admin: Admin,
    status: StatusBarreira | None = None,
    limite: Annotated[int, Query(ge=1, le=100)] = 50,
    antes_de: Annotated[int | None, Query(ge=1, le=BIGINT_MAX)] = None,
) -> list[BarreiraOut]:
    with transacao(db):
        return barreiras.listar_fila(db, agora, status, limite, antes_de)


@router.get("/barreiras/{barreira_id}", response_model=BarreiraOut)
def obter(barreira_id: int, db: Db, agora: Agora, admin: Admin) -> BarreiraOut:
    with transacao(db):
        return barreiras.obter(db, barreira_id, agora, incluir_removida=True)


@router.post("/barreiras/{barreira_id}/status", response_model=BarreiraOut)
def mudar_status(
    barreira_id: int, entrada: StatusAdminIn, db: Db, agora: Agora, admin: Admin
) -> BarreiraOut:
    with transacao(db):
        return votacao.mudar_status_admin(
            db, admin, barreira_id, entrada.status, entrada.motivo.strip(), agora
        )


@router.get("/barreiras/{barreira_id}/eventos", response_model=list[EventoOut])
def eventos(barreira_id: int, db: Db, admin: Admin) -> list[EventoOut]:
    with transacao(db):
        return barreiras.listar_eventos(db, barreira_id)

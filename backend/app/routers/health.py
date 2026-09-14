from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.health import HealthOut
from app.services.ors_client import OrsFixtureClient

VERSAO = "0.1.0"

router = APIRouter(tags=["saude"])


@router.get("/health", response_model=HealthOut)
def health(request: Request, db: Session = Depends(get_db)) -> HealthOut:  # noqa: B008
    ultimo_etl = None
    try:
        db.execute(text("SELECT 1"))
        ultimo_etl = db.execute(
            text("SELECT max(fim) FROM etl_execucao WHERE status = 'ok'")
        ).scalar_one_or_none()
        banco = "ok"
    except Exception:
        banco = "indisponivel"

    # mesmo cliente ORS usado por POST /api/rotas (app.state.cliente_ors,
    # ver main.create_app e routers/rotas.py): o EstadoCota que ele carrega
    # já reflete os headers x-ratelimit-* da última chamada real ao ORS.
    cliente_ors = request.app.state.cliente_ors
    return HealthOut(
        status="ok" if banco == "ok" else "degradado",
        versao=VERSAO,
        banco=banco,
        ultimo_etl=ultimo_etl,
        ors_cota_restante=cliente_ors.estado.restante,
        ors_cota_reset=cliente_ors.estado.reset_em,
        modo_fixtures=isinstance(cliente_ors, OrsFixtureClient),
    )

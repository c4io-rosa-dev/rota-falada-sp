from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.health import HealthOut

VERSAO = "0.1.0"

router = APIRouter(tags=["saude"])


@router.get("/health", response_model=HealthOut)
def health(db: Session = Depends(get_db)) -> HealthOut:  # noqa: B008
    ultimo_etl = None
    try:
        db.execute(text("SELECT 1"))
        ultimo_etl = db.execute(
            text("SELECT max(fim) FROM etl_execucao WHERE status = 'ok'")
        ).scalar_one_or_none()
        banco = "ok"
    except Exception:
        banco = "indisponivel"
    return HealthOut(
        status="ok" if banco == "ok" else "degradado",
        versao=VERSAO,
        banco=banco,
        ultimo_etl=ultimo_etl,
    )

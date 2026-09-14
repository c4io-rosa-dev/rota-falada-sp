from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.health import HealthOut

VERSAO = "0.1.0"

router = APIRouter(tags=["saude"])


@router.get("/health", response_model=HealthOut)
def health(db: Session = Depends(get_db)) -> HealthOut:  # noqa: B008
    try:
        db.execute(text("SELECT 1"))
        banco = "ok"
    except Exception:
        banco = "indisponivel"
    return HealthOut(status="ok" if banco == "ok" else "degradado", versao=VERSAO, banco=banco)

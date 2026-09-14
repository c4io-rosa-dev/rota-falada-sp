from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import FonteDados
from app.schemas.fontes import FonteOut

router = APIRouter(prefix="/api", tags=["fontes"])


@router.get("/fontes", response_model=list[FonteOut])
def listar_fontes(db: Session = Depends(get_db)) -> list[FonteOut]:  # noqa: B008
    fontes = db.scalars(select(FonteDados).order_by(FonteDados.chave)).all()
    return [FonteOut.model_validate(f) for f in fontes]

from fastapi import APIRouter

from app.schemas.health import HealthOut

VERSAO = "0.1.0"

router = APIRouter(tags=["saude"])


@router.get("/health", response_model=HealthOut)
def health() -> HealthOut:
    return HealthOut(status="ok", versao=VERSAO)

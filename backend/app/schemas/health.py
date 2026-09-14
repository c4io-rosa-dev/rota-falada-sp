from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class HealthOut(BaseModel):
    status: Literal["ok", "degradado"]
    versao: str
    banco: Literal["ok", "indisponivel"]
    ultimo_etl: datetime | None
    ors_cota_restante: int | None
    ors_cota_reset: datetime | None
    modo_fixtures: bool

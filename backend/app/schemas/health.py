from typing import Literal

from pydantic import BaseModel


class HealthOut(BaseModel):
    status: Literal["ok", "degradado"]
    versao: str
    banco: Literal["ok", "indisponivel"]

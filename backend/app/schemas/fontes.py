from datetime import date

from pydantic import BaseModel, ConfigDict


class FonteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    chave: str
    nome: str
    licenca: str
    url: str
    atribuicao: str
    data_referencia: date | None
    data_extracao: date | None

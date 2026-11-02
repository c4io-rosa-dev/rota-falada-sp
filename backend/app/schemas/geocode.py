"""Contrato de `GET /api/geocode` e `GET /api/geocode/reverso`."""

from typing import Literal

from pydantic import BaseModel, Field


class EnderecoOut(BaseModel):
    id: int
    tipo: Literal["logradouro", "endereco", "lugar"]
    # texto exibido e falado pelo leitor de tela; nunca vazio
    rotulo: str = Field(min_length=1)
    lat: float
    lon: float
    # true quando o número digitado não existe e este é o mais próximo da rua
    aproximado: bool = False

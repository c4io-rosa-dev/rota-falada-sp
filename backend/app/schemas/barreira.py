"""Contratos da camada colaborativa (spec 2026-11-02-colaborativo-design.md, 5)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, Field, StringConstraints, field_validator

Categoria = Literal[
    "escada",
    "sem_rampa",
    "elevador_quebrado",
    "obstaculo_bloqueando",
    "calcada_estreita",
    "rampa_ingreme",
    "buraco",
    "piso_irregular",
    "sem_piso_tatil",
    "outro",
]
StatusBarreira = Literal["pendente", "validada", "contestada", "resolvida", "expirada", "removida"]


def _sem_nul(valor: str) -> str:
    """O Postgres recusa U+0000 em texto; sem isto, sobe como 500 sem CORS."""
    if "\x00" in valor:
        raise ValueError("O texto tem um caractere inválido.")
    return valor


class BarreiraIn(BaseModel):
    categoria: Categoria
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    descricao: str | None = Field(default=None, max_length=500)
    # gerado pelo app; reenviar a mesma chave não duplica (fila offline)
    chave_idempotencia: uuid.UUID

    @field_validator("descricao", mode="before")
    @classmethod
    def _em_branco_vira_nula(cls, valor: str | None) -> str | None:
        if not isinstance(valor, str):
            return valor
        valor = _sem_nul(valor).strip()
        return valor or None


class Votos(BaseModel):
    confirma: int
    contesta: int
    resolvida: int


class BarreiraOut(BaseModel):
    """Ficha pública: nunca inclui quem reportou nem quem votou (LGPD)."""

    id: int
    categoria: str
    severidade: Literal["intransponivel", "dificulta", "informativo"]
    status: StatusBarreira
    votos: Votos
    descricao: str | None
    lat: float
    lon: float
    criada_em: datetime
    ultima_confirmacao_em: datetime | None
    foto_url: str | None
    foto_descricao: str | None


class VotoIn(BaseModel):
    voto: Literal["confirma", "contesta", "resolvida"]


class StatusAdminIn(BaseModel):
    status: StatusBarreira
    # o strip vem antes do tamanho: "   " não pode virar motivo vazio na auditoria
    motivo: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=3, max_length=300),
        AfterValidator(_sem_nul),
    ]


class EuOut(BaseModel):
    """Só o papel: id e e-mail a pessoa já tem pelo Supabase, e não voltam aqui."""

    papel: Literal["colaborador", "admin"]


class EventoOut(BaseModel):
    id: int
    barreira_id: int | None
    usuario_id: uuid.UUID | None
    tipo: str
    de_status: str | None
    para_status: str | None
    detalhe: dict[str, Any]
    criado_em: datetime

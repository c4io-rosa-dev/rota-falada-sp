from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field


class Coordenada(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class PerfilAcessibilidade(BaseModel):
    inclinacao_max: Literal[3, 6, 10, "any"] = 6
    guia_max_m: Literal[0.03, 0.06, 0.1, "any"] = 0.06
    largura_min_m: float = Field(0.9, ge=0.5, le=3)
    evitar_degraus: bool = True
    velocidade_kmh: float = Field(3.0, ge=0.5, le=6)


class RotaIn(BaseModel):
    origem: Coordenada
    destino: Coordenada
    perfil: PerfilAcessibilidade = PerfilAcessibilidade()


class BarreiraResumo(BaseModel):
    id: int
    origem: Literal["oficial", "colaborativa"]
    categoria: str
    severidade: str
    distancia_m: float
    confirmacoes: int | None
    data_referencia: date | None


class Passo(BaseModel):
    ordem: int
    instrucao: str
    distancia_m: float
    duracao_s: float
    direcao: str
    largura_m: float | None
    largura_medida: bool
    declividade_pct: float | None
    declividade_medida: bool
    guia: Literal["transponivel", "nao_transponivel", "desconhecida"]
    is_degrau: bool
    barreiras_proximas: list[BarreiraResumo]
    fonte: str
    data_referencia: date | None
    geometria: dict[str, Any]  # GeoJSON LineString


class Aviso(BaseModel):
    tipo: Literal["exigencia_relaxada", "barreira_dificulta", "trecho_sem_dados", "motor_fallback"]
    mensagem: str


class RotaOut(BaseModel):
    passos: list[Passo]
    distancia_m: float
    duracao_s: float
    avisos: list[Aviso]
    nivel_exigencia_atendido: Literal[3, 6, 10, "any"]
    motor: Literal["ors", "pgrouting", "fixture"]
    fontes: list[str]
    geometria: dict[str, Any]
    cache: bool

"""Regras de moderação da camada colaborativa (spec
docs/superpowers/specs/2026-11-02-colaborativo-design.md, seções 3.3 e 6).

Tudo aqui é puro: sem banco, sem relógio. `expressao_status_efetivo` repete
em SQL a regra de `status_efetivo` para as leituras e o roteamento; os
testes de `test_barreiras_cadastro.py` conferem que as duas concordam.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

Severidade = Literal["intransponivel", "dificulta", "informativo"]
Status = Literal["pendente", "validada", "contestada", "resolvida", "expirada", "removida"]
Voto = Literal["confirma", "contesta", "resolvida"]

SEVERIDADE_POR_CATEGORIA: dict[str, Severidade] = {
    "escada": "intransponivel",
    "sem_rampa": "intransponivel",
    "elevador_quebrado": "intransponivel",
    "obstaculo_bloqueando": "intransponivel",
    "calcada_estreita": "dificulta",
    "rampa_ingreme": "dificulta",
    "buraco": "dificulta",
    "piso_irregular": "dificulta",
    "sem_piso_tatil": "informativo",
    "outro": "informativo",
}
CATEGORIAS: tuple[str, ...] = tuple(SEVERIDADE_POR_CATEGORIA)

LIMIAR_VALIDACAO: dict[str, int] = {"intransponivel": 2, "dificulta": 1, "informativo": 0}
VOTOS_PARA_CONTESTAR = 2
VOTOS_PARA_RESOLVER = 2
PRAZO_PENDENTE = timedelta(days=30)
PRAZO_VALIDADA = timedelta(days=180)
STATUS_ENCERRADOS: frozenset[str] = frozenset({"removida", "contestada", "resolvida", "expirada"})
_SEVERIDADES_QUE_AFETAM_ROTA = frozenset({"intransponivel", "dificulta"})


@dataclass(frozen=True)
class Contagem:
    confirma: int = 0
    contesta: int = 0
    resolvida: int = 0


def severidade_da_categoria(categoria: str) -> Severidade:
    try:
        return SEVERIDADE_POR_CATEGORIA[categoria]
    except KeyError as erro:
        raise ValueError(f"categoria desconhecida: {categoria!r}") from erro


def status_inicial(severidade: Severidade) -> Status:
    """`informativo` (limiar 0) já nasce visível; as demais esperam votos."""
    return "validada" if LIMIAR_VALIDACAO[severidade] == 0 else "pendente"


def decidir_status(
    status_atual: str, severidade: Severidade, contagem: Contagem, voto: Voto | None = None
) -> Status:
    """Novo status depois de um voto, na ordem da seção 6.2 do spec. Confirmar
    nunca rebaixa uma barreira validada, mesmo abaixo do limiar: o admin pode
    tê-la validado sem votos (decisão do dono, 05/11/2026)."""
    if status_atual in STATUS_ENCERRADOS:
        return status_atual  # type: ignore[return-value]
    if status_atual == "validada" and voto == "confirma":
        return "validada"
    if contagem.contesta >= VOTOS_PARA_CONTESTAR:
        return "contestada"
    if contagem.resolvida >= VOTOS_PARA_RESOLVER:
        return "resolvida"
    if contagem.confirma >= LIMIAR_VALIDACAO[severidade]:
        return "validada"
    return "pendente"


def status_efetivo(
    status: str,
    criado_em: datetime,
    ultima_confirmacao_em: datetime | None,
    agora: datetime,
) -> Status:
    """Expiração calculada na leitura (seção 6.3): `pendente` há mais de 30
    dias e `validada` sem confirmação há mais de 180 dias contam como
    `expirada`."""
    if status == "pendente" and agora - criado_em > PRAZO_PENDENTE:
        return "expirada"
    if status == "validada" and agora - (ultima_confirmacao_em or criado_em) > PRAZO_VALIDADA:
        return "expirada"
    return status  # type: ignore[return-value]


def afeta_rota(status: str, severidade: str) -> bool:
    return status == "validada" and severidade in _SEVERIDADES_QUE_AFETAM_ROTA


def expressao_status_efetivo(tabela: str, agora_sql: str) -> str:
    """A regra de `status_efetivo` em SQL. `tabela` é o nome ou alias usado
    para qualificar as colunas; `agora_sql` é `:agora` (parâmetro) ou
    `now()`."""
    agora = f"CAST({agora_sql} AS timestamptz)"
    return (
        f"CASE WHEN {tabela}.status = 'pendente' "
        f"AND {tabela}.criado_em < {agora} - interval '{PRAZO_PENDENTE.days} days' "
        "THEN 'expirada' "
        f"WHEN {tabela}.status = 'validada' "
        f"AND coalesce({tabela}.ultima_confirmacao_em, {tabela}.criado_em) "
        f"< {agora} - interval '{PRAZO_VALIDADA.days} days' "
        "THEN 'expirada' "
        f"ELSE {tabela}.status END"
    )

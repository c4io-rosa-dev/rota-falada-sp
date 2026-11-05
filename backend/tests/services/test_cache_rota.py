"""Retenção de `rota_cache`: entrada vencida não fica guardada para sempre."""

from datetime import UTC, datetime, timedelta

import pytest
from shapely.geometry import box
from sqlalchemy import text

from app.schemas.rota import RotaOut
from app.services import cache_rota

pytestmark = pytest.mark.integration

AGORA = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
REGIAO = box(-46.64, -23.60, -46.63, -23.59)


def _saida() -> RotaOut:
    return RotaOut(
        passos=[],
        distancia_m=0,
        duracao_s=0,
        avisos=[],
        nivel_exigencia_atendido=6,
        motor="fixture",
        fontes=[],
        geometria={},
        cache=False,
    )


def _chaves(db) -> set[str]:
    return set(db.execute(text("SELECT chave FROM rota_cache")).scalars())


def test_guardar_apaga_o_que_venceu_e_mantem_o_que_vale(db_transacional):
    db_transacional.execute(text("DELETE FROM rota_cache"))
    cache_rota.guardar(db_transacional, "vencida", _saida(), regiao=REGIAO, agora=AGORA)
    cache_rota.guardar(
        db_transacional, "valendo", _saida(), regiao=REGIAO, agora=AGORA + timedelta(hours=5)
    )
    cache_rota.guardar(
        db_transacional, "nova", _saida(), regiao=REGIAO, agora=AGORA + timedelta(days=30)
    )
    assert _chaves(db_transacional) == {"nova"}

    cache_rota.guardar(
        db_transacional, "outra", _saida(), regiao=REGIAO, agora=AGORA + timedelta(days=30, hours=1)
    )
    assert _chaves(db_transacional) == {"nova", "outra"}

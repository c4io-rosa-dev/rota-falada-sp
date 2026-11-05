"""Regras puras da moderação (spec 2026-11-02-colaborativo-design.md, 3.3 e 6)."""

from datetime import UTC, datetime, timedelta

import pytest

from app.services.moderacao import (
    CATEGORIAS,
    Contagem,
    afeta_rota,
    decidir_status,
    expressao_status_efetivo,
    severidade_da_categoria,
    status_efetivo,
    status_inicial,
)

AGORA = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("categoria", "severidade"),
    [
        ("escada", "intransponivel"),
        ("sem_rampa", "intransponivel"),
        ("elevador_quebrado", "intransponivel"),
        ("obstaculo_bloqueando", "intransponivel"),
        ("calcada_estreita", "dificulta"),
        ("rampa_ingreme", "dificulta"),
        ("buraco", "dificulta"),
        ("piso_irregular", "dificulta"),
        ("sem_piso_tatil", "informativo"),
        ("outro", "informativo"),
    ],
)
def test_severidade_da_categoria(categoria, severidade):
    assert severidade_da_categoria(categoria) == severidade


def test_lista_fechada_tem_dez_categorias():
    assert len(CATEGORIAS) == 10


def test_categoria_desconhecida():
    with pytest.raises(ValueError):
        severidade_da_categoria("inventada")


@pytest.mark.parametrize(
    ("severidade", "esperado"),
    [("intransponivel", "pendente"), ("dificulta", "pendente"), ("informativo", "validada")],
)
def test_status_inicial(severidade, esperado):
    assert status_inicial(severidade) == esperado


@pytest.mark.parametrize(
    ("atual", "severidade", "contagem", "esperado"),
    [
        ("pendente", "intransponivel", Contagem(confirma=1), "pendente"),
        ("pendente", "intransponivel", Contagem(confirma=2), "validada"),
        ("pendente", "dificulta", Contagem(), "pendente"),
        ("pendente", "dificulta", Contagem(confirma=1), "validada"),
        ("validada", "informativo", Contagem(), "validada"),
        ("validada", "intransponivel", Contagem(confirma=1), "pendente"),
        ("validada", "intransponivel", Contagem(confirma=5, contesta=2), "contestada"),
        ("pendente", "dificulta", Contagem(confirma=3, resolvida=2), "resolvida"),
        ("validada", "dificulta", Contagem(contesta=2, resolvida=2), "contestada"),
        ("pendente", "intransponivel", Contagem(confirma=1, contesta=1, resolvida=1), "pendente"),
        ("contestada", "intransponivel", Contagem(confirma=9), "contestada"),
        ("resolvida", "dificulta", Contagem(confirma=9), "resolvida"),
        ("expirada", "dificulta", Contagem(confirma=9), "expirada"),
        ("removida", "dificulta", Contagem(confirma=9), "removida"),
    ],
)
def test_decidir_status(atual, severidade, contagem, esperado):
    assert decidir_status(atual, severidade, contagem) == esperado


@pytest.mark.parametrize(
    ("atual", "contagem", "voto", "esperado"),
    [
        ("validada", Contagem(confirma=1), "confirma", "validada"),
        ("validada", Contagem(confirma=1, contesta=2), "confirma", "validada"),
        ("validada", Contagem(contesta=1), "contesta", "pendente"),
        ("validada", Contagem(resolvida=1), "resolvida", "pendente"),
        ("pendente", Contagem(confirma=1), "confirma", "pendente"),
        ("contestada", Contagem(confirma=9), "confirma", "contestada"),
    ],
)
def test_confirmar_nao_rebaixa_validada(atual, contagem, voto, esperado):
    assert decidir_status(atual, "intransponivel", contagem, voto) == esperado


@pytest.mark.parametrize(
    ("status", "criado_dias", "ultima_dias", "esperado"),
    [
        ("pendente", 30, None, "pendente"),
        ("pendente", 31, None, "expirada"),
        ("validada", 180, None, "validada"),
        ("validada", 181, None, "expirada"),
        ("validada", 400, 10, "validada"),
        ("validada", 400, 181, "expirada"),
        ("contestada", 999, None, "contestada"),
        ("removida", 999, None, "removida"),
    ],
)
def test_status_efetivo(status, criado_dias, ultima_dias, esperado):
    criado = AGORA - timedelta(days=criado_dias)
    ultima = None if ultima_dias is None else AGORA - timedelta(days=ultima_dias)
    assert status_efetivo(status, criado, ultima, AGORA) == esperado


@pytest.mark.parametrize(
    ("status", "severidade", "esperado"),
    [
        ("validada", "intransponivel", True),
        ("validada", "dificulta", True),
        ("validada", "informativo", False),
        ("pendente", "intransponivel", False),
        ("contestada", "dificulta", False),
    ],
)
def test_afeta_rota(status, severidade, esperado):
    assert afeta_rota(status, severidade) is esperado


def test_expressao_sql_usa_os_mesmos_prazos():
    expressao = expressao_status_efetivo("b", ":agora")
    assert "b.status = 'pendente'" in expressao
    assert "interval '30 days'" in expressao
    assert "interval '180 days'" in expressao
    assert "coalesce(b.ultima_confirmacao_em, b.criado_em)" in expressao

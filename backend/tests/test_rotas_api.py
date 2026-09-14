"""Teste de contrato de `POST /api/rotas` (Tarefa 7 do Plano 4).

Usa sempre `OrsFixtureClient` (nunca a rede) sobre um caso real de
`casos_referencia.json` — o corpo da resposta precisa ter, em `passos[0]`,
todos os campos de `Passo` (contrato com o Plano 5, frontend)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db import SessionLocal
from app.main import create_app
from app.routers.rotas import obter_cliente_ors
from app.services.ors_client import EstadoCota, OrsFixtureClient

_CASOS = json.loads((Path(__file__).parent / "casos_referencia.json").read_text(encoding="utf-8"))
_CASO_REFERENCIA = next(c for c in _CASOS if c["nome"] == "vila_mariana_curta_1")

_CAMPOS_PASSO = {
    "ordem",
    "instrucao",
    "distancia_m",
    "duracao_s",
    "direcao",
    "largura_m",
    "largura_medida",
    "declividade_pct",
    "declividade_medida",
    "guia",
    "is_degrau",
    "barreiras_proximas",
    "fonte",
    "data_referencia",
    "geometria",
}


def _cliente_fixture() -> OrsFixtureClient:
    return OrsFixtureClient(
        chave="", base_url="https://x.invalido", timeout_s=1.0, estado=EstadoCota()
    )


@pytest.fixture
def cache_rota_vazio():
    """Esvazia `rota_cache` antes do teste: os testes de contrato commitam
    de verdade (é o router real, via `get_db`), então uma rodada anterior da
    suíte (ou `test_post_rotas_grava_no_cache_...` antes deste) pode ter
    deixado uma entrada válida (TTL 6h) para o mesmo par origem/destino,
    fazendo `cache` vir `True` quando o teste espera um cache miss."""
    sessao = SessionLocal()
    try:
        sessao.execute(text("DELETE FROM rota_cache"))
        sessao.commit()
    finally:
        sessao.close()


def test_post_rotas_latitude_invalida_devolve_422():
    resposta = TestClient(create_app()).post(
        "/api/rotas",
        json={
            "origem": {"lat": 91, "lng": -46.63},
            "destino": {"lat": -23.60, "lng": -46.64},
        },
    )
    assert resposta.status_code == 422


@pytest.mark.integration
def test_post_rotas_caso_de_referencia_devolve_200_com_todos_os_campos_do_passo(
    cache_rota_vazio,
):
    app = create_app()
    app.dependency_overrides[obter_cliente_ors] = _cliente_fixture
    resposta = TestClient(app).post(
        "/api/rotas",
        json={
            "origem": _CASO_REFERENCIA["origem"],
            "destino": _CASO_REFERENCIA["destino"],
        },
    )
    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["motor"] == "fixture"
    assert corpo["cache"] is False
    assert len(corpo["passos"]) >= 1
    assert _CAMPOS_PASSO <= corpo["passos"][0].keys()
    assert corpo["distancia_m"] > 0
    assert corpo["nivel_exigencia_atendido"] in (3, 6, 10, "any")


@pytest.mark.integration
def test_post_rotas_grava_no_cache_e_a_segunda_chamada_devolve_cache_true(cache_rota_vazio):
    app = create_app()
    app.dependency_overrides[obter_cliente_ors] = _cliente_fixture
    corpo = {
        "origem": _CASO_REFERENCIA["origem"],
        "destino": _CASO_REFERENCIA["destino"],
    }
    cliente_http = TestClient(app)
    primeira = cliente_http.post("/api/rotas", json=corpo)
    assert primeira.status_code == 200
    assert primeira.json()["cache"] is False

    segunda = cliente_http.post("/api/rotas", json=corpo)
    assert segunda.status_code == 200
    assert segunda.json()["cache"] is True

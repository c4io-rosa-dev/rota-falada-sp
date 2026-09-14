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
from app.services.ors_client import EstadoCota, OrsErro, OrsFixtureClient

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


# bem fora das três area_piloto (mesmo ponto-base de test_pgrouting.py e
# test_barreira_geom_db.py): não há nenhum no_pedestre a 300 m dali, então
# `rota_pgrouting` sempre devolve `None` para esses pontos — é o que deixa
# as duas branches de tradução de erro do router (404/503) exercitáveis sem
# depender de o ORS realmente estar fora do ar.
_ORIGEM_FORA_DO_PILOTO = {"lat": -24.048988029889923, "lng": -45.98351729900837}
_DESTINO_FORA_DO_PILOTO = {"lat": -24.048988029889923, "lng": -45.973517299008374}


class _ClienteOrsSemRotaEmTodosOsNiveis:
    """Simula o ORS respondendo `sem_rota` (código 2009/2010) em toda
    passada, em todo nível do fallback progressivo — nunca por cota ou
    indisponibilidade. `calcular()` esgota os níveis sem `_OrsIndisponivel`
    e `RotaNaoEncontrada.erro_ors` fica `None`; combinado com pgRouting
    também sem rota (pontos fora do piloto), o router deve devolver 404."""

    def __init__(self) -> None:
        self.estado = EstadoCota()

    def rota(
        self,
        coords: list[tuple[float, float]],
        *,
        restricoes: dict,
        evitar_degraus: bool,
        avoid_polygons: dict | None,
    ) -> dict:
        raise OrsErro("sem_rota")


class _ClienteOrsCotaDiariaEsgotada:
    """Simula a cota diária do ORS estourada (HTTP 403) já na 1ª passada do
    primeiro nível: `_tentar_nivel` levanta `_OrsIndisponivel` e `calcular()`
    abandona o ORS de vez, indo direto para o pgRouting. Combinado com
    pgRouting também sem rota (pontos fora do piloto), o router deve
    devolver 503 — falha de serviço, não "não existe rota"."""

    def __init__(self) -> None:
        self.estado = EstadoCota()

    def rota(
        self,
        coords: list[tuple[float, float]],
        *,
        restricoes: dict,
        evitar_degraus: bool,
        avoid_polygons: dict | None,
    ) -> dict:
        raise OrsErro("cota_diaria")


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


@pytest.mark.integration
def test_post_rotas_sem_rota_em_nenhum_motor_devolve_404(cache_rota_vazio):
    """`OrsErro('sem_rota')` em todos os níveis (não é problema de cota/
    indisponibilidade) e pgRouting também sem rota (pontos fora do piloto,
    sem `no_pedestre` por perto) → `RotaNaoEncontrada(erro_ors=None)` →
    404. Se alguém inverter `if erro.erro_ors is not None` no router, este
    teste passa a ver 503 e falha."""
    app = create_app()
    app.dependency_overrides[obter_cliente_ors] = _ClienteOrsSemRotaEmTodosOsNiveis
    resposta = TestClient(app).post(
        "/api/rotas",
        json={"origem": _ORIGEM_FORA_DO_PILOTO, "destino": _DESTINO_FORA_DO_PILOTO},
    )
    assert resposta.status_code == 404
    assert "detail" in resposta.json()


@pytest.mark.integration
def test_post_rotas_cota_do_ors_esgotada_e_pgrouting_tambem_falha_devolve_503(
    cache_rota_vazio,
):
    """`OrsErro('cota_diaria')` tira o ORS do laço de níveis antes de
    esgotá-los (`RotaNaoEncontrada.erro_ors` presente) e pgRouting também
    não acha rota (pontos fora do piloto) → 503, não 404: é falha de
    serviço (cota do dia), não "não existe rota acessível entre esses
    pontos". Se alguém inverter `if erro.erro_ors is not None` no router,
    este teste passa a ver 404 e falha."""
    app = create_app()
    app.dependency_overrides[obter_cliente_ors] = _ClienteOrsCotaDiariaEsgotada
    resposta = TestClient(app).post(
        "/api/rotas",
        json={"origem": _ORIGEM_FORA_DO_PILOTO, "destino": _DESTINO_FORA_DO_PILOTO},
    )
    assert resposta.status_code == 503
    assert "detail" in resposta.json()

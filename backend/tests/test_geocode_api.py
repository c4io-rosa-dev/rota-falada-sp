"""Contrato HTTP do geocode (spec 2026-11-02-geocode-design.md, 4 e 5)."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.db import get_db
from app.main import create_app
from app.routers.geocode import (
    CACHE_CONTROL,
    CACHE_CONTROL_REVERSO,
    CACHE_CONTROL_VAZIO,
    MSG_INDISPONIVEL,
)
from app.services.geocode import MSG_FORA_DA_AREA

pytestmark = pytest.mark.integration


@pytest.fixture
def cliente(db_geocode):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db_geocode
    return TestClient(app)


def test_busca_devolve_lista_com_cache(cliente, semear_endereco):
    semear_endereco("lugar", "Fatec Ipiranga · Ipiranga", "fatec ipiranga", -46.60, -23.59)
    resposta = cliente.get("/api/geocode", params={"q": "fatec"})
    assert resposta.status_code == 200
    assert resposta.headers["cache-control"] == CACHE_CONTROL
    corpo = resposta.json()
    assert corpo[0]["rotulo"] == "Fatec Ipiranga · Ipiranga"
    assert set(corpo[0]) == {"id", "tipo", "rotulo", "lat", "lon", "aproximado"}


def test_busca_sem_resultado_e_200_com_lista_vazia(cliente):
    resposta = cliente.get("/api/geocode", params={"q": "xyzxyzxyz"})
    assert resposta.status_code == 200
    assert resposta.json() == []
    assert resposta.headers["cache-control"] == CACHE_CONTROL_VAZIO


@pytest.mark.parametrize(
    "params",
    [
        {"q": "  ab  "},
        {"q": "a" * 101},
        {"q": "fatec", "limite": 0},
        {"q": "fatec", "limite": 11},
        {},
    ],
    ids=["q-curto-apos-strip", "q-longo", "limite-zero", "limite-acima-de-10", "sem-q"],
)
def test_busca_invalida_e_422(cliente, params):
    assert cliente.get("/api/geocode", params=params).status_code == 422


def test_reverso_devolve_endereco_com_cache(cliente, area_teste, semear_endereco, deslocar):
    lon, lat = area_teste
    semear_endereco(
        "endereco",
        "Rua Perto, 20 · Teste",
        "rua perto 20",
        *deslocar(lon, lat, 20, 0),
        "Rua Perto",
        "20",
        20,
    )
    resposta = cliente.get("/api/geocode/reverso", params={"lat": lat, "lon": lon})
    assert resposta.status_code == 200
    assert resposta.headers["cache-control"] == CACHE_CONTROL_REVERSO
    assert resposta.json()["rotulo"] == "Rua Perto, 20 · Teste"


def test_reverso_fora_da_area_e_404_em_portugues(cliente):
    resposta = cliente.get("/api/geocode/reverso", params={"lat": -25.0, "lon": -46.0})
    assert resposta.status_code == 404
    assert resposta.json()["detail"] == MSG_FORA_DA_AREA


@pytest.mark.parametrize(
    "params",
    [{"lat": 91, "lon": 0}, {"lat": 0, "lon": -181}, {"lat": -23.5}],
    ids=["lat-invalida", "lon-invalida", "sem-lon"],
)
def test_reverso_invalido_e_422(cliente, params):
    assert cliente.get("/api/geocode/reverso", params=params).status_code == 422


class _SessaoSemBanco:
    def execute(self, *args, **kwargs):
        raise OperationalError("SELECT 1", {}, Exception("conexão recusada"))


@pytest.mark.parametrize(
    ("rota", "params"),
    [("/api/geocode", {"q": "fatec"}), ("/api/geocode/reverso", {"lat": -23.59, "lon": -46.6})],
)
def test_banco_fora_do_ar_e_503(rota, params):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: _SessaoSemBanco()
    resposta = TestClient(app).get(rota, params=params)
    assert resposta.status_code == 503
    assert resposta.json()["detail"] == MSG_INDISPONIVEL

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

pytestmark = pytest.mark.integration


def test_lista_fontes_com_atribuicao_e_licenca():
    client = TestClient(create_app())
    resposta = client.get("/api/fontes")
    assert resposta.status_code == 200
    fontes = resposta.json()
    assert [f["chave"] for f in fontes] == [
        "colaborativo",
        "geosampa",
        "ors",
        "osm",
        "sp156",
        "sptrans",
    ]
    osm = next(f for f in fontes if f["chave"] == "osm")
    assert osm["licenca"] == "ODbL 1.0"
    assert "OpenStreetMap" in osm["atribuicao"]
    geosampa = next(f for f in fontes if f["chave"] == "geosampa")
    assert geosampa["data_referencia"] == "2021-08-13"

import json
from pathlib import Path

import pytest

from app.services.ors_client import EstadoCota, OrsErro, OrsFixtureClient


@pytest.fixture()
def diretorio_fixtures(tmp_path: Path) -> Path:
    return tmp_path


def _escreve(diretorio: Path, nome: str, conteudo: dict) -> None:
    (diretorio / f"{nome}.json").write_text(json.dumps(conteudo), encoding="utf-8")


def _feature_generica() -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "segments": [
                        {
                            "distance": 100.0,
                            "duration": 120.0,
                            "steps": [
                                {
                                    "distance": 100.0,
                                    "duration": 120.0,
                                    "instruction": "Siga em frente",
                                    "name": "",
                                    "way_points": [0, 1],
                                }
                            ],
                        }
                    ],
                    "extras": {"steepness": {"values": [[0, 1, 0]]}},
                    "summary": {
                        "distance": 100.0,
                        "duration": 120.0,
                        "ascent": 0.0,
                        "descent": 0.0,
                    },
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-46.60000, -23.50000, 730.0], [-46.59900, -23.49900, 731.0]],
                },
            }
        ],
    }


def _cliente(diretorio: Path) -> OrsFixtureClient:
    return OrsFixtureClient(
        chave="",
        base_url="https://api.openrouteservice.org",
        timeout_s=15.0,
        estado=EstadoCota(),
        diretorio_fixtures=diretorio,
    )


def test_le_fixture_exata_pela_coordenada_arredondada_e_inclinacao(diretorio_fixtures):
    origem = (-46.63331, -23.55052)
    destino = (-46.63200, -23.54900)
    nome = "-23.55052_-46.63331_-23.549_-46.632_6"
    conteudo = _feature_generica()
    _escreve(diretorio_fixtures, nome, conteudo)

    cliente = _cliente(diretorio_fixtures)
    resposta = cliente.rota(
        [origem, destino],
        restricoes={"maximum_incline": 6},
        evitar_degraus=True,
        avoid_polygons=None,
    )

    assert resposta == conteudo


def test_sem_fixture_exata_usa_generica_traduzida_mantendo_a_forma(diretorio_fixtures):
    generica = _feature_generica()
    _escreve(diretorio_fixtures, "generica", generica)

    origem = (-46.70000, -23.60000)
    destino = (-46.69900, -23.59900)
    cliente = _cliente(diretorio_fixtures)

    resposta = cliente.rota(
        [origem, destino],
        restricoes={"maximum_incline": 6},
        evitar_degraus=True,
        avoid_polygons=None,
    )

    coordenadas = resposta["features"][0]["geometry"]["coordinates"]
    # o primeiro ponto foi transladado para a origem pedida
    assert coordenadas[0][0] == pytest.approx(origem[0])
    assert coordenadas[0][1] == pytest.approx(origem[1])
    # a forma (distância relativa entre os pontos) foi mantida
    delta_lng_original = (
        generica["features"][0]["geometry"]["coordinates"][1][0]
        - (generica["features"][0]["geometry"]["coordinates"][0][0])
    )
    delta_lng_traduzido = coordenadas[1][0] - coordenadas[0][0]
    assert delta_lng_traduzido == pytest.approx(delta_lng_original)
    # elevação não é alterada pela translação
    assert coordenadas[0][2] == generica["features"][0]["geometry"]["coordinates"][0][2]


def test_fixture_com_erro_codigo_levanta_ors_erro(diretorio_fixtures):
    origem = (-46.63331, -23.55052)
    destino = (-46.63200, -23.54900)
    nome = "-23.55052_-46.63331_-23.549_-46.632_3"
    _escreve(diretorio_fixtures, nome, {"erro_codigo": "sem_rota"})

    cliente = _cliente(diretorio_fixtures)

    with pytest.raises(OrsErro) as exc:
        cliente.rota(
            [origem, destino],
            restricoes={"maximum_incline": 3},
            evitar_degraus=True,
            avoid_polygons=None,
        )
    assert exc.value.codigo == "sem_rota"


def test_nunca_chama_rede(diretorio_fixtures, monkeypatch):
    _escreve(diretorio_fixtures, "generica", _feature_generica())

    def _explode(*args, **kwargs):
        raise AssertionError("OrsFixtureClient não deve chamar a rede")

    monkeypatch.setattr("httpx.post", _explode)

    cliente = _cliente(diretorio_fixtures)
    cliente.rota(
        [(-46.7, -23.6), (-46.699, -23.599)],
        restricoes={"maximum_incline": 6},
        evitar_degraus=True,
        avoid_polygons=None,
    )

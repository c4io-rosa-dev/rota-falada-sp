import json
from datetime import UTC, datetime

import httpx
import pytest
import respx

from app.config import Settings
from app.services.ors_client import (
    EstadoCota,
    OrsClient,
    OrsErro,
    OrsFixtureClient,
    criar_cliente,
)

URL_ORS = "https://api.openrouteservice.org/v2/directions/wheelchair/geojson"

COORDS = [(-46.63331, -23.55052), (-46.63200, -23.54900)]

RESPOSTA_OK = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {
                "segments": [
                    {
                        "distance": 150.0,
                        "duration": 180.0,
                        "steps": [
                            {
                                "distance": 150.0,
                                "duration": 180.0,
                                "instruction": "Siga pela Rua X",
                                "name": "Rua X",
                                "way_points": [0, 1],
                            }
                        ],
                    }
                ],
                "extras": {"steepness": {"values": [[0, 1, 0]]}},
                "summary": {"distance": 150.0, "duration": 180.0, "ascent": 1.0, "descent": 0.5},
            },
            "geometry": {
                "type": "LineString",
                "coordinates": [[-46.63331, -23.55052, 720.0], [-46.63200, -23.54900, 722.0]],
            },
        }
    ],
}


def _cliente(**kwargs) -> OrsClient:
    padrao = dict(
        chave="chave-teste",
        base_url="https://api.openrouteservice.org",
        timeout_s=15.0,
        estado=EstadoCota(),
    )
    padrao.update(kwargs)
    return OrsClient(**padrao)


# --- corpo da requisição -----------------------------------------------------


@respx.mock
def test_faz_post_com_corpo_completo_incluindo_avoid_polygons_e_avoid_features():
    rota_mock = respx.post(URL_ORS).mock(
        return_value=httpx.Response(200, json=RESPOSTA_OK, headers={})
    )
    cliente = _cliente()
    avoid = {"type": "MultiPolygon", "coordinates": []}
    restricoes = {"maximum_incline": 6}

    cliente.rota(COORDS, restricoes=restricoes, evitar_degraus=True, avoid_polygons=avoid)

    assert rota_mock.called
    requisicao = rota_mock.calls.last.request
    assert requisicao.method == "POST"
    corpo = json.loads(requisicao.content)
    assert corpo["coordinates"] == [[-46.63331, -23.55052], [-46.632, -23.549]]
    assert corpo["elevation"] is True
    assert corpo["instructions"] is True
    assert corpo["language"] == "pt"
    assert corpo["extra_info"] == ["steepness", "surface", "waytype"]
    assert corpo["units"] == "m"
    assert corpo["options"]["avoid_features"] == ["steps"]
    assert corpo["options"]["profile_params"]["restrictions"] == restricoes
    assert corpo["options"]["avoid_polygons"] == avoid
    assert requisicao.headers["Authorization"] == "chave-teste"


@respx.mock
def test_omite_avoid_polygons_quando_nao_informado():
    rota_mock = respx.post(URL_ORS).mock(return_value=httpx.Response(200, json=RESPOSTA_OK))
    cliente = _cliente()

    cliente.rota(
        COORDS, restricoes={"maximum_incline": 6}, evitar_degraus=True, avoid_polygons=None
    )

    corpo = json.loads(rota_mock.calls.last.request.content)
    assert "avoid_polygons" not in corpo["options"]


@respx.mock
def test_omite_avoid_features_quando_evitar_degraus_false():
    rota_mock = respx.post(URL_ORS).mock(return_value=httpx.Response(200, json=RESPOSTA_OK))
    cliente = _cliente()

    cliente.rota(
        COORDS, restricoes={"maximum_incline": 6}, evitar_degraus=False, avoid_polygons=None
    )

    corpo = json.loads(rota_mock.calls.last.request.content)
    assert "avoid_features" not in corpo["options"]


# --- cotas --------------------------------------------------------------------


@respx.mock
def test_le_headers_de_cota_e_atualiza_estado():
    reset_epoch = 1_800_000_000
    respx.post(URL_ORS).mock(
        return_value=httpx.Response(
            200,
            json=RESPOSTA_OK,
            headers={"x-ratelimit-remaining": "1999", "x-ratelimit-reset": str(reset_epoch)},
        )
    )
    estado = EstadoCota()
    cliente = _cliente(estado=estado)

    cliente.rota(
        COORDS, restricoes={"maximum_incline": 6}, evitar_degraus=True, avoid_polygons=None
    )

    assert estado.restante == 1999
    assert estado.reset_em == datetime.fromtimestamp(reset_epoch, tz=UTC)
    assert estado.atualizado_em is not None


# --- mapeamento de erros -------------------------------------------------------


@respx.mock
def test_403_levanta_ors_erro_cota_diaria():
    respx.post(URL_ORS).mock(return_value=httpx.Response(403, json={"error": "quota"}))
    cliente = _cliente()

    with pytest.raises(OrsErro) as exc:
        cliente.rota(COORDS, restricoes={}, evitar_degraus=True, avoid_polygons=None)
    assert exc.value.codigo == "cota_diaria"


@respx.mock
def test_429_levanta_ors_erro_cota_minuto():
    respx.post(URL_ORS).mock(return_value=httpx.Response(429, json={"error": "rate"}))
    cliente = _cliente()

    with pytest.raises(OrsErro) as exc:
        cliente.rota(COORDS, restricoes={}, evitar_degraus=True, avoid_polygons=None)
    assert exc.value.codigo == "cota_minuto"


@pytest.mark.parametrize("codigo_ors", [2009, 2010])
@respx.mock
def test_404_com_codigo_de_sem_rota_levanta_ors_erro_sem_rota(codigo_ors):
    respx.post(URL_ORS).mock(
        return_value=httpx.Response(404, json={"error": {"code": codigo_ors, "message": "x"}})
    )
    cliente = _cliente()

    with pytest.raises(OrsErro) as exc:
        cliente.rota(COORDS, restricoes={}, evitar_degraus=True, avoid_polygons=None)
    assert exc.value.codigo == "sem_rota"


@respx.mock
def test_404_com_outro_codigo_levanta_ors_erro_indisponivel():
    respx.post(URL_ORS).mock(
        return_value=httpx.Response(404, json={"error": {"code": 9999, "message": "x"}})
    )
    cliente = _cliente()

    with pytest.raises(OrsErro) as exc:
        cliente.rota(COORDS, restricoes={}, evitar_degraus=True, avoid_polygons=None)
    assert exc.value.codigo == "indisponivel"


@pytest.mark.parametrize("status", [400, 406])
@respx.mock
def test_400_e_406_levantam_ors_erro_entrada_invalida(status):
    respx.post(URL_ORS).mock(return_value=httpx.Response(status, json={"error": "bad"}))
    cliente = _cliente()

    with pytest.raises(OrsErro) as exc:
        cliente.rota(COORDS, restricoes={}, evitar_degraus=True, avoid_polygons=None)
    assert exc.value.codigo == "entrada_invalida"


@respx.mock
def test_timeout_levanta_ors_erro_indisponivel():
    respx.post(URL_ORS).mock(side_effect=httpx.TimeoutException("tempo esgotado"))
    cliente = _cliente()

    with pytest.raises(OrsErro) as exc:
        cliente.rota(COORDS, restricoes={}, evitar_degraus=True, avoid_polygons=None)
    assert exc.value.codigo == "indisponivel"


@respx.mock
def test_5xx_levanta_ors_erro_indisponivel():
    respx.post(URL_ORS).mock(return_value=httpx.Response(503, text="fora do ar"))
    cliente = _cliente()

    with pytest.raises(OrsErro) as exc:
        cliente.rota(COORDS, restricoes={}, evitar_degraus=True, avoid_polygons=None)
    assert exc.value.codigo == "indisponivel"


@respx.mock
def test_erro_de_conexao_levanta_ors_erro_indisponivel():
    respx.post(URL_ORS).mock(side_effect=httpx.ConnectError("conexão recusada"))
    cliente = _cliente()

    with pytest.raises(OrsErro) as exc:
        cliente.rota(COORDS, restricoes={}, evitar_degraus=True, avoid_polygons=None)
    assert exc.value.codigo == "indisponivel"


@respx.mock
def test_404_com_corpo_nao_json_levanta_ors_erro_indisponivel():
    respx.post(URL_ORS).mock(return_value=httpx.Response(404, text="não encontrado"))
    cliente = _cliente()

    with pytest.raises(OrsErro) as exc:
        cliente.rota(COORDS, restricoes={}, evitar_degraus=True, avoid_polygons=None)
    assert exc.value.codigo == "indisponivel"


@respx.mock
def test_404_com_corpo_json_nao_objeto_levanta_ors_erro_indisponivel():
    respx.post(URL_ORS).mock(return_value=httpx.Response(404, json=["algo"]))
    cliente = _cliente()

    with pytest.raises(OrsErro) as exc:
        cliente.rota(COORDS, restricoes={}, evitar_degraus=True, avoid_polygons=None)
    assert exc.value.codigo == "indisponivel"


@respx.mock
def test_404_com_corpo_json_sem_campo_error_levanta_ors_erro_indisponivel():
    respx.post(URL_ORS).mock(return_value=httpx.Response(404, json={"algo": "sem error"}))
    cliente = _cliente()

    with pytest.raises(OrsErro) as exc:
        cliente.rota(COORDS, restricoes={}, evitar_degraus=True, avoid_polygons=None)
    assert exc.value.codigo == "indisponivel"


# --- criar_cliente --------------------------------------------------------------


def test_criar_cliente_sem_chave_devolve_fixture_client():
    settings = Settings(ors_api_key=None, use_fixtures=False)
    cliente = criar_cliente(settings)
    assert isinstance(cliente, OrsFixtureClient)


def test_criar_cliente_com_use_fixtures_devolve_fixture_client_mesmo_com_chave():
    settings = Settings(ors_api_key="alguma-chave", use_fixtures=True)
    cliente = criar_cliente(settings)
    assert isinstance(cliente, OrsFixtureClient)


def test_criar_cliente_com_chave_e_sem_use_fixtures_devolve_ors_client_real():
    settings = Settings(ors_api_key="alguma-chave", use_fixtures=False)
    cliente = criar_cliente(settings)
    assert type(cliente) is OrsClient

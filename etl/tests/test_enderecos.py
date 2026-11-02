"""Funções puras da etapa `enderecos` (spec 2026-11-02-geocode-design.md, 3.2).
Rodam sem banco e sem osmium, sobre `tests/dados/enderecos_amostra.geojsonseq`."""

from pathlib import Path

import pytest
from shapely.geometry import Point, shape

from etl.enderecos import (
    Registro,
    bairro_de,
    deduplicar,
    ler_geojsonseq,
    numero_inteiro,
    registro_de_feature,
    registros_logradouro,
)

_AMOSTRA = Path(__file__).parent / "dados" / "enderecos_amostra.geojsonseq"


@pytest.fixture(scope="module")
def features() -> dict[int, dict]:
    return {f["properties"]["@id"]: f for f in ler_geojsonseq(_AMOSTRA)}


def test_ler_geojsonseq_le_todas_as_linhas_e_ignora_separador(features):
    assert sorted(features) == [101, 104, 105, 202, 303, 404, 505, 707, 909]


def test_registro_de_endereco(features):
    registro = registro_de_feature(features[101])
    assert registro == Registro(
        tipo="endereco",
        rotulo="Rua Vergueiro, 3000 · Vila Mariana",
        logradouro="Rua Vergueiro",
        numero="3000",
        numero_int=3000,
        categoria=None,
        texto_busca="rua vergueiro 3000",
        lon=-46.635,
        lat=-23.59,
        osm_tipo="n",
        osm_id=101,
    )


def test_registro_de_lugar_em_poligono_vira_ponto_dentro_dele(features):
    registro = registro_de_feature(features[202])
    assert registro.tipo == "lugar"
    assert registro.rotulo == "Fatec Ipiranga — Rua Frei João, 59 · Ipiranga"
    assert registro.texto_busca == "fatec ipiranga rua frei joao 59"
    assert registro.categoria == "college"
    assert (registro.osm_tipo, registro.osm_id) == ("w", 202)
    poligono = shape(features[202]["geometry"])
    assert poligono.contains(Point(registro.lon, registro.lat))


def test_registro_de_lugar_sem_endereco(features):
    registro = registro_de_feature(features[303])
    assert registro.tipo == "lugar"
    assert registro.rotulo == "Estação Lapa · Lapa"
    assert registro.texto_busca == "estacao lapa"
    assert registro.logradouro is None
    assert registro.numero is None


@pytest.mark.parametrize("osm_id", [404, 505, 909], ids=["fora-da-area", "via-sem-dados", "sem-rua"])
def test_registro_descartado(features, osm_id):
    assert registro_de_feature(features[osm_id]) is None


def test_bairro_na_sobreposicao_e_o_primeiro_da_area_piloto(features):
    assert registro_de_feature(features[707]).rotulo == "Rua Sorocabanos, 10 · Vila Mariana"
    assert bairro_de(-46.620, -23.59) == "Vila Mariana"
    assert bairro_de(-46.60, -23.59) == "Ipiranga"
    assert bairro_de(-46.50, -23.50) is None


def test_deduplicar_remove_mesmo_texto_a_menos_de_15_m_e_mantem_o_menor_osm_id(features):
    registros = [registro_de_feature(features[i]) for i in (105, 101, 104)]
    mantidos = deduplicar(registros)
    assert sorted(r.osm_id for r in mantidos) == [101, 105]


def test_deduplicar_remove_mesmo_objeto_osm_repetido(features):
    registro = registro_de_feature(features[101])
    assert deduplicar([registro, registro]) == [registro]


@pytest.mark.parametrize(
    ("numero", "esperado"),
    [("1000", 1000), ("1000A", 1000), ("1000-A", 1000), ("s/n", None),
     ("1234567890", None), ("", None), (None, None)],
)
def test_numero_inteiro(numero, esperado):
    assert numero_inteiro(numero) == esperado


def test_registros_logradouro():
    registros = registros_logradouro(
        [
            ("Rua Vergueiro", "Vila Mariana", -46.63, -23.58),
            ("   ", "Lapa", -46.70, -23.53),
            ("Rua Fora", "Lapa", -46.50, -23.50),
        ]
    )
    assert registros == [
        Registro(
            tipo="logradouro",
            rotulo="Rua Vergueiro · Vila Mariana",
            logradouro="Rua Vergueiro",
            numero=None,
            numero_int=None,
            categoria=None,
            texto_busca="rua vergueiro",
            lon=-46.63,
            lat=-23.58,
            osm_tipo=None,
            osm_id=None,
        )
    ]

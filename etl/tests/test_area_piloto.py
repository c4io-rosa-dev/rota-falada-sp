"""Forma da área piloto em `etl/etl/config.py` (sem banco): quem precisa ficar
dentro, os retângulos antigos intactos, área total e nenhuma costura solta."""

import pytest
from pyproj import Transformer
from shapely.geometry import Point
from shapely.ops import transform, unary_union

from etl.config import AREA_PILOTO, BBOX_UNIAO
from etl.enderecos import bairro_de
from etl.geo import bbox_para_poligono

FATEC = (-46.6082618, -23.609669)  # Rua Frei João, 59
METRO_ALTO_DO_IPIRANGA = (-46.6124857, -23.6022366)  # nó OSM da estação
_PARA_METROS = Transformer.from_crs("EPSG:4326", "EPSG:31983", always_xy=True).transform


def _retangulos():
    return {nome: bbox_para_poligono(bbox) for nome, bbox in AREA_PILOTO.items()}


@pytest.fixture
def uniao():
    return unary_union(list(_retangulos().values()))


@pytest.mark.parametrize(
    "ponto", [FATEC, METRO_ALTO_DO_IPIRANGA], ids=["fatec", "metro"]
)
def test_trajeto_da_apresentacao_fica_dentro_e_no_ipiranga(uniao, ponto):
    assert Point(ponto).within(uniao)
    assert bairro_de(*ponto) == "Ipiranga"


def test_recortes_antigos_ficam_iguais_e_na_frente():
    """`bairro_de` e `SQL_LOGRADOUROS` dão prioridade à primeira área: manter os
    três na frente preserva os rótulos dos endereços que já existiam."""
    assert list(AREA_PILOTO.items())[:3] == [
        ("Vila Mariana", (-46.660, -23.610, -46.615, -23.570)),
        ("Lapa", (-46.720, -23.545, -46.680, -23.510)),
        ("Ipiranga", (-46.625, -23.615, -46.590, -23.575)),
    ]


def test_uniao_e_um_pedaco_so_de_cerca_de_150_km2(uniao):
    assert uniao.geom_type == "Polygon"
    assert not uniao.interiors
    km2 = transform(_PARA_METROS, uniao).area / 1e6
    assert 140 <= km2 <= 160, f"área real: {km2:.1f} km²"


def test_nenhuma_costura_entre_retangulos_fica_sem_interior(uniao):
    """Os testes de qualidade usam `ST_Within` contra cada retângulo, e `within`
    é falso na borda: um ponto numa costura de dois retângulos só encostados
    estaria na união (e o ETL o carregaria), mas em nenhum retângulo. Por isso
    eles se sobrepõem, em vez de só se tocarem."""
    retangulos = _retangulos()
    for nome, retangulo in retangulos.items():
        costura = retangulo.boundary.difference(uniao.boundary)
        for outro_nome, outro in retangulos.items():
            if outro_nome != nome:
                costura = costura.difference(outro.buffer(-1e-9))
        assert costura.length < 1e-6, f"{nome}: costura solta {costura.wkt}"


def test_bbox_uniao_envolve_todos_os_retangulos(uniao):
    assert tuple(uniao.bounds) == pytest.approx(BBOX_UNIAO)

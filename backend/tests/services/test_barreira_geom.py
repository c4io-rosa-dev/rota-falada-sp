"""Testes puros (sem banco) da geometria de barreiras: corredor, buffers e
teto de polígonos. Todo cálculo métrico é conferido em EPSG:31983."""

from datetime import date

from shapely.geometry import LineString, Point, shape
from shapely.ops import transform

from app.services.barreira_geom import (
    PROJ_4326_31983,
    PROJ_31983_4326,
    BarreiraCandidata,
    corredor,
    poligonos_para_evitar,
)

# ponto arbitrário dentro do fuso 23S (SIRGAS 2000 / UTM 23S), perto da
# região piloto — só serve de origem para montar geometrias sintéticas.
_X0, _Y0 = 333_000.0, 7_394_500.0


def _linha_4326(comprimento_m: float) -> LineString:
    coords_31983 = [(_X0, _Y0), (_X0 + comprimento_m, _Y0)]
    return LineString([PROJ_31983_4326.transform(x, y) for x, y in coords_31983])


def _ponto_4326(dx_m: float, dy_m: float = 0.0) -> Point:
    lng, lat = PROJ_31983_4326.transform(_X0 + dx_m, _Y0 + dy_m)
    return Point(lng, lat)


def _barreira(id_: int, dx_m: float, severidade: str = "intransponivel") -> BarreiraCandidata:
    return BarreiraCandidata(
        id=id_,
        origem="oficial",
        categoria="buraco",
        severidade=severidade,
        geom=_ponto_4326(dx_m),
        confirmacoes=None,
        data_referencia=date(2026, 1, 1),
    )


def test_corredor_de_linha_de_1km_tem_area_aproximada_de_1000_por_100_m2():
    linha = _linha_4326(1000.0)

    poligono_4326 = corredor(linha, largura_m=50.0)
    poligono_31983 = transform(PROJ_4326_31983.transform, poligono_4326)

    esperado = 1000.0 * 100.0  # comprimento × (2×largura)
    assert esperado * 0.9 <= poligono_31983.area <= esperado * 1.1


def test_poligonos_para_evitar_corta_no_teto_de_15():
    linha = _linha_4326(2000.0)
    # 20 barreiras espaçadas 100 m entre si: longe o bastante (>> 2×8 m) para
    # que os buffers não se fundam e cada uma vire um polígono separado.
    barreiras = [_barreira(i, dx_m=float(i) * 100.0) for i in range(20)]

    resultado = poligonos_para_evitar(barreiras, linha, teto=15, buffer_m=8.0)

    assert resultado is not None
    assert resultado["type"] == "MultiPolygon"
    assert len(resultado["coordinates"]) == 15


def test_buffer_de_8m_produz_poligono_com_raio_aproximado_de_8m():
    linha = _linha_4326(100.0)
    barreiras = [_barreira(1, dx_m=50.0)]

    resultado = poligonos_para_evitar(barreiras, linha, teto=15, buffer_m=8.0)

    assert resultado is not None
    geometria_4326 = shape(resultado)
    geometria_31983 = transform(PROJ_4326_31983.transform, geometria_4326)
    (poligono_31983,) = geometria_31983.geoms

    centro = poligono_31983.centroid
    raios = [centro.distance(Point(x, y)) for x, y in poligono_31983.exterior.coords]
    raio_medio = sum(raios) / len(raios)
    assert abs(raio_medio - 8.0) <= 0.2


def test_poligonos_para_evitar_devolve_none_sem_intransponiveis():
    linha = _linha_4326(200.0)
    barreiras = [
        _barreira(1, dx_m=50.0, severidade="dificulta"),
        _barreira(2, dx_m=100.0, severidade="dificulta"),
    ]

    assert poligonos_para_evitar(barreiras, linha, teto=15, buffer_m=8.0) is None


def test_poligonos_para_evitar_devolve_none_para_lista_vazia():
    linha = _linha_4326(200.0)
    assert poligonos_para_evitar([], linha, teto=15, buffer_m=8.0) is None


def test_poligonos_para_evitar_descarta_a_mais_distante_para_caber_na_extensao_maxima():
    # duas barreiras a 25 km uma da outra: juntas estourariam os 20 km de
    # extensão do avoid_polygons do ORS (Global Constraints); a função deve
    # descartar a mais distante da rota e devolver só a mais próxima.
    linha = _linha_4326(100.0)
    proxima = _barreira(1, dx_m=50.0)
    distante = _barreira(2, dx_m=25_050.0)

    resultado = poligonos_para_evitar([proxima, distante], linha, teto=15, buffer_m=8.0)

    assert resultado is not None
    assert len(resultado["coordinates"]) == 1


def test_poligonos_para_evitar_devolve_none_quando_nem_um_unico_buffer_cabe():
    # caso degenerado: um `buffer_m` absurdo faz até o único polígono
    # estourar sozinho os 200 km² do avoid_polygons do ORS.
    linha = _linha_4326(100.0)
    barreira = _barreira(1, dx_m=50.0)

    resultado = poligonos_para_evitar([barreira], linha, teto=15, buffer_m=15_000.0)

    assert resultado is None

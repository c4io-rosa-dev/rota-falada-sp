"""Teste de integração das regras de desempate da conflação (Task 2 do Plano
3): insere dados sintéticos, roda a query de candidatos direto sobre a mesma
conexão/transação e reverte tudo ao final — nunca commita, nunca toca a
tabela real `conflacao_via_calcada` nem mistura com os dados reais de
`via_pedestre`/`calcada_sp` (o ponto-base fica bem fora das três
`area_piloto`, onde não há nenhuma calçada nem via real carregada).
"""

from datetime import date

import pytest
from etl.config import DATABASE_URL
from etl.conflacao import _candidatos
from etl.db import fonte_id
from etl.geo import comprimento_m
from pyproj import Transformer
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from sqlalchemy import create_engine, text

pytestmark = pytest.mark.integration

_PROJ_DIRETO = Transformer.from_crs("EPSG:4326", "EPSG:31983", always_xy=True)
_PROJ_INVERSO = Transformer.from_crs("EPSG:31983", "EPSG:4326", always_xy=True)

# ids sentinela bem acima do que o ETL real carrega (25.040 vias, 22.422
# calçadas hoje) para nunca colidir com dados reais.
NO_A, NO_B = 900_000_001, 900_000_002
VIA_A, VIA_B, VIA_C = 900_000_001, 900_000_002, 900_000_003
CAL_A, CAL_B1, CAL_B2, CAL_C1, CAL_C2 = (
    900_000_001,
    900_000_002,
    900_000_003,
    900_000_004,
    900_000_005,
)


def _linha_31983(pontos: list[tuple[float, float]]) -> LineString:
    return LineString([_PROJ_INVERSO.transform(x, y) for x, y in pontos])


def _poligono_31983(x0: float, y0: float, x1: float, y1: float) -> MultiPolygon:
    quadrado = box(x0, y0, x1, y1)
    anel = [_PROJ_INVERSO.transform(x, y) for x, y in quadrado.exterior.coords]
    return MultiPolygon([Polygon(anel)])


@pytest.fixture
def engine():
    return create_engine(DATABASE_URL)


def test_regras_de_desempate_da_conflacao(engine):
    fid_osm = fonte_id(engine, "osm")
    fid_geosampa = fonte_id(engine, "geosampa")
    hoje = date.today()  # noqa: DTZ011 — data_referencia é DATE (sem fuso), não timestamp

    # ponto-base em SIRGAS 2000 / UTM 23S bem fora das três `area_piloto`
    # (lon -46.9, lat -24.0), para garantir que nenhuma via/calçada real
    # esteja a menos de 5 m e influencie o teste.
    x0, y0 = _PROJ_DIRETO.transform(-46.9, -24.0)

    # (a) aresta totalmente dentro de um polígono → 'contido'
    via_a = _linha_31983([(x0 - 10, y0), (x0 + 10, y0)])
    calcada_a = _poligono_31983(x0 - 20, y0 - 20, x0 + 20, y0 + 20)

    # (b) aresta no eixo da rua (não é a própria calçada), um polígono a 4 m
    # de cada lado → empate: não liga com 'mesmo_lado', liga com 'mais_proximo'
    bx, by = x0, y0 + 2000
    via_b = _linha_31983([(bx, by), (bx, by + 20)])
    calcada_b1 = _poligono_31983(bx - 9, by, bx - 4, by + 20)  # 4 m à esquerda
    calcada_b2 = _poligono_31983(bx + 4, by, bx + 9, by + 20)  # 4 m à direita

    # (c) aresta a 3 m de um polígono e 20 m de outro (fora do buffer de 5 m)
    # → liga ao mais próximo, confianca = 1 - 3/5 = 0.4
    cx, cy = x0, y0 + 4000
    via_c = _linha_31983([(cx, cy), (cx, cy + 20)])
    calcada_c1 = _poligono_31983(cx + 3, cy, cx + 8, cy + 20)  # 3 m
    calcada_c2 = _poligono_31983(cx - 25, cy, cx - 20, cy + 20)  # 20 m

    with engine.connect() as conexao:
        transacao = conexao.begin()
        try:
            conexao.execute(
                text(
                    "INSERT INTO no_pedestre (id, geom, fonte_id, data_referencia) "
                    "VALUES (:id, ST_SetSRID(ST_GeomFromText(:wkt), 4326), :fonte_id, :data)"
                ),
                [
                    {
                        "id": id_,
                        "wkt": Point(-46.9, -24.0).wkt,
                        "fonte_id": fid_osm,
                        "data": hoje,
                    }
                    for id_ in (NO_A, NO_B)
                ],
            )

            def _linha_via(id_, geom, esquema):
                comprimento = comprimento_m(geom)
                return {
                    "id": id_,
                    "osmid": id_,
                    "source": NO_A,
                    "target": NO_B,
                    "highway": "footway",
                    "esquema_calcada": esquema,
                    "comprimento_m": comprimento,
                    "custo_acessivel": comprimento,
                    "custo_reverso": comprimento,
                    "wkt": geom.wkt,
                    "fonte_id": fid_osm,
                    "data": hoje,
                }

            conexao.execute(
                text(
                    "INSERT INTO via_pedestre "
                    "(id, osmid, source, target, highway, esquema_calcada, comprimento_m, "
                    " custo_acessivel, custo_reverso, geom, fonte_id, data_referencia) "
                    "VALUES (:id, :osmid, :source, :target, :highway, :esquema_calcada, "
                    " :comprimento_m, :custo_acessivel, :custo_reverso, "
                    " ST_SetSRID(ST_GeomFromText(:wkt), 4326), :fonte_id, :data)"
                ),
                [
                    _linha_via(VIA_A, via_a, "geometria_propria"),
                    _linha_via(VIA_B, via_b, "via_generica"),
                    _linha_via(VIA_C, via_c, "atributo_via"),
                ],
            )

            conexao.execute(
                text(
                    "INSERT INTO calcada_sp (id, geom, fonte_id, data_referencia) "
                    "VALUES (:id, ST_SetSRID(ST_GeomFromText(:wkt), 4326), :fonte_id, :data)"
                ),
                [
                    {"id": id_, "wkt": geom.wkt, "fonte_id": fid_geosampa, "data": hoje}
                    for id_, geom in (
                        (CAL_A, calcada_a),
                        (CAL_B1, calcada_b1),
                        (CAL_B2, calcada_b2),
                        (CAL_C1, calcada_c1),
                        (CAL_C2, calcada_c2),
                    )
                ],
            )

            vias_do_teste = (VIA_A, VIA_B, VIA_C)
            mesmo_lado = {
                linha["via_id"]: linha
                for linha in _candidatos(conexao, buffer_m=5.0, metodo="mesmo_lado")
                if linha["via_id"] in vias_do_teste
            }
            mais_proximo = {
                linha["via_id"]: linha
                for linha in _candidatos(conexao, buffer_m=5.0, metodo="mais_proximo")
                if linha["via_id"] in vias_do_teste
            }

            # (a) aresta dentro do polígono → 'contido', confiança 1, distância 0
            linha_a = mesmo_lado[VIA_A]
            assert linha_a["ligada"]
            assert linha_a["calcada_id"] == CAL_A
            assert linha_a["metodo"] == "contido"
            assert float(linha_a["confianca"]) == 1.0
            assert float(linha_a["distancia_m"]) == 0.0

            # (b) empate: 'mesmo_lado' não liga (ambígua), 'mais_proximo' liga
            assert not mesmo_lado[VIA_B]["ligada"]
            linha_b = mais_proximo[VIA_B]
            assert linha_b["ligada"]
            assert linha_b["calcada_id"] in (CAL_B1, CAL_B2)

            # (c) segundo candidato fora do buffer → liga ao mais próximo
            # mesmo com 'mesmo_lado'; confianca = 1 - 3/5 = 0.4
            linha_c = mesmo_lado[VIA_C]
            assert linha_c["ligada"]
            assert linha_c["calcada_id"] == CAL_C1
            assert linha_c["metodo"] == "mesmo_lado"
            assert float(linha_c["confianca"]) == pytest.approx(0.4, abs=1e-3)
            assert float(linha_c["distancia_m"]) == pytest.approx(3.0, abs=1e-3)
        finally:
            transacao.rollback()


def test_metodo_invalido_recusado(engine):
    from etl.conflacao import executar

    with pytest.raises(ValueError):
        executar(engine, metodo="contido")

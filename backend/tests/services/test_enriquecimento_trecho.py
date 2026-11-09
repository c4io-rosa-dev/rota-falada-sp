"""O passo olha a rua inteira: várias vias ao longo dele e as duas calçadas de
uma via, sempre com o pior valor. Dados sintéticos fora da área coberta, numa
transação que é desfeita no fim."""

from __future__ import annotations

from datetime import date

import pytest
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from sqlalchemy import text

from app.db import SessionLocal
from app.services.barreira_geom import PROJ_4326_31983, PROJ_31983_4326
from app.services.enriquecimento import enriquecer_passos
from app.services.pgrouting import PassoBruto

pytestmark = pytest.mark.integration

_X0, _Y0 = PROJ_4326_31983.transform(-46.9, -24.0)
_NO_A, _NO_B = 900_200_001, 900_200_002
_VIA_1, _VIA_2 = 900_200_001, 900_200_002
_CAL_1, _CAL_2, _CAL_3 = 900_200_001, 900_200_002, 900_200_003


@pytest.fixture
def db():
    sessao = SessionLocal()
    try:
        yield sessao
    finally:
        sessao.rollback()
        sessao.close()


def _linha(pontos: list[tuple[float, float]]) -> LineString:
    return LineString([PROJ_31983_4326.transform(x, y) for x, y in pontos])


def _poligono(x0: float, y0: float, x1: float, y1: float) -> MultiPolygon:
    anel = [PROJ_31983_4326.transform(x, y) for x, y in box(x0, y0, x1, y1).exterior.coords]
    return MultiPolygon([Polygon(anel)])


def _fonte(db, chave: str) -> int:
    return db.execute(
        text("SELECT id FROM fonte_dados WHERE chave = :c"), {"c": chave}
    ).scalar_one()


def _preparar(db) -> None:
    """Via 1 (0-100 m) com calçada nos dois lados; via 2 (100-200 m) com uma."""
    osm, geosampa, hoje = _fonte(db, "osm"), _fonte(db, "geosampa"), date(2026, 1, 1)
    ponto = Point(-46.9, -24.0).wkt
    for no in (_NO_A, _NO_B):
        db.execute(
            text(
                "INSERT INTO no_pedestre (id, geom, fonte_id, data_referencia) VALUES "
                "(:id, ST_SetSRID(ST_GeomFromText(:wkt), 4326), :f, :d)"
            ),
            {"id": no, "wkt": ponto, "f": osm, "d": hoje},
        )
    for via, inicio, degrau in ((_VIA_1, 0.0, False), (_VIA_2, 100.0, True)):
        db.execute(
            text(
                "INSERT INTO via_pedestre (id, osmid, source, target, highway, esquema_calcada, "
                "comprimento_m, custo_acessivel, custo_reverso, is_degrau, geom, fonte_id, "
                "data_referencia) VALUES (:id, :id, :a, :b, 'footway', 'via_generica', 100, 100, "
                "100, :degrau, ST_SetSRID(ST_GeomFromText(:wkt), 4326), :f, :d)"
            ),
            {
                "id": via,
                "a": _NO_A,
                "b": _NO_B,
                "degrau": degrau,
                "wkt": _linha([(_X0 + inicio, _Y0), (_X0 + inicio + 100, _Y0)]).wkt,
                "f": osm,
                "d": hoje,
            },
        )
    for calcada, geom, largura, declividade in (
        (_CAL_1, _poligono(_X0, _Y0 + 3, _X0 + 100, _Y0 + 6), 2.5, 4.0),
        (_CAL_2, _poligono(_X0, _Y0 - 6, _X0 + 100, _Y0 - 3), 1.2, 9.0),
        (_CAL_3, _poligono(_X0 + 100, _Y0 + 3, _X0 + 200, _Y0 + 6), 3.0, 12.0),
    ):
        db.execute(
            text(
                "INSERT INTO calcada_sp (id, largura_min_m, declividade_max_pct, geom, fonte_id, "
                "data_referencia) VALUES (:id, :l, :decl, ST_SetSRID(ST_GeomFromText(:wkt), 4326), "
                ":f, :d)"
            ),
            {
                "id": calcada,
                "l": largura,
                "decl": declividade,
                "wkt": geom.wkt,
                "f": geosampa,
                "d": hoje,
            },
        )
    for via, calcada, metodo in (
        (_VIA_1, _CAL_1, "dois_lados"),
        (_VIA_1, _CAL_2, "dois_lados"),
        (_VIA_2, _CAL_3, "mesmo_lado"),
    ):
        db.execute(
            text(
                "INSERT INTO conflacao_via_calcada (via_id, calcada_id, distancia_m, confianca, "
                "metodo, buffer_m) VALUES (:v, :c, 3, 0.4, :m, 5)"
            ),
            {"v": via, "c": calcada, "m": metodo},
        )


def _passo(geometria: LineString, distancia_m: float) -> PassoBruto:
    return PassoBruto(1, "Siga", distancia_m, "siga", geometria, False, None, [])


def test_via_com_dois_lados_mostra_o_pior_de_cada_atributo(db):
    _preparar(db)
    geometria = _linha([(_X0 + 10, _Y0), (_X0 + 90, _Y0)])

    passos, _avisos, fontes = enriquecer_passos(db, [_passo(geometria, 80.0)], [], None)

    assert float(passos[0].largura_m) == pytest.approx(1.2)
    assert float(passos[0].declividade_pct) == pytest.approx(9.0)
    assert passos[0].largura_medida is True
    assert passos[0].declividade_medida is True
    assert "geosampa" in fontes


def test_passo_longo_nao_esconde_o_pico_nem_o_degrau_fora_do_meio(db):
    _preparar(db)
    # o ponto médio cai na via 1; o pico de 12% e o degrau estão só na via 2
    geometria = _linha([(_X0 + 5, _Y0), (_X0 + 130, _Y0)])

    passos, _avisos, _fontes = enriquecer_passos(db, [_passo(geometria, 125.0)], [], None)

    assert float(passos[0].declividade_pct) == pytest.approx(12.0)
    assert float(passos[0].largura_m) == pytest.approx(1.2)
    assert passos[0].is_degrau is True


@pytest.mark.parametrize(
    ("classe", "esperado", "medida"),
    [(1, 1.9, True), (2, 6.0, False)],
)
def test_estimativa_do_ors_so_vence_quando_a_faixa_desmente_a_medida(db, classe, esperado, medida):
    """Classe 1 (1% a 4%) cabe numa medida de 1,9% e não a troca; classe 2 (4% a 7%) desmente."""
    _preparar(db)
    db.execute(
        text("UPDATE calcada_sp SET declividade_max_pct = 1.9 WHERE id = :id"), {"id": _CAL_3}
    )
    geometria = _linha([(_X0 + 110, _Y0), (_X0 + 190, _Y0)])

    passos, _avisos, _fontes = enriquecer_passos(db, [_passo(geometria, 80.0)], [], [classe])

    assert float(passos[0].declividade_pct) == pytest.approx(esperado)
    assert passos[0].declividade_medida is medida

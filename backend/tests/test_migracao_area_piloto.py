"""area_piloto: o Ipiranga inclui a FATEC (migration 007) e o banco bate com
o `AREA_PILOTO` do ETL (mesmos retângulos, mesma ordem de id; `bairro_de` do
ETL depende dessa ordem)."""

import ast
from pathlib import Path

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.integration

_CONFIG_ETL = Path(__file__).resolve().parents[2] / "etl" / "etl" / "config.py"
# ponto dentro do polígono da FATEC Ipiranga no OSM (way 737408597)
_FATEC = (-46.6087, -23.6090)


@pytest.fixture
def db():
    from app.db import SessionLocal

    sessao = SessionLocal()
    try:
        yield sessao
    finally:
        sessao.rollback()
        sessao.close()


def _area_piloto_do_etl() -> dict[str, tuple[float, float, float, float]]:
    arvore = ast.parse(_CONFIG_ETL.read_text(encoding="utf-8"))
    for no in arvore.body:
        if isinstance(no, ast.AnnAssign) and getattr(no.target, "id", None) == "AREA_PILOTO":
            return ast.literal_eval(no.value)
    raise AssertionError("AREA_PILOTO não encontrado em etl/etl/config.py")


def test_ipiranga_contem_a_fatec(db):
    contem = db.execute(
        text(
            "SELECT ST_Covers(geom, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)) "
            "FROM area_piloto WHERE nome = 'Ipiranga'"
        ),
        {"lon": _FATEC[0], "lat": _FATEC[1]},
    ).scalar_one()
    assert contem is True


def test_area_piloto_do_banco_igual_a_do_etl_na_mesma_ordem(db):
    linhas = db.execute(
        text(
            "SELECT nome, ST_XMin(geom), ST_YMin(geom), ST_XMax(geom), ST_YMax(geom) "
            "FROM area_piloto ORDER BY id"
        )
    ).all()
    do_banco = [(nome, (x0, y0, x1, y1)) for nome, x0, y0, x1, y1 in linhas]
    do_etl = list(_area_piloto_do_etl().items())
    assert [nome for nome, _ in do_banco] == [nome for nome, _ in do_etl]
    for (nome, caixa_banco), (_, caixa_etl) in zip(do_banco, do_etl, strict=True):
        assert caixa_banco == pytest.approx(caixa_etl, abs=1e-9), nome

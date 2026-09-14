import pytest
from sqlalchemy import text

pytestmark = pytest.mark.integration


@pytest.fixture
def db():
    from app.db import SessionLocal

    sessao = SessionLocal()
    try:
        yield sessao
    finally:
        sessao.close()


def test_extensoes_instaladas(db):
    nomes = {linha[0] for linha in db.execute(text("SELECT extname FROM pg_extension"))}
    assert {"postgis", "pgrouting", "pg_trgm"} <= nomes


def test_fonte_dados_semeada_com_licencas(db):
    linhas = db.execute(text("SELECT chave, licenca FROM fonte_dados")).all()
    licencas = {chave: licenca for chave, licenca in linhas}
    assert licencas["osm"] == "ODbL 1.0"
    assert licencas["geosampa"] == "CC-BY-SA 4.0"
    assert licencas["sp156"] == "CC0 1.0"
    assert licencas["colaborativo"] == "ODbL 1.0"
    assert len(licencas) == 6


def test_geosampa_tem_data_de_referencia_de_2021(db):
    data = db.execute(
        text("SELECT data_referencia FROM fonte_dados WHERE chave = 'geosampa'")
    ).scalar_one()
    assert str(data) == "2021-08-13"

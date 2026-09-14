import pytest
from sqlalchemy import text

pytestmark = pytest.mark.integration

TABELAS_ESPERADAS = {
    "area_piloto",
    "etl_execucao",
    "no_pedestre",
    "via_pedestre",
    "calcada_sp",
    "barreira_oficial",
    "parada",
    "linha",
}


@pytest.fixture
def db():
    from app.db import SessionLocal

    sessao = SessionLocal()
    try:
        yield sessao
    finally:
        sessao.close()


def test_tabelas_oficiais_existem_e_area_piloto_semeada(db):
    nomes_tabelas = {
        linha[0]
        for linha in db.execute(
            text(
                "SELECT table_name FROM information_schema.tables " "WHERE table_schema = 'public'"
            )
        )
    }
    assert TABELAS_ESPERADAS <= nomes_tabelas

    nomes_area_piloto = {
        linha[0] for linha in db.execute(text("SELECT nome FROM area_piloto ORDER BY nome"))
    }
    assert nomes_area_piloto == {"Vila Mariana", "Lapa", "Ipiranga"}


def test_calcada_sp_gerada_e_via_pedestre_sem_atributos_de_licenca_cruzada(db):
    tipo = db.execute(
        text(
            "SELECT is_generated FROM information_schema.columns "
            "WHERE table_name = 'calcada_sp' AND column_name = 'largura_medida'"
        )
    ).scalar_one()
    assert tipo == "ALWAYS"

    colunas_via_pedestre = {
        linha[0]
        for linha in db.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'via_pedestre'"
            )
        )
    }
    for coluna in colunas_via_pedestre:
        assert "largura" not in coluna
        assert "declividade" not in coluna

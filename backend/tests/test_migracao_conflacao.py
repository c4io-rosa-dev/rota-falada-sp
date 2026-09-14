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


def test_conflacao_via_calcada_existe_com_chave_primaria_em_via_id(db):
    nomes_tabelas = {
        linha[0]
        for linha in db.execute(
            text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
        )
    }
    assert "conflacao_via_calcada" in nomes_tabelas

    colunas_pk = [
        linha[0]
        for linha in db.execute(
            text(
                "SELECT a.attname FROM pg_index i "
                "JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) "
                "WHERE i.indrelid = 'conflacao_via_calcada'::regclass AND i.indisprimary "
                "ORDER BY array_position(i.indkey, a.attnum)"
            )
        )
    ]
    assert colunas_pk == ["via_id"]


def test_conflacao_via_calcada_sem_geometria_nem_atributos_de_licenca_cruzada(db):
    colunas = {
        linha[0]: linha[1]
        for linha in db.execute(
            text(
                "SELECT column_name, udt_name FROM information_schema.columns "
                "WHERE table_name = 'conflacao_via_calcada'"
            )
        )
    }
    assert "geometry" not in colunas.values()
    for coluna in colunas:
        assert "largura" not in coluna
        assert "declividade" not in coluna

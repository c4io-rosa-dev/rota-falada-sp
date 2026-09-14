import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

pytestmark = pytest.mark.integration

TABELAS_ESPERADAS = {"barreira_colaborativa", "rota_cache"}


@pytest.fixture
def db():
    from app.db import SessionLocal

    sessao = SessionLocal()
    try:
        yield sessao
    finally:
        sessao.close()


def test_tabelas_de_roteamento_existem(db):
    nomes_tabelas = {
        linha[0]
        for linha in db.execute(
            text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
        )
    }
    assert TABELAS_ESPERADAS <= nomes_tabelas


def test_rota_cache_tem_chave_como_chave_primaria_e_indices(db):
    colunas_pk = [
        linha[0]
        for linha in db.execute(
            text(
                "SELECT a.attname FROM pg_index i "
                "JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) "
                "WHERE i.indrelid = 'rota_cache'::regclass AND i.indisprimary "
                "ORDER BY array_position(i.indkey, a.attnum)"
            )
        )
    ]
    assert colunas_pk == ["chave"]

    nomes_indices = {
        linha[0]
        for linha in db.execute(
            text("SELECT indexname FROM pg_indexes WHERE tablename = 'rota_cache'")
        )
    }
    assert {"rota_cache_regiao_idx", "rota_cache_expira_idx"} <= nomes_indices


def test_barreira_colaborativa_tem_indice_geom_e_fk_para_fonte_dados(db):
    nomes_indices = {
        linha[0]
        for linha in db.execute(
            text("SELECT indexname FROM pg_indexes WHERE tablename = 'barreira_colaborativa'")
        )
    }
    assert "barreira_colaborativa_geom_idx" in nomes_indices

    fk_fonte = db.execute(
        text(
            "SELECT confrelid::regclass::text FROM pg_constraint "
            "WHERE conrelid = 'barreira_colaborativa'::regclass AND contype = 'f'"
        )
    ).scalar_one()
    assert fk_fonte == "fonte_dados"


def test_barreira_colaborativa_rejeita_severidade_fora_do_dominio(db):
    fonte_id = db.execute(
        text("SELECT id FROM fonte_dados WHERE chave = 'colaborativo'")
    ).scalar_one()
    with pytest.raises(DBAPIError):
        db.execute(
            text(
                "INSERT INTO barreira_colaborativa "
                "(categoria, severidade, geom, fonte_id) VALUES "
                "('buraco', 'inventada', ST_SetSRID(ST_MakePoint(-46.63, -23.59), 4326), :fonte_id)"
            ),
            {"fonte_id": fonte_id},
        )
        db.commit()
    db.rollback()


def test_barreira_colaborativa_rejeita_status_fora_do_dominio(db):
    fonte_id = db.execute(
        text("SELECT id FROM fonte_dados WHERE chave = 'colaborativo'")
    ).scalar_one()
    with pytest.raises(DBAPIError):
        db.execute(
            text(
                "INSERT INTO barreira_colaborativa "
                "(categoria, severidade, status, geom, fonte_id) VALUES "
                "('buraco', 'dificulta', 'inexistente', "
                "ST_SetSRID(ST_MakePoint(-46.63, -23.59), 4326), :fonte_id)"
            ),
            {"fonte_id": fonte_id},
        )
        db.commit()
    db.rollback()

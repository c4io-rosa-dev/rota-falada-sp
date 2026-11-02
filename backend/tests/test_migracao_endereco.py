"""Migration 006: tabela `endereco` do geocode local (spec 2026-11-02, 3.1)."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

pytestmark = pytest.mark.integration


@pytest.fixture
def db():
    from app.db import SessionLocal

    sessao = SessionLocal()
    try:
        yield sessao
    finally:
        sessao.rollback()
        sessao.close()


def test_endereco_tem_os_indices_esperados(db):
    nomes = {
        linha[0]
        for linha in db.execute(
            text("SELECT indexname FROM pg_indexes WHERE tablename = 'endereco'")
        )
    }
    assert {
        "endereco_pkey",
        "endereco_texto_busca_trgm_idx",
        "endereco_geom_idx",
        "endereco_logradouro_numero_idx",
    } <= nomes


def test_indice_de_texto_e_gin_trigram(db):
    definicao = db.execute(
        text("SELECT indexdef FROM pg_indexes WHERE indexname = 'endereco_texto_busca_trgm_idx'")
    ).scalar_one()
    assert "USING gin" in definicao
    assert "gin_trgm_ops" in definicao


def test_endereco_tem_rls_ligado(db):
    ligado = db.execute(
        text("SELECT relrowsecurity FROM pg_class WHERE relname = 'endereco'")
    ).scalar_one()
    assert ligado is True


_INSERIR = text(
    "INSERT INTO endereco (tipo, rotulo, texto_busca, geom, fonte_id, data_referencia) "
    "VALUES (:tipo, :rotulo, :texto_busca, ST_SetSRID(ST_MakePoint(-46.63, -23.59), 4326), "
    "(SELECT id FROM fonte_dados WHERE chave = 'osm'), CURRENT_DATE)"
)


def test_endereco_aceita_linha_valida(db):
    db.execute(
        _INSERIR,
        {"tipo": "endereco", "rotulo": "Rua X, 1 · Lapa", "texto_busca": "rua x 1"},
    )


@pytest.mark.parametrize(
    ("tipo", "rotulo", "texto_busca"),
    [
        ("bairro", "Rua X · Lapa", "rua x"),
        ("endereco", "   ", "rua x"),
        ("endereco", "Rua X · Lapa", ""),
    ],
    ids=["tipo-fora-do-dominio", "rotulo-em-branco", "texto-busca-vazio"],
)
def test_endereco_rejeita_linha_invalida(db, tipo, rotulo, texto_busca):
    with pytest.raises(DBAPIError):
        db.execute(_INSERIR, {"tipo": tipo, "rotulo": rotulo, "texto_busca": texto_busca})

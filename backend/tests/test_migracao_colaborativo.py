"""Migration 008: camada colaborativa (spec 2026-11-02-colaborativo-design.md, 3)."""

import uuid

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


def _usuario(db) -> uuid.UUID:
    uid = uuid.uuid4()
    db.execute(text("INSERT INTO usuario (id) VALUES (:id)"), {"id": uid})
    return uid


def _barreira(db, categoria="escada", status="pendente", autor=None, chave=None, **extra) -> int:
    colunas = {
        "categoria": categoria,
        "severidade": "intransponivel",
        "status": status,
        "autor_id": autor,
        "chave_idempotencia": chave,
        **extra,
    }
    nomes = ", ".join(colunas)
    valores = ", ".join(f":{c}" for c in colunas)
    return db.execute(
        text(
            f"INSERT INTO barreira_colaborativa ({nomes}, geom, fonte_id) VALUES ({valores}, "
            "ST_SetSRID(ST_MakePoint(-46.635, -23.59), 4326), "
            "(SELECT id FROM fonte_dados WHERE chave = 'colaborativo')) RETURNING id"
        ),
        colunas,
    ).scalar_one()


def test_tabelas_novas_existem_com_rls(db):
    for tabela in ("usuario", "confirmacao", "barreira_evento"):
        ligado = db.execute(
            text("SELECT relrowsecurity FROM pg_class WHERE oid = CAST(:t AS regclass)"),
            {"t": tabela},
        ).scalar_one()
        assert ligado is True, tabela


def test_usuario_papel_padrao_e_dominio(db):
    uid = _usuario(db)
    papel = db.execute(text("SELECT papel FROM usuario WHERE id = :id"), {"id": uid}).scalar_one()
    assert papel == "colaborador"
    with pytest.raises(DBAPIError):
        db.execute(
            text("INSERT INTO usuario (id, papel) VALUES (:id, 'chefe')"), {"id": uuid.uuid4()}
        )


def test_status_removida_aceito_e_categoria_fora_da_lista_recusada(db):
    _barreira(db, status="removida")
    with pytest.raises(DBAPIError):
        _barreira(db, categoria="obstaculo_calcada")


def test_foto_exige_caminho_e_descricao_juntos(db):
    _barreira(db, foto_caminho="1/a.webp", foto_descricao="Escada de três degraus")
    with pytest.raises(DBAPIError):
        _barreira(db, foto_caminho="1/b.webp")


def test_chave_idempotencia_unica_por_autor(db):
    autor = _usuario(db)
    chave = uuid.uuid4()
    _barreira(db, autor=autor, chave=chave)
    _barreira(db, autor=_usuario(db), chave=chave)  # outro autor pode repetir a chave
    with pytest.raises(DBAPIError):
        _barreira(db, autor=autor, chave=chave)


def test_confirmacao_voto_unico_por_usuario(db):
    barreira = _barreira(db)
    eleitor = _usuario(db)
    sql = text("INSERT INTO confirmacao (barreira_id, usuario_id, voto) VALUES (:b, :u, :v)")
    db.execute(sql, {"b": barreira, "u": eleitor, "v": "confirma"})
    with pytest.raises(DBAPIError):
        db.execute(sql, {"b": barreira, "u": eleitor, "v": "contesta"})


def test_confirmacao_rejeita_voto_fora_do_dominio(db):
    with pytest.raises(DBAPIError):
        db.execute(
            text(
                "INSERT INTO confirmacao (barreira_id, usuario_id, voto) VALUES (:b, :u, 'talvez')"
            ),
            {"b": _barreira(db), "u": _usuario(db)},
        )


def test_barreira_evento_e_so_insercao(db):
    evento = db.execute(
        text(
            "INSERT INTO barreira_evento (barreira_id, tipo, para_status) "
            "VALUES (:b, 'criada', 'pendente') RETURNING id"
        ),
        {"b": _barreira(db)},
    ).scalar_one()
    db.execute(text("SAVEPOINT antes_update"))
    with pytest.raises(DBAPIError):
        db.execute(text("UPDATE barreira_evento SET tipo = 'voto' WHERE id = :id"), {"id": evento})
    db.execute(text("ROLLBACK TO SAVEPOINT antes_update"))
    with pytest.raises(DBAPIError):
        db.execute(text("DELETE FROM barreira_evento WHERE id = :id"), {"id": evento})

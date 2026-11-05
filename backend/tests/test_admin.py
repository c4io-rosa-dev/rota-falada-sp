"""Promoção a admin (spec 2026-11-02-colaborativo-design.md, 4.6)."""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from app.schemas.barreira import BarreiraIn
from app.services import barreiras
from app.services.admin import (
    UsuarioNaoEncontrado,
    anonimizar_conta,
    buscar_id_por_email,
    promover_admin,
)

pytestmark = pytest.mark.integration

AGORA = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)


def test_promover_por_id_cria_admin_e_registra_evento(db_transacional):
    usuario_id = uuid.uuid4()
    promover_admin(db_transacional, usuario_id, AGORA)
    papel = db_transacional.execute(
        text("SELECT papel FROM usuario WHERE id = :id"), {"id": usuario_id}
    ).scalar_one()
    assert papel == "admin"
    tipo, barreira = db_transacional.execute(
        text("SELECT tipo, barreira_id FROM barreira_evento WHERE usuario_id = :id"),
        {"id": usuario_id},
    ).one()
    assert (tipo, barreira) == ("promocao", None)


def test_promover_usuario_existente(db_transacional, criar_usuario):
    usuario = criar_usuario()
    promover_admin(db_transacional, usuario.id, AGORA)
    papel = db_transacional.execute(
        text("SELECT papel FROM usuario WHERE id = :id"), {"id": usuario.id}
    ).scalar_one()
    assert papel == "admin"


def test_buscar_por_email_sem_auth_users_explica_o_que_fazer(db_transacional):
    existe = db_transacional.execute(
        text("SELECT to_regclass('auth.users') IS NOT NULL")
    ).scalar_one()
    if existe:
        pytest.skip("este banco tem auth.users (Supabase); o teste é para o banco local")
    with pytest.raises(UsuarioNaoEncontrado, match="--id"):
        buscar_id_por_email(db_transacional, "caiorosa2006@gmail.com")


def test_excluir_conta_mantem_a_barreira_sem_autor(db_transacional, criar_usuario):
    autor = criar_usuario()
    entrada = BarreiraIn(
        categoria="escada", lat=-23.59, lon=-46.635, chave_idempotencia=uuid.uuid4()
    )
    barreira, _ = barreiras.criar(db_transacional, autor, entrada, AGORA)
    assert anonimizar_conta(db_transacional, autor.id, AGORA) == 1
    autor_id, chave = db_transacional.execute(
        text("SELECT autor_id, chave_idempotencia FROM barreira_colaborativa WHERE id = :id"),
        {"id": barreira.id},
    ).one()
    assert (autor_id, chave) == (None, None)
    assert barreiras.obter(db_transacional, barreira.id, AGORA).id == barreira.id
    detalhe = db_transacional.execute(
        text("SELECT detalhe FROM barreira_evento WHERE usuario_id = :id AND tipo = 'admin'"),
        {"id": autor.id},
    ).scalar_one()
    assert detalhe == {"acao": "conta_excluida", "barreiras_sem_autor": 1}

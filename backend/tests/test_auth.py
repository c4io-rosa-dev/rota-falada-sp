"""Login com JWT do Supabase (spec 2026-11-02-colaborativo-design.md, 4)."""

import uuid

import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.auth import (
    MSG_LOGIN,
    MSG_LOGIN_INDISPONIVEL,
    MSG_SEM_PERMISSAO,
    UsuarioAtual,
    criar_config_auth,
    exigir_admin,
    obter_config_auth,
    usuario_atual,
)
from app.db import get_db

pytestmark = pytest.mark.integration


def _app(db, config):
    app = FastAPI()

    @app.get("/eu")
    def eu(usuario: UsuarioAtual = Depends(usuario_atual)):  # noqa: B008
        return {"id": str(usuario.id), "papel": usuario.papel}

    @app.get("/admin")
    def so_admin(usuario: UsuarioAtual = Depends(exigir_admin)):  # noqa: B008
        return {"ok": True}

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[obter_config_auth] = lambda: config
    return TestClient(app)


@pytest.fixture
def cliente(db_transacional, config_auth_teste):
    return _app(db_transacional, config_auth_teste)


def _cabecalho(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_token_valido_cria_usuario_colaborador(cliente, emitir_token, db_transacional):
    sub = uuid.uuid4()
    resposta = cliente.get("/eu", headers=_cabecalho(emitir_token(sub)))
    assert resposta.status_code == 200
    assert resposta.json() == {"id": str(sub), "papel": "colaborador"}
    papel = db_transacional.execute(
        text("SELECT papel FROM usuario WHERE id = :id"), {"id": sub}
    ).scalar_one()
    assert papel == "colaborador"
    assert cliente.get("/eu", headers=_cabecalho(emitir_token(sub))).status_code == 200


def test_sem_token_e_401(cliente):
    resposta = cliente.get("/eu")
    assert resposta.status_code == 401
    assert resposta.json()["detail"] == MSG_LOGIN
    assert resposta.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize(
    "ajuste",
    [
        {"validade_s": -10},
        {"aud": "anon"},
        {"iss": "https://outro.supabase.co/auth/v1"},
    ],
    ids=["vencido", "aud-errado", "emissor-errado"],
)
def test_token_invalido_e_401(cliente, emitir_token, ajuste):
    resposta = cliente.get("/eu", headers=_cabecalho(emitir_token(uuid.uuid4(), **ajuste)))
    assert resposta.status_code == 401
    assert resposta.json()["detail"] == MSG_LOGIN


def test_assinatura_de_outra_chave_e_401(cliente, emitir_token):
    outra = ec.generate_private_key(ec.SECP256R1())
    token = emitir_token(uuid.uuid4(), chave=outra)
    assert cliente.get("/eu", headers=_cabecalho(token)).status_code == 401


def test_sub_que_nao_e_uuid_e_401(cliente, emitir_token):
    assert cliente.get("/eu", headers=_cabecalho(emitir_token("abc"))).status_code == 401


def test_esquema_basic_e_401(cliente):
    assert cliente.get("/eu", headers={"Authorization": "Basic abc"}).status_code == 401


def test_colaborador_em_rota_de_admin_e_403(cliente, emitir_token):
    resposta = cliente.get("/admin", headers=_cabecalho(emitir_token(uuid.uuid4())))
    assert resposta.status_code == 403
    assert resposta.json()["detail"] == MSG_SEM_PERMISSAO


def test_admin_passa(cliente, emitir_token, criar_usuario):
    admin = criar_usuario("admin")
    assert cliente.get("/admin", headers=_cabecalho(emitir_token(admin.id))).status_code == 200


def test_sem_configuracao_de_login_e_503(db_transacional, emitir_token):
    resposta = _app(db_transacional, None).get(
        "/eu", headers=_cabecalho(emitir_token(uuid.uuid4()))
    )
    assert resposta.status_code == 503
    assert resposta.json()["detail"] == MSG_LOGIN_INDISPONIVEL


def test_criar_config_auth():
    assert criar_config_auth(None) is None
    assert criar_config_auth("") is None
    config = criar_config_auth("https://abc.supabase.co/")
    assert config.emissor == "https://abc.supabase.co/auth/v1"


def test_token_anonimo_e_401(cliente, emitir_token):
    token = emitir_token(uuid.uuid4(), extra={"is_anonymous": True})
    resposta = cliente.get("/eu", headers=_cabecalho(token))
    assert resposta.status_code == 401
    assert resposta.json()["detail"] == MSG_LOGIN


def test_sub_inteiro_no_token_e_401(cliente, emitir_token):
    token = emitir_token(uuid.uuid4(), extra={"sub": 123})
    assert cliente.get("/eu", headers=_cabecalho(token)).status_code == 401


def test_esquema_bearer_sem_diferenciar_maiusculas(cliente, emitir_token):
    token = emitir_token(uuid.uuid4())
    resposta = cliente.get("/eu", headers={"Authorization": f"bearer {token}"})
    assert resposta.status_code == 200


def test_token_sem_exp_e_401(cliente, emitir_token):
    token = emitir_token(uuid.uuid4(), sem_exp=True)
    assert cliente.get("/eu", headers=_cabecalho(token)).status_code == 401

"""`GET /api/eu`: só o papel, para o frontend mostrar o painel de moderação."""

import uuid

import pytest

from app.auth import MSG_LOGIN, MSG_LOGIN_INDISPONIVEL, obter_config_auth

pytestmark = pytest.mark.integration


def _auth(emitir_token, sub, **extras) -> dict[str, str]:
    return {"Authorization": f"Bearer {emitir_token(sub, **extras)}"}


def test_sem_token_e_401(cliente_api):
    resposta = cliente_api.get("/api/eu")
    assert resposta.status_code == 401
    assert resposta.json()["detail"] == MSG_LOGIN


def test_token_anonimo_e_401(cliente_api, emitir_token):
    resposta = cliente_api.get(
        "/api/eu", headers=_auth(emitir_token, uuid.uuid4(), extra={"is_anonymous": True})
    )
    assert resposta.status_code == 401


@pytest.mark.parametrize("papel", ["colaborador", "admin"])
def test_devolve_so_o_papel(cliente_api, emitir_token, criar_usuario, papel):
    usuario = criar_usuario(papel)
    resposta = cliente_api.get("/api/eu", headers=_auth(emitir_token, usuario.id))
    assert resposta.status_code == 200
    # nem id nem e-mail: o Supabase já os fornece ao próprio dono
    assert resposta.json() == {"papel": papel}


def test_sem_login_configurado_e_503(cliente_api, emitir_token):
    cliente_api.app.dependency_overrides[obter_config_auth] = lambda: None
    resposta = cliente_api.get("/api/eu", headers=_auth(emitir_token, uuid.uuid4()))
    assert resposta.status_code == 503
    assert resposta.json()["detail"] == MSG_LOGIN_INDISPONIVEL

"""Entrada que o Postgres recusa não vira 500: sem CORS, o navegador leria como falha de rede."""

import io
import uuid

import pytest
from PIL import Image

pytestmark = pytest.mark.integration

LON, LAT = -46.6350, -23.5900
COM_NUL = "a\x00bcde"


def _auth(emitir_token, sub) -> dict[str, str]:
    return {"Authorization": f"Bearer {emitir_token(sub)}"}


def _corpo(**extras):
    return {
        "categoria": "escada",
        "lat": LAT,
        "lon": LON,
        "chave_idempotencia": str(uuid.uuid4()),
        **extras,
    }


def _jpeg() -> bytes:
    saida = io.BytesIO()
    Image.new("RGB", (40, 30), (10, 20, 30)).save(saida, "JPEG")
    return saida.getvalue()


@pytest.fixture
def autor():
    return uuid.uuid4()


@pytest.fixture
def criada(cliente_api, emitir_token, autor):
    resposta = cliente_api.post("/api/barreiras", json=_corpo(), headers=_auth(emitir_token, autor))
    assert resposta.status_code == 201
    return resposta.json()


def test_descricao_com_nul_e_422(cliente_api, emitir_token, autor):
    resposta = cliente_api.post(
        "/api/barreiras", json=_corpo(descricao=COM_NUL), headers=_auth(emitir_token, autor)
    )
    assert resposta.status_code == 422


def test_motivo_com_nul_e_422(cliente_api, emitir_token, criar_usuario, criada):
    admin = _auth(emitir_token, criar_usuario("admin").id)
    resposta = cliente_api.post(
        f"/api/admin/barreiras/{criada['id']}/status",
        json={"status": "validada", "motivo": COM_NUL},
        headers=admin,
    )
    assert resposta.status_code == 422


def test_descricao_da_foto_com_nul_e_422(cliente_api, emitir_token, autor, criada):
    resposta = cliente_api.post(
        f"/api/barreiras/{criada['id']}/foto",
        files={"arquivo": ("foto.jpg", _jpeg(), "image/jpeg")},
        data={"descricao": COM_NUL},
        headers=_auth(emitir_token, autor),
    )
    assert resposta.status_code == 422


def test_antes_de_gigante_e_422(cliente_api, emitir_token, criar_usuario):
    admin = _auth(emitir_token, criar_usuario("admin").id)
    resposta = cliente_api.get(
        "/api/admin/barreiras", params={"antes_de": "99999999999999999999"}, headers=admin
    )
    assert resposta.status_code == 422


def test_antes_de_no_limite_do_bigint_funciona(cliente_api, emitir_token, criar_usuario):
    admin = _auth(emitir_token, criar_usuario("admin").id)
    resposta = cliente_api.get(
        "/api/admin/barreiras", params={"antes_de": str(2**63 - 1)}, headers=admin
    )
    assert resposta.status_code == 200


def test_busca_de_endereco_com_nul_e_422(cliente_api):
    assert cliente_api.get("/api/geocode", params={"q": "rua\x00a"}).status_code == 422

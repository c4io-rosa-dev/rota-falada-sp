"""Contrato HTTP da camada colaborativa (spec 2026-11-02-colaborativo-design.md, 5 e 8)."""

import io
import uuid

import pytest
from PIL import Image

from app.auth import MSG_LOGIN, MSG_SEM_PERMISSAO
from app.config import settings
from app.routers.barreiras import obter_armazenamento
from app.services.erros import AutorNaoVota, ForaDaArea, StorageIndisponivel

pytestmark = pytest.mark.integration

LON, LAT = -46.6350, -23.5900
CAMPOS_PUBLICOS = {
    "id",
    "categoria",
    "severidade",
    "status",
    "votos",
    "descricao",
    "lat",
    "lon",
    "criada_em",
    "ultima_confirmacao_em",
    "foto_url",
    "foto_descricao",
}


def _auth(emitir_token, sub) -> dict[str, str]:
    return {"Authorization": f"Bearer {emitir_token(sub)}"}


def _corpo(categoria="escada", chave=None, lon=LON, lat=LAT):
    return {
        "categoria": categoria,
        "lat": lat,
        "lon": lon,
        "chave_idempotencia": str(chave or uuid.uuid4()),
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


def test_cadastro_exige_login(cliente_api):
    resposta = cliente_api.post("/api/barreiras", json=_corpo())
    assert resposta.status_code == 401
    assert resposta.json()["detail"] == MSG_LOGIN


def test_cadastro_devolve_ficha_publica_sem_autor(criada, autor):
    assert set(criada) == CAMPOS_PUBLICOS
    assert criada["status"] == "pendente"
    assert str(autor) not in str(criada)


def test_cadastro_idempotente(cliente_api, emitir_token, autor):
    chave = uuid.uuid4()
    primeira = cliente_api.post(
        "/api/barreiras", json=_corpo(chave=chave), headers=_auth(emitir_token, autor)
    )
    segunda = cliente_api.post(
        "/api/barreiras", json=_corpo(chave=chave), headers=_auth(emitir_token, autor)
    )
    assert (primeira.status_code, segunda.status_code) == (201, 200)
    assert primeira.json()["id"] == segunda.json()["id"]


@pytest.mark.parametrize(
    "corpo",
    [_corpo(categoria="inventada"), {"categoria": "escada", "lat": LAT, "lon": LON}],
    ids=["categoria-fora-da-lista", "sem-chave"],
)
def test_cadastro_invalido_e_422(cliente_api, emitir_token, corpo):
    resposta = cliente_api.post(
        "/api/barreiras", json=corpo, headers=_auth(emitir_token, uuid.uuid4())
    )
    assert resposta.status_code == 422


def test_cadastro_fora_da_area_e_422_em_portugues(cliente_api, emitir_token):
    resposta = cliente_api.post(
        "/api/barreiras",
        json=_corpo(lon=-46.5, lat=-23.5),
        headers=_auth(emitir_token, uuid.uuid4()),
    )
    assert resposta.status_code == 422
    assert resposta.json()["detail"] == ForaDaArea.mensagem


def test_leitura_publica(cliente_api, criada):
    lista = cliente_api.get("/api/barreiras", params={"lat": LAT, "lon": LON, "raio_m": 50})
    assert lista.status_code == 200
    assert criada["id"] in [b["id"] for b in lista.json()]
    uma = cliente_api.get(f"/api/barreiras/{criada['id']}")
    assert uma.status_code == 200
    assert cliente_api.get("/api/barreiras/987654321").status_code == 404


@pytest.mark.parametrize("raio", [5, 501])
def test_raio_fora_dos_limites_e_422(cliente_api, raio):
    resposta = cliente_api.get("/api/barreiras", params={"lat": LAT, "lon": LON, "raio_m": raio})
    assert resposta.status_code == 422


def test_votacao(cliente_api, emitir_token, autor, criada):
    url = f"/api/barreiras/{criada['id']}/voto"
    resposta_autor = cliente_api.put(
        url, json={"voto": "confirma"}, headers=_auth(emitir_token, autor)
    )
    assert resposta_autor.status_code == 403
    assert resposta_autor.json()["detail"] == AutorNaoVota.mensagem
    assert (
        cliente_api.put(url, json={"voto": "talvez"}, headers=_auth(emitir_token, uuid.uuid4()))
    ).status_code == 422
    for _ in range(2):
        resposta = cliente_api.put(
            url, json={"voto": "confirma"}, headers=_auth(emitir_token, uuid.uuid4())
        )
    assert resposta.status_code == 200
    assert resposta.json()["status"] == "validada"
    assert resposta.json()["votos"]["confirma"] == 2


def test_admin(cliente_api, emitir_token, criar_usuario, criada):
    url = f"/api/admin/barreiras/{criada['id']}/status"
    corpo = {"status": "removida", "motivo": "denúncia de barreira falsa"}
    colaborador = cliente_api.post(url, json=corpo, headers=_auth(emitir_token, uuid.uuid4()))
    assert colaborador.status_code == 403
    assert colaborador.json()["detail"] == MSG_SEM_PERMISSAO

    admin = criar_usuario("admin")
    resposta = cliente_api.post(url, json=corpo, headers=_auth(emitir_token, admin.id))
    assert resposta.status_code == 200
    assert resposta.json()["status"] == "removida"
    assert cliente_api.get(f"/api/barreiras/{criada['id']}").status_code == 404

    eventos = cliente_api.get(
        f"/api/admin/barreiras/{criada['id']}/eventos", headers=_auth(emitir_token, admin.id)
    )
    assert eventos.status_code == 200
    assert [e["tipo"] for e in eventos.json()] == ["criada", "admin"]
    assert eventos.json()[-1]["usuario_id"] == str(admin.id)


def test_motivo_do_admin_obrigatorio(cliente_api, emitir_token, criar_usuario, criada):
    admin = criar_usuario("admin")
    resposta = cliente_api.post(
        f"/api/admin/barreiras/{criada['id']}/status",
        json={"status": "removida", "motivo": "x"},
        headers=_auth(emitir_token, admin.id),
    )
    assert resposta.status_code == 422


def test_foto(cliente_api, emitir_token, autor, criada, monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "https://abc.supabase.co")
    url = f"/api/barreiras/{criada['id']}/foto"
    resposta = cliente_api.post(
        url,
        files={"arquivo": ("foto.jpg", _jpeg(), "image/jpeg")},
        data={"descricao": "Escada de três degraus"},
        headers=_auth(emitir_token, autor),
    )
    assert resposta.status_code == 200
    assert resposta.json()["foto_url"].endswith(".webp")
    texto = cliente_api.post(
        url,
        files={"arquivo": ("a.txt", b"texto", "text/plain")},
        data={"descricao": "Escada de três degraus"},
        headers=_auth(emitir_token, autor),
    )
    assert texto.status_code == 415
    removida = cliente_api.delete(url, headers=_auth(emitir_token, autor))
    assert removida.status_code == 200
    assert removida.json()["foto_url"] is None


def test_foto_sem_storage_e_503(cliente_api, emitir_token, autor, criada):
    cliente_api.app.dependency_overrides[obter_armazenamento] = lambda: None
    resposta = cliente_api.post(
        f"/api/barreiras/{criada['id']}/foto",
        files={"arquivo": ("foto.jpg", _jpeg(), "image/jpeg")},
        data={"descricao": "Escada de três degraus"},
        headers=_auth(emitir_token, autor),
    )
    assert resposta.status_code == 503
    assert resposta.json()["detail"] == StorageIndisponivel.mensagem


def test_cors_libera_put_para_o_frontend(cliente_api):
    resposta = cliente_api.options(
        "/api/barreiras/1/voto",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert resposta.status_code == 200
    assert "PUT" in resposta.headers["access-control-allow-methods"]

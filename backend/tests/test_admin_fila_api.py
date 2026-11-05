"""Fila de moderação: `GET /api/admin/barreiras` e `GET /api/admin/barreiras/{id}`."""

import uuid

import pytest
from sqlalchemy import text

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


@pytest.fixture
def admin(emitir_token, criar_usuario):
    return _auth(emitir_token, criar_usuario("admin").id)


@pytest.fixture
def criar(cliente_api, emitir_token):
    def _criar() -> dict:
        resposta = cliente_api.post(
            "/api/barreiras",
            json={
                "categoria": "escada",
                "lat": LAT,
                "lon": LON,
                "chave_idempotencia": str(uuid.uuid4()),
            },
            headers=_auth(emitir_token, uuid.uuid4()),
        )
        assert resposta.status_code == 201
        return resposta.json()

    return _criar


def _ids(resposta) -> list[int]:
    assert resposta.status_code == 200
    return [b["id"] for b in resposta.json()]


def test_fila_exige_admin(cliente_api, emitir_token, criar_usuario):
    assert cliente_api.get("/api/admin/barreiras").status_code == 401
    comum = _auth(emitir_token, criar_usuario().id)
    assert cliente_api.get("/api/admin/barreiras", headers=comum).status_code == 403


def test_fila_acha_removida_que_o_publico_nao_lista(cliente_api, admin, criar):
    barreira = criar()
    mudou = cliente_api.post(
        f"/api/admin/barreiras/{barreira['id']}/status",
        json={"status": "removida", "motivo": "Denúncia de vandalismo"},
        headers=admin,
    )
    assert mudou.status_code == 200
    publica = cliente_api.get("/api/barreiras", params={"lat": LAT, "lon": LON})
    assert barreira["id"] not in _ids(publica)
    fila = cliente_api.get("/api/admin/barreiras", params={"status": "removida"}, headers=admin)
    assert barreira["id"] in _ids(fila)
    pendentes = cliente_api.get(
        "/api/admin/barreiras", params={"status": "pendente"}, headers=admin
    )
    assert barreira["id"] not in _ids(pendentes)


def test_fila_compara_com_o_status_efetivo(cliente_api, admin, criar, db_transacional):
    barreira = criar()
    db_transacional.execute(
        text(
            "UPDATE barreira_colaborativa SET criado_em = now() - interval '31 days' WHERE id = :id"
        ),
        {"id": barreira["id"]},
    )
    expiradas = cliente_api.get(
        "/api/admin/barreiras", params={"status": "expirada"}, headers=admin
    )
    assert barreira["id"] in _ids(expiradas)
    pendentes = cliente_api.get(
        "/api/admin/barreiras", params={"status": "pendente"}, headers=admin
    )
    assert barreira["id"] not in _ids(pendentes)


def test_fila_ordena_limita_e_pagina_por_chave(cliente_api, admin, criar):
    a, b, c = criar()["id"], criar()["id"], criar()["id"]
    pagina = cliente_api.get("/api/admin/barreiras", params={"limite": 2}, headers=admin)
    assert _ids(pagina) == [c, b]
    resto = cliente_api.get(
        "/api/admin/barreiras", params={"limite": 2, "antes_de": b}, headers=admin
    )
    assert _ids(resto)[0] == a


def test_fila_devolve_a_ficha_publica_sem_autor(cliente_api, admin, criar):
    criar()
    resposta = cliente_api.get("/api/admin/barreiras", params={"limite": 1}, headers=admin)
    assert set(resposta.json()[0]) == CAMPOS_PUBLICOS


@pytest.mark.parametrize("parametros", [{"status": "inexistente"}, {"limite": 0}, {"limite": 101}])
def test_fila_recusa_parametro_invalido(cliente_api, admin, parametros):
    resposta = cliente_api.get("/api/admin/barreiras", params=parametros, headers=admin)
    assert resposta.status_code == 422


def test_ficha_admin_abre_removida(cliente_api, admin, emitir_token, criar_usuario, criar):
    barreira = criar()
    url = f"/api/admin/barreiras/{barreira['id']}"
    cliente_api.post(f"{url}/status", json={"status": "removida", "motivo": "Falsa"}, headers=admin)
    assert cliente_api.get(f"/api/barreiras/{barreira['id']}").status_code == 404
    assert cliente_api.get(url).status_code == 401
    comum = _auth(emitir_token, criar_usuario().id)
    assert cliente_api.get(url, headers=comum).status_code == 403
    aberta = cliente_api.get(url, headers=admin)
    assert aberta.status_code == 200
    assert aberta.json()["status"] == "removida"
    assert cliente_api.get("/api/admin/barreiras/999999999", headers=admin).status_code == 404


@pytest.mark.parametrize("motivo", ["    ", "  a ", ""])
def test_motivo_em_branco_e_recusado(cliente_api, admin, criar, motivo):
    barreira = criar()
    resposta = cliente_api.post(
        f"/api/admin/barreiras/{barreira['id']}/status",
        json={"status": "validada", "motivo": motivo},
        headers=admin,
    )
    assert resposta.status_code == 422


def test_motivo_vai_sem_espacos_para_a_auditoria(cliente_api, admin, criar):
    barreira = criar()
    url = f"/api/admin/barreiras/{barreira['id']}"
    cliente_api.post(
        f"{url}/status", json={"status": "validada", "motivo": "  Vi no local  "}, headers=admin
    )
    eventos = cliente_api.get(f"{url}/eventos", headers=admin).json()
    assert eventos[-1]["detalhe"]["motivo"] == "Vi no local"


def test_admin_valida_com_zero_votos_e_entra_no_avoid_polygons(
    cliente_api, admin, criar, db_transacional
):
    """D3 do spec colaborativo: o admin decide na hora, e a rota muda."""
    from shapely.geometry import LineString

    from app.services.barreira_geom import barreiras_no_corredor, corredor, poligonos_para_evitar

    rota = LineString([(LON - 0.001, LAT), (LON + 0.001, LAT)])
    barreira = criar()

    def _nossa():
        return [
            b
            for b in barreiras_no_corredor(db_transacional, corredor(rota))
            if b.origem == "colaborativa" and b.id == barreira["id"]
        ]

    assert _nossa() == []
    resposta = cliente_api.post(
        f"/api/admin/barreiras/{barreira['id']}/status",
        json={"status": "validada", "motivo": "Vi no local"},
        headers=admin,
    )
    assert resposta.json()["votos"]["confirma"] == 0
    nossa = _nossa()
    assert [b.severidade for b in nossa] == ["intransponivel"]
    assert poligonos_para_evitar(nossa, rota) is not None

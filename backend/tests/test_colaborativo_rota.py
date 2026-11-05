"""Critério de saída do Plano 6: "usuário cadastra barreira e a rota muda".

Cadastro e votos pela API; o efeito na rota é verificado em
`barreira_geom` (o que o ORS recebe como `avoid_polygons`), sem chamar o ORS.
"""

import uuid

import pytest
from shapely.geometry import LineString

from app.services.barreira_geom import barreiras_no_corredor, corredor, poligonos_para_evitar

pytestmark = pytest.mark.integration

LON, LAT = -46.6350, -23.5900


def _auth(emitir_token, sub):
    return {"Authorization": f"Bearer {emitir_token(sub)}"}


def test_barreira_validada_por_dois_votos_entra_no_avoid_polygons(
    cliente_api, emitir_token, db_transacional
):
    faixa = corredor(LineString([(LON - 0.001, LAT), (LON + 0.001, LAT)]))

    def _nossa(barreira_id):
        return [
            b
            for b in barreiras_no_corredor(db_transacional, faixa)
            if b.origem == "colaborativa" and b.id == barreira_id
        ]

    criada = cliente_api.post(
        "/api/barreiras",
        json={
            "categoria": "escada",
            "lat": LAT,
            "lon": LON,
            "chave_idempotencia": str(uuid.uuid4()),
        },
        headers=_auth(emitir_token, uuid.uuid4()),
    ).json()
    assert _nossa(criada["id"]) == []  # pendente: a rota ainda não desvia

    for _ in range(2):
        voto = cliente_api.put(
            f"/api/barreiras/{criada['id']}/voto",
            json={"voto": "confirma"},
            headers=_auth(emitir_token, uuid.uuid4()),
        )
    assert voto.json()["status"] == "validada"

    nossa = _nossa(criada["id"])
    assert [b.severidade for b in nossa] == ["intransponivel"]
    rota = LineString([(LON - 0.001, LAT), (LON + 0.001, LAT)])
    assert poligonos_para_evitar(nossa, rota) is not None

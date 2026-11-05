"""O fallback pgRouting desvia de barreira que bloqueia (decisão do dono, 05/11/2026).

Grafo sintético em losango, longe das áreas reais, dentro de transação revertida:
O -> M1 -> D é o caminho curto; O -> M2 -> D é o longo.
"""

import uuid

import pytest
from sqlalchemy import text

from app.schemas.rota import Coordenada
from app.services.pgrouting import rota_pgrouting

pytestmark = pytest.mark.integration

LON, LAT = -45.98351729900837, -24.048988029889923
GRAU_100M = 0.0009
NOS = {
    "O": (900_000_201, LON, LAT),
    "M1": (900_000_202, LON + GRAU_100M, LAT + GRAU_100M),
    "M2": (900_000_203, LON + GRAU_100M, LAT - 3 * GRAU_100M),
    "D": (900_000_204, LON + 2 * GRAU_100M, LAT),
}
ORIGEM = Coordenada(lat=LAT, lng=LON)
DESTINO = Coordenada(lat=LAT, lng=LON + 2 * GRAU_100M)


@pytest.fixture
def losango(db_transacional):
    db = db_transacional
    fid = db.execute(text("SELECT id FROM fonte_dados WHERE chave = 'osm'")).scalar_one()
    for no, lon, lat in NOS.values():
        db.execute(
            text(
                "INSERT INTO no_pedestre (id, geom, fonte_id, data_referencia) VALUES "
                "(:id, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), :fid, CURRENT_DATE)"
            ),
            {"id": no, "lon": lon, "lat": lat, "fid": fid},
        )
    arestas = {}
    for a, b, custo in (("O", "M1", 140), ("M1", "D", 140), ("O", "M2", 330), ("M2", "D", 330)):
        arestas[a + b] = db.execute(
            text(
                "INSERT INTO via_pedestre (osmid, source, target, highway, esquema_calcada, "
                "nome, comprimento_m, custo_acessivel, custo_reverso, geom, fonte_id, "
                "data_referencia) VALUES (900000002, :a, :b, 'footway', 'geometria_propria', "
                "'Rua Sintética', :custo, :custo, :custo, ST_SetSRID(ST_MakeLine("
                "ST_MakePoint(:lon_a, :lat_a), ST_MakePoint(:lon_b, :lat_b)), 4326), :fid, "
                "CURRENT_DATE) RETURNING id"
            ),
            {
                "a": NOS[a][0],
                "b": NOS[b][0],
                "custo": custo,
                "lon_a": NOS[a][1],
                "lat_a": NOS[a][2],
                "lon_b": NOS[b][1],
                "lat_b": NOS[b][2],
                "fid": fid,
            },
        ).scalar_one()
    return arestas


def _barreira(db, lon, lat, *, status="validada", confirmacoes=2, severidade="intransponivel"):
    db.execute(
        text(
            "INSERT INTO barreira_colaborativa (categoria, severidade, status, confirmacoes, "
            "geom, fonte_id, chave_idempotencia) VALUES ('escada', :severidade, :status, "
            ":confirmacoes, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), "
            "(SELECT id FROM fonte_dados WHERE chave = 'colaborativo'), :chave)"
        ),
        {
            "severidade": severidade,
            "status": status,
            "confirmacoes": confirmacoes,
            "lon": lon,
            "lat": lat,
            "chave": uuid.uuid4(),
        },
    )


def test_sem_barreira_vai_pelo_caminho_curto(db_transacional, losango):
    rota = rota_pgrouting(db_transacional, ORIGEM, DESTINO)
    assert rota.arestas == [losango["OM1"], losango["M1D"]]


def test_barreira_validada_que_bloqueia_faz_desviar(db_transacional, losango):
    _barreira(db_transacional, *NOS["M1"][1:])
    rota = rota_pgrouting(db_transacional, ORIGEM, DESTINO)
    assert rota.arestas == [losango["OM2"], losango["M2D"]]


def test_admin_validou_sem_votos_tambem_desvia(db_transacional, losango):
    _barreira(db_transacional, *NOS["M1"][1:], confirmacoes=0)
    rota = rota_pgrouting(db_transacional, ORIGEM, DESTINO)
    assert rota.arestas == [losango["OM2"], losango["M2D"]]


@pytest.mark.parametrize(
    "kwargs",
    [{"status": "pendente"}, {"status": "contestada"}, {"severidade": "dificulta"}],
    ids=["pendente", "contestada", "so-dificulta"],
)
def test_barreira_que_nao_bloqueia_nao_muda_a_rota(db_transacional, losango, kwargs):
    _barreira(db_transacional, *NOS["M1"][1:], **kwargs)
    rota = rota_pgrouting(db_transacional, ORIGEM, DESTINO)
    assert rota.arestas == [losango["OM1"], losango["M1D"]]


def test_sem_alternativa_nao_ha_rota(db_transacional, losango):
    _barreira(db_transacional, *NOS["M1"][1:])
    _barreira(db_transacional, *NOS["M2"][1:])
    assert rota_pgrouting(db_transacional, ORIGEM, DESTINO) is None

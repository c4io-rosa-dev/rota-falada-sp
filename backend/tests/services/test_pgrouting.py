"""Testes de integração do fallback pgRouting: dois nós reais de Vila
Mariana a ~500 m pela via, um ponto fora do piloto (sem no_pedestre por
perto) e um "corte" — todas as arestas que tocam o nó de origem levadas a
`custo_acessivel`/`custo_reverso` = 1e6 (o mesmo BLOQUEIO do ETL,
`etl/etl/osm_regras.py`) numa transação sempre revertida, nunca commitada.

Os nós usados (`_NO_ORIGEM`/`_NO_DESTINO`) são `no_pedestre.id` reais do
piloto Vila Mariana, escolhidos consultando o banco (ver
`docs/superpowers/plans/2026-09-13-plano-04-roteamento.md`, Tarefa 4): o
caminho acessível entre eles soma ~401,9 m por `pgr_dijkstra`, sem nenhuma
aresta `is_degrau`."""

from __future__ import annotations

import pytest
from sqlalchemy import text

from app.db import SessionLocal
from app.schemas.rota import Coordenada
from app.services.pgrouting import (
    PassoBruto,
    RotaBruta,
    instrucoes,
    no_mais_proximo,
    rota_pgrouting,
)

pytestmark = pytest.mark.integration

# no_pedestre.id reais (Vila Mariana), caminho a pé de ~401,9 m entre eles.
_NO_ORIGEM = 9509943143
_NO_DESTINO = 9501407854
_ORIGEM = Coordenada(lat=-23.6040614, lng=-46.6408116)  # == geom de _NO_ORIGEM
_DESTINO = Coordenada(lat=-23.6040364, lng=-46.6446546)  # == geom de _NO_DESTINO

# bem fora das três area_piloto (mesmo ponto-base de test_barreira_geom_db.py);
# não há nenhum no_pedestre a 300 m dali.
_FORA_DO_PILOTO = Coordenada(lat=-24.048988029889923, lng=-45.98351729900837)


@pytest.fixture
def db():
    sessao = SessionLocal()
    try:
        yield sessao
    finally:
        sessao.rollback()
        sessao.close()


def test_no_mais_proximo_acha_o_no_real_na_propria_coordenada(db):
    assert no_mais_proximo(db, _ORIGEM.lat, _ORIGEM.lng) == _NO_ORIGEM


def test_no_mais_proximo_fora_do_piloto_devolve_none(db):
    assert no_mais_proximo(db, _FORA_DO_PILOTO.lat, _FORA_DO_PILOTO.lng) is None


def test_rota_pgrouting_entre_dois_nos_de_vila_mariana_a_500m(db):
    rota = rota_pgrouting(db, _ORIGEM, _DESTINO)

    assert rota is not None
    assert isinstance(rota, RotaBruta)
    assert 400.0 <= rota.distancia_m <= 1500.0
    assert len(rota.arestas) > 0
    # a geometria concatenada começa em _NO_ORIGEM e termina em _NO_DESTINO.
    assert rota.geometria.coords[0] == pytest.approx((_ORIGEM.lng, _ORIGEM.lat), abs=1e-6)
    assert rota.geometria.coords[-1] == pytest.approx((_DESTINO.lng, _DESTINO.lat), abs=1e-6)

    graus_degrau = db.execute(
        text("SELECT bool_or(is_degrau) FROM via_pedestre WHERE id = ANY(:ids)"),
        {"ids": rota.arestas},
    ).scalar_one()
    assert graus_degrau is False


def test_rota_pgrouting_origem_fora_do_piloto_devolve_none(db):
    assert rota_pgrouting(db, _FORA_DO_PILOTO, _DESTINO) is None


def test_rota_pgrouting_com_corte_no_no_de_origem_devolve_none(db):
    ids_do_corte = (
        db.execute(
            text("SELECT id FROM via_pedestre WHERE source = :no OR target = :no"),
            {"no": _NO_ORIGEM},
        )
        .scalars()
        .all()
    )
    assert ids_do_corte  # o nó de origem tem pelo menos uma aresta

    db.execute(
        text(
            "UPDATE via_pedestre SET custo_acessivel = 1e6, custo_reverso = 1e6 "
            "WHERE id = ANY(:ids)"
        ),
        {"ids": ids_do_corte},
    )

    assert rota_pgrouting(db, _ORIGEM, _DESTINO) is None


def test_instrucoes_agrupa_por_nome_de_via_e_soma_a_mesma_distancia(db):
    rota = rota_pgrouting(db, _ORIGEM, _DESTINO)
    assert rota is not None

    passos = instrucoes(db, rota)

    assert len(passos) > 0
    assert all(isinstance(passo, PassoBruto) for passo in passos)
    # os passos cobrem exatamente as mesmas arestas da rota, na mesma ordem.
    assert [aresta for passo in passos for aresta in passo.arestas] == rota.arestas
    # a soma das distâncias dos passos bate com a distância total da rota.
    assert sum(passo.distancia_m for passo in passos) == pytest.approx(rota.distancia_m)
    # ordem sequencial e sem degrau em nenhum passo (mesma rota do teste acima).
    assert [passo.ordem for passo in passos] == list(range(1, len(passos) + 1))
    assert all(not passo.is_degrau for passo in passos)
    # o primeiro passo sempre é 'siga' (não há trecho anterior para comparar rumo).
    assert passos[0].direcao == "siga"

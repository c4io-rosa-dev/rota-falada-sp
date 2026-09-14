"""Testes de `enriquecer_passos`: integração com dados reais do piloto (via
`via_pedestre`/`conflacao_via_calcada`/`calcada_sp` já carregados pelo ETL) e
um teste puro do mapa de classes de steepness do ORS.

Os `via_pedestre.id` usados abaixo foram escolhidos consultando o banco
(ver `docs/superpowers/plans/2026-09-13-plano-04-roteamento.md`, Tarefa 5):
- `_VIA_COM_CONFLACAO_MEDIDA`: tem `conflacao_via_calcada` ligada a uma
  `calcada_sp` com `largura_medida=true` (largura_min_m > 0).
- `_VIA_SEM_CONFLACAO`: não aparece em `conflacao_via_calcada`.
- `_VIA_KERB_NAO_TRANSPONIVEL`: `kerb_transponivel = false` (kerb='raised').
- `_VIA_CONFLACAO_LARGURA_ZERO`: tem `conflacao_via_calcada`, mas a
  `calcada_sp` ligada tem `largura_min_m = 0` (⇒ `largura_medida=false` pela
  coluna gerada) — o caso real da regra inegociável do GeoSampa (zero é
  ausência de medição, nunca "calçada de largura zero").
Cada teste usa a própria geometria da via como `PassoBruto.geometria`, então
o ponto médio cai a 0 m dela — bem dentro do raio de 10 m de
`_via_mais_proxima` — sem precisar inserir nada no banco.
"""

from __future__ import annotations

from datetime import date

import pytest
from shapely.geometry import LineString
from shapely.wkt import loads as _carregar_wkt
from sqlalchemy import text

from app.db import SessionLocal
from app.schemas.rota import BarreiraResumo, Passo
from app.services.barreira_geom import PROJ_4326_31983, BarreiraCandidata
from app.services.enriquecimento import _distancia_m, _pct_da_classe_steepness, enriquecer_passos
from app.services.pgrouting import PassoBruto

pytestmark = [pytest.mark.integration, pytest.mark.dados_reais]

_VIA_COM_CONFLACAO_MEDIDA = 25041
_VIA_SEM_CONFLACAO = 25044
_VIA_KERB_NAO_TRANSPONIVEL = 26002
_VIA_CONFLACAO_LARGURA_ZERO = 49085

# bem fora das três area_piloto (mesmo ponto-base de test_barreira_geom_db.py
# e test_pgrouting.py) — nenhuma via_pedestre real está a 10 m dali.
_FORA_DO_PILOTO = (-45.98351729900837, -24.048988029889923)  # (lng, lat)


@pytest.fixture
def db():
    sessao = SessionLocal()
    try:
        yield sessao
    finally:
        sessao.rollback()
        sessao.close()


def _geometria_da_via(db, via_id: int) -> LineString:
    wkt = db.execute(
        text("SELECT ST_AsText(geom) FROM via_pedestre WHERE id = :id"), {"id": via_id}
    ).scalar_one()
    return _carregar_wkt(wkt)


def _passo_bruto(ordem: int, geometria: LineString, *, distancia_m: float = 10.0) -> PassoBruto:
    return PassoBruto(
        ordem=ordem,
        instrucao="Siga",
        distancia_m=distancia_m,
        direcao="siga",
        geometria=geometria,
        is_degrau=False,
        kerb_transponivel=None,
        arestas=[],
    )


def test_passo_sobre_aresta_conflada_preenche_largura_medida(db):
    geometria = _geometria_da_via(db, _VIA_COM_CONFLACAO_MEDIDA)
    bruto = _passo_bruto(1, geometria)

    passos, avisos, fontes = enriquecer_passos(db, [bruto], [], None)

    assert len(passos) == 1
    passo = passos[0]
    assert isinstance(passo, Passo)
    assert passo.largura_medida is True
    assert passo.largura_m is not None
    assert passo.largura_m > 0
    assert passo.fonte == "osm"
    assert passo.data_referencia == date(2026, 9, 13)
    assert "geosampa" in fontes
    assert "osm" in fontes
    assert not any(aviso.tipo == "trecho_sem_dados" for aviso in avisos)


def test_passo_sobre_aresta_sem_conflacao_devolve_none_e_aviso(db):
    geometria = _geometria_da_via(db, _VIA_SEM_CONFLACAO)
    bruto = _passo_bruto(1, geometria)

    passos, avisos, _fontes = enriquecer_passos(db, [bruto], [], None)

    passo = passos[0]
    assert passo.largura_m is None
    assert passo.largura_medida is False
    assert sum(1 for aviso in avisos if aviso.tipo == "trecho_sem_dados") == 1


def test_aviso_trecho_sem_dados_aparece_uma_unica_vez_por_rota(db):
    geometria = _geometria_da_via(db, _VIA_SEM_CONFLACAO)
    brutos = [_passo_bruto(1, geometria), _passo_bruto(2, geometria)]

    _passos, avisos, _fontes = enriquecer_passos(db, brutos, [], None)

    assert sum(1 for aviso in avisos if aviso.tipo == "trecho_sem_dados") == 1


def test_aresta_com_kerb_nao_transponivel_vira_guia_nao_transponivel(db):
    geometria = _geometria_da_via(db, _VIA_KERB_NAO_TRANSPONIVEL)
    bruto = _passo_bruto(1, geometria)

    passos, _avisos, _fontes = enriquecer_passos(db, [bruto], [], None)

    assert passos[0].guia == "nao_transponivel"


def test_regra_inegociavel_largura_medida_falsa_implica_largura_none(db):
    """Regra inegociável do projeto: mesmo quando a via TEM conflação, se a
    `calcada_sp` ligada tem `largura_medida=false` (GeoSampa zero = ausência,
    nunca "calçada de largura zero"), `largura_m` tem que vir `None` — nunca
    `0.0`."""
    geometria = _geometria_da_via(db, _VIA_CONFLACAO_LARGURA_ZERO)
    bruto = _passo_bruto(1, geometria)

    passos, _avisos, _fontes = enriquecer_passos(db, [bruto], [], None)

    passo = passos[0]
    assert passo.largura_medida is False
    assert passo.largura_m is None


def test_via_nao_encontrada_a_10m_devolve_guia_desconhecida(db):
    ponto = _FORA_DO_PILOTO
    geometria = LineString([ponto, (ponto[0] + 0.0001, ponto[1] + 0.0001)])
    bruto = _passo_bruto(1, geometria)

    passos, avisos, fontes = enriquecer_passos(db, [bruto], [], None)

    passo = passos[0]
    assert passo.guia == "desconhecida"
    assert passo.fonte == "osm"
    assert passo.data_referencia is None
    assert passo.largura_m is None
    assert "osm" not in fontes  # nenhum via_pedestre real foi confirmado
    assert sum(1 for aviso in avisos if aviso.tipo == "trecho_sem_dados") == 1


def test_barreira_dificulta_proxima_vira_barreira_resumo_e_aviso(db):
    from pyproj import Transformer
    from shapely.geometry import Point

    geometria = _geometria_da_via(db, _VIA_COM_CONFLACAO_MEDIDA)
    bruto = _passo_bruto(1, geometria)

    # barreira 10 m (em 31983) ao lado do ponto médio do passo — dentro do
    # raio de 15 m de `barreiras_proximas`; a distância exata até a
    # POLILINHA (não até o ponto médio) é recalculada abaixo com o mesmo
    # `_distancia_m` que a implementação usa, porque a via bruta pode
    # encurvar entre o ponto médio e as pontas (ponto-a-linha != ponto-a-ponto).
    ponto_medio = geometria.interpolate(0.5, normalized=True).coords[0]
    ponto_medio_31983 = PROJ_4326_31983.transform(*ponto_medio)
    proj_31983_4326 = Transformer.from_crs("EPSG:31983", "EPSG:4326", always_xy=True)
    lng_barreira, lat_barreira = proj_31983_4326.transform(
        ponto_medio_31983[0] + 10.0, ponto_medio_31983[1]
    )
    ponto_barreira = Point(lng_barreira, lat_barreira)
    distancia_esperada = _distancia_m(ponto_barreira, geometria)
    assert distancia_esperada <= 15.0  # a fixture precisa cair dentro do raio testado

    barreira = BarreiraCandidata(
        id=999_999,
        origem="colaborativa",
        categoria="buraco",
        severidade="dificulta",
        geom=ponto_barreira,
        confirmacoes=1,
        data_referencia=date(2026, 1, 1),
    )

    passos, avisos, fontes = enriquecer_passos(db, [bruto], [barreira], None)

    passo = passos[0]
    assert len(passo.barreiras_proximas) == 1
    resumo = passo.barreiras_proximas[0]
    assert isinstance(resumo, BarreiraResumo)
    assert resumo.id == 999_999
    assert resumo.distancia_m == pytest.approx(distancia_esperada)
    assert any(aviso.tipo == "barreira_dificulta" for aviso in avisos)
    assert "colaborativo" in fontes


def test_barreira_dificulta_longe_nao_aparece(db):
    geometria = _geometria_da_via(db, _VIA_COM_CONFLACAO_MEDIDA)
    bruto = _passo_bruto(1, geometria)
    from shapely.geometry import Point

    barreira = BarreiraCandidata(
        id=999_998,
        origem="oficial",
        categoria="buraco",
        severidade="dificulta",
        geom=Point(-46.0, -23.0),  # bem longe
        confirmacoes=None,
        data_referencia=None,
    )

    passos, avisos, _fontes = enriquecer_passos(db, [bruto], [barreira], None)

    assert passos[0].barreiras_proximas == []
    assert not any(aviso.tipo == "barreira_dificulta" for aviso in avisos)


def test_extras_steepness_sobrepoe_declividade_do_geosampa(db):
    geometria = _geometria_da_via(db, _VIA_COM_CONFLACAO_MEDIDA)
    bruto = _passo_bruto(1, geometria)

    passos, _avisos, _fontes = enriquecer_passos(db, [bruto], [], [5])

    passo = passos[0]
    assert passo.declividade_medida is True
    assert passo.declividade_pct == _pct_da_classe_steepness(5)
    assert passo.declividade_pct != pytest.approx(1.5)  # valor real do GeoSampa p/ essa via


def test_extras_steepness_none_usa_geosampa(db):
    geometria = _geometria_da_via(db, _VIA_COM_CONFLACAO_MEDIDA)
    bruto = _passo_bruto(1, geometria)

    passos, _avisos, _fontes = enriquecer_passos(db, [bruto], [], [None])

    passo = passos[0]
    assert passo.declividade_medida is True
    assert passo.declividade_pct == pytest.approx(1.5)


@pytest.mark.parametrize(
    ("classe", "esperado"),
    [(0, 0.0), (1, 3.0), (-1, 3.0), (2, 6.0), (-3, 10.0), (4, 15.0), (5, 20.0), (-5, 20.0)],
)
def test_pct_da_classe_steepness_segue_o_mapa_oficial_do_ors(classe, esperado):
    assert _pct_da_classe_steepness(classe) == esperado

"""Testes de `enriquecer_passos`: integração com dados reais do piloto (via
`via_pedestre`/`conflacao_via_calcada`/`calcada_sp` já carregados pelo ETL) e
um teste puro do mapa de classes de steepness do ORS.

Os `via_pedestre.id` mudam a cada recarga completa do ETL (bigserial), então
nenhum id é fixo: cada fixture abaixo localiza, de forma determinística
(`ORDER BY osmid, source, target`), uma via com a PROPRIEDADE que o teste
exige e que é a vizinha mais próxima do próprio ponto médio (é isso que
`_via_mais_proxima` enxerga). Se nenhuma via tem a propriedade, a fixture
falha (`pytest.fail`) em vez de pular:
- `via_com_conflacao_medida`: tem `conflacao_via_calcada` ligada a uma
  `calcada_sp` com `largura_medida=true` e `declividade_medida=true` (e
  declividade diferente da classe 5 do ORS, para o teste de sobreposição).
- `via_sem_conflacao`: não aparece em `conflacao_via_calcada`.
- `via_kerb_nao_transponivel`: `kerb_transponivel = false` (kerb='raised').
- `via_conflacao_largura_zero`: tem `conflacao_via_calcada`, mas a
  `calcada_sp` ligada tem `largura_min_m = 0` (⇒ `largura_medida=false` pela
  coluna gerada) — o caso real da regra inegociável do GeoSampa (zero é
  ausência de medição, nunca "calçada de largura zero").
Cada teste usa a própria geometria da via como `PassoBruto.geometria`, então
o ponto médio cai a 0 m dela — bem dentro do raio de 10 m de
`_via_mais_proxima` — sem precisar inserir nada no banco.
"""

from __future__ import annotations

from datetime import date
from typing import NamedTuple

import pytest
from shapely.geometry import LineString
from shapely.wkt import loads as _carregar_wkt
from sqlalchemy import text

from app.db import SessionLocal
from app.schemas.rota import BarreiraResumo, Passo
from app.services.barreira_geom import PROJ_4326_31983, BarreiraCandidata
from app.services.enriquecimento import (
    _distancia_m,
    _pct_da_classe_steepness,
    _via_mais_proxima,
    enriquecer_passos,
)
from app.services.pgrouting import PassoBruto

pytestmark = [pytest.mark.integration, pytest.mark.dados_reais]

_LIMITE_CANDIDATAS = 500

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


class _ViaEscolhida(NamedTuple):
    id: int
    data_referencia: date
    declividade_max_pct: float | None  # da calcada_sp conflada (None se não há conflação)


def _escolher_via(descricao: str, juncao_e_filtro: str) -> _ViaEscolhida:
    """Primeira via (ordem estável por chaves OSM) que satisfaz `juncao_e_filtro`
    e cuja vizinha mais próxima do próprio ponto médio é ela mesma."""
    sessao = SessionLocal()
    try:
        candidatas = sessao.execute(
            text(
                "SELECT v.id, v.data_referencia, ST_AsText(v.geom) AS wkt, "
                "(SELECT c.declividade_max_pct FROM conflacao_via_calcada cv "
                " JOIN calcada_sp c ON c.id = cv.calcada_id WHERE cv.via_id = v.id) AS decl "
                f"FROM via_pedestre v {juncao_e_filtro} "
                "ORDER BY v.osmid, v.source, v.target, v.id "
                f"LIMIT {_LIMITE_CANDIDATAS}"
            )
        ).all()
        for via_id, data_ref, wkt, decl in candidatas:
            ponto_medio = _carregar_wkt(wkt).interpolate(0.5, normalized=True)
            vizinha = _via_mais_proxima(sessao, ponto_medio)
            if vizinha is not None and vizinha["id"] == via_id:
                return _ViaEscolhida(via_id, data_ref, None if decl is None else float(decl))
    finally:
        sessao.rollback()
        sessao.close()
    pytest.fail(
        f"nenhuma via_pedestre com a propriedade '{descricao}' no banco local "
        "(ETL carregado? o piloto mudou?)"
    )


@pytest.fixture(scope="module")
def via_com_conflacao_medida() -> _ViaEscolhida:
    return _escolher_via(
        "conflação com largura e declividade medidas",
        "JOIN conflacao_via_calcada cv ON cv.via_id = v.id "
        "JOIN calcada_sp c ON c.id = cv.calcada_id "
        "WHERE c.largura_medida AND c.declividade_medida "
        "AND c.declividade_max_pct <> 20",
    )


@pytest.fixture(scope="module")
def via_sem_conflacao() -> _ViaEscolhida:
    return _escolher_via(
        "sem conflação",
        "WHERE NOT EXISTS (SELECT 1 FROM conflacao_via_calcada cv WHERE cv.via_id = v.id)",
    )


@pytest.fixture(scope="module")
def via_kerb_nao_transponivel() -> _ViaEscolhida:
    return _escolher_via("kerb_transponivel = false", "WHERE v.kerb_transponivel = false")


@pytest.fixture(scope="module")
def via_conflacao_largura_zero() -> _ViaEscolhida:
    return _escolher_via(
        "conflação com calçada de largura_min_m = 0",
        "JOIN conflacao_via_calcada cv ON cv.via_id = v.id "
        "JOIN calcada_sp c ON c.id = cv.calcada_id "
        "WHERE c.largura_min_m = 0",
    )


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


def test_passo_sobre_aresta_conflada_preenche_largura_medida(db, via_com_conflacao_medida):
    geometria = _geometria_da_via(db, via_com_conflacao_medida.id)
    bruto = _passo_bruto(1, geometria)

    passos, avisos, fontes = enriquecer_passos(db, [bruto], [], None)

    assert len(passos) == 1
    passo = passos[0]
    assert isinstance(passo, Passo)
    assert passo.largura_medida is True
    assert passo.largura_m is not None
    assert passo.largura_m > 0
    assert passo.fonte == "osm"
    assert passo.data_referencia == via_com_conflacao_medida.data_referencia
    assert "geosampa" in fontes
    assert "osm" in fontes
    assert not any(aviso.tipo == "trecho_sem_dados" for aviso in avisos)


def test_passo_sobre_aresta_sem_conflacao_devolve_none_e_aviso(db, via_sem_conflacao):
    geometria = _geometria_da_via(db, via_sem_conflacao.id)
    bruto = _passo_bruto(1, geometria)

    passos, avisos, _fontes = enriquecer_passos(db, [bruto], [], None)

    passo = passos[0]
    assert passo.largura_m is None
    assert passo.largura_medida is False
    assert sum(1 for aviso in avisos if aviso.tipo == "trecho_sem_dados") == 1


def test_aviso_trecho_sem_dados_aparece_uma_unica_vez_por_rota(db, via_sem_conflacao):
    geometria = _geometria_da_via(db, via_sem_conflacao.id)
    brutos = [_passo_bruto(1, geometria), _passo_bruto(2, geometria)]

    _passos, avisos, _fontes = enriquecer_passos(db, brutos, [], None)

    assert sum(1 for aviso in avisos if aviso.tipo == "trecho_sem_dados") == 1


def test_aresta_com_kerb_nao_transponivel_vira_guia_nao_transponivel(db, via_kerb_nao_transponivel):
    geometria = _geometria_da_via(db, via_kerb_nao_transponivel.id)
    bruto = _passo_bruto(1, geometria)

    passos, _avisos, _fontes = enriquecer_passos(db, [bruto], [], None)

    assert passos[0].guia == "nao_transponivel"


def test_regra_inegociavel_largura_medida_falsa_implica_largura_none(
    db, via_conflacao_largura_zero
):
    """Regra inegociável do projeto: mesmo quando a via TEM conflação, se a
    `calcada_sp` ligada tem `largura_medida=false` (GeoSampa zero = ausência,
    nunca "calçada de largura zero"), `largura_m` tem que vir `None` — nunca
    `0.0`."""
    geometria = _geometria_da_via(db, via_conflacao_largura_zero.id)
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


def test_barreira_dificulta_proxima_vira_barreira_resumo_e_aviso(db, via_com_conflacao_medida):
    from pyproj import Transformer
    from shapely.geometry import Point

    geometria = _geometria_da_via(db, via_com_conflacao_medida.id)
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


def test_barreira_dificulta_longe_nao_aparece(db, via_com_conflacao_medida):
    geometria = _geometria_da_via(db, via_com_conflacao_medida.id)
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


def test_extras_steepness_sobrepoe_declividade_do_geosampa(db, via_com_conflacao_medida):
    geometria = _geometria_da_via(db, via_com_conflacao_medida.id)
    bruto = _passo_bruto(1, geometria)

    passos, _avisos, _fontes = enriquecer_passos(db, [bruto], [], [5])

    passo = passos[0]
    assert passo.declividade_medida is True
    assert passo.declividade_pct == _pct_da_classe_steepness(5)
    assert passo.declividade_pct != pytest.approx(
        via_com_conflacao_medida.declividade_max_pct
    )  # GeoSampa


def test_extras_steepness_none_usa_geosampa(db, via_com_conflacao_medida):
    geometria = _geometria_da_via(db, via_com_conflacao_medida.id)
    bruto = _passo_bruto(1, geometria)

    passos, _avisos, _fontes = enriquecer_passos(db, [bruto], [], [None])

    passo = passos[0]
    assert passo.declividade_medida is True
    assert passo.declividade_pct == pytest.approx(via_com_conflacao_medida.declividade_max_pct)


@pytest.mark.parametrize(
    ("classe", "esperado"),
    [(0, 0.0), (1, 3.0), (-1, 3.0), (2, 6.0), (-3, 10.0), (4, 15.0), (5, 20.0), (-5, 20.0)],
)
def test_pct_da_classe_steepness_segue_o_mapa_oficial_do_ors(classe, esperado):
    assert _pct_da_classe_steepness(classe) == esperado

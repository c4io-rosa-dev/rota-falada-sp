"""Testes de integração de `rota.calcular` (duas passadas, fallback
progressivo, fallback pgRouting, cache) e dos 13 casos de referência de
`tests/casos_referencia.json` (10-15 pares reais de `no_pedestre` nos três
recortes do piloto, mais a regressão do spec: um POI `wheelchair=no`
[severidade `informativo`] a poucos metros da calçada NÃO bloqueia a rota).

Todos os testes usam `OrsFixtureClient` (nunca a rede) e o banco real do
piloto — mesmo os cenários puramente de ORS precisam do banco, porque
`barreira_geom`/`enriquecimento` (chamados por `calcular`) sempre consultam
`via_pedestre`/`barreira_colaborativa`/`barreira_oficial`. Os cenários que
usam coordenadas sintéticas ficam bem fora das três `area_piloto` (mesmo
ponto-base de `test_barreira_geom_db.py`), para nenhuma via ou barreira real
interferir; os que precisam de pgRouting de verdade usam os mesmos nós reais
de Vila Mariana já validados em `test_pgrouting.py`."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from shapely.geometry import LineString, Point, mapping
from sqlalchemy import text

from app.db import SessionLocal
from app.schemas.rota import Coordenada, PerfilAcessibilidade, RotaIn, RotaOut
from app.services import cache_rota
from app.services.barreira_geom import (
    PROJ_4326_31983,
    PROJ_31983_4326,
    barreiras_no_corredor,
    corredor,
)
from app.services.ors_client import EstadoCota, OrsClient, OrsErro, OrsFixtureClient, _nome_fixture
from app.services.pgrouting import rota_pgrouting
from app.services.rota import RotaNaoEncontrada, calcular

pytestmark = pytest.mark.integration

# bem fora das três area_piloto (mesmo ponto-base de test_barreira_geom_db.py
# e test_pgrouting.py) — nenhuma via_pedestre/barreira real está por perto.
_X0, _Y0 = 400_000.0, 7_340_000.0

# no_pedestre.id reais (Vila Mariana), mesmos de test_pgrouting.py: caminho a
# pé de ~401,9 m entre eles, sem degrau — usados nos testes que precisam de
# um fallback pgRouting de verdade.
_ORIGEM_REAL = Coordenada(lat=-23.6040614, lng=-46.6408116)
_DESTINO_REAL = Coordenada(lat=-23.6040364, lng=-46.6446546)

# id sentinela bem acima do que o ETL real carrega, para nunca colidir.
_ID_BARREIRA_INTRANSPONIVEL = 900_100_001
_ID_POI_INFORMATIVO = 900_100_002


@pytest.fixture
def db():
    sessao = SessionLocal()
    try:
        yield sessao
    finally:
        sessao.rollback()
        sessao.close()


def _ponto_4326(dx_m: float, dy_m: float = 0.0) -> tuple[float, float]:
    """(lng, lat) do ponto sentinela deslocado `dx_m`/`dy_m` metros do
    ponto-base `_X0`/`_Y0` (EPSG:31983)."""
    return PROJ_31983_4326.transform(_X0 + dx_m, _Y0 + dy_m)


def _fonte_id(db, chave: str) -> int:
    return db.execute(
        text("SELECT id FROM fonte_dados WHERE chave = :chave"), {"chave": chave}
    ).scalar_one()


def _resposta_ors(
    coords: list[tuple[float, float]],
    distancia_m: float,
    *,
    nome_via: str = "Rua Teste",
    steepness_classe: int | None = 0,
) -> dict:
    """GeoJSON FeatureCollection mínimo, na estrutura real do ORS (perfil
    wheelchair): um passo cobrindo a linha inteira mais o passo degenerado
    de chegada (`way_points` com início == fim), igual ao que o ORS de
    verdade devolve — exercita o descarte desse passo em
    `rota._passos_brutos_do_ors`."""
    ultimo = len(coords) - 1
    extras = {}
    if steepness_classe is not None:
        extras["steepness"] = {"values": [[0, ultimo, steepness_classe]]}
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "segments": [
                        {
                            "distance": distancia_m,
                            "duration": distancia_m,
                            "steps": [
                                {
                                    "distance": distancia_m,
                                    "duration": distancia_m,
                                    "type": 11,
                                    "instruction": f"Siga por {nome_via}",
                                    "name": nome_via,
                                    "way_points": [0, ultimo],
                                },
                                {
                                    "distance": 0.0,
                                    "duration": 0.0,
                                    "type": 10,
                                    "instruction": "Chegou ao destino",
                                    "name": "-",
                                    "way_points": [ultimo, ultimo],
                                },
                            ],
                        }
                    ],
                    "extras": extras,
                    "summary": {
                        "distance": distancia_m,
                        "duration": distancia_m,
                        "ascent": 0.0,
                        "descent": 0.0,
                    },
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[lng, lat, 0.0] for lng, lat in coords],
                },
            }
        ],
    }


def _escreve_fixture(diretorio: Path, nome: str, conteudo: dict) -> None:
    (diretorio / f"{nome}.json").write_text(json.dumps(conteudo), encoding="utf-8")


class _ClienteSempreErro(OrsClient):
    """Cliente ORS de teste que sempre levanta o mesmo `OrsErro`, para forçar
    `calcular` a abandonar o ORS (cota) ou esgotar os níveis (sem_rota)."""

    def __init__(self, codigo: str):
        super().__init__(
            chave="", base_url="https://x.invalido", timeout_s=1.0, estado=EstadoCota()
        )
        self._codigo = codigo

    def rota(self, *args, **kwargs):  # noqa: D102 - mesma assinatura de OrsClient.rota
        raise OrsErro(self._codigo)


class _ClienteEspiao(OrsFixtureClient):
    """`OrsFixtureClient` que grava os argumentos de cada chamada a `.rota`
    (em particular `avoid_polygons`) antes de delegar para a implementação
    real de fixtures — usado para confirmar que a 2ª passada é mesmo
    disparada quando o corredor cruza uma barreira intransponível."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.chamadas: list[dict] = []

    def rota(self, coords, *, restricoes, evitar_degraus, avoid_polygons):
        self.chamadas.append(
            {"coords": coords, "restricoes": restricoes, "avoid_polygons": avoid_polygons}
        )
        return super().rota(
            coords,
            restricoes=restricoes,
            evitar_degraus=evitar_degraus,
            avoid_polygons=avoid_polygons,
        )


# --- cache: miss na 1ª chamada, hit na 2ª -----------------------------------


def test_cache_miss_na_primeira_chamada_e_hit_na_segunda(db, tmp_path):
    lng_o, lat_o = _ponto_4326(0.0)
    lng_d, lat_d = _ponto_4326(300.0)
    entrada = RotaIn(
        origem=Coordenada(lat=lat_o, lng=lng_o), destino=Coordenada(lat=lat_d, lng=lng_d)
    )

    nome = _nome_fixture((lng_o, lat_o), (lng_d, lat_d), 6)
    _escreve_fixture(tmp_path, nome, _resposta_ors([(lng_o, lat_o), (lng_d, lat_d)], 300.0))

    cliente = OrsFixtureClient(
        chave="",
        base_url="https://x",
        timeout_s=15.0,
        estado=EstadoCota(),
        diretorio_fixtures=tmp_path,
    )
    agora = datetime.now(UTC)

    saida_1 = calcular(db, entrada, cliente, agora)
    assert saida_1.cache is False
    assert saida_1.motor == "fixture"
    assert saida_1.nivel_exigencia_atendido == 6
    assert saida_1.distancia_m == pytest.approx(300.0)

    saida_2 = calcular(db, entrada, cliente, agora)
    assert saida_2.cache is True
    assert saida_2.distancia_m == pytest.approx(saida_1.distancia_m)
    assert saida_2.motor == saida_1.motor
    assert saida_2.nivel_exigencia_atendido == saida_1.nivel_exigencia_atendido


def test_cache_expirado_nao_e_reaproveitado(db, tmp_path):
    lng_o, lat_o = _ponto_4326(50.0)
    lng_d, lat_d = _ponto_4326(400.0)
    entrada = RotaIn(
        origem=Coordenada(lat=lat_o, lng=lng_o), destino=Coordenada(lat=lat_d, lng=lng_d)
    )

    nome = _nome_fixture((lng_o, lat_o), (lng_d, lat_d), 6)
    _escreve_fixture(tmp_path, nome, _resposta_ors([(lng_o, lat_o), (lng_d, lat_d)], 350.0))

    cliente = OrsFixtureClient(
        chave="",
        base_url="https://x",
        timeout_s=15.0,
        estado=EstadoCota(),
        diretorio_fixtures=tmp_path,
    )
    t0 = datetime.now(UTC)

    saida_1 = calcular(db, entrada, cliente, t0)
    assert saida_1.cache is False

    # 7h depois (TTL é 6h): a entrada gravada por calcular() já expirou.
    saida_2 = calcular(db, entrada, cliente, t0 + timedelta(hours=7))
    assert saida_2.cache is False


# --- fallback progressivo de inclinação -------------------------------------


def test_nivel_3_sem_rota_recua_para_nivel_6_e_avisa(db, tmp_path):
    lng_o, lat_o = _ponto_4326(1000.0)
    lng_d, lat_d = _ponto_4326(1500.0)
    perfil = PerfilAcessibilidade(inclinacao_max=3)
    entrada = RotaIn(
        origem=Coordenada(lat=lat_o, lng=lng_o),
        destino=Coordenada(lat=lat_d, lng=lng_d),
        perfil=perfil,
    )

    _escreve_fixture(
        tmp_path, _nome_fixture((lng_o, lat_o), (lng_d, lat_d), 3), {"erro_codigo": "sem_rota"}
    )
    _escreve_fixture(
        tmp_path,
        _nome_fixture((lng_o, lat_o), (lng_d, lat_d), 6),
        _resposta_ors([(lng_o, lat_o), (lng_d, lat_d)], 500.0),
    )

    cliente = OrsFixtureClient(
        chave="",
        base_url="https://x",
        timeout_s=15.0,
        estado=EstadoCota(),
        diretorio_fixtures=tmp_path,
    )

    saida = calcular(db, entrada, cliente, datetime.now(UTC))

    assert saida.nivel_exigencia_atendido == 6
    assert saida.motor == "fixture"
    avisos_relaxamento = [a for a in saida.avisos if a.tipo == "exigencia_relaxada"]
    assert len(avisos_relaxamento) == 1
    assert "3" in avisos_relaxamento[0].mensagem
    assert "6" in avisos_relaxamento[0].mensagem


def test_todos_os_niveis_sem_rota_no_ors_cai_para_pgrouting(db):
    """`sem_rota` em 3, 6, 10 e 'any' esgota o laço de níveis inteiro (sem
    levantar `_OrsIndisponivel`) e `calcular` recorre ao pgRouting mesmo
    assim — usa os nós reais de Vila Mariana para o fallback ter onde
    achar caminho."""
    cliente = _ClienteSempreErro("sem_rota")
    entrada = RotaIn(origem=_ORIGEM_REAL, destino=_DESTINO_REAL)

    saida = calcular(db, entrada, cliente, datetime.now(UTC))

    assert saida.motor == "pgrouting"
    assert saida.nivel_exigencia_atendido == "any"
    assert any(a.tipo == "motor_fallback" for a in saida.avisos)
    assert any(a.tipo == "exigencia_relaxada" for a in saida.avisos)  # pedido=6 != atendido='any'


# --- cota do ORS esgotada -> pgRouting --------------------------------------


def test_cota_diaria_esgotada_usa_pgrouting_e_avisa_motor_fallback(db):
    cliente = _ClienteSempreErro("cota_diaria")
    entrada = RotaIn(origem=_ORIGEM_REAL, destino=_DESTINO_REAL)

    saida = calcular(db, entrada, cliente, datetime.now(UTC))

    assert saida.motor == "pgrouting"
    assert 300.0 <= saida.distancia_m <= 1500.0
    assert any(a.tipo == "motor_fallback" for a in saida.avisos)
    assert not any(passo.is_degrau for passo in saida.passos)


def test_rota_nao_encontrada_quando_nem_ors_nem_pgrouting_acham_rota(db):
    """Origem fora da área piloto: pgRouting não acha `no_pedestre` por
    perto, e o `RotaNaoEncontrada` carrega o motivo do ORS (cota) para o
    router (Tarefa 7) decidir entre 404 e 503."""
    fora_do_piloto = Coordenada(lat=-24.048988029889923, lng=-45.98351729900837)
    cliente = _ClienteSempreErro("cota_diaria")
    entrada = RotaIn(origem=fora_do_piloto, destino=_DESTINO_REAL)

    with pytest.raises(RotaNaoEncontrada) as exc:
        calcular(db, entrada, cliente, datetime.now(UTC))

    assert exc.value.erro_ors is not None
    assert exc.value.erro_ors.codigo == "cota_diaria"


# --- barreira intransponível no corredor aciona a 2ª passada ---------------


def test_barreira_intransponivel_no_corredor_aciona_segunda_passada_com_avoid_polygons(
    db, tmp_path
):
    lng_o, lat_o = _ponto_4326(2000.0)
    lng_d, lat_d = _ponto_4326(2200.0)
    lng_meio, lat_meio = _ponto_4326(2100.0)  # bem no meio da linha, dentro do corredor de 50 m

    fid_colab = _fonte_id(db, "colaborativo")
    db.execute(
        text(
            "INSERT INTO barreira_colaborativa "
            "(id, categoria, severidade, status, confirmacoes, geom, fonte_id) VALUES "
            "(:id, 'obstaculo_calcada', 'intransponivel', 'validada', 2, "
            " ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), :fonte_id)"
        ),
        {
            "id": _ID_BARREIRA_INTRANSPONIVEL,
            "lng": lng_meio,
            "lat": lat_meio,
            "fonte_id": fid_colab,
        },
    )

    entrada = RotaIn(
        origem=Coordenada(lat=lat_o, lng=lng_o), destino=Coordenada(lat=lat_d, lng=lng_d)
    )
    _escreve_fixture(
        tmp_path,
        _nome_fixture((lng_o, lat_o), (lng_d, lat_d), 6),
        _resposta_ors([(lng_o, lat_o), (lng_meio, lat_meio), (lng_d, lat_d)], 200.0),
    )
    cliente = _ClienteEspiao(
        chave="",
        base_url="https://x",
        timeout_s=15.0,
        estado=EstadoCota(),
        diretorio_fixtures=tmp_path,
    )

    saida = calcular(db, entrada, cliente, datetime.now(UTC))

    assert len(cliente.chamadas) == 2
    assert cliente.chamadas[0]["avoid_polygons"] is None
    assert cliente.chamadas[1]["avoid_polygons"] is not None
    assert saida.motor == "fixture"


class _ClienteSemRotaNaSegundaPassada(OrsFixtureClient):
    """`OrsFixtureClient` que levanta `OrsErro('sem_rota')` sempre que
    `avoid_polygons` é informado (simula o ORS não achando desvio para a
    barreira) e delega para a fixture normalmente na 1ª passada."""

    def rota(self, coords, *, restricoes, evitar_degraus, avoid_polygons):
        if avoid_polygons is not None:
            raise OrsErro("sem_rota")
        return super().rota(
            coords,
            restricoes=restricoes,
            evitar_degraus=evitar_degraus,
            avoid_polygons=avoid_polygons,
        )


class _ClienteCotaNaSegundaPassada(OrsFixtureClient):
    """Como acima, mas a 2ª passada falha por cota (não por falta de rota) —
    cobre o ramo que abandona o ORS de vez a partir da 2ª passada."""

    def rota(self, coords, *, restricoes, evitar_degraus, avoid_polygons):
        if avoid_polygons is not None:
            raise OrsErro("cota_diaria")
        return super().rota(
            coords,
            restricoes=restricoes,
            evitar_degraus=evitar_degraus,
            avoid_polygons=avoid_polygons,
        )


def test_segunda_passada_sem_rota_tenta_o_proximo_nivel(db, tmp_path):
    """A barreira intransponível cruza a rota do nível 6 (aciona a 2ª
    passada, que aqui sempre falha com `sem_rota`); o nível 10 usa uma
    geometria que não cruza a barreira, então resolve de primeira."""
    lng_o, lat_o = _ponto_4326(4000.0)
    lng_d, lat_d = _ponto_4326(4200.0)
    lng_meio, lat_meio = _ponto_4326(4100.0)

    fid_colab = _fonte_id(db, "colaborativo")
    db.execute(
        text(
            "INSERT INTO barreira_colaborativa "
            "(id, categoria, severidade, status, confirmacoes, geom, fonte_id) VALUES "
            "(:id, 'obstaculo_calcada', 'intransponivel', 'validada', 2, "
            " ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), :fonte_id)"
        ),
        {
            "id": _ID_BARREIRA_INTRANSPONIVEL + 1,
            "lng": lng_meio,
            "lat": lat_meio,
            "fonte_id": fid_colab,
        },
    )

    entrada = RotaIn(
        origem=Coordenada(lat=lat_o, lng=lng_o), destino=Coordenada(lat=lat_d, lng=lng_d)
    )
    # nível 6: passa bem em cima da barreira (aciona a 2ª passada).
    _escreve_fixture(
        tmp_path,
        _nome_fixture((lng_o, lat_o), (lng_d, lat_d), 6),
        _resposta_ors([(lng_o, lat_o), (lng_meio, lat_meio), (lng_d, lat_d)], 200.0),
    )
    # nível 10: geometria bem longe da barreira, resolve de primeira.
    lng_o2, lat_o2 = _ponto_4326(6000.0)
    lng_d2, lat_d2 = _ponto_4326(6200.0)
    _escreve_fixture(
        tmp_path,
        _nome_fixture((lng_o, lat_o), (lng_d, lat_d), 10),
        _resposta_ors([(lng_o2, lat_o2), (lng_d2, lat_d2)], 200.0),
    )

    cliente = _ClienteSemRotaNaSegundaPassada(
        chave="",
        base_url="https://x",
        timeout_s=15.0,
        estado=EstadoCota(),
        diretorio_fixtures=tmp_path,
    )

    saida = calcular(db, entrada, cliente, datetime.now(UTC))

    assert saida.nivel_exigencia_atendido == 10
    assert saida.motor == "fixture"
    assert any(a.tipo == "exigencia_relaxada" for a in saida.avisos)


def test_segunda_passada_com_cota_abandona_o_ors_e_usa_pgrouting(db, tmp_path):
    """A 2ª passada falhando por cota (em vez de `sem_rota`) não tenta o
    próximo nível: abandona o ORS de vez, como a 1ª passada já fazia."""
    lng_o, lat_o = _ponto_4326(4000.0)
    lng_d, lat_d = _ponto_4326(4200.0)
    lng_meio, lat_meio = _ponto_4326(4100.0)

    fid_colab = _fonte_id(db, "colaborativo")
    db.execute(
        text(
            "INSERT INTO barreira_colaborativa "
            "(id, categoria, severidade, status, confirmacoes, geom, fonte_id) VALUES "
            "(:id, 'obstaculo_calcada', 'intransponivel', 'validada', 2, "
            " ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), :fonte_id)"
        ),
        {
            "id": _ID_BARREIRA_INTRANSPONIVEL + 2,
            "lng": lng_meio,
            "lat": lat_meio,
            "fonte_id": fid_colab,
        },
    )

    entrada = RotaIn(
        origem=Coordenada(lat=lat_o, lng=lng_o), destino=Coordenada(lat=lat_d, lng=lng_d)
    )
    _escreve_fixture(
        tmp_path,
        _nome_fixture((lng_o, lat_o), (lng_d, lat_d), 6),
        _resposta_ors([(lng_o, lat_o), (lng_meio, lat_meio), (lng_d, lat_d)], 200.0),
    )

    cliente = _ClienteCotaNaSegundaPassada(
        chave="",
        base_url="https://x",
        timeout_s=15.0,
        estado=EstadoCota(),
        diretorio_fixtures=tmp_path,
    )

    # esse par sintético não tem no_pedestre por perto: pgRouting também não
    # acha rota, então o desfecho esperado é RotaNaoEncontrada carregando o
    # motivo (cota_diaria) que tirou o ORS do laço de níveis.
    with pytest.raises(RotaNaoEncontrada) as exc:
        calcular(db, entrada, cliente, datetime.now(UTC))

    assert exc.value.erro_ors is not None
    assert exc.value.erro_ors.codigo == "cota_diaria"


# --- cache_rota: invalidação espacial ---------------------------------------


def test_invalidar_regiao_apaga_entrada_cujo_corredor_contem_o_ponto(db):
    linha = LineString([_ponto_4326(3000.0), _ponto_4326(3300.0)])
    regiao = corredor(linha, largura_m=50.0)
    saida_fake = RotaOut(
        passos=[],
        distancia_m=300.0,
        duracao_s=300.0,
        avisos=[],
        nivel_exigencia_atendido=6,
        motor="fixture",
        fontes=[],
        geometria=mapping(linha),
        cache=False,
    )
    agora = datetime.now(UTC)
    chave_teste = "teste-invalidar-regiao"
    cache_rota.guardar(db, chave_teste, saida_fake, regiao=regiao, agora=agora)
    assert cache_rota.obter(db, chave_teste, agora) is not None

    ponto_dentro_do_corredor = Point(*_ponto_4326(3150.0))
    cache_rota.invalidar_regiao(db, ponto_dentro_do_corredor)

    assert cache_rota.obter(db, chave_teste, agora) is None


# --- casos de referência -----------------------------------------------------

_CAMINHO_CASOS_REFERENCIA = Path(__file__).resolve().parent.parent / "casos_referencia.json"
_CASOS_REFERENCIA = json.loads(_CAMINHO_CASOS_REFERENCIA.read_text(encoding="utf-8"))


@pytest.mark.parametrize("caso", _CASOS_REFERENCIA, ids=[c["nome"] for c in _CASOS_REFERENCIA])
def test_casos_referencia_cumprem_espera_com_pgrouting_real(db, caso):
    origem = Coordenada(**caso["origem"])
    destino = Coordenada(**caso["destino"])

    rota = rota_pgrouting(db, origem, destino)

    assert rota is not None, f"{caso['nome']}: pgRouting não achou caminho acessível"
    assert 300.0 <= rota.distancia_m <= caso["espera"]["distancia_max_m"]

    if caso["espera"]["sem_degraus"]:
        tem_degrau = db.execute(
            text("SELECT bool_or(is_degrau) FROM via_pedestre WHERE id = ANY(:ids)"),
            {"ids": rota.arestas},
        ).scalar_one()
        assert tem_degrau is not True, f"{caso['nome']}: rota atravessa um degrau"


@pytest.mark.parametrize("caso", _CASOS_REFERENCIA, ids=[c["nome"] for c in _CASOS_REFERENCIA])
def test_casos_referencia_calculam_rota_com_fixtures_do_ors(db, caso):
    entrada = RotaIn(origem=Coordenada(**caso["origem"]), destino=Coordenada(**caso["destino"]))
    # sem diretorio_fixtures: usa o diretório real (app/fixtures/ors/generica.json
    # traduzida), o mesmo que USE_FIXTURES=true usa em produção/demonstração.
    cliente = OrsFixtureClient(chave="", base_url="https://x", timeout_s=15.0, estado=EstadoCota())

    saida = calcular(db, entrada, cliente, datetime.now(UTC))

    assert isinstance(saida, RotaOut)
    assert saida.motor == "fixture"
    assert saida.passos
    assert saida.distancia_m > 0.0


def test_regressao_poi_wheelchair_no_severidade_informativo_nao_bloqueia_rota(db):
    """Regressão do spec (seção 6): severidade `informativo` (POI OSM
    `wheelchair=no`, piso irregular etc.) nunca vira `avoid_polygons` nem
    aviso de barreira, mesmo validada e com confirmações — só `intransponivel`
    (2 confirmações) bloqueia. Cobre os dois níveis: `barreiras_no_corredor`
    (Tarefa 3) já filtra `informativo` fora, e `calcular` de ponta a ponta
    continua encontrando a rota."""
    rota_referencia = rota_pgrouting(db, _ORIGEM_REAL, _DESTINO_REAL)
    assert rota_referencia is not None

    ponto_medio = rota_referencia.geometria.interpolate(0.5, normalized=True)
    x_medio, y_medio = PROJ_4326_31983.transform(ponto_medio.x, ponto_medio.y)
    lng_poi, lat_poi = PROJ_31983_4326.transform(x_medio + 5.0, y_medio)  # 5 m ao lado da rota

    fid_colab = _fonte_id(db, "colaborativo")
    db.execute(
        text(
            "INSERT INTO barreira_colaborativa "
            "(id, categoria, severidade, status, confirmacoes, geom, fonte_id) VALUES "
            "(:id, 'poi_inacessivel', 'informativo', 'validada', 5, "
            " ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), :fonte_id)"
        ),
        {"id": _ID_POI_INFORMATIVO, "lng": lng_poi, "lat": lat_poi, "fonte_id": fid_colab},
    )

    corredor_referencia = corredor(rota_referencia.geometria, largura_m=50.0)
    candidatas = barreiras_no_corredor(db, corredor_referencia)
    assert _ID_POI_INFORMATIVO not in {c.id for c in candidatas}

    cliente = _ClienteSempreErro("sem_rota")  # força o fallback pgRouting
    entrada = RotaIn(origem=_ORIGEM_REAL, destino=_DESTINO_REAL)

    saida = calcular(db, entrada, cliente, datetime.now(UTC))

    assert saida.motor == "pgrouting"
    assert saida.distancia_m == pytest.approx(rota_referencia.distancia_m, rel=0.01)
    assert not any(
        a.tipo == "barreira_dificulta" and "poi_inacessivel" in a.mensagem for a in saida.avisos
    )

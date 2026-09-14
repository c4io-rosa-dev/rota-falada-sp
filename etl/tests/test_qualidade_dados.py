"""Testes de qualidade de dados: rodam depois do ETL e falham o build se os
dados carregados violarem as garantias do projeto (licenças, proveniência,
regras de acessibilidade). Cada task do Plano 2 acrescenta sua parte aqui.
"""

import zipfile

import pytest
from sqlalchemy import create_engine, text

from etl.config import DATABASE_URL, DIR_DADOS

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def engine():
    return create_engine(DATABASE_URL)


# --- OSM: no_pedestre / via_pedestre (Task 3) ---------------------------------


def test_via_pedestre_populada(engine):
    with engine.connect() as conexao:
        total = conexao.execute(text("SELECT count(*) FROM via_pedestre")).scalar_one()
    assert total >= 5000


def test_nos_referenciados_existem(engine):
    consulta = """
        SELECT count(*) FROM via_pedestre v
        WHERE NOT EXISTS (SELECT 1 FROM no_pedestre n WHERE n.id = v.source)
           OR NOT EXISTS (SELECT 1 FROM no_pedestre n WHERE n.id = v.target)
    """
    with engine.connect() as conexao:
        sem_no = conexao.execute(text(consulta)).scalar_one()
    assert sem_no == 0


def test_coordenadas_dentro_da_area_piloto(engine):
    consulta_vias = """
        SELECT count(*) FROM via_pedestre v
        WHERE NOT EXISTS (SELECT 1 FROM area_piloto a WHERE ST_Intersects(v.geom, a.geom))
    """
    consulta_nos = """
        SELECT count(*) FROM no_pedestre n
        WHERE NOT EXISTS (SELECT 1 FROM area_piloto a WHERE ST_Within(n.geom, a.geom))
    """
    with engine.connect() as conexao:
        fora_vias = conexao.execute(text(consulta_vias)).scalar_one()
        fora_nos = conexao.execute(text(consulta_nos)).scalar_one()
    assert fora_vias == 0
    assert fora_nos == 0


def test_kerb_yes_nunca_vira_acessivel(engine):
    consulta = """
        SELECT count(*) FROM via_pedestre WHERE kerb = 'yes' AND kerb_transponivel IS NOT NULL
    """
    with engine.connect() as conexao:
        total = conexao.execute(text(consulta)).scalar_one()
    assert total == 0


def test_degraus_bloqueiam(engine):
    consulta = """
        SELECT count(*) FROM via_pedestre
        WHERE highway = 'steps' AND (NOT is_degrau OR custo_acessivel < 1000000)
    """
    with engine.connect() as conexao:
        invalidas = conexao.execute(text(consulta)).scalar_one()
    assert invalidas == 0


def test_ha_degraus_e_guias_no_piloto(engine):
    with engine.connect() as conexao:
        degraus = conexao.execute(
            text("SELECT count(*) FROM via_pedestre WHERE highway = 'steps'")
        ).scalar_one()
        guias = conexao.execute(
            text("SELECT count(*) FROM no_pedestre WHERE kerb IS NOT NULL")
        ).scalar_one()
    assert degraus >= 50
    assert guias >= 50


def test_proveniencia_completa_osm(engine):
    with engine.connect() as conexao:
        sem_fonte_via = conexao.execute(
            text(
                "SELECT count(*) FROM via_pedestre WHERE fonte_id IS NULL OR data_referencia IS NULL"
            )
        ).scalar_one()
        sem_fonte_no = conexao.execute(
            text(
                "SELECT count(*) FROM no_pedestre WHERE fonte_id IS NULL OR data_referencia IS NULL"
            )
        ).scalar_one()
    assert sem_fonte_via == 0
    assert sem_fonte_no == 0


# --- GeoSampa: calcada_sp (Task 4) --------------------------------------------


def test_calcada_populada(engine):
    with engine.connect() as conexao:
        total = conexao.execute(text("SELECT count(*) FROM calcada_sp")).scalar_one()
    assert total >= 5000


def test_wfs_nao_truncou(engine):
    """A última execução `ok` do GeoSampa carregou exatamente o que o WFS
    reportou via `numberMatched` (nenhuma página truncada em silêncio)."""
    consulta = """
        SELECT linhas, esperado FROM etl_execucao
        WHERE fonte = 'geosampa' AND status = 'ok'
        ORDER BY fim DESC LIMIT 1
    """
    with engine.connect() as conexao:
        linhas, esperado = conexao.execute(text(consulta)).one()
    assert linhas == esperado


def test_calcada_sem_zeros_mascarados(engine):
    consulta_mascarados = """
        SELECT count(*) FROM calcada_sp WHERE largura_min_m = 0 AND largura_medida
    """
    consulta_nao_medida = "SELECT count(*) FROM calcada_sp WHERE NOT largura_medida"
    with engine.connect() as conexao:
        mascarados = conexao.execute(text(consulta_mascarados)).scalar_one()
        alguma_nao_medida = conexao.execute(text(consulta_nao_medida)).scalar_one()
    assert mascarados == 0
    assert alguma_nao_medida > 0


def test_calcada_dentro_da_area_piloto(engine):
    consulta = """
        SELECT count(*) FROM calcada_sp c
        WHERE NOT EXISTS (SELECT 1 FROM area_piloto a WHERE ST_Intersects(c.geom, a.geom))
    """
    with engine.connect() as conexao:
        fora = conexao.execute(text(consulta)).scalar_one()
    assert fora == 0


def test_proveniencia_completa_calcada(engine):
    consulta = """
        SELECT count(*) FROM calcada_sp WHERE fonte_id IS NULL OR data_referencia IS NULL
    """
    with engine.connect() as conexao:
        sem_fonte = conexao.execute(text(consulta)).scalar_one()
    assert sem_fonte == 0


# --- SP156: barreira_oficial (Task 5) -----------------------------------------


def test_barreira_oficial_populada(engine):
    with engine.connect() as conexao:
        total = conexao.execute(
            text("SELECT count(*) FROM barreira_oficial")
        ).scalar_one()
    assert total >= 100


def test_barreira_categoria_valida(engine):
    from etl.sp156 import CATEGORIAS

    with engine.connect() as conexao:
        categorias = (
            conexao.execute(text("SELECT DISTINCT categoria FROM barreira_oficial"))
            .scalars()
            .all()
        )
    assert categorias  # a tabela não pode estar vazia
    assert set(categorias) <= set(CATEGORIAS.values())


def test_barreira_dentro_da_area_piloto(engine):
    consulta = """
        SELECT count(*) FROM barreira_oficial b
        WHERE NOT EXISTS (SELECT 1 FROM area_piloto a WHERE ST_Within(b.geom, a.geom))
    """
    with engine.connect() as conexao:
        fora = conexao.execute(text(consulta)).scalar_one()
    assert fora == 0


def test_barreira_datas_coerentes(engine):
    consulta = """
        SELECT count(*) FROM barreira_oficial
        WHERE data_abertura IS NOT NULL AND data_finalizacao IS NOT NULL
          AND data_finalizacao < data_abertura
    """
    with engine.connect() as conexao:
        invalidas = conexao.execute(text(consulta)).scalar_one()
    assert invalidas == 0


def test_proveniencia_completa_barreira(engine):
    consulta = """
        SELECT count(*) FROM barreira_oficial WHERE fonte_id IS NULL OR data_referencia IS NULL
    """
    with engine.connect() as conexao:
        sem_fonte = conexao.execute(text(consulta)).scalar_one()
    assert sem_fonte == 0


# --- GTFS: parada / linha (Task 6) --------------------------------------------


def test_parada_populada(engine):
    with engine.connect() as conexao:
        total = conexao.execute(text("SELECT count(*) FROM parada")).scalar_one()
    assert total >= 200


def test_parada_dentro_da_area_piloto(engine):
    consulta = """
        SELECT count(*) FROM parada p
        WHERE NOT EXISTS (SELECT 1 FROM area_piloto a WHERE ST_Within(p.geom, a.geom))
    """
    with engine.connect() as conexao:
        fora = conexao.execute(text(consulta)).scalar_one()
    assert fora == 0


def test_linha_populada(engine):
    with engine.connect() as conexao:
        total = conexao.execute(text("SELECT count(*) FROM linha")).scalar_one()
    assert total >= 1000


# --- Conflação: conflacao_via_calcada (Plano 3, Task 4) -----------------------


def test_conflacao_cobertura_minima(engine):
    """Gate do spec: pelo menos 30% das arestas do grafo de pedestres (OSM)
    precisam estar ligadas a uma calçada do GeoSampa em `conflacao_via_calcada`.
    Se a cobertura real cair abaixo disso, este teste **falha** — não afrouxa
    o limiar — porque a saída é uma decisão humana: assumir a camada
    colaborativa (OSM) como fonte principal e tratar os polígonos do
    GeoSampa como barreiras (não como fonte de largura/atributo), ver
    `docs/superpowers/specs/2026-09-08-rotas-acessiveis-sp-design.md`."""
    with engine.connect() as conexao:
        arestas = conexao.execute(
            text("SELECT count(*) FROM via_pedestre")
        ).scalar_one()
        ligadas = conexao.execute(
            text("SELECT count(*) FROM conflacao_via_calcada")
        ).scalar_one()
    cobertura = ligadas / arestas if arestas else 0.0
    assert cobertura >= 0.30, (
        f"cobertura real da conflação = {cobertura:.1%} ({ligadas}/{arestas} arestas), "
        "abaixo do gate de 30% do spec. Decisão humana necessária (o teste não decide "
        "sozinho): assumir o OSM (camada colaborativa) como fonte principal de topologia "
        "e tratar os polígonos do GeoSampa como barreiras, não como fonte de largura/"
        "declividade por aresta."
    )


def test_conflacao_sem_geometria_nem_atributos(engine):
    """Guarda permanente (redundante de propósito com
    `backend/tests/test_migracao_conflacao.py` da Task 1): mesmo que a
    migration mude, `conflacao_via_calcada` nunca pode ganhar coluna de
    geometria nem atributo copiado de largura/declividade — ela resolve
    ODbL (OSM) x CC-BY-SA (GeoSampa) só por chave e distância, nunca
    misturando os dados das duas licenças numa única linha."""
    consulta = """
        SELECT column_name, udt_name FROM information_schema.columns
        WHERE table_name = 'conflacao_via_calcada'
    """
    with engine.connect() as conexao:
        colunas = conexao.execute(text(consulta)).all()
    nomes = {linha[0] for linha in colunas}
    tipos = {linha[1] for linha in colunas}
    assert "geometry" not in tipos
    assert not any("largura" in nome or "declividade" in nome for nome in nomes)


def test_conflacao_confianca_coerente(engine):
    consulta_contido = """
        SELECT count(*) FROM conflacao_via_calcada
        WHERE metodo = 'contido' AND (confianca <> 1 OR distancia_m <> 0)
    """
    consulta_demais = """
        SELECT count(*) FROM conflacao_via_calcada
        WHERE metodo <> 'contido' AND distancia_m > buffer_m
    """
    with engine.connect() as conexao:
        contido_incoerente = conexao.execute(text(consulta_contido)).scalar_one()
        demais_incoerente = conexao.execute(text(consulta_demais)).scalar_one()
    assert contido_incoerente == 0
    assert demais_incoerente == 0


def test_conflacao_uma_calcada_por_aresta(engine):
    consulta = "SELECT count(*), count(DISTINCT via_id) FROM conflacao_via_calcada"
    with engine.connect() as conexao:
        total, distintos = conexao.execute(text(consulta)).one()
    assert total == distintos


def test_gtfs_sem_campos_de_acessibilidade():
    """Canário sobre o zip cacheado (não sobre o banco): se o feed da SPTrans
    um dia passar a trazer `wheelchair_boarding`/`wheelchair_accessible` ou os
    arquivos `pathways.txt`/`levels.txt`/`calendar_dates.txt`, o escopo do
    projeto precisa ser revisto (ver `etl/README.md`)."""
    caminho_zip = DIR_DADOS / "gtfs-sptrans.zip"
    if not caminho_zip.exists():
        pytest.skip("gtfs-sptrans.zip não está em cache; rode 'python -m etl.cli gtfs'")
    with zipfile.ZipFile(caminho_zip) as zf:
        nomes = set(zf.namelist())
        assert not ({"pathways.txt", "levels.txt", "calendar_dates.txt"} & nomes)
        with zf.open("stops.txt") as arquivo:
            cabecalho_stops = arquivo.readline().decode("utf-8-sig")
        with zf.open("routes.txt") as arquivo:
            cabecalho_routes = arquivo.readline().decode("utf-8-sig")
    assert "wheelchair_boarding" not in cabecalho_stops
    assert "wheelchair_accessible" not in cabecalho_routes

"""Testes de qualidade de dados: rodam depois do ETL e falham o build se os
dados carregados violarem as garantias do projeto (licenças, proveniência,
regras de acessibilidade). Cada task do Plano 2 acrescenta sua parte aqui.
"""

import pytest
from etl.config import DATABASE_URL
from sqlalchemy import create_engine, text

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

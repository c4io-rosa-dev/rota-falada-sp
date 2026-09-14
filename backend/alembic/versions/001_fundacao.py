"""extensões espaciais e catálogo fonte_dados

Revision ID: 001_fundacao
Revises:
Create Date: 2026-09-13
"""

from datetime import date

import sqlalchemy as sa

from alembic import op

revision = "001_fundacao"
down_revision = None
branch_labels = None
depends_on = None

FONTES = [
    {
        "chave": "osm",
        "nome": "OpenStreetMap",
        "licenca": "ODbL 1.0",
        "url": "https://www.openstreetmap.org/copyright",
        "atribuicao": "Dados do mapa © colaboradores do OpenStreetMap (ODbL)",
        "data_referencia": None,
        "data_extracao": None,
    },
    {
        "chave": "geosampa",
        "nome": "GeoSampa / Prefeitura de São Paulo",
        "licenca": "CC-BY-SA 4.0",
        "url": "https://geosampa.prefeitura.sp.gov.br",
        "atribuicao": "Calçadas: GeoSampa/PMSP (CC-BY-SA 4.0), diagnóstico de 2021",
        "data_referencia": date(2021, 8, 13),
        "data_extracao": None,
    },
    {
        "chave": "sp156",
        "nome": "SP156 / SMIT",
        "licenca": "CC0 1.0",
        "url": "https://dados.prefeitura.sp.gov.br/dataset/dados-do-sp156",
        "atribuicao": "Solicitações: SP156/SMIT (CC0)",
        "data_referencia": None,
        "data_extracao": None,
    },
    {
        "chave": "sptrans",
        "nome": "SPTrans — API Olho Vivo e GTFS",
        "licenca": "não declarada",
        "url": "https://www.sptrans.com.br/desenvolvedores/",
        "atribuicao": "Ônibus: SPTrans / API Olho Vivo",
        "data_referencia": None,
        "data_extracao": None,
    },
    {
        "chave": "ors",
        "nome": "openrouteservice (HeiGIT)",
        "licenca": "CC-BY 4.0",
        "url": "https://openrouteservice.org",
        "atribuicao": "© openrouteservice.org by HeiGIT",
        "data_referencia": None,
        "data_extracao": None,
    },
    {
        "chave": "colaborativo",
        "nome": "Contribuições dos usuários do Rota Falada SP",
        "licenca": "ODbL 1.0",
        "url": "/fontes",
        "atribuicao": "Barreiras cadastradas por usuários do Rota Falada SP (ODbL)",
        "data_referencia": None,
        "data_extracao": None,
    },
]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.execute("CREATE EXTENSION IF NOT EXISTS pgrouting")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    tabela = op.create_table(
        "fonte_dados",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("chave", sa.String(40), nullable=False, unique=True),
        sa.Column("nome", sa.String(120), nullable=False),
        sa.Column("licenca", sa.String(60), nullable=False),
        sa.Column("url", sa.Text, nullable=False),
        sa.Column("atribuicao", sa.Text, nullable=False),
        sa.Column("data_referencia", sa.Date, nullable=True),
        sa.Column("data_extracao", sa.Date, nullable=True),
    )
    op.bulk_insert(tabela, FONTES)


def downgrade() -> None:
    op.drop_table("fonte_dados")

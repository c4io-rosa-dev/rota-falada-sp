"""row level security em todas as tabelas (bloqueia a Data API do Supabase)

O acesso aos dados é exclusivamente pelo backend FastAPI, que conecta com o
papel dono do banco e por isso ignora RLS. Com RLS ligado e nenhuma política,
a API REST/GraphQL do Supabase (papéis anon e authenticated) não lê nem grava
nada — em especial não consegue inserir em barreira_colaborativa por fora da
moderação do backend. Em PostgreSQL puro (Docker local) o comando é inócuo.

Revision ID: 005_rls
Revises: 004_roteamento
Create Date: 2026-09-14
"""

from alembic import op

revision = "005_rls"
down_revision = "004_roteamento"
branch_labels = None
depends_on = None

TABELAS = [
    "alembic_version",
    "area_piloto",
    "etl_execucao",
    "fonte_dados",
    "no_pedestre",
    "via_pedestre",
    "calcada_sp",
    "barreira_oficial",
    "parada",
    "linha",
    "conflacao_via_calcada",
    "barreira_colaborativa",
    "rota_cache",
]


def upgrade() -> None:
    for tabela in TABELAS:
        op.execute(f"ALTER TABLE {tabela} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    for tabela in TABELAS:
        op.execute(f"ALTER TABLE {tabela} DISABLE ROW LEVEL SECURITY")

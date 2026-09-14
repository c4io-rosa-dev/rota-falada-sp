"""barreira_colaborativa (mínima) e rota_cache para o roteamento acessível

Revision ID: 004_roteamento
Revises: 003_conflacao
Create Date: 2026-09-14
"""

from alembic import op

revision = "004_roteamento"
down_revision = "003_conflacao"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        -- versão mínima; o Plano 6 acrescenta usuário, foto, eventos
        CREATE TABLE barreira_colaborativa (
          id bigserial PRIMARY KEY,
          categoria text NOT NULL,
          severidade text NOT NULL
            CHECK (severidade IN ('intransponivel','dificulta','informativo')),
          descricao text,
          status text NOT NULL DEFAULT 'pendente'
            CHECK (status IN ('pendente','validada','contestada','resolvida','expirada')),
          confirmacoes integer NOT NULL DEFAULT 0,
          geom geometry(Point, 4326) NOT NULL,
          fonte_id integer NOT NULL REFERENCES fonte_dados(id),
          data_referencia date NOT NULL DEFAULT CURRENT_DATE,
          criado_em timestamptz NOT NULL DEFAULT now(),
          atualizado_em timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX barreira_colaborativa_geom_idx ON barreira_colaborativa USING GIST (geom);
        """
    )

    op.execute(
        """
        CREATE TABLE rota_cache (
          chave text PRIMARY KEY,
          resposta jsonb NOT NULL,
          regiao geometry(Polygon, 4326) NOT NULL,
          motor text NOT NULL,
          criado_em timestamptz NOT NULL DEFAULT now(),
          expira_em timestamptz NOT NULL
        );
        CREATE INDEX rota_cache_regiao_idx ON rota_cache USING GIST (regiao);
        CREATE INDEX rota_cache_expira_idx ON rota_cache (expira_em);
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE rota_cache")
    op.execute("DROP TABLE barreira_colaborativa")

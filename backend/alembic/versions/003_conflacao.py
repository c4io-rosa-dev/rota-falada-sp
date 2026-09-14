"""tabela de conflação via_pedestre x calcada_sp e índices métricos em 31983

Revision ID: 003_conflacao
Revises: 002_fontes_oficiais
Create Date: 2026-09-14
"""

from alembic import op

revision = "003_conflacao"
down_revision = "002_fontes_oficiais"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE conflacao_via_calcada (
          via_id bigint NOT NULL REFERENCES via_pedestre(id) ON DELETE CASCADE,
          calcada_id bigint NOT NULL REFERENCES calcada_sp(id) ON DELETE CASCADE,
          distancia_m numeric NOT NULL CHECK (distancia_m >= 0),
          confianca numeric NOT NULL CHECK (confianca >= 0 AND confianca <= 1),
          metodo text NOT NULL CHECK (metodo IN ('contido','mais_proximo','mesmo_lado')),
          buffer_m numeric NOT NULL,
          criado_em timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (via_id)
        );
        CREATE INDEX conflacao_calcada_idx ON conflacao_via_calcada (calcada_id);
        """
    )

    # índices métricos funcionais para a conflação e para o Plano 4
    op.execute(
        "CREATE INDEX via_pedestre_geom_31983_idx ON via_pedestre "
        "USING GIST (ST_Transform(geom, 31983))"
    )
    op.execute(
        "CREATE INDEX calcada_sp_geom_31983_idx ON calcada_sp "
        "USING GIST (ST_Transform(geom, 31983))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX calcada_sp_geom_31983_idx")
    op.execute("DROP INDEX via_pedestre_geom_31983_idx")
    op.execute("DROP TABLE conflacao_via_calcada")

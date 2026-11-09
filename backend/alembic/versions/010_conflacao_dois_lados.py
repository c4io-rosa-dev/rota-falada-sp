"""conflacao_via_calcada: uma via pode ligar às calçadas dos dois lados

Empate entre os dois lados da rua deixava a via sem dado nenhum. Agora ela liga
às duas (`metodo = 'dois_lados'`) e a API mostra o pior valor. A tabela continua
só com chaves e distância.

Limpa `rota_cache`: as rotas gravadas têm a declividade e os avisos da regra
antiga. Depois desta migration, rode o ETL (`conflacao` basta para esta mudança).

Revision ID: 010_conflacao_dois_lados
Revises: 009_area_centro_expandido
Create Date: 2026-11-07
"""

from alembic import op

revision = "010_conflacao_dois_lados"
down_revision = "009_area_centro_expandido"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE conflacao_via_calcada DROP CONSTRAINT conflacao_via_calcada_pkey;
        ALTER TABLE conflacao_via_calcada ADD PRIMARY KEY (via_id, calcada_id);
        ALTER TABLE conflacao_via_calcada DROP CONSTRAINT conflacao_via_calcada_metodo_check;
        ALTER TABLE conflacao_via_calcada ADD CONSTRAINT conflacao_via_calcada_metodo_check
            CHECK (metodo IN ('contido', 'mais_proximo', 'mesmo_lado', 'dois_lados'));
        DELETE FROM rota_cache;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM conflacao_via_calcada WHERE metodo = 'dois_lados';
        ALTER TABLE conflacao_via_calcada DROP CONSTRAINT conflacao_via_calcada_metodo_check;
        ALTER TABLE conflacao_via_calcada ADD CONSTRAINT conflacao_via_calcada_metodo_check
            CHECK (metodo IN ('contido', 'mais_proximo', 'mesmo_lado'));
        ALTER TABLE conflacao_via_calcada DROP CONSTRAINT conflacao_via_calcada_pkey;
        ALTER TABLE conflacao_via_calcada ADD PRIMARY KEY (via_id);
        DELETE FROM rota_cache;
        """
    )

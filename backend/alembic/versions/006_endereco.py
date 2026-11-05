"""endereco: geocode local (ruas, endereços numerados e lugares do OSM)

Spec: docs/superpowers/specs/2026-11-02-geocode-design.md, seção 3.1.
Só dados do OpenStreetMap (ODbL). RLS ligado na criação, como as demais
tabelas desde a 005 (só o backend, dono do banco, acessa).

Revision ID: 006_endereco
Revises: 005_rls
Create Date: 2026-11-02
"""

from alembic import op

revision = "006_endereco"
down_revision = "005_rls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE endereco (
          id bigserial PRIMARY KEY,
          tipo text NOT NULL CHECK (tipo IN ('logradouro','endereco','lugar')),
          rotulo text NOT NULL CHECK (length(btrim(rotulo)) > 0),
          logradouro text,
          numero text,
          numero_int integer,
          categoria text,
          texto_busca text NOT NULL CHECK (length(texto_busca) > 0),
          geom geometry(Point, 4326) NOT NULL,
          osm_tipo char(1) CHECK (osm_tipo IN ('n','w','r')),
          osm_id bigint,
          fonte_id integer NOT NULL REFERENCES fonte_dados(id),
          data_referencia date NOT NULL
        );
        CREATE INDEX endereco_texto_busca_trgm_idx
          ON endereco USING GIN (texto_busca gin_trgm_ops);
        CREATE INDEX endereco_geom_idx ON endereco USING GIST (geom);
        CREATE INDEX endereco_logradouro_numero_idx ON endereco (logradouro, numero_int);
        ALTER TABLE endereco ENABLE ROW LEVEL SECURITY;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE endereco")

"""tabelas das fontes oficiais (OSM, GeoSampa, SP156, GTFS) e execuções do ETL

Revision ID: 002_fontes_oficiais
Revises: 001_fundacao
Create Date: 2026-09-13
"""

from alembic import op

revision = "002_fontes_oficiais"
down_revision = "001_fundacao"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE area_piloto (
          id serial PRIMARY KEY,
          nome text NOT NULL UNIQUE,
          geom geometry(Polygon, 4326) NOT NULL
        );
        INSERT INTO area_piloto (nome, geom) VALUES
          ('Vila Mariana', ST_MakeEnvelope(-46.660,-23.610,-46.615,-23.570, 4326)),
          ('Lapa',         ST_MakeEnvelope(-46.720,-23.545,-46.680,-23.510, 4326)),
          ('Ipiranga',     ST_MakeEnvelope(-46.625,-23.605,-46.590,-23.575, 4326));
        """
    )

    op.execute(
        """
        CREATE TABLE etl_execucao (
          id serial PRIMARY KEY,
          fonte text NOT NULL,
          inicio timestamptz NOT NULL,
          fim timestamptz,
          status text NOT NULL CHECK (status IN ('executando','ok','erro')),
          linhas integer,
          esperado integer,
          detalhe text
        );
        """
    )

    op.execute(
        """
        CREATE TABLE no_pedestre (
          id bigint PRIMARY KEY,                -- osmid
          kerb text, tactile_paving text, crossing text, wheelchair text, barrier text,
          geom geometry(Point, 4326) NOT NULL,
          fonte_id integer NOT NULL REFERENCES fonte_dados(id),
          data_referencia date NOT NULL
        );
        CREATE INDEX no_pedestre_geom_idx ON no_pedestre USING GIST (geom);
        """
    )

    op.execute(
        """
        CREATE TABLE via_pedestre (
          id bigserial PRIMARY KEY,
          osmid bigint NOT NULL,
          source bigint NOT NULL REFERENCES no_pedestre(id),
          target bigint NOT NULL REFERENCES no_pedestre(id),
          highway text NOT NULL,
          footway text, sidewalk text,
          esquema_calcada text NOT NULL
            CHECK (esquema_calcada IN ('geometria_propria','atributo_via','via_generica')),
          is_degrau boolean NOT NULL DEFAULT false,
          kerb text,
          kerb_transponivel boolean,            -- NULL = desconhecido (inclui kerb=yes)
          wheelchair text, surface text, smoothness text, incline text,
          width_m numeric,
          nome text,
          comprimento_m numeric NOT NULL,
          custo_acessivel numeric NOT NULL,
          custo_reverso numeric NOT NULL,
          geom geometry(LineString, 4326) NOT NULL,
          fonte_id integer NOT NULL REFERENCES fonte_dados(id),
          data_referencia date NOT NULL
        );
        CREATE INDEX via_pedestre_geom_idx ON via_pedestre USING GIST (geom);
        CREATE INDEX via_pedestre_source_idx ON via_pedestre (source);
        CREATE INDEX via_pedestre_target_idx ON via_pedestre (target);
        """
    )

    op.execute(
        """
        CREATE TABLE calcada_sp (
          id bigserial PRIMARY KEY,
          cd_identificador_calcada text,
          cd_setor_quadra text,
          nm_logradouro text,
          qt_area_m2 numeric,
          largura_min_m numeric NOT NULL DEFAULT 0,
          largura_max_m numeric NOT NULL DEFAULT 0,
          largura_media_m numeric NOT NULL DEFAULT 0,
          declividade_min_pct numeric NOT NULL DEFAULT 0,
          declividade_max_pct numeric NOT NULL DEFAULT 0,
          declividade_media_pct numeric NOT NULL DEFAULT 0,
          tx_situacao text,
          tx_plano_emergencial text,
          largura_medida boolean GENERATED ALWAYS AS (largura_min_m > 0) STORED,
          declividade_medida boolean GENERATED ALWAYS AS (declividade_max_pct > 0) STORED,
          geom geometry(MultiPolygon, 4326) NOT NULL,
          fonte_id integer NOT NULL REFERENCES fonte_dados(id),
          data_referencia date NOT NULL DEFAULT DATE '2021-08-13'
        );
        CREATE INDEX calcada_sp_geom_idx ON calcada_sp USING GIST (geom);
        """
    )

    op.execute(
        """
        CREATE TABLE barreira_oficial (
          id bigserial PRIMARY KEY,
          categoria text NOT NULL,              -- ver mapeamento na Task 5
          servico text NOT NULL,                -- texto original do SP156 (traço normalizado)
          status text,
          data_abertura date,
          data_finalizacao date,
          distrito text,
          geom geometry(Point, 4326) NOT NULL,
          fonte_id integer NOT NULL REFERENCES fonte_dados(id),
          data_referencia date NOT NULL
        );
        CREATE INDEX barreira_oficial_geom_idx ON barreira_oficial USING GIST (geom);
        """
    )

    op.execute(
        """
        CREATE TABLE parada (
          id bigserial PRIMARY KEY,
          stop_id text NOT NULL UNIQUE,
          nome text NOT NULL,
          geom geometry(Point, 4326) NOT NULL,
          fonte_id integer NOT NULL REFERENCES fonte_dados(id),
          data_referencia date NOT NULL
        );
        CREATE INDEX parada_geom_idx ON parada USING GIST (geom);
        """
    )

    op.execute(
        """
        CREATE TABLE linha (
          id bigserial PRIMARY KEY,
          route_id text NOT NULL UNIQUE,
          nome_curto text NOT NULL,
          nome_longo text,
          fonte_id integer NOT NULL REFERENCES fonte_dados(id),
          data_referencia date NOT NULL
        );
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE linha")
    op.execute("DROP TABLE parada")
    op.execute("DROP TABLE barreira_oficial")
    op.execute("DROP TABLE calcada_sp")
    op.execute("DROP TABLE via_pedestre")
    op.execute("DROP TABLE no_pedestre")
    op.execute("DROP TABLE etl_execucao")
    op.execute("DROP TABLE area_piloto")

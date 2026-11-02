"""area_piloto: estende o Ipiranga para o sul até -23.615 para incluir a FATEC

A FATEC Ipiranga (Rua Frei João, 59; way OSM 737408597, lat ~-23.609) ficava
~450 m ao sul do retângulo original (-23.605), fora da busca e do roteamento.
`etl/etl/config.py::AREA_PILOTO` muda junto; o teste
`backend/tests/test_migracao_area_piloto.py` falha se os dois divergirem.
Depois desta migration, rode o ETL completo (`tudo`) para recarregar os dados.

Revision ID: 007_area_ipiranga_fatec
Revises: 006_endereco
Create Date: 2026-11-02
"""

from alembic import op

revision = "007_area_ipiranga_fatec"
down_revision = "006_endereco"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE area_piloto "
        "SET geom = ST_MakeEnvelope(-46.625, -23.615, -46.590, -23.575, 4326) "
        "WHERE nome = 'Ipiranga'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE area_piloto "
        "SET geom = ST_MakeEnvelope(-46.625, -23.605, -46.590, -23.575, 4326) "
        "WHERE nome = 'Ipiranga'"
    )

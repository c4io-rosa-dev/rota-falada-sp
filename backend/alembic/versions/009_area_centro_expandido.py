"""area_piloto: amplia para centro expandido + Lapa + Ipiranga/FATEC

Soma quatro retângulos aos três existentes, que não mudam e continuam nos
menores ids (os rótulos de endereço usam a área de menor id). A união fica
contínua, com cerca de 149 km². Os retângulos se sobrepõem em vez de só se
tocarem: um ponto numa costura ficaria fora dos dois para `ST_Within`.
`etl/etl/config.py::AREA_PILOTO` muda junto; o teste
`backend/tests/test_migracao_area_piloto.py` falha se os dois divergirem.

Depois desta migration, rode o ETL completo (`tudo`) para carregar os dados.
Sem isso, as áreas novas existem mas ficam vazias: o geocode reverso responde
"nenhum endereço" e a rota não acha nó. O downgrade só remove os retângulos; os
dados fora dos três recortes antigos saem na próxima carga do ETL.

Revision ID: 009_area_centro_expandido
Revises: 008_colaborativo
Create Date: 2026-11-05
"""

from alembic import op

revision = "009_area_centro_expandido"
down_revision = "008_colaborativo"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO area_piloto (nome, geom) VALUES
          ('Centro',    ST_MakeEnvelope(-46.685, -23.575, -46.615, -23.515, 4326)),
          ('Pinheiros', ST_MakeEnvelope(-46.705, -23.610, -46.655, -23.540, 4326)),
          ('Mooca',     ST_MakeEnvelope(-46.620, -23.580, -46.575, -23.520, 4326)),
          ('Saúde',     ST_MakeEnvelope(-46.665, -23.625, -46.620, -23.605, 4326))
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM area_piloto WHERE nome IN ('Centro', 'Pinheiros', 'Mooca', 'Saúde')")

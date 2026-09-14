"""Configuração do ETL: área piloto, URLs das fontes e caminhos.

Nenhum script deste pacote lê o `.env` da raiz do repositório; a URL do banco
vem sempre da variável de ambiente `DATABASE_URL` (definida no docker-compose
e no workflow do GitHub Actions).
"""

import os
from pathlib import Path

# oeste, sul, leste, norte (lon/lat, EPSG:4326)
AREA_PILOTO: dict[str, tuple[float, float, float, float]] = {
    "Vila Mariana": (-46.660, -23.610, -46.615, -23.570),
    "Lapa": (-46.720, -23.545, -46.680, -23.510),
    "Ipiranga": (-46.625, -23.605, -46.590, -23.575),
}

# bbox que envolve os três recortes, usada no `osmium extract`.
BBOX_UNIAO: tuple[float, float, float, float] = (
    min(bbox[0] for bbox in AREA_PILOTO.values()),
    min(bbox[1] for bbox in AREA_PILOTO.values()),
    max(bbox[2] for bbox in AREA_PILOTO.values()),
    max(bbox[3] for bbox in AREA_PILOTO.values()),
)

# calibrados em docs/pesquisa/2026-09-14-calibracao-conflacao.md (Plano 3, Task 3):
# com o gabarito atual (só `automatico_contido`; `manual_streetview` é pendência
# humana, ver etl/README.md), o buffer que maximiza a cobertura do método de
# produção 'mesmo_lado' é 5 m — buffers maiores aumentam empates (ambiguidade
# entre os dois lados da rua) mais rápido do que ganham cobertura.
BUFFER_CONFLACAO_M = 5.0
METODO_CONFLACAO = "mesmo_lado"

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql+psycopg://postgres:dev@localhost:5433/acessibilidade"
)

DIR_DADOS = Path(__file__).resolve().parent.parent / "dados"

URL_GEOFABRIK = "https://download.geofabrik.de/south-america/brazil/sudeste-latest.osm.pbf"
URL_GEOSAMPA_WFS = "https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs"
URL_CKAN_SP156 = "https://dados.prefeitura.sp.gov.br/api/3/action/package_show?id=dados-do-sp156"
# download anônimo confirmado em 08/09/2026 (docs/pesquisa/2026-09-08-sptrans.md)
URL_GTFS = "http://www.sptrans.com.br/umbraco/Surface/PerfilDesenvolvedor/BaixarGTFS"

UA = "RotaFaladaSP-ETL/0.1 (projeto academico FATEC)"

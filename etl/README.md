# ETL — Rota Falada SP

Pacote Python independente do backend que popula o PostGIS da área piloto (Vila Mariana, Lapa, Ipiranga/FATEC) com o grafo de pedestres do OSM, as calçadas do GeoSampa, as reclamações do SP156 e as paradas/linhas do GTFS da SPTrans. O esquema das tabelas é criado pelas migrations do Alembic do backend (`backend/alembic/versions/002_fontes_oficiais.py`); este pacote só lê fontes externas e grava linhas.

Ver `docs/adr/002-grafo-com-osmnx.md` para a decisão de usar `osmium` + `osmnx` em vez de `osm2pgsql`.

## Estrutura

```
etl/
├── Dockerfile              python:3.12-slim + osmium-tool + requirements
├── requirements.txt
├── dados/                  downloads cacheados (fora do git; ver .gitignore)
└── etl/
    ├── config.py           AREA_PILOTO, BBOX_UNIAO, DATABASE_URL, URLs, DIR_DADOS
    ├── db.py                engine(), fonte_id(), registrar_execucao(), concluir_execucao()
    ├── download.py          baixar(url, destino, max_idade_dias=7) com cache e validação de tamanho
    ├── geo.py                bbox_para_poligono(), PROJ_31983, comprimento_m()
    ├── osm_regras.py         classificar_kerb(), esquema_calcada(), fator_custo(), eh_via_de_pedestre() — puro, sem I/O
    ├── osm.py                executar(engine): osmium (recorte+filtro) + osmnx (topologia) → no_pedestre/via_pedestre
    ├── geosampa.py           executar(engine): WFS paginado (verificação numberReturned==numberMatched) → calcada_sp
    └── cli.py                python -m etl.cli osm|geosampa|sp156|gtfs|tudo
```

## Como rodar

Com o Docker Desktop rodando e o banco local no ar (`docker compose up -d db`):

```bash
docker compose --profile etl build etl
docker compose --profile etl run --rm etl --help
docker compose --profile etl run --rm etl osm        # Task 3
docker compose --profile etl run --rm etl geosampa   # Task 4
docker compose --profile etl run --rm etl sp156      # Task 5
docker compose --profile etl run --rm etl gtfs       # Task 6
docker compose --profile etl run --rm etl tudo       # Task 7
```

Testes (de dentro do container, sempre funciona — é o mesmo ambiente do CI):

```bash
docker compose --profile etl run --rm --entrypoint pytest etl tests -q
```

Testes no host: instale `etl/requirements.txt` no venv do backend. `osmnx`/`geopandas` dependem de wheels que podem não existir ainda para a versão de Python do host (o Dockerfile fixa `python:3.12-slim`); se a instalação falhar, rode os testes de dentro do container como acima.

```bash
source ../backend/.venv/Scripts/activate   # a partir de etl/
pip install -r requirements.txt
python -m pytest tests -q
```

## Armadilhas conhecidas (detalhadas por fonte nas próprias tasks)

- **OSM:** `osm2pgsql` não divide vias nos cruzamentos (sem `source`/`target` por nó); por isso o grafo é montado com `osmium` + `osmnx`, não `osm2pgsql` (ADR 002). `kerb=yes` é "guia de altura indeterminada" e nunca vira acessível. `GeoDataFrame.to_postgis` escreve por padrão numa coluna chamada `geometry`; como `no_pedestre`/`via_pedestre` usam `geom`, é preciso `gdf.rename_geometry("geom")` antes de gravar — sem isso o Postgres falha com `find_srid(): could not find the corresponding SRID` (a coluna `geometry` não existe na tabela).
- **GeoSampa:** o WFS trunca resultado em silêncio (HTTP 200) se a paginação não verificar `numberReturned` contra `numberMatched`; a paginação exige `sortBy` explícito (WFS 2.0) — testado em 14/09/2026 contra o serviço real: `sortBy=cd_identificador_calcada` funciona direto, sem precisar do sufixo `+A` nem de subdividir a bbox. Zero em largura/declividade é ausência de medição, não medição real — por isso as colunas geradas `largura_medida`/`declividade_medida`. As bboxes de Vila Mariana e Ipiranga (definidas de forma independente no Plano 2) se sobrepõem num pequeno canto, então a mesma calçada é devolvida por mais de uma consulta de bbox: é preciso deduplicar por `cd_identificador_calcada`. O filtro `bbox` do WFS testa a caixa delimitadora da feição contra a bbox pedida (não a geometria exata), então algumas calçadas na borda do recorte vêm com a geometria fora da área piloto de fato — por isso ainda é preciso um filtro final por `ST_Intersects`/`.intersects()` contra a união das três `area_piloto`, como já era feito para o grafo do OSM.
- **SP156:** o CSV é `cp1252`, não UTF-8/latin-1 estrito (o campo `Serviço` mistura hífen e travessão, byte `0x96`).
- **GTFS:** o feed **não** tem `wheelchair_boarding`, `wheelchair_accessible`, `pathways.txt`, `levels.txt` nem `calendar_dates.txt` (confirmado em 08/09/2026); serve só como seed de paradas e linhas.

## Tempos e contagens reais

Preenchido conforme cada fonte é implementada (Tasks 3–6):

- **OSM** (medido em 14/09/2026, `docker compose --profile etl run --rm etl osm`, rede residencial):
  - Download do Geofabrik (`sudeste-latest.osm.pbf`, sudeste do Brasil inteiro): **857.760.454 bytes (~858 MB)**, cerca de **1min50s**; reaproveitado por até 7 dias (`max_idade_dias` padrão de `baixar()`), então corridas seguintes pulam o download.
  - `osmium extract` (bbox união dos 3 recortes, `-s smart`) + `tags-filter w/highway` + `cat` (XML) + `osmnx.graph_from_xml` + filtro de acessibilidade + `simplify_graph` + recorte final pelos 3 polígonos `area_piloto` + carga no Postgres: **~1min30s** (com o PBF já em cache).
  - Tempo total de ponta a ponta (download + processamento): **~3min20s** na primeira corrida; **~1min30s** nas seguintes (cache).
  - Resultado carregado: **18.333 `no_pedestre`** e **25.040 `via_pedestre`** (mínimo exigido pelos testes de qualidade: 5.000); **174 escadas** (`highway='steps'`, todas bloqueadas com `custo_acessivel >= 1.000.000`); **3.838 nós com `kerb` preenchido**; **0 ocorrências de `kerb='yes'` com `kerb_transponivel` diferente de `NULL`** (a regra de negócio se sustenta com dados reais); `esquema_calcada`: 3.088 `geometria_propria`, 3.342 `atributo_via`, 18.610 `via_generica`.
  - `pytest etl/tests -q` (31 unitários de `osm_regras` + 7 de qualidade de `via_pedestre`/`no_pedestre`, com o banco local no ar): **38 passed**.
- **GeoSampa** (medido em 14/09/2026, `docker compose --profile etl run --rm etl geosampa` no host, rede residencial):
  - `numberMatched` por bbox: **11.313** (Vila Mariana), **7.135** (Lapa), **6.830** (Ipiranga) — **25.278** feições no total, todas efetivamente recebidas (`etl_execucao.linhas == etl_execucao.esperado == 25.278`, nenhuma página truncada).
  - Paginação: `count=2000`, pausa de 1s entre páginas, **14 requisições HTTP** no total (6+4+4 páginas); tempo de ponta a ponta (contagem `hits` + páginas + carga no Postgres): **~29s**.
  - Após deduplicar por `cd_identificador_calcada` (a mesma calçada aparece nas consultas de Vila Mariana e Ipiranga, cujas bboxes se sobrepõem num pequeno canto) e filtrar por interseção real com a união das três `area_piloto` (o filtro `bbox` do WFS usa a caixa delimitadora da feição, não a geometria exata — havia 402 linhas com geometria fora da área piloto antes desse filtro): **22.422 `calcada_sp`** carregadas (mínimo exigido pelos testes de qualidade: 5.000).
  - `largura_medida = true` (largura realmente medida, não ausência mascarada em zero) em **21.952** linhas, `false` em **470**; `declividade_medida = true` em **18.186**, `false` em **4.236** — confirma que as colunas geradas distinguem "zero" de "não medido" com dados reais.
  - `pytest etl/tests -q` (com o banco local no ar, dados do OSM e do GeoSampa carregados): **45 passed** (31 unitários de `osm_regras` + 2 unitários de paginação do GeoSampa + 7 de qualidade OSM + 5 de qualidade GeoSampa).
- **SP156:** _pendente (Task 5)._
- **GTFS:** _pendente (Task 6)._

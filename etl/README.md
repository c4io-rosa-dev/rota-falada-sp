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
    ├── sp156.py              executar(engine): CSV cp1252 do CKAN → barreira_oficial
    ├── gtfs.py                executar(engine): zip GTFS da SPTrans (http, anônimo) → parada/linha
    └── cli.py                python -m etl.cli osm|geosampa|sp156|gtfs|tudo
```

## Orquestrador `tudo` e agendamento

`python -m etl.cli tudo` roda as quatro fontes em sequência (`osm → geosampa → sp156 → gtfs`). Cada módulo já grava sua própria linha em `etl_execucao` (inclusive `status='erro'` com o `detalhe`, antes de relançar a exceção) — o orquestrador só captura essa exceção fonte a fonte para que uma falha não impeça as demais de rodar, imprime `<fonte>: ERRO — <mensagem>` em stderr e continua. Ao final, o código de saída é `1` se qualquer fonte falhou (e `0` só se as quatro terminaram `ok`), para que o passo do CI/Actions marque o job como falho sem abortar a carga das outras fontes.

`.github/workflows/etl.yml` roda esse orquestrador e depois `pytest tests/test_qualidade_dados.py -q` num cron semanal (segunda 03:17 BRT) e por `workflow_dispatch` — **de propósito não roda em `push`** (é um job de dados, não de código, e o `DATABASE_URL_PROD` ainda não existe, ver pendência abaixo). Antes de rodar `tudo`, garanta que o banco tem o esquema mais recente (`alembic upgrade head` em `backend/`, apontando para o mesmo `DATABASE_URL`).

**Pendência do dono do projeto:** o workflow depende do Secret `DATABASE_URL_PROD` (string de conexão do Supabase de produção, Session pooler). Enquanto ele não existir no repositório, tanto o cron quanto um disparo manual (`workflow_dispatch`) falham no primeiro passo com banco (`python -m etl.cli tudo`) com erro de conexão — comportamento esperado, não um bug do ETL.

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
- **SP156:** o CSV é `cp1252`, não UTF-8/latin-1 estrito (o campo `Serviço` mistura hífen e travessão, byte `0x96`). A API do CKAN (`package_show`) não bloqueou o `User-Agent` do projeto em nenhum teste (14/09/2026); mesmo assim `descobrir_url` tenta de novo com um `User-Agent` de navegador antes de cair no CSV fixo, caso o WAF passe a bloquear. **Armadilha adicional encontrada na prática:** o campo `last_modified` do CKAN não é confiável para achar "o recurso mais recente" — confirmado ao vivo em 14/09/2026, o recurso "Dados do SP156 - 2º TRI 2021" tinha `last_modified` (17:29:39) *depois* do "2º TRI 2026" de fato mais novo (17:20:14), porque alguém editou o metadado do recurso antigo mais tarde. `descobrir_url` por isso extrai o período do **nome** do recurso (`_chave_periodo`, ex. "2º TRI 2026" → 2026.25) e só cai em `last_modified`/`created` se o nome não bater com esse padrão.
- **GTFS:** o feed **não** tem `wheelchair_boarding`, `wheelchair_accessible`, `pathways.txt`, `levels.txt` nem `calendar_dates.txt` (confirmado em 08/09/2026); serve só como seed de paradas e linhas.

## Tempos e contagens reais

Preenchido conforme cada fonte é implementada (Tasks 3–7):

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
- **SP156** (medido em 14/09/2026, `python -m etl.cli sp156` no host, rede residencial):
  - `descobrir_url()` achou "Dados do SP156 - 2º TRI 2026" (mesma URL do `URL_CSV_FALLBACK` fixo, coincidência de o trimestre atual ser esse mesmo). Download do CSV: **101.003.291 bytes (~101 MB)** em **~6s**; reaproveitado por até 7 dias como os demais downloads.
  - Leitura (`pd.read_csv` com `usecols`+`dtype=str`, `cp1252`) + normalização de traço/coordenadas + filtro de categoria + filtro de área piloto + carga no Postgres: **463.686 linhas** no arquivo inteiro, **34.134** batendo alguma categoria de `CATEGORIAS` (antes do filtro de área), **1.865** dentro das três `area_piloto`; tempo de ponta a ponta com o CSV já em cache: **~6s**.
  - Por categoria (dentro do piloto): **1.223 `buraco`**, **242 `guia_danificada`**, **220 `calcada_danificada`**, **109 `obstaculo_calcada`**, **50 `travessia`**, **21 `guia_sem_rebaixamento`** (mínimo exigido pelos testes de qualidade: 100 no total). `raiz_de_arvore` não apareceu neste trimestre — o texto exato do plano ("Árvore - Solicitar avaliação em calçadas e praças") não bate com o serviço real da PMSP para esse trimestre ("Árvore – Solicitar avaliação em calçadas e praças **para fins de poda ou remoção**"); não é um bug de normalização (verificado com o CSV real: a comparação é exata após normalizar traço/acento/caixa, e o serviço real citado tem palavras a mais no fim, não só o separador diferente).
  - `data_finalizacao < data_abertura` (quando ambas existem, 398.670 linhas no CSV inteiro): **0 ocorrências** — a regra de coerência de datas se sustenta com dados reais.
  - `pytest etl/tests -q` (com o banco local no ar, OSM + GeoSampa + SP156 carregados): **55 passed** (31 unitários de `osm_regras` + 2 unitários de paginação do GeoSampa + 5 unitários de leitura/descoberta de URL do SP156 + 7 de qualidade OSM + 5 de qualidade GeoSampa + 5 de qualidade SP156).
- **GTFS** (medido em 14/09/2026, `python -m etl.cli gtfs` no host, rede residencial):
  - Download anônimo (sem autenticação), URL **http** (não https), de `http://www.sptrans.com.br/umbraco/Surface/PerfilDesenvolvedor/BaixarGTFS`: **14.293.480 bytes (~14 MB)** em menos de 1s; reaproveitado por até 7 dias como os demais downloads.
  - Verificação de campos de acessibilidade (`_verificar_sem_campos_de_acessibilidade`, roda antes de qualquer carga): feed confirmado **sem** `pathways.txt`, `levels.txt`, `calendar_dates.txt`, `wheelchair_boarding` (`stops.txt`) e `wheelchair_accessible` (`routes.txt`).
  - `stops.txt` inteiro: **22.266** paradas, nenhum `stop_id` duplicado, nenhum `stop_name` nulo; **1.142** caem dentro da união das três `area_piloto` (mínimo exigido pelos testes de qualidade: 200) e foram carregadas em `parada`.
  - `routes.txt` inteiro: **1.362** linhas, nenhum `route_id` duplicado, nenhum `route_short_name`/`route_long_name` nulo — todas carregadas em `linha` (mínimo exigido: 1.000).
  - Tempo de ponta a ponta com o zip já em cache: **~2,1s**.
  - `pytest etl/tests -q` (com o banco local no ar, OSM + GeoSampa + SP156 + GTFS carregados): **59 passed** (31 unitários de `osm_regras` + 2 unitários de paginação do GeoSampa + 5 unitários de leitura/descoberta de URL do SP156 + 7 de qualidade OSM + 5 de qualidade GeoSampa + 5 de qualidade SP156 + 4 de qualidade GTFS).
- **`tudo`** (medido em 14/09/2026, `docker compose --profile etl run --rm etl tudo`, os quatro downloads já em cache de execuções anteriores):
  - Tempo de ponta a ponta das quatro fontes em sequência, com todo o cache quente (nenhum download de fato refeito): **~2min24s** (`osm` continua sendo a mais lenta por causa do `osmium extract`/`osmnx`, mesmo sem baixar o PBF de novo).
  - As quatro fontes terminaram `ok`, saída: `osm: {'nos': 18333, 'vias': 25040}`, `geosampa: {'calcadas': 22422, 'esperado': 25278}`, `sp156: {'barreiras': 1865}`, `gtfs: {'paradas': 1142, 'linhas': 1362}` — código de saída `0`; as contagens batem exatamente com as corridas isoladas de cada fonte (Tasks 3–6), confirmando que `tudo` é apenas o encadeamento, sem efeito colateral entre fontes.
  - `pytest etl/tests -q` (com o banco populado pelo `tudo` acima): **62 passed** (58 anteriores + 3 unitários novos do orquestrador em `test_cli_tudo.py`, que simulam uma fonte falhando e verificam que as outras três continuam rodando e que o código de saída vira `1`).
  - `GET /health` do backend local (`uvicorn`, mesmo `DATABASE_URL` do ETL), depois desse `tudo`: `ultimo_etl` deixa de ser `null` e passa a refletir o horário da execução mais recente com `status='ok'` em `etl_execucao` (a `gtfs`, por ser a última fonte a terminar na sequência `osm → geosampa → sp156 → gtfs`).

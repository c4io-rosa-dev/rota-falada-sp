# ETL — Rota Falada SP

Pacote Python independente do backend que popula o PostGIS da área piloto (Vila Mariana, Lapa, Ipiranga/FATEC) com o grafo de pedestres do OSM, as calçadas do GeoSampa, as reclamações do SP156 e as paradas/linhas do GTFS da SPTrans. O esquema das tabelas é criado pelas migrations do Alembic do backend (`backend/alembic/versions/002_fontes_oficiais.py`); este pacote só lê fontes externas e grava linhas.

Ver `docs/adr/002-grafo-com-osmnx.md` para a decisão de usar `osmium` + `osmnx` em vez de `osm2pgsql`.

## Estrutura

```
etl/
├── Dockerfile              python:3.12-slim + osmium-tool + requirements
├── requirements.txt
├── gabarito_conflacao.csv  gabarito da conflação (via_osmid;calcada_cd_identificador;origem;observacao)
├── dados/                  downloads cacheados (fora do git; ver .gitignore)
└── etl/
    ├── config.py           AREA_PILOTO, BBOX_UNIAO, DATABASE_URL, URLs, DIR_DADOS, BUFFER_CONFLACAO_M, METODO_CONFLACAO
    ├── db.py                engine(), fonte_id(), registrar_execucao(), concluir_execucao()
    ├── download.py          baixar(url, destino, max_idade_dias=7) com cache e validação de tamanho
    ├── geo.py                bbox_para_poligono(), PROJ_31983, comprimento_m()
    ├── osm_regras.py         classificar_kerb(), esquema_calcada(), fator_custo(), eh_via_de_pedestre() — puro, sem I/O
    ├── osm.py                executar(engine): osmium (recorte+filtro) + osmnx (topologia) → no_pedestre/via_pedestre
    ├── geosampa.py           executar(engine): WFS paginado (verificação numberReturned==numberMatched) → calcada_sp
    ├── sp156.py              executar(engine): CSV cp1252 do CKAN → barreira_oficial
    ├── gtfs.py                executar(engine): zip GTFS da SPTrans (http, anônimo) → parada/linha
    ├── conflacao.py           executar(engine, buffer_m, metodo, so_medir=False): liga via_pedestre × calcada_sp
    ├── calibracao_conflacao.py  gerar_gabarito()/avaliar_buffer(): gabarito + calibração do buffer → docs/pesquisa/*-calibracao-conflacao.md
    └── cli.py                python -m etl.cli osm|geosampa|sp156|gtfs|conflacao|tudo
```

## Orquestrador `tudo` e agendamento

`python -m etl.cli tudo` roda as cinco fontes em sequência (`osm → geosampa → sp156 → gtfs → conflacao`; a conflação por último, já com o buffer e o método fixados pela calibração — `BUFFER_CONFLACAO_M`/`METODO_CONFLACAO` em `etl/config.py`, Plano 3 Task 3 — não os padrões do subcomando isolado, hoje os mesmos valores). Cada módulo já grava sua própria linha em `etl_execucao` (inclusive `status='erro'` com o `detalhe`, antes de relançar a exceção) — o orquestrador só captura essa exceção fonte a fonte para que uma falha não impeça as demais de rodar, imprime `<fonte>: ERRO — <mensagem>` em stderr e continua. Ao final, o código de saída é `1` se qualquer fonte falhou (e `0` só se as cinco terminaram `ok`), para que o passo do CI/Actions marque o job como falho sem abortar a carga das outras fontes.

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
docker compose --profile etl run --rm etl conflacao --buffer 5 --metodo mesmo_lado  # Plano 3, Task 2 (5/mesmo_lado já são o padrão calibrado na Task 3)
docker compose --profile etl run --rm etl tudo       # Task 7 (agora também roda a conflação por último)
```

Gabarito e calibração do buffer (Plano 3, Task 3; fora do `cli` porque não faz parte do pipeline de dados, é uma ferramenta de pesquisa que se roda à mão):

```bash
python -m etl.calibracao_conflacao --gerar-gabarito                      # regenera etl/gabarito_conflacao.csv (só automatico_contido)
python -m etl.calibracao_conflacao --buffers 2 3 5 8 10 15               # roda a calibração, escreve docs/pesquisa/<data>-calibracao-conflacao.md
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
- **Conflação (`etl/conflacao.py`):** o GEOS 3.9.0 desta imagem (`pgrouting/pgrouting:latest`, PostGIS 3.5.2) tem um bug de robustez confirmado em 14/09/2026: `ST_Intersection`/`ST_Difference` entre uma `LineString` e um `Polygon`/`MultiPolygon` **sempre devolve geometria vazia** — reproduzido até com coordenadas triviais (`LINESTRING(0 0,10 0)` × um polígono que a contém de sobra), independente de SRID, ordem dos operandos ou `ST_Buffer(...,0)` como workaround; `ST_Contains`/`ST_Within`/`ST_Relate`/`ST_Intersects` (booleanos) e `ST_Intersection` **Polígono × Polígono** continuam corretos. Por isso `fracao_dentro` (a fração do comprimento da via dentro da calçada, usada para decidir o método `'contido'`) não usa `ST_Intersection` direto sobre a via: a via é bufferizada numa faixa fininha (0,001 m, `ST_Buffer(..., 'endcap=flat')`, sem sobra nas pontas) e a fração vem da razão de **áreas** entre essa faixa e sua interseção com a calçada — interseção Polígono × Polígono, que funciona. Validado com casos sintéticos de sobreposição total (fração 1.0) e parcial (fração 0.5, ver `etl/tests/test_conflacao_sql.py`).
- **Gabarito da conflação (`etl/etl/calibracao_conflacao.py`):** `via_pedestre.osmid` **não é único** nesta base — o `osmnx` nem sempre funde todos os segmentos de uma via original do OSM num único trecho simplificado (confirmado em 14/09/2026: 6.690 grupos de `osmid` duplicado no total, 527 só dentro de `esquema_calcada='geometria_propria'`). A geração automática do gabarito por isso só escolhe arestas cujo `osmid` é único em todo `via_pedestre`, para que `via_osmid` no CSV resolva sem ambiguidade — o que reduziu bastante a amostra automática em Ipiranga/Lapa (ver números abaixo); `_resolver_gabarito` ainda aceita `osmid` duplicado para as futuras linhas `manual_streetview` (conta acerto se qualquer via daquele `osmid` ligou certo). Achado relacionado: dos 27 casos automáticos, 3 erram em **todo** buffer testado — não é sensibilidade a buffer, é um polígono do GeoSampa sobreposto a outro no mesmo lugar (a via fica a distância 0 de duas calçadas, e o desempate por `calcada_id` de `conflacao.py` às vezes escolhe a errada); documentado como achado, não corrigido aqui (mudar o desempate é código da Task 2, fora do escopo desta task).

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
- **Conflação** (medido em 14/09/2026, `docker compose --profile etl run --rm etl conflacao --buffer 5 --metodo mesmo_lado`, sobre os 25.040 `via_pedestre` × 22.422 `calcada_sp` já carregados pelas Tasks anteriores):
  - `EXPLAIN` da query de candidatos (`ST_DWithin` em EPSG:31983) confirma que ela usa o índice funcional da Task 1: `Index Scan using calcada_sp_geom_31983_idx on calcada_sp` como lado interno de um nested loop sobre as 25.040 vias — nenhuma varredura sequencial das ~561 mil combinações possíveis. `EXPLAIN (ANALYZE, BUFFERS)` real: **4,2 s** de execução (bem abaixo dos 5 min do gate de investigação), 20.034 vias com pelo menos um candidato dentro de 5 m.
  - Resultado gravado em `conflacao_via_calcada`: **11.001 vias ligadas** de 25.040 (**cobertura = 43,9%**, acima do gate de 30% do spec) — **1.202** por `'contido'` (≥ 80% do comprimento dentro do polígono) e **9.799** por `'mesmo_lado'`; **9.033** ficaram ambíguas (candidato(s) dentro do buffer, mas empate entre os dois lados da rua — não ligadas, de propósito, para não inventar um lado). Distância média das ligadas: **1,11 m**.
  - Verificado após a carga: `count(*) = count(DISTINCT via_id)` = 11.001 (uma calçada por aresta, sem duplicata); nenhuma linha com `metodo='contido'` e `confianca≠1`/`distancia_m≠0`; nenhuma `distancia_m > buffer_m`. `etl_execucao` (fonte `'conflacao'`) registrou `status='ok', linhas=11001`.
  - **Armadilha real encontrada nesta task** (não estimada, ver seção acima): o GEOS 3.9.0 desta imagem não calcula `ST_Intersection` entre `LineString` e `Polygon`/`MultiPolygon` (sempre vazio) — descoberto ao rodar o teste de integração com dados sintéticos, que originalmente usava `ST_Length(ST_Intersection(...))` (como no esqueleto do plano) e falhava mesmo no caso trivial de uma via inteiramente dentro de um polígono. O workaround (razão de áreas com a via bufferizada numa faixa fina) está documentado no docstring de `etl/etl/conflacao.py` e cobre o mesmo caso no teste automatizado.
  - `pytest etl/tests -q` (dentro do container, com o banco populado por `tudo` + `conflacao`): **64 passed** (62 anteriores + 2 novos: `test_regras_de_desempate_da_conflacao` sintético/revertido e `test_metodo_invalido_recusado`).
- **Gabarito e calibração do buffer** (medido em 14/09/2026, `python -m etl.calibracao_conflacao --gerar-gabarito` e depois `python -m etl.calibracao_conflacao` no host, sobre os mesmos 25.040 `via_pedestre` × 22.422 `calcada_sp`):
  - `--gerar-gabarito`: **27 linhas `automatico_contido`** (Vila Mariana 20, Ipiranga 4, Lapa 3 — bem abaixo dos 20 por recorte / 60 no total que o plano antecipava, porque a exigência adicional de `osmid` único no grafo, ver armadilha acima, elimina a maior parte dos candidatos em Ipiranga e Lapa: sem essa exigência havia 122/284/597 candidatos por recorte, mas ficariam ambíguos para o gabarito). `etl/gabarito_conflacao.csv` commitado com essas 27 linhas; **0 linhas `manual_streetview`** — pendência humana, ver abaixo.
  - Calibração (`--buffers 2 3 5 8 10 15`, os dois métodos): **~52 s** de ponta a ponta (12 corridas da query de candidatos, cada uma ~4 s). Com o gabarito só `automatico_contido`, acertos/erros ficaram **constantes em todo buffer testado** (24 acertos, 3 erros, em `mesmo_lado` e em `mais_proximo`) — esperado: essas linhas testam exclusivamente a regra `'contido'`, que vence a disputa de prioridade independente do buffer sempre que a aresta está de fato dentro do polígono, então `detectar_joelho` não encontra joelho (`None`) com este gabarito.
  - O sinal que de fato varia com o buffer é a **cobertura** do método de produção `mesmo_lado`: 34,2% (buffer 2) → 38,7% (3) → **pico de 43,9% no buffer 5** → cai para 41,8% (8) e só recupera parcialmente com buffers maiores (41,9% em 10, 42,6% em 15) — a regra de desempate do `mesmo_lado` passa a recusar mais candidatos como empate (o lado oposto da rua entra no alcance) mais rápido do que ganha cobertura nova. `detectar_pico_cobertura` acha o buffer 5 m.
  - **Buffer fixado: `BUFFER_CONFLACAO_M = 5.0`, `METODO_CONFLACAO = 'mesmo_lado'`** em `etl/etl/config.py` (o mesmo valor que já era o padrão do subcomando `conflacao` desde a Task 2, por coincidência — o padrão do esqueleto do plano já era o valor certo). `python -m etl.cli tudo` agora também roda a conflação com esses valores no final. Relatório completo: `docs/pesquisa/2026-09-14-calibracao-conflacao.md`.
  - Rodar `python -m etl.cli conflacao` de novo com o buffer/método fixados reproduziu exatamente o resultado da Task 2 (**11.001 vias ligadas, cobertura 43,9%**) — confirma que a carga já feita é a definitiva, nenhum recarregamento necessário.
  - `pytest etl/tests -q`: **75 passed** (64 anteriores + 9 novos de `test_calibracao_conflacao.py`, incluindo 2 de integração contra o gabarito real gerado do banco + 2 do orquestrador `cli tudo` atualizados para a quinta etapa `conflacao`).
  - **Pendência para o dono do projeto:** faltam as linhas `manual_streetview` do gabarito (mínimo 40, verificadas no Street View pela equipe humana, semanas 5–6, conforme o plano). `etl.calibracao_conflacao.ler_gabarito`/`avaliar_buffer` já aceitam as duas origens sem mudança de código — basta acrescentar linhas a `etl/gabarito_conflacao.csv` (`origem=manual_streetview`) e rodar `python -m etl.calibracao_conflacao` de novo; só essas linhas (casos ambíguos, perto de mais de uma calçada) vão de fato testar a sensibilidade ao buffer via `detectar_joelho`, hoje inconclusivo por falta delas.

# Design — Geocodificação local (`GET /api/geocode` e `/api/geocode/reverso`)

**Data:** 02/11/2026 · **Plano:** 5 (frontend da rota), parte do backend · **Branch:** `feat/backend`
**Spec-mãe:** `2026-09-08-rotas-acessiveis-sp-design.md` (persona Dona Ivete, tabela `logradouro` com GIN `pg_trgm`, autocomplete local)

## 1. Objetivo

Permitir que a pessoa informe origem e destino digitando texto ou usando "minha localização", sem depender de serviço externo. É o que destrava a tela `/rota` do Plano 5.

## 2. Decisões tomadas (02/11/2026)

| # | Decisão | Motivo |
|---|---|---|
| D1 | Busca por **rua**, **rua + número** e **lugares com nome** (escolas, estações, farmácias…) | É assim que as pessoas buscam; o OSM da área piloto tem ~87 mil endereços numerados e ~17 mil lugares com nome (contagem em `etl/dados/piloto.osm.pbf`, 02/11/2026) |
| D2 | **Sem fallback Photon** | O roteamento só funciona dentro da área piloto, então um endereço de fora não leva a lugar nenhum. Photon já é o 3º item da ordem de corte. A busca fica 100% determinística e sem dependência externa |
| D3 | **Inclui geocodificação reversa** | O botão "minha localização" (WCAG 2.5.7) precisa anunciar um endereço, não coordenadas, para a pessoa conferir onde o GPS a colocou |
| D4 | **Trigram no PostGIS** (`pg_trgm`, `word_similarity`) | Tolera erro de digitação e funciona com prefixo. `tsvector` não faz nenhum dos dois; um índice em memória não cabe bem nos 512 MB do Render |
| D5 | **Fonte única: OSM (ODbL)** | Não mistura atributos com o GeoSampa (CC-BY-SA), pela regra do projeto |
| D6 | **Nada de engenharia reversa de serviços de terceiros** (Google Maps etc.) | Termos de uso proíbem; o geocodificador do Google roda no servidor deles, então não há o que reaproveitar; o repositório é público |

## 3. Dados

### 3.1 Tabela `endereco` (migration `006_endereco`)

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | `bigserial` PK | |
| `tipo` | `text` NOT NULL, CHECK em (`logradouro`, `endereco`, `lugar`) | |
| `rotulo` | `text` NOT NULL, CHECK `length(trim(rotulo)) > 0` | Texto exibido e falado. Ex.: `Rua Vergueiro, 1000 · Vila Mariana` |
| `logradouro` | `text` | Nome da rua como está no OSM (`addr:street` ou `name` da via) |
| `numero` | `text` | `addr:housenumber` como no OSM (pode ser `1000A`) |
| `numero_int` | `integer` | Parte numérica inicial de `numero`, para achar o mais próximo; NULL se não houver |
| `categoria` | `text` | Valor de `amenity`/`railway`/`shop`/`leisure`… para lugares |
| `texto_busca` | `text` NOT NULL | Saída da normalização (seção 3.3) aplicada a `rotulo` sem o bairro |
| `geom` | `geometry(Point, 4326)` NOT NULL | |
| `osm_tipo` | `char(1)` | `n`, `w` ou `r`; NULL para linhas de `logradouro` derivadas |
| `osm_id` | `bigint` | |
| `fonte_id` | FK `fonte_dados` | OSM |
| `data_referencia` | `date` NOT NULL | Do PBF |

Índices: GIN `texto_busca gin_trgm_ops`; GiST `geom`; btree `(logradouro, numero_int)` para o número mais próximo.
RLS ligado na criação (mesmo padrão da `005_rls`).

### 3.2 Etapa de ETL `enderecos` (`etl/etl/enderecos.py`)

1. Entrada: `etl/dados/piloto.osm.pbf`, gerado pela etapa `osm`. Se não existir, falha com mensagem pedindo para rodar `osm` antes.
2. `osmium tags-filter` separa objetos com `addr:housenumber` + `addr:street` e objetos com `name` + uma das chaves de lugar (`amenity`, `railway`, `public_transport`, `shop`, `leisure`, `tourism`, `office`, `healthcare`).
3. `osmium export -f geojsonseq` gera GeoJSON. Polígonos (prédios) viram ponto com `ST_PointOnSurface`.
4. Mantém só o que está dentro da união de `area_piloto`.
5. Linhas `logradouro`: uma por par (nome de `via_pedestre`, bairro). Cada trecho de via pertence ao bairro de menor `id` que contém seu centroide; o ponto é `ST_ClosestPoint` dos trechos unidos em relação ao centroide deles (fica sobre a via, perto do meio). Assim, uma rua com o mesmo nome na Lapa e na Vila Mariana vira duas linhas, cada uma no seu bairro.
6. Bairro do rótulo: `area_piloto.nome` do polígono que contém o ponto; se dois contiverem (Vila Mariana e Ipiranga se sobrepõem), vence o de menor `id`.
7. Carga: `TRUNCATE` + `INSERT` numa transação; registra em `etl_execucao` como as demais etapas.
8. Entra em `tudo`, depois de `osm`. Não adiciona dependência: `osmium-tool` já está na imagem do ETL.

Formato do rótulo:
- `endereco`: `{logradouro}, {numero} · {bairro}`
- `lugar`: `{name} — {logradouro}, {numero} · {bairro}` quando houver `addr:*`; senão `{name} · {bairro}`
- `logradouro`: `{logradouro} · {bairro}`

Duplicatas (mesmo `tipo` + `texto_busca` a menos de 15 m) ficam só uma, a de menor `osm_id`.

### 3.3 Normalização (`normalizar(texto) -> str`)

Mesma função nos dois pacotes, `backend/app/services/normalizacao.py` e `etl/etl/normalizacao.py`, porque a imagem do ETL só copia `etl/`. Regras, em ordem:

1. Minúsculas; remove acentos (NFKD, descarta marcas combinantes).
2. Troca pontuação por espaço; colapsa espaços.
3. Expande abreviações quando são a palavra inteira: `r`→`rua`, `av`/`avn`→`avenida`, `al`→`alameda`, `pca`/`pc`→`praca`, `tv`/`trav`→`travessa`, `vd`→`viaduto`, `lgo`→`largo`, `dr`→`doutor`, `prof`→`professor`, `sto`→`santo`, `sta`→`santa`, `cel`→`coronel`, `gal`/`gen`→`general`. `est` **não** é expandido: é ambíguo entre "estrada" e "estação", e sem expansão "est vila mariana" ainda casa por prefixo com "estacao vila mariana".

O arquivo `normalizacao_casos.json` (pares entrada → saída) existe nos dois pacotes com o mesmo conteúdo; os testes dos dois lados o leem, e um teste do backend compara os dois arquivos byte a byte.

## 4. API

Código no padrão de `rotas`: `app/routers/geocode.py` só valida e traduz erros; `app/services/geocode.py` faz as consultas; `app/schemas/geocode.py` define os tipos.

### 4.1 `GET /api/geocode?q=&limite=`

- `q`: 3 a 100 caracteres depois de `strip()`. `limite`: 1 a 10, padrão 8. Fora disso, 422.
- **Separação de número:** se o texto normalizado termina em um número (`\s(\d+[a-z]?)$`), separa `rua` e `numero`.
  - Com número: escolhe a rua (`logradouro`) das linhas numeradas (`endereco` e `lugar` com `numero`) que melhor casa por trigram com a parte da rua (empate: nome mais curto, depois alfabético). Devolve as linhas dessa rua com `numero` igual (sem pontuação, minúsculo), `endereco` antes de `lugar`, com `aproximado=false`. Se a rua existir mas o número não, devolve a linha da mesma rua com menor `abs(numero_int - n)` (empate: menor `numero_int`), com `aproximado=true`. Se nem a rua casar, segue como busca sem número usando o texto inteiro.
  - Sem número: busca em `logradouro` e `lugar` (não em `endereco`, senão "rua vergueiro" devolveria oito números aleatórios da rua em vez da rua) com `q <% texto_busca` (limiar padrão de `word_similarity`, 0,6) ou prefixo.
- **Ordem (determinística):** 1) `texto_busca` começa com o texto da busca; 2) `word_similarity` decrescente; 3) `tipo` na ordem `logradouro`, `lugar`; 4) `rotulo` crescente; 5) `id` crescente.
- Sem resultado: 200 com `[]`.

### 4.2 `GET /api/geocode/reverso?lat=&lon=`

- `lat` em [-90, 90], `lon` em [-180, 180]; senão 422.
- Ponto fora da união de `area_piloto`: 404, `detail = "Este ponto está fora da área atendida pelo Rota Falada SP."`.
- Linha `endereco` mais próxima a até 50 m (distância em `geography`): devolve ela.
- Senão, a via nomeada (`via_pedestre`) mais próxima a até 50 m: devolve a linha `logradouro` com esse nome mais próxima do usuário, com `lat`/`lon` substituídos pelo ponto da via mais próximo do usuário.
- Senão: 404, `detail = "Nenhum endereço conhecido a até 50 metros deste ponto."`.

### 4.3 Resposta

```json
{ "id": 123, "tipo": "endereco", "rotulo": "Rua Vergueiro, 1000 · Vila Mariana",
  "lat": -23.58, "lon": -46.63, "aproximado": false }
```

`/api/geocode` devolve `list[EnderecoOut]`; o reverso devolve um `EnderecoOut`. Respostas 200 com resultado mandam `Cache-Control: public, max-age=86400`. Lista vazia manda `Cache-Control: no-store` (decisão de 02/11/2026, revisão final): logo depois de um deploy, a tabela `endereco` pode estar vazia até o ETL rodar, e um `[]` cacheado por 24 h no navegador e no Cloudflare esconderia os dados já carregados. Depois de prontas, `frontend/src/api/types.gen.ts` é regenerado.

## 5. Erros

| Situação | Resposta |
|---|---|
| Parâmetros inválidos | 422 (Pydantic/FastAPI) |
| Busca sem resultado | 200, `[]` |
| Reverso fora da área ou sem nada a 50 m | 404 com `detail` em português |
| Banco indisponível (`OperationalError`) | 503, `detail = "Busca de endereços indisponível no momento."` |

## 6. Testes (TDD em todos os passos)

1. **Unitários puros:** `normalizar` (lê `normalizacao_casos.json`) e a separação rua/número.
2. **Paridade:** os dois `normalizacao_casos.json` são idênticos; os dois módulos passam nos mesmos casos.
3. **ETL:** a transformação roda sobre um GeoJSONSeq pequeno de fixture (sem osmium): rótulos, ponto em polígono, recorte pela área piloto, deduplicação, bairro na sobreposição.
4. **Migration 006:** tabela, CHECKs, índices e RLS, no padrão de `test_migracao_*.py`.
5. **Serviço e API** (`TestClient`, linhas semeadas no banco de teste): número exato, número aproximado, erro de digitação, abreviação, ordem determinística, `limite`, 422, reverso 200/404 (fora da área e sem nada a 50 m), `Cache-Control`.
6. **Dados reais** (marcador `dados_reais`, pulado no CI): "FATEC Ipiranga" devolve um `lugar`; "rua vergueiro 1000" devolve um `endereco`; p95 da busca < 300 ms em 50 consultas locais (orçamento do spec-mãe).

## 7. Fora de escopo

- Fallback Photon/Nominatim (D2).
- Endereços fora da área piloto.
- Componente de autocomplete no frontend (é a outra metade do Plano 5).
- CEP.

## 8. Limitações conhecidas

- Os polígonos de `area_piloto` são retângulos, não limites oficiais de bairro; o bairro do rótulo é aproximado.
- A cobertura de números no OSM não é uniforme; onde faltar, a busca cai no número mais próximo ou na rua.

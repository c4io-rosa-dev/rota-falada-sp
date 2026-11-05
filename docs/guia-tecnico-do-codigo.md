# Guia técnico do código — Rota Falada SP

**Para quem é:** o dono do projeto e a equipe da disciplina Engenharia de Software II (FATEC Ipiranga), que precisam entender o que cada parte do código faz e por que está estruturada assim.

**Como foi produzido:** em 14/09/2026, seis agentes redatores leram os arquivos reais de cada área e escreveram uma seção; seis agentes verificadores reabriram cada arquivo citado, conferiram cada afirmação (nomes, parâmetros, colunas, valores padrão, códigos HTTP, contagens) e devolveram a seção corrigida. As correções feitas e as limitações encontradas no código estão no apêndice. A fonte da verdade é sempre o código; quando o texto e o código divergirem, o código venceu e o texto está errado.

**Estado do sistema quando este guia foi escrito:** Planos 1 a 4 executados (fundação, ETL, conflação, roteamento); produção no ar em Cloudflare Workers, Render e Supabase; 133 testes no backend e 8 no frontend. Os Planos 5 a 8 (frontend da rota, camada colaborativa, SPTrans/voz/offline, entrega) ainda não existem no código.

## Mapa da arquitetura

```mermaid
flowchart LR
  subgraph NAV["Navegador do usuário"]
    FE["React 19 + TypeScript<br/>(Cloudflare Worker com assets estáticos)"]
  end
  subgraph API["Render Free — FastAPI"]
    R1["POST /api/rotas"]
    R2["GET /api/fontes"]
    R3["GET /health"]
    S1["services/rota.py<br/>duas passadas + fallback"]
    S2["services/ors_client.py"]
    S3["services/pgrouting.py"]
    S4["services/enriquecimento.py"]
    S5["services/barreira_geom.py"]
    S6["services/cache_rota.py"]
  end
  subgraph DB["Supabase — PostgreSQL + PostGIS + pgRouting (RLS ligado)"]
    T1[("via_pedestre / no_pedestre (OSM, ODbL)")]
    T2[("calcada_sp (GeoSampa, CC-BY-SA)")]
    T3[("conflacao_via_calcada (só chaves)")]
    T4[("barreira_oficial / barreira_colaborativa")]
    T5[("rota_cache / fonte_dados / etl_execucao")]
  end
  subgraph ETL["ETL — container Docker / GitHub Actions"]
    E1["osm.py: Geofabrik → osmium → osmnx"]
    E2["geosampa.py: WFS paginado"]
    E3["sp156.py: CSV cp1252"]
    E4["gtfs.py"]
    E5["conflacao.py"]
  end
  ORS["OpenRouteService<br/>perfil wheelchair"]
  FE -->|fetch JSON| R1 & R2 & R3
  R1 --> S1
  S1 --> S2 & S3 & S4 & S5 & S6
  S2 <--> ORS
  S3 & S4 & S5 & S6 --> DB
  E1 --> T1
  E2 --> T2
  E3 & E4 --> T4
  E5 --> T3
```

## Índice

1. [Visão geral, infraestrutura e deploy](#1-visao-geral-infraestrutura-e-deploy)
2. [Backend: núcleo (configuração, banco, modelos, schemas, rotas HTTP e migrations)](#2-backend-nucleo-configuracao-banco-modelos-schemas-rotas-http-e-migrations)
3. [Backend: serviços de roteamento](#3-backend-servicos-de-roteamento)
4. [Backend: estratégia de testes](#4-backend-estrategia-de-testes)
5. [ETL: carga das fontes oficiais e conflação](#5-etl-carga-das-fontes-oficiais-e-conflacao)
6. [Frontend: React acessível](#6-frontend-react-acessivel)
7. [Apêndice A — correções feitas pela verificação](#7-apendice-a--correcoes-feitas-pela-verificacao)
8. [Apêndice B — limitações e dívidas técnicas encontradas no código](#8-apendice-b--limitacoes-e-dividas-tecnicas-encontradas-no-codigo)

## 1. Visão geral, infraestrutura e deploy

### O que este pedaço do repositório cobre

Nenhum dos arquivos desta seção contém lógica de negócio — não há aqui nenhuma linha que calcule uma rota ou faça conflação geoespacial. Eles fazem outra coisa, igualmente necessária: dizem **como as três partes do sistema se encontram** (frontend, backend, banco), **como o código chega a rodar em produção sem custar nada**, e **quais garantias automáticas existem** antes de qualquer commit virar deploy (lint, teste, e verificação de que nenhum segredo vazou). É a "cola" de infraestrutura. Vale a pena começar por aqui porque, sem entender essa cola, partes do código de aplicação (por exemplo, por que `config.py` aceita tanto `postgres://` quanto `postgresql+psycopg://`, ou por que `CORS_ORIGINS` é uma string crua e não uma lista JSON) parecem decisões arbitrárias — na verdade são respostas diretas a como o Render e o Supabase entregam essas variáveis.

### README.md — o mapa do projeto

O `README.md` (raiz do repo, 115 linhas) é o ponto de entrada e cumpre três papéis: descreve a tese do produto, documenta o setup local passo a passo, e — a parte mais valiosa para quem já conhece o projeto — mantém uma seção chamada **"Armadilhas conhecidas"**, que cresce a cada plano executado. Isso é uma decisão deliberada de engenharia: em vez de um ADR (Architecture Decision Record) para cada detalhe operacional pequeno, o time registra ali os "gotchas" que já morderam alguém, numerados sequencialmente e agrupados por plano de implementação. Alguns exemplos que se conectam diretamente com arquivos desta seção:

- **Item 1b** explica a porta 5433 do `docker-compose.yml` (detalhada abaixo).
- **Item 3** documenta que `CORS_ORIGINS` aceita lista separada por vírgula (ou JSON) — implementado em `backend/app/config.py::parsear_origens`.
- **Item 4** e **item 5** são avisos operacionais sobre o Postgres do Render (não usar; expira em 30 dias sem backup) e sobre qual pooler do Supabase usar (Session pooler, porta 5432 — não o Transaction pooler, porta 6543, que não suporta os *prepared statements* do driver psycopg).
- **Item 6** documenta um risco operacional que afeta qualquer workflow agendado do repositório: o GitHub desativa `schedule:` sozinho em repositórios públicos depois de 60 dias sem commits. Isso vale tanto para o `etl.yml` quanto para o `keep-alive.yml` — o cron que mantém o Render acordado (cuja razão de existir é o cold start do plano Free, explicada na seção "Produção" do próprio README, não esse item) pode simplesmente parar de rodar silenciosamente se o repositório ficar parado por dois meses.
- **Item 8** (o último da lista, fora de ordem e reaproveitando um número já usado por outro item de "Plano 2" — sinal de que foi adicionado depois, na correção do deploy) explica a arquitetura do Cloudflare: é um **Worker com assets estáticos**, não um projeto Cloudflare Pages. Isso importa porque a forma "Pages" de fazer roteamento de SPA (Single Page Application) — um arquivo `public/_redirects` com uma regra coringa redirecionando tudo para `index.html` — **não funciona** nesse modelo e é rejeitada pelo Cloudflare com erro de "Infinite loop detected". A solução usada foi a opção nativa do Worker (`not_found_handling` no `wrangler.jsonc`), vista adiante.

A tabela de comandos do README também é a referência rápida de como rodar lint e teste local em cada parte — os mesmos comandos que o CI roda automaticamente (ver `ci.yml` abaixo), então rodar localmente antes de commitar evita surpresa no pipeline.

### DATA-LICENSES.md — por que os dados de fontes diferentes nunca se misturam numa tabela só

Este arquivo documenta uma decisão que é tanto jurídica quanto de modelagem de dados, e é um dos pontos mais "não óbvios" do projeto para quem não trabalhou com dados geográficos abertos antes.

O problema: o projeto usa dados do **OpenStreetMap** (licença ODbL 1.0 — Open Database License) e dados do **GeoSampa/PMSP** (licença CC-BY-SA 4.0). As duas são licenças *copyleft* — obrigam qualquer obra derivada a manter licença "compatível" — mas são **mutuamente incompatíveis entre si**: não é juridicamente possível pegar uma via do OSM e um polígono de calçada do GeoSampa, fundir os dois num único registro (por exemplo, copiar a `largura` da calçada do GeoSampa para dentro da tabela do OSM) e publicar isso como um dado novo, porque esse dado fundido não consegue satisfazer as duas licenças share-alike ao mesmo tempo.

| Fonte | Licença | Obrigação | Tabela(s) |
|---|---|---|---|
| OpenStreetMap (via Geofabrik) | ODbL 1.0 | Atribuição "© OpenStreetMap contributors" + share-alike em derivados | `via_pedestre`, `no_pedestre` |
| GeoSampa / PMSP | CC-BY-SA 4.0 | Atribuição + licença semelhante em derivados | `calcada_sp` (fisicamente isolada) |
| SP156 / SMIT | CC0 1.0 | Nenhuma (atribuído por boa prática) | `barreira_oficial` |
| SPTrans (Olho Vivo/GTFS) | Não declarada publicamente | Atribuição "Dados: SPTrans / API Olho Vivo", por convenção | `parada`, `linha` |
| openrouteservice | Dados ODbL; serviço CC-BY 4.0 | Atribuição "© openrouteservice.org by HeiGIT" | `rota_cache` |
| Contribuições dos usuários | ODbL 1.0 (decisão de 10/09/2026) | Permite devolução futura ao OSM | `barreira_colaborativa`, `confirmacao` |

A solução adotada é de **modelagem, não jurídica**: os dados do OSM e do GeoSampa ficam em tabelas fisicamente separadas (`via_pedestre`/`no_pedestre` de um lado, `calcada_sp` do outro), ligadas apenas por uma tabela de junção, `conflacao_via_calcada`, que guarda **somente chaves estrangeiras, distância, confiança e método de vinculação** — nunca geometria nem atributos copiados. Isso caracteriza o conjunto como um *Collective Database* (uma coleção de bases independentes referenciadas entre si, e não uma base derivada única), o que evita que o share-alike de uma fonte "contamine" a outra. As regras práticas que o documento deixa explícitas: nunca subir dados do GeoSampa de volta pro OSM; nunca copiar `largura` ou `declividade` do GeoSampa para uma coluna da tabela do OSM (a junção acontece na *consulta* SQL, não no dado armazenado); e a tabela `fonte_dados` é a fonte única da verdade das atribuições mostradas na interface — toda linha espacial aponta para uma linha em `fonte_dados`, então o texto de atribuição legal aparece sempre correto sem precisar ser hardcoded em cada tela.

### docs/adr/ — as duas decisões de arquitetura registradas

Um **ADR (Architecture Decision Record)** é um documento curto e imutável que registra uma decisão técnica importante, o contexto que levou a ela, e as consequências aceitas — inclusive as desvantagens, para que quem ler depois não repita a pergunta "por que não fizeram X" sem saber que X foi considerado e descartado por um motivo específico. O repositório tem exatamente dois, em `docs/adr/`.

**ADR 001 — Backend em Python + FastAPI** (`docs/adr/001-backend-python.md`): registra a escolha entre Python, Java e C# para o backend, decidida a favor de Python 3.12 + FastAPI + SQLAlchemy 2 + GeoAlchemy2 (a extensão do SQLAlchemy para tipos geométricos) sobre PostgreSQL/PostGIS/pgRouting. O ADR cita que a decisão veio de "três arquiteturas independentes e dois juízes técnicos" que convergiram em Python — ou seja, não foi uma escolha de uma pessoa só, mas um método comparativo formal, documentado em `docs/pesquisa/2026-09-08-painel-de-designs.md`. Os motivos dados: cerca de 70% do esforço real do projeto é ETL geoespacial (recortar arquivo `.osm.pbf`, paginar WFS, ler CSV em `cp1252`, conflar com o grafo), e o ecossistema Python (`pyrosm`, `GeoPandas`/`pyogrio`, `Shapely`, `pyproj`, `OWSLib`) é o mais maduro nessa área; a calibração da conflação é experimentação iterativa em Jupyter; o Render Free tem só 512 MB de RAM, e uma aplicação Spring Boot (Java) consumiria 250–400 MB sozinha e somaria 10–30s ao *cold start* (o tempo que o serviço leva pra "acordar" depois de dormir por inatividade); e, por fim, nada no projeto exige a performance de uma JVM, já que as operações pesadas (buffer, interseção, caminho mínimo) rodam dentro do próprio PostGIS, em C, não no código da aplicação. O ADR reconhece explicitamente que C# com Npgsql + NetTopologySuite seria uma escolha tecnicamente boa também — a decisão não foi "Python é superior", foi "o ecossistema de dados geoespaciais do Python encaixa melhor no que 70% do trabalho realmente é" (e o ADR chega a comentar que, se o escopo fosse construir o próprio motor de roteamento, Java com GraphHopper seria a escolha certa — não é o caso aqui, que usa o ORS externo com fallback em pgRouting).

**ADR 002 — Grafo de pedestres com osmium + osmnx, não `osm2pgsql`** (`docs/adr/002-grafo-com-osmnx.md`): explica por que o ETL do OSM não usa a ferramenta mais comum do ecossistema (`osm2pgsql`, usada por praticamente todo tile server de mapa). O motivo é topológico: `osm2pgsql` carrega cada via do OSM como uma `LineString` isolada, sem dividi-la nos cruzamentos — duas ruas que se cruzam viram duas geometrias que só coincidem por coordenada, sem compartilhar um nó de verdade. Só que o pgRouting (extensão do PostGIS que calcula caminho mínimo em grafo) exige que cada aresta tenha colunas `source`/`target` explícitas apontando para o **mesmo nó** nos cruzamentos, senão o algoritmo de caminho mínimo simplesmente não atravessa de uma rua para outra. A solução escolhida foi usar `osmium extract`/`tags-filter` para recortar a área piloto do `.osm.pbf`, depois `osmnx.graph_from_xml` (que por baixo usa NetworkX) para montar um grafo onde cada nó já é uma interseção real, simplificando vias colineares sem perder atributos que variam ao longo da via (`kerb`, `surface`). A consequência aceita: o ETL fica dependente do `osmnx`/NetworkX/GeoPandas — mais pesado que `osm2pgsql` — e não há, no MVP, atualização incremental por diff do OSM (arquivos `.osc`): cada execução do ETL recorta e remonta o grafo inteiro do zero, baixando o `.osm.pbf` completo da Geofabrik novamente.

### docker-compose.yml — ambiente local, e por que a porta é 5433

```yaml
services:
  db:
    image: pgrouting/pgrouting:latest
    ports:
      - "5433:5432"
    ...
  etl:
    build: ./etl
    profiles: ["etl"]
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql+psycopg://postgres:dev@db:5432/acessibilidade
```

Dois serviços. `db` sobe a imagem `pgrouting/pgrouting:latest`, que já vem com PostGIS e pgRouting pré-instalados sobre o PostgreSQL — evita ter que instalar essas extensões manualmente (o README, item 7, registra que a versão local trouxe `postgis` 3.5.2, `pgrouting` 3.7.3 e `pg_trgm` 1.6). O detalhe que mais gera confusão (documentado no item 1b do README) é o mapeamento de porta **`5433:5432`**: o container escuta na porta padrão do Postgres (5432) *dentro* de si mesmo, mas o Docker expõe isso na porta **5433** do host. Isso existe porque muitas máquinas de desenvolvimento já têm um PostgreSQL nativo instalado ocupando a 5432 — se o compose também usasse 5432 no host, a conexão do backend local cairia silenciosamente no Postgres errado (o nativo, sem o schema do projeto) e falharia com uma mensagem de "senha incorreta" que não tem nada a ver com o problema real. Por isso a `DATABASE_URL` padrão do backend (em `config.py`, valor `postgresql+psycopg://postgres:dev@localhost:5433/acessibilidade`) já aponta para a porta 5433. Repare que essa armadilha só existe no ambiente **local**: dentro do Docker, o serviço `etl` fala com `db` pelo nome do serviço e pela porta interna 5432 (a rede interna do Compose não tem esse conflito), e no CI (`ci.yml`) o serviço de banco também usa 5432 porque roda isolado em um runner do GitHub, sem Postgres nativo concorrente.

O serviço `etl` usa `profiles: ["etl"]`, um mecanismo do Docker Compose que faz o serviço **não subir** com um `docker compose up` comum — só sobe explicitamente com `docker compose --profile etl run --rm etl <fonte>`, como o item 12 do README descreve. Isso evita que rodar o compose padrão (banco + nada mais) também tente buildar e rodar o container de ETL, que é pesado e só é necessário sob demanda. O `depends_on` com `condition: service_healthy` garante que o `etl` só inicia depois que o `healthcheck` do `db` (um `pg_isready -U postgres -d acessibilidade`) reportar sucesso — sem isso, o ETL poderia tentar conectar num Postgres que ainda está inicializando.

### render.yaml — o backend em produção

```yaml
services:
  - type: web
    name: rota-falada-api
    runtime: python
    plan: free
    region: oregon
    rootDir: backend
    buildCommand: pip install -e . && alembic upgrade head
    startCommand: uvicorn app.main:app --host 0.0.0.0 --port $PORT
    healthCheckPath: /health
    envVars:
      - key: PYTHON_VERSION
        value: "3.12.6"
      - key: APP_ENV
        value: prod
      - key: DATABASE_URL
        sync: false
      - key: CORS_ORIGINS
        sync: false
```

Esse arquivo é um **Render Blueprint**: o Render lê esse YAML da raiz do repo e cria/atualiza o serviço automaticamente a partir dele, em vez de exigir configuração manual pelo painel. Pontos relevantes:

- `plan: free` é o tier gratuito de 512 MB de RAM citado no ADR 001 — e que, como o README avisa, **dorme após 15 minutos sem tráfego** e leva cerca de 1 minuto para "acordar" na próxima requisição (o *cold start*). É justamente esse comportamento que motiva o workflow `keep-alive.yml`.
- `region: oregon` coloca o backend nos EUA (Oregon), enquanto o banco Supabase (visto adiante) fica em `sa-east-1` (São Paulo). Isso é uma escolha do tier gratuito, não uma otimização de latência: toda requisição que o backend faz ao banco cruza o continente (ida e volta), somando latência de rede a cada consulta — um trade-off aceito pelo custo zero, mas que vale ter em mente ao explicar por que uma chamada de API pode demorar mais do que o esperado só pela distância física entre Oregon e São Paulo.
- `PYTHON_VERSION` fixa a versão exata do interpretador (`3.12.6`) usada no build do Render, e `APP_ENV: prod` marca o ambiente como produção — embora hoje nenhum código do backend leia essa variável (`app_env` existe em `Settings`, com padrão `"dev"`, mas não é consultada em nenhum outro lugar do projeto no momento).
- `buildCommand` roda `alembic upgrade head` **durante o build**, não em um passo separado — ou seja, toda migration pendente do banco é aplicada automaticamente a cada deploy, antes do processo web novo começar a servir tráfego.
- `healthCheckPath: /health` é o endpoint que o Render chama repetidamente para saber se o deploy novo está saudável antes de rotear tráfego para ele (e para decidir se reinicia o serviço em caso de falha).
- As duas variáveis com `sync: false` (`DATABASE_URL` e `CORS_ORIGINS`) são declaradas no blueprint mas **não têm valor no arquivo** — `sync: false` diz ao Render "essa variável existe e é esperada, mas o valor é segredo e deve ser preenchido manualmente no painel", exatamente para que a connection string do Supabase e a lista de origens do CORS nunca fiquem versionadas em texto puro no Git.

### frontend/wrangler.jsonc — o frontend em produção

```jsonc
{
  "name": "rota-falada-sp",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  }
}
```

`wrangler` é a CLI oficial do Cloudflare para publicar Workers. Aqui o Worker não roda código de servidor algum — ele só serve os arquivos estáticos gerados pelo build do Vite (pasta `./dist`, o resultado de `npm run build`). A chave é `not_found_handling: "single-page-application"`: como é uma SPA (Single Page Application, roteada inteiramente no navegador via React Router ou similar), uma URL como `/rotas/123` não corresponde a nenhum arquivo físico em `dist/` — sem essa opção, o Worker devolveria 404 e o React nunca chegaria a carregar para assumir o roteamento no cliente. Com `single-page-application`, qualquer caminho que não bate com um asset real cai de volta em `index.html`, deixando o React Router (ou equivalente) decidir a rota no lado do cliente. Como o item 8 (o último) do README destaca, essa é a razão de o projeto **não** poder usar a abordagem clássica do Cloudflare Pages (arquivo `public/_redirects` com uma regra coringa) — nesse modelo de Worker com assets, esse arquivo é rejeitado com erro de loop infinito.

A variável `VITE_API_URL` **não aparece neste arquivo** porque não é config do Worker — é uma *variável de build* configurada no painel do Cloudflare (fora do repositório) e consumida em tempo de build pelo Vite. O consumo acontece em `frontend/src/api/client.ts`:

```ts
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
```

Todo prefixo `VITE_` é injetado pelo Vite no bundle final no momento do `npm run build` — depois disso é uma string fixa no JavaScript compilado, não algo lido em tempo de execução. Em desenvolvimento local, a variável não existe, então cai no fallback `http://localhost:8000` (o backend rodando local via `uvicorn`); em produção, o Cloudflare injeta a URL real do serviço no Render (`https://rota-falada-api.onrender.com`) antes do build.

### A arquitetura de produção, de ponta a ponta

```mermaid
flowchart LR
    subgraph Cliente["Navegador do usuário"]
        UI[React SPA]
    end
    subgraph CF["Cloudflare Workers"]
        Assets["Assets estáticos (dist/)\nnot_found_handling: SPA"]
    end
    subgraph Render["Render Free (512 MB, região Oregon)"]
        API["FastAPI\ndorme após 15 min sem tráfego"]
    end
    subgraph Supabase["Supabase Free (sa-east-1)"]
        DB[("PostgreSQL\nPostGIS + pgRouting\nRLS ligado, sem políticas")]
    end
    ORS["openrouteservice\n(API externa)"]

    UI -- "1. carrega HTML/JS/CSS" --> Assets
    UI -- "2. fetch VITE_API_URL + /api/..." --> API
    API -- "3. SQL como dono do banco\n(ignora RLS)" --> DB
    API -- "4. POST rota wheelchair" --> ORS
```

A ideia central, e o motivo de o backend ser um **proxy obrigatório** (nunca opcional) entre o frontend e o banco: o frontend React nunca fala diretamente com o Supabase, nem com o openrouteservice. Isso é reforçado em duas camadas independentes:

1. **RLS (Row Level Security) ligado sem políticas.** A migration `backend/alembic/versions/005_rls.py` roda `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` em **todas as 13 tabelas** do schema — `alembic_version`, `area_piloto`, `etl_execucao`, `fonte_dados`, `no_pedestre`, `via_pedestre`, `calcada_sp`, `barreira_oficial`, `parada`, `linha`, `conflacao_via_calcada`, `barreira_colaborativa` e `rota_cache` — sem criar nenhuma política de acesso (`CREATE POLICY`). RLS é um recurso do PostgreSQL que, quando ligado numa tabela, faz o banco **negar por padrão** qualquer leitura ou escrita de qualquer papel (role) que não seja o dono da tabela — a menos que exista uma política explícita liberando aquele acesso. Como não existe nenhuma política, o efeito prático é: **nenhum papel além do dono consegue tocar nos dados**. O comentário da própria migration explica o motivo específico: o Supabase expõe automaticamente uma API REST/GraphQL pública (a "Data API") sobre qualquer tabela do banco, usando os papéis `anon` (visitante anônimo) e `authenticated`; com RLS ligado e zero políticas, essa API fica de fato **bloqueada** — em particular, ninguém consegue inserir direto em `barreira_colaborativa` contornando a moderação que o backend aplicaria. O backend FastAPI, por sua vez, conecta ao Supabase com o papel **dono do banco** (via a connection string do Session pooler), que por definição ignora RLS — então, para o backend, nada muda; para qualquer outro caminho de acesso, tudo é bloqueado. Em Postgres local puro (o `docker-compose.yml` de desenvolvimento), esse `ALTER TABLE` é inócuo, porque ali não existe Data API do Supabase tentando ler as tabelas.
2. **A chave do openrouteservice nunca sai do servidor.** O item 14 do README é explícito: a chamada ao ORS (openrouteservice) é sempre feita pelo backend, com a chave apenas no header `Authorization` — o frontend não tem, e nunca teve, acesso a essa chave. Se o frontend chamasse o ORS diretamente, a chave (um JWT longo) precisaria estar embutida no bundle JavaScript público, visível a qualquer pessoa que abrisse o DevTools do navegador.

Cada um dos três serviços de produção citados na tabela do README:

| Componente | Serviço | Detalhe relevante |
|---|---|---|
| Frontend | Cloudflare Workers (assets) | `https://rota-falada-sp.caiorosa2006.workers.dev` |
| Backend | Render Free (512 MB, região Oregon) | `https://rota-falada-api.onrender.com`; dorme após 15 min |
| Banco | Supabase Free | PostGIS 3.3 + pgRouting 3.4, região `sa-east-1`, RLS ligado |

Um detalhe técnico que aparece em `config.py` e vale explicar: tanto o Supabase quanto o Render entregam a connection string do Postgres como `postgresql://...` (ou `postgres://...`), mas o SQLAlchemy 2 usado aqui, ao ver esse prefixo, tentaria carregar o driver `psycopg2` — que não está instalado, porque o projeto usa a versão 3 (`psycopg`, sem o "2"). A função `normalizar_url_banco` em `backend/app/config.py` reescreve esses dois prefixos para `postgresql+psycopg://` antes do SQLAlchemy tentar conectar:

```python
def normalizar_url_banco(valor: str) -> str:
    """Força o driver psycopg 3: painéis como Supabase e Render entregam 'postgresql://'
    ou 'postgres://', que fariam o SQLAlchemy procurar o psycopg2 (não instalado)."""
    texto = valor.strip()
    for prefixo in ("postgresql://", "postgres://"):
        if texto.startswith(prefixo):
            return "postgresql+psycopg://" + texto[len(prefixo):]
    return texto
```

Esse ajuste acontece via um *validator* do Pydantic (`@field_validator("database_url")`), então roda automaticamente toda vez que `Settings()` é instanciado — ninguém precisa lembrar de colar a URL já corrigida no painel do Render.

### Como as variáveis de ambiente fluem

O fluxo de configuração tem quatro origens diferentes dependendo de onde o código roda, e todas convergem no mesmo `Settings` do Pydantic:

```mermaid
flowchart TD
    A[".env na raiz do repo\n(local, nunca commitado)"] -->|"env_file=('../.env', '.env')"| S["Settings (backend/app/config.py)\npydantic-settings"]
    B["Render → painel\nDATABASE_URL, CORS_ORIGINS (sync: false)"] -->|"variáveis de ambiente do processo"| S
    C["GitHub Secrets\nDATABASE_URL_PROD, RENDER_HEALTH_URL"] -->|"env: nos workflows"| D["etl.yml / keep-alive.yml"]
    E["Cloudflare → variável de build\nVITE_API_URL"] -->|"import.meta.env, em tempo de build"| F["frontend/src/api/client.ts"]
```

- **Local**: `.env.example` (raiz) lista as chaves esperadas — `SPTRANS_TOKEN`, `DIRETO_DOS_TRENS_TOKEN`, `ORS_API_KEY`, `DATABASE_URL` — todas vazias, servindo só de modelo para copiar como `.env`. O `.gitignore` bloqueia `.env` e `.env.*` explicitamente (com uma exceção `!.env.example` para o próprio modelo permanecer versionado). A classe `Settings` do backend (`SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")`) lê o `.env` de dois caminhos possíveis — `../.env` cobre o caso comum de rodar `uvicorn` de dentro da pasta `backend/`, enquanto `.env` cobre rodar a partir da raiz — daí o item 2 do README ("o `.env` fica na raiz; o backend lê `../.env` quando roda de `backend/`").
- **Render**: `DATABASE_URL` e `CORS_ORIGINS` são preenchidas manualmente no painel (por isso `sync: false` no `render.yaml`) e chegam ao processo como variáveis de ambiente comuns do sistema operacional do container — o Pydantic Settings lê variável de ambiente com prioridade sobre o `.env` (que nem existe em produção).
- **GitHub Secrets**: usados só pelos workflows do GitHub Actions, nunca pelo backend/frontend diretamente. `etl.yml` usa `secrets.DATABASE_URL_PROD` para o ETL agendado escrever no Supabase de produção; `keep-alive.yml` usa `secrets.RENDER_HEALTH_URL` para saber qual URL pingar. Nenhum desses secrets é acessível fora do contexto do Actions.
- **Cloudflare**: `VITE_API_URL` é uma variável de **build**, configurada no painel do Cloudflare Workers (fora do repositório), lida por `import.meta.env.VITE_API_URL` dentro de `frontend/src/api/client.ts` no momento do `npm run build` — vira uma string fixa no bundle final, não algo consultado em tempo real.

### CI: ci.yml, etl.yml e keep-alive.yml

Os três únicos workflows do repositório vivem em `.github/workflows/`.

**`ci.yml`** roda em todo `push` para `main`/`master` e em todo `pull_request`, com três jobs independentes rodando em paralelo:

- `backend`: sobe um serviço de banco `pgrouting/pgrouting:latest` como *service container* do próprio GitHub Actions (padrão do Actions para dependências como bancos de dados — o runner sobe o container automaticamente antes do job, e ele já responde na porta mapeada quando os passos começam), aqui na porta 5432 do runner (sem o conflito de porta que motiva a 5433 local, porque o runner do Actions não tem Postgres nativo concorrente). Instala o backend em modo editável com extras de dev (`pip install -e ".[dev]"`), roda `ruff check .` e `ruff format --check .` (lint e formatação), aplica todas as migrations (`alembic upgrade head`) e roda a suíte de testes (`pytest -q`).
- `frontend`: `npm ci` (instalação reprodutível a partir do `package-lock.json`), `npm run lint`, `npm test -- --run` (Vitest sem modo watch) e `npm run build` — ou seja, o CI garante que o build de produção do Vite também não quebra, não só os testes.
- `gitleaks`: escaneia o **histórico inteiro** do Git (`fetch-depth: 0` no checkout) em busca de segredos vazados (chaves de API, tokens, senhas commitadas por engano) usando o binário do `gitleaks` (mesma versão fixada no `.pre-commit-config.yaml`, `v8.21.2`) baixado diretamente do GitHub Releases, em vez da action oficial `gitleaks/gitleaks-action@v2`. O comentário no arquivo explica por quê: essa action quebra no primeiro push de um repositório novo, porque monta um diff `<commit-raiz>^..HEAD` e o commit raiz não tem pai — um bug documentado upstream (`gitleaks-action/issues/199`). Baixar o binário e rodar `gitleaks detect --source . --verbose --redact` evita depender dessa falha.

**`etl.yml`** roda o pipeline de ETL geoespacial — não em todo `push` (o comentário do README, item 12, é explícito: "o workflow não roda em push de propósito", porque o ETL é pesado e não precisa rodar a cada commit) — mas em cron semanal (`17 6 * * 1`, ou seja, segunda-feira às 06:17 UTC, que corresponde a 03:17 no horário de Brasília) e sob demanda via `workflow_dispatch` (botão manual no GitHub). Instala `osmium-tool` (dependência do sistema operacional, usada para recortar o `.osm.pbf`, ver ADR 002), instala as dependências Python do ETL (`pip install -r etl/requirements.txt`), roda `python -m etl.cli tudo` (o pipeline completo, todas as fontes) contra `secrets.DATABASE_URL_PROD`, e depois roda os testes de qualidade de dados (`pytest tests/test_qualidade_dados.py -q`) — os mesmos testes que, segundo o item 13 do README, falham (em vez de afrouxar o limiar) se a cobertura real da conflação cair abaixo do gate combinado. Uma limitação documentada explicitamente no README (item 12): enquanto o secret `DATABASE_URL_PROD` não existir no repositório (porque depende do banco de produção do Supabase estar provisionado), a execução agendada ou manual desse workflow falha logo no primeiro passo que usa o banco — uma pendência aberta do dono do projeto, não um bug.

**`keep-alive.yml`** existe só para contornar o *cold start* do Render Free: dois crons — `7-59/10 10-23 * * *` e `7-59/10 0-2 * * *`, ambos em UTC — fazem um `curl` no endpoint de saúde do backend a cada 10 minutos (a cada minuto terminado em 7, 17, 27... nunca no minuto exato da hora cheia, de propósito, porque crons na hora cheia atrasam no GitHub por sobrecarga do agendador compartilhado), guardado no secret `RENDER_HEALTH_URL`. Somados, esses dois crons cobrem, em horário de Brasília (UTC−3), das **7h às 23h59** — o próprio comentário do arquivo confirma essa conta ("das 07h às 23h59 de Brasília (10h–02h59 UTC)"). Ou seja, o backend fica sem ping só de madrugada, entre meia-noite e 7h BRT, período em que faz sentido deixar o serviço dormir mesmo, já que dificilmente há alguém testando o projeto àquela hora. O passo falha explicitamente (`test "$codigo" = "200"`) se a resposta não for HTTP 200, então uma falha nesse workflow é um sinal legítimo de que o backend está fora do ar, não apenas dormindo.

### .pre-commit-config.yaml e .gitleaks.toml — verificação antes do commit chegar ao CI

`.pre-commit-config.yaml` configura o framework `pre-commit` (hooks Git que rodam automaticamente antes de cada `git commit` local, se instalados com `pre-commit install`) com dois repositórios de hooks:

```yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.21.2
    hooks: [{ id: gitleaks }]
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.16.7
    hooks:
      - id: ruff
        args: [--fix]
        files: ^backend/
      - id: ruff-format
        files: ^backend/
```

O `gitleaks` roda em todo commit local, escaneando o *diff* em busca de segredos antes que cheguem a ser commitados — a mesma ferramenta e versão (`v8.21.2`) que o job `gitleaks` do CI roda sobre o histórico inteiro, então um segredo tem duas chances independentes de ser pego: no commit local e, se escapar (por exemplo, um hook desativado), no `push`. `ruff` (linter, com `--fix` para autocorrigir o que der) e `ruff-format` (formatador, equivalente ao Black mas mais rápido, integrado na mesma ferramenta) rodam só sobre arquivos em `backend/` (`files: ^backend/`), porque o frontend tem seu próprio lint (ESLint, via `npm run lint`) fora do escopo do pre-commit Python.

`.gitleaks.toml` é a configuração do próprio gitleaks: `useDefault = true` mantém todas as regras padrão de detecção de segredo (chaves AWS, tokens do GitHub, chaves privadas, etc.), e a seção `[allowlist]` adiciona uma única exceção — uma regex que corresponde a uma chave **falsa** de teste (uma sequência hexadecimal repetitiva de 64 caracteres, `0123456789abcdef...`), documentada no próprio comentário do arquivo como parte do "Plano 1 (Task 9, Step 2)": ela existe só para provar, em teste, que o gitleaks de fato bloqueia um segredo real — sem essa allowlist, esse teste dispararia um falso positivo permanente no scanner.

### Limitações e pendências que o próprio repositório documenta

- O secret `DATABASE_URL_PROD` (usado por `etl.yml`) ainda não existe no GitHub — a execução agendada/manual do ETL contra produção falha no primeiro passo até o dono do projeto provisionar isso (README, item 12).
- Não há atualização incremental do grafo OSM (`.osc`) — cada execução do ETL reprocessa o `.osm.pbf` inteiro do zero (ADR 002, seção "Consequências").
- A licença de dados da SPTrans (Olho Vivo/GTFS) "não é declarada publicamente" — o projeto atribui por convenção/boa prática, não porque exista uma licença formal encontrada (`DATA-LICENSES.md`).
- O RLS ligado sem políticas é uma decisão binária e um tanto rígida: bloqueia *toda* a Data API do Supabase, sem meio-termo — não há, por exemplo, uma política granular permitindo leitura pública de algumas tabelas (como `fonte_dados`) via Data API; todo acesso, mesmo o de leitura pura, passa pelo backend.
- O backend roda em Oregon (EUA) e o banco em São Paulo (`sa-east-1`) — uma consequência do plano gratuito do Render, não uma escolha de performance; cada consulta ao banco cruza o continente duas vezes.
- A variável `app_env` existe em `Settings` (`backend/app/config.py`) e é setada como `prod` no `render.yaml`, mas hoje nenhum código do backend a lê — está declarada, mas ainda sem efeito.

### Arquivos lidos para esta seção

`README.md`, `DATA-LICENSES.md`, `docs/adr/001-backend-python.md`, `docs/adr/002-grafo-com-osmnx.md`, `docker-compose.yml`, `render.yaml`, `frontend/wrangler.jsonc`, `.github/workflows/ci.yml`, `.github/workflows/etl.yml`, `.github/workflows/keep-alive.yml`, `.pre-commit-config.yaml`, `.gitleaks.toml`, `.env.example`, `.gitignore`, `backend/app/config.py`, `backend/alembic/versions/005_rls.py`, `frontend/src/api/client.ts`.


## 2. Backend: núcleo (configuração, banco, modelos, schemas, rotas HTTP e migrations)

### Visão geral desta camada

O backend é um serviço FastAPI (`backend/app/`) que expõe três rotas HTTP (`/health`, `/api/fontes`, `/api/rotas`), fala com um banco PostgreSQL/PostGIS via SQLAlchemy 2, e tem seu esquema de banco versionado por migrations Alembic. Esta seção cobre o "esqueleto" do backend — tudo que não é a lógica de roteamento em si (isso fica em `app/services/`, coberto em outra seção) mas que sustenta essa lógica: como a configuração é lida, como a conexão com o banco é aberta, quais tabelas existem e por quê, quais formatos de entrada/saída a API aceita, e como o esquema do banco evoluiu em 5 migrations.

```mermaid
flowchart LR
    ENV[".env / variáveis de ambiente"] --> CFG["app/config.py\nSettings"]
    CFG --> MAIN["app/main.py\ncreate_app()"]
    CFG --> DB["app/db.py\nengine, SessionLocal"]
    MAIN --> R1["routers/health.py"]
    MAIN --> R2["routers/fontes.py"]
    MAIN --> R3["routers/rotas.py"]
    DB --> R1
    DB --> R2
    DB --> R3
    R1 --> SCH1["schemas/health.py"]
    R2 --> SCH2["schemas/fontes.py"]
    R2 --> MOD["models/fonte_dados.py"]
    R3 --> SCH3["schemas/rota.py"]
    R3 --> SVC["services/rota.py (outra seção)"]
    MIG["alembic/versions/001..005"] -->|cria/altera tabelas| PG[("PostgreSQL + PostGIS")]
    DB -->|engine aponta para| PG
```

### `backend/pyproject.toml`: como o projeto é empacotado

Esse arquivo é a "certidão de nascimento" do pacote Python `rota-falada-backend`. Ele usa o padrão moderno `pyproject.toml` (em vez do antigo `setup.py`) para declarar três coisas:

1. **Como construir o pacote** (`[build-system]`): usa `setuptools>=69` como *build backend* — a ferramenta que sabe empacotar o código em um formato instalável.
2. **Dependências de produção** (`[project].dependencies`): FastAPI (framework web assíncrono), Uvicorn (servidor ASGI que roda o FastAPI), Pydantic 2 e `pydantic-settings` (validação de dados e leitura de configuração), SQLAlchemy 2 (ORM/query builder), `geoalchemy2` (extensão do SQLAlchemy para tipos geométricos do PostGIS), `psycopg[binary]` (driver PostgreSQL versão 3, não o `psycopg2` mais antigo), Alembic (migrations), `httpx` (cliente HTTP assíncrono, usado para chamar o openrouteservice), `shapely` e `pyproj` (geometria e projeções cartográficas, usados nos cálculos de barreira/distância).
3. **Dependências de desenvolvimento** (`[project.optional-dependencies].dev`): `pytest` + `pytest-cov` (testes e cobertura), `ruff` (linter/formatter rápido escrito em Rust), `respx` (mock de chamadas HTTP feitas com `httpx`, usado para testar o cliente ORS sem rede real).

A seção `[tool.setuptools.packages.find]` restringe o empacotamento ao diretório `app*` — ou seja, só o código da aplicação é empacotado, não `tests/` ou `scripts/`. `[tool.ruff]` fixa o alvo em Python 3.12 e liga os grupos de regras `E` (erros do pycodestyle), `F` (Pyflakes — código morto, imports não usados), `I` (ordenação de imports) e `UP` (sugestões de sintaxe mais moderna, "pyupgrade") e `B` (bugbear — armadilhas comuns do Python). Por fim, `[tool.pytest.ini_options]` declara dois *markers* customizados usados nos testes: `integration` (testes que precisam de um PostGIS real acessível via `DATABASE_URL`) e `dados_reais` (testes que só funcionam depois do ETL ter carregado `via_pedestre`, pulados no CI). Isso explica por que rodar `pytest` sem banco disponível ainda executa uma boa parte da suíte — só os testes marcados `integration` falham/são pulados.

### `app/config.py`: de onde vem a configuração

Esse arquivo define a classe `Settings`, que centraliza toda configuração do backend lida do ambiente. É construída sobre `pydantic_settings.BaseSettings`, uma classe da biblioteca `pydantic-settings` que automaticamente lê variáveis de ambiente (e, opcionalmente, um arquivo `.env`) e as valida contra os tipos declarados — se uma variável obrigatória faltar ou tiver tipo errado, a aplicação falha já na inicialização, não em tempo de uso.

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    app_env: str = "dev"
    database_url: str = "postgresql+psycopg://postgres:dev@localhost:5433/acessibilidade"
    cors_origins: str = "http://localhost:5173"
    use_fixtures: bool = False
    sptrans_token: str | None = None
    ors_api_key: str | None = None
    ors_base_url: str = "https://api.openrouteservice.org"
    ors_timeout_s: float = 15.0
```

Repare em `env_file=("../.env", ".env")`: o Pydantic tenta primeiro `../.env` (a raiz do monorepo, um nível acima de `backend/`) e depois `.env` local — isso permite manter um único `.env` compartilhado na raiz do projeto (frontend + backend) em desenvolvimento, mas ainda funcionar se alguém rodar o backend isolado com seu próprio `.env`. `extra="ignore"` faz variáveis de ambiente desconhecidas (por exemplo, variáveis do sistema operacional ou do painel do Render que não pertencem à app) serem silenciosamente ignoradas em vez de causar erro de validação — sem isso, `Settings()` quebraria em qualquer ambiente de deploy com variáveis extras no ambiente.

Cada campo tem um valor padrão pensado para desenvolvimento local: `database_url` aponta pra um Postgres em `localhost:5433` (a porta não-padrão 5433, não 5432, sugere que o `docker-compose` do projeto expõe o PostGIS nessa porta para não colidir com um Postgres já instalado na máquina do desenvolvedor — e é exatamente o que o histórico do projeto confirma: o commit `2c42c2b` descreve essa escolha como "banco local na porta 5433 (conflito com PostgreSQL nativo)"); `use_fixtures` (usado por `services/ors_client.py`, outra seção) desliga por padrão o uso de respostas gravadas do ORS; `ors_api_key` é opcional (`str | None`) porque sem ela o cliente provavelmente cai no modo de fixtures.

Duas funções module-level (fora da classe) fazem o trabalho pesado de normalização, e são funções puras testadas isoladamente em `tests/test_config.py`:

```python
def parsear_origens(valor: str) -> list[str]:
    """Aceita JSON (["a","b"]) ou lista separada por vírgulas (a, b), ignorando vazios."""
    texto = valor.strip()
    if not texto:
        return []
    if texto.startswith("["):
        return [str(item).strip() for item in json.loads(texto) if str(item).strip()]
    return [parte.strip() for parte in texto.split(",") if parte.strip()]
```

`cors_origins` é guardado como **string crua**, não como `list[str]` direto no `Settings`. Por quê? O comentário no código explica: "string crua para não exigir JSON no painel do Render". CORS (*Cross-Origin Resource Sharing*) é o mecanismo do navegador que decide se um site em domínio A pode chamar uma API em domínio B; o FastAPI/Starlette precisa de uma lista de origens permitidas. Só que painéis de deploy como o do Render costumam oferecer só um campo de texto simples para variáveis de ambiente, e digitar um JSON válido (`["https://a.com","https://b.com"]`) ali é propenso a erro de digitação (aspas, colchetes). `parsear_origens` aceita **os dois formatos**: se o texto começa com `[`, tenta decodificar como JSON; senão, faz um `split(",")` simples, removendo espaços e entradas vazias em ambos os casos. Isso está documentado no histórico do projeto como correção de um bug real de produção (commit `7aa4516`, "CORS_ORIGINS aceita lista separada por vírgulas — falha de parse JSON no Render"). O acesso à lista já normalizada é feito pela `@property cors_origins_lista`, que é o que `main.py` de fato usa — `cors_origins` (a string) nunca é consumida diretamente fora dessa property.

```python
def normalizar_url_banco(valor: str) -> str:
    """Força o driver psycopg 3: painéis como Supabase e Render entregam 'postgresql://'
    ou 'postgres://', que fariam o SQLAlchemy procurar o psycopg2 (não instalado)."""
    texto = valor.strip()
    for prefixo in ("postgresql://", "postgres://"):
        if texto.startswith(prefixo):
            return "postgresql+psycopg://" + texto[len(prefixo) :]
    return texto
```

O SQLAlchemy decide qual driver de banco usar a partir do esquema da URL de conexão: `postgresql://` sozinho faz o SQLAlchemy tentar carregar o `psycopg2` (o driver "clássico" e mais comum em tutoriais), mas o `pyproject.toml` deste projeto só instala `psycopg[binary]` — que é o **psycopg 3**, um pacote e API diferentes. Painéis como Supabase e Render geram strings de conexão com `postgresql://` ou `postgres://` (formato genérico, sem opinião sobre o driver), então sem essa normalização o backend quebraria em produção com `ModuleNotFoundError: No module named 'psycopg2'`. `normalizar_url_banco` reescreve o prefixo para `postgresql+psycopg://`, que diz explicitamente ao SQLAlchemy "use o driver psycopg (versão 3)". Essa é exatamente a correção descrita no commit `edc799c` ("normaliza prefixo de DATABASE_URL para o driver psycopg 3"). A função é aplicada automaticamente a todo valor de `database_url` através de um **validador Pydantic**:

```python
@field_validator("database_url")
@classmethod
def _driver_psycopg(cls, valor: str) -> str:
    return normalizar_url_banco(valor)
```

`@field_validator("database_url")` diz ao Pydantic "rode esta função sempre que o campo `database_url` for atribuído/validado, e use o valor de retorno como o valor final do campo" — então qualquer código que leia `settings.database_url` depois da inicialização já recebe a URL corrigida, sem precisar lembrar de chamar `normalizar_url_banco` manualmente em cada lugar.

Por fim, `settings = Settings()` no final do arquivo cria a instância **singleton** — o objeto de configuração é instanciado uma única vez, no momento em que o módulo é importado, e todo o resto do backend (`db.py`, `main.py`, os routers) importa esse mesmo objeto `settings` em vez de instanciar `Settings()` de novo. Isso garante que toda a aplicação enxergue a mesma configuração, lida uma única vez do ambiente.

### `app/main.py`: montagem da aplicação FastAPI

```python
def create_app() -> FastAPI:
    app = FastAPI(title="Rota Falada SP API", version=health.VERSAO)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_lista,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    app.state.cliente_ors = criar_cliente(settings)
    app.include_router(health.router)
    app.include_router(fontes.router)
    app.include_router(rotas.router)
    return app


app = create_app()
```

`create_app()` é uma **factory function** — em vez de instanciar `FastAPI()` direto no nível do módulo, o projeto envolve a criação em uma função. Isso é o que permite os testes criarem múltiplas instâncias independentes da aplicação com estado diferente (por exemplo, `test_health.py` chama `create_app()` várias vezes e troca `app.state.cliente_ors` por um cliente falso a cada teste, sem que um teste vaze estado para o outro). No final do arquivo, `app = create_app()` cria a instância real que o Uvicorn de fato serve em produção (`uvicorn app.main:app`).

`CORSMiddleware` é o componente do Starlette (framework por baixo do FastAPI) que adiciona os cabeçalhos HTTP (`Access-Control-Allow-Origin` etc.) que autorizam um navegador rodando em outra origem (o frontend em `https://...workers.dev` ou `localhost:5173`) a chamar essa API. `allow_methods=["GET", "POST"]` restringe deliberadamente aos dois métodos que a API de fato usa — não há `PUT`/`DELETE`/`PATCH` em nenhuma rota. `allow_headers=["*"]` libera qualquer cabeçalho de requisição (inclui `Content-Type: application/json`, necessário para o `POST /api/rotas`).

A linha mais sutil é `app.state.cliente_ors = criar_cliente(settings)`. `app.state` é um objeto de uso livre que o FastAPI anexa à aplicação e que sobrevive durante todo o ciclo de vida do processo — diferente de uma variável criada dentro de uma função de rota, que é recriada a cada requisição. O comentário no código é explícito sobre por quê isso importa: **"único cliente ORS do processo... `POST /api/rotas` e `GET /health` compartilham o mesmo `EstadoCota`"**. O `OrsClient` (coberto na seção de `services/`) mantém internamente um contador de quota restante do openrouteservice, atualizado a cada resposta real da API externa (via cabeçalhos `x-ratelimit-*`). Se cada requisição criasse seu próprio cliente ORS, `/health` nunca saberia a cota real — sempre reportaria "nunca observada". Guardando um único cliente em `app.state`, tanto `routers/rotas.py` (via `obter_cliente_ors`, veja adiante) quanto `routers/health.py` leem o mesmo objeto.

### `app/db.py`: engine, sessão e injeção de dependência

```python
engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    sessao = SessionLocal()
    try:
        yield sessao
    finally:
        sessao.close()
```

O **engine** do SQLAlchemy é o objeto que sabe como abrir conexões físicas com o banco — internamente ele mantém um **pool de conexões** (um cache de conexões TCP já abertas e prontas para reuso, porque abrir uma conexão nova a cada requisição seria caro). `pool_pre_ping=True` faz o SQLAlchemy testar cada conexão retirada do pool com um `SELECT 1` silencioso antes de entregá-la ao código — se a conexão morreu (por exemplo, o Supabase/Render fechou conexões ociosas, algo comum em ambientes gerenciados com *poolers*), o SQLAlchemy descarta e abre outra automaticamente, em vez de o `INSERT`/`SELECT` real falhar com um erro de conexão perdida.

`SessionLocal` é uma **fábrica de sessões** (`sessionmaker`) — uma "sessão" no SQLAlchemy é a unidade de trabalho: ela agrupa operações, mantém um cache de objetos identity-mapped, e é o que expõe `.commit()`/`.rollback()`. `autoflush=False` desliga o comportamento padrão de o SQLAlchemy emitir `INSERT`/`UPDATE` pendentes automaticamente antes de cada `SELECT` — desligar isso dá controle explícito de quando os dados são enviados ao banco (o código decide quando fazer flush/commit, evitando side effects surpresa no meio de uma leitura). `expire_on_commit=False` evita que, depois de um `commit()`, todos os atributos dos objetos Python fiquem marcados como "expirados" (o que forçaria uma nova consulta ao banco na próxima leitura de qualquer atributo) — importante aqui porque o router de rotas (`routers/rotas.py`) monta o `RotaOut` de resposta *antes* de chamar `db.commit()`, então os objetos usados na resposta continuam válidos em memória mesmo depois do commit.

`get_db()` é uma função **geradora** (`yield`) usada como *dependência* do FastAPI (`Depends(get_db)`). O padrão `try/finally` com `yield` no meio é o idioma padrão do FastAPI para recursos que precisam ser liberados ao final da requisição, sucesso ou falha: o código antes do `yield` roda antes da rota executar (abre a sessão), o `yield sessao` entrega a sessão para a função de rota, e o `finally: sessao.close()` roda depois que a rota termina — inclusive se ela lançar uma exceção — garantindo que a conexão volte ao pool. Note que `get_db` nunca chama `commit()` nem `rollback()` — essa decisão é deixada para cada router (compare `routers/rotas.py`, que decide explicitamente commitar ou dar rollback, com `routers/fontes.py` e `routers/health.py`, que só leem).

### `app/models/`: os modelos ORM (SQLAlchemy)

Um **modelo ORM** (*Object-Relational Mapping*) é uma classe Python que representa uma tabela do banco: cada instância é uma linha, cada atributo mapeado é uma coluna. O SQLAlchemy usa esses modelos tanto para gerar SQL a partir de código Python (`select(FonteDados)...`) quanto, no caso deste projeto, como fonte da verdade que o Alembic compara ao gerar migrations automaticamente.

`app/models/base.py`:
```python
class Base(DeclarativeBase):
    pass
```
`Base` é a classe-mãe (declarativa) de que todo modelo do projeto herda; `Base.metadata` é o registro central que sabe quais tabelas existem e suas colunas — é isso que `alembic/env.py` usa como `target_metadata`.

`app/models/fonte_dados.py` é, na prática, o **único modelo ORM completo do projeto** (as outras 11 tabelas existem no banco, criadas via SQL cru nas migrations, mas não têm classe `Mapped` correspondente — ver observação nas limitações, adiante):

```python
class FonteDados(Base):
    """Catálogo de proveniência. Alimenta o rodapé e a página /fontes."""

    __tablename__ = "fonte_dados"

    id: Mapped[int] = mapped_column(primary_key=True)
    chave: Mapped[str] = mapped_column(String(40), unique=True)
    nome: Mapped[str] = mapped_column(String(120))
    licenca: Mapped[str] = mapped_column(String(60))
    url: Mapped[str] = mapped_column(Text)
    atribuicao: Mapped[str] = mapped_column(Text)
    data_referencia: Mapped[date | None] = mapped_column(Date, nullable=True)
    data_extracao: Mapped[date | None] = mapped_column(Date, nullable=True)
```

A sintaxe `Mapped[int]`/`Mapped[str | None]` é o estilo "typed" introduzido no SQLAlchemy 2.0: o tipo Python anotado (`int`, `str`, `str | None`) já informa ao SQLAlchemy se a coluna aceita `NULL` (União com `None`) e integra com checagem estática de tipos (mypy/pyright). `mapped_column(...)` é onde ficam os detalhes específicos de SQL (tamanho de `String`, `unique=True`, `nullable=True`). Essa tabela existe para dar **proveniência e licenciamento** a cada dado exibido no app — cada barreira, calçada ou rota mostrada no frontend precisa poder apontar "de onde veio isso, sob qual licença" (requisito comum em produtos que usam dados abertos como OpenStreetMap, cuja licença ODbL exige atribuição). `app/models/__init__.py` reexporta `Base` e `FonteDados` para que `from app.models import FonteDados` funcione a partir de qualquer lugar do projeto (usado em `routers/fontes.py` e em `alembic/env.py`).

### `app/schemas/`: os modelos Pydantic (contratos HTTP)

Enquanto os modelos em `app/models/` descrevem tabelas do banco, os **schemas** em `app/schemas/` descrevem o formato JSON de entrada e saída da API — são classes `pydantic.BaseModel`, validadas automaticamente pelo FastAPI a cada requisição/resposta. Um campo com tipo errado, fora de faixa, ou ausente numa requisição faz o FastAPI devolver `422 Unprocessable Entity` **antes mesmo de a função da rota rodar**.

#### `app/schemas/health.py`

```python
class HealthOut(BaseModel):
    status: Literal["ok", "degradado"]
    versao: str
    banco: Literal["ok", "indisponivel"]
    ultimo_etl: datetime | None
    ors_cota_restante: int | None
    ors_cota_reset: datetime | None
    modo_fixtures: bool
```

| Campo | Tipo | Significado |
|---|---|---|
| `status` | `"ok"` \| `"degradado"` | Resumo de um caractere só: `"ok"` se o banco respondeu, `"degradado"` caso contrário. Nunca reflete o estado do ORS — só do banco. |
| `versao` | `str` | Versão fixa da API (`health.VERSAO = "0.1.0"`), usada por `main.py` como `FastAPI(version=...)` também. |
| `banco` | `"ok"` \| `"indisponivel"` | Resultado do teste de conectividade `SELECT 1`. |
| `ultimo_etl` | `datetime \| None` | Timestamp da última execução bem-sucedida do pipeline de ETL (lido de `etl_execucao`); `None` se nunca rodou ou se o banco está fora. |
| `ors_cota_restante` | `int \| None` | Quantas chamadas ainda restam na cota do openrouteservice, conforme o último cabeçalho `x-ratelimit-*` observado; `None` se ainda não houve nenhuma chamada real ao ORS nesse processo. |
| `ors_cota_reset` | `datetime \| None` | Quando a cota do ORS reseta. |
| `modo_fixtures` | `bool` | `True` quando o backend está usando respostas gravadas (fixtures) em vez do openrouteservice real — útil para saber, olhando `/health` em produção, se as rotas estão vindo de dados reais ou de fixtures de teste. |

#### `app/schemas/fontes.py`

```python
class FonteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    chave: str
    nome: str
    licenca: str
    url: str
    atribuicao: str
    data_referencia: date | None
    data_extracao: date | None
```

Espelha exatamente as colunas de `FonteDados` (o modelo ORM). `ConfigDict(from_attributes=True)` (antigo `orm_mode` do Pydantic 1) é o que permite `FonteOut.model_validate(objeto_orm)` funcionar — sem isso, o Pydantic só aceitaria um `dict`, não um objeto SQLAlchemy com atributos.

#### `app/schemas/rota.py` — o contrato mais rico da API

```python
class Coordenada(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
```
Um ponto geográfico. `Field(ge=..., le=...)` já valida faixa geográfica válida — é essa validação que faz `test_post_rotas_latitude_invalida_devolve_422` (latitude 91) devolver `422` sem nenhuma linha de código extra no router.

```python
class PerfilAcessibilidade(BaseModel):
    inclinacao_max: Literal[3, 6, 10, "any"] = 6
    guia_max_m: Literal[0.03, 0.06, 0.1, "any"] = 0.06
    largura_min_m: float = Field(0.9, ge=0.5, le=3)
    evitar_degraus: bool = True
    velocidade_kmh: float = Field(3.0, ge=0.5, le=6)
```

| Campo | Significado |
|---|---|
| `inclinacao_max` | Inclinação máxima aceitável do trecho, em percentual (3%, 6%, 10%) ou `"any"` (sem limite) — usado pelo fallback progressivo de nível em `services/rota.py`. |
| `guia_max_m` | Altura máxima de guia/degrau na calçada (rampa de acessibilidade) tolerada, em metros. |
| `largura_min_m` | Largura mínima de calçada aceitável (padrão 0.9 m, valor comum de referência para cadeira de rodas), limitado entre 0.5 e 3 m. |
| `evitar_degraus` | Se `True`, evita trechos marcados como `is_degrau`. |
| `velocidade_kmh` | Velocidade de caminhada assumida, usada para estimar `duracao_s` dos passos. |

Cada campo tem um valor padrão razoável, então `RotaIn` pode ser enviado só com `origem`/`destino` e o perfil "any-accessible padrão" é assumido — é exatamente o que `test_rotas_api.py` faz nos testes de contrato.

```python
class RotaIn(BaseModel):
    origem: Coordenada
    destino: Coordenada
    perfil: PerfilAcessibilidade = PerfilAcessibilidade()
```
Corpo esperado por `POST /api/rotas`.

```python
class BarreiraResumo(BaseModel):
    id: int
    origem: Literal["oficial", "colaborativa"]
    categoria: str
    severidade: str
    distancia_m: float
    confirmacoes: int | None
    data_referencia: date | None
```
Resumo de uma barreira (obstáculo de acessibilidade) próxima a um passo da rota. `origem` distingue se veio da tabela `barreira_oficial` (dado municipal, SP156) ou `barreira_colaborativa` (cadastrada por usuários do app) — só a colaborativa tem `confirmacoes` com sentido (contagem de "sim, essa barreira existe" de outros usuários).

```python
class Passo(BaseModel):
    ordem: int
    instrucao: str
    distancia_m: float
    duracao_s: float
    direcao: str
    largura_m: float | None
    largura_medida: bool
    declividade_pct: float | None
    declividade_medida: bool
    guia: Literal["transponivel", "nao_transponivel", "desconhecida"]
    is_degrau: bool
    barreiras_proximas: list[BarreiraResumo]
    fonte: str
    data_referencia: date | None
    geometria: dict[str, Any]  # GeoJSON LineString
```

Cada `Passo` é um trecho da rota, pensado para ser tanto exibido visualmente quanto **narrado por voz** (o nome do projeto é "Rota Falada"): `instrucao` é o texto falável ("vire à direita e siga por 20 metros"), `direcao` é provavelmente uma categoria curta (ex. "reto", "direita"). Os pares `largura_m`/`largura_medida` e `declividade_pct`/`declividade_medida` seguem um padrão recorrente no projeto: o valor pode ser `None` (não medido) mesmo quando existe um booleano "medida" — isso vem diretamente das colunas geradas `largura_medida`/`declividade_medida` de `calcada_sp` (ver migration 002), que distinguem "medimos e o valor é zero/pequeno" de "não temos essa medição". `guia` usa três estados (`transponivel`/`nao_transponivel`/`desconhecida`) em vez de um booleano — reflete que nem toda via tem o atributo `kerb` do OpenStreetMap preenchido. `fonte` e `data_referencia` dão proveniência por passo (não só por rota inteira), porque diferentes trechos da mesma rota podem vir de fontes diferentes (OSM vs. GeoSampa vs. pgRouting fallback). `geometria` é um GeoJSON `LineString` cru (`dict[str, Any]`, sem schema Pydantic tipado — o formato GeoJSON é heterogêneo o bastante que tipá-lo em Pydantic não compensaria).

```python
class Aviso(BaseModel):
    tipo: Literal["exigencia_relaxada", "barreira_dificulta", "trecho_sem_dados", "motor_fallback"]
    mensagem: str
```
Avisos não-fatais sobre a rota calculada. Os quatro tipos correspondem a decisões de compromisso que `services/rota.py` pode ter tomado: `exigencia_relaxada` (o perfil pedido não foi 100% atendido e o sistema relaxou uma exigência para achar alguma rota — ver `nivel_exigencia_atendido` abaixo), `barreira_dificulta` (há uma barreira que atrapalha mas não bloqueia), `trecho_sem_dados` (um trecho sem cobertura de dados de acessibilidade), `motor_fallback` (a rota não veio do ORS, e sim do fallback pgRouting).

```python
class RotaOut(BaseModel):
    passos: list[Passo]
    distancia_m: float
    duracao_s: float
    avisos: list[Aviso]
    nivel_exigencia_atendido: Literal[3, 6, 10, "any"]
    motor: Literal["ors", "pgrouting", "fixture"]
    fontes: list[str]
    geometria: dict[str, Any]
    cache: bool
```
`nivel_exigencia_atendido` é o nível de `inclinacao_max` que **de fato** foi satisfeito — pode ser mais permissivo que o pedido em `PerfilAcessibilidade.inclinacao_max` se o sistema precisou relaxar a exigência (mecanismo de "fallback progressivo" nos services). `motor` diz qual dos três motores de roteamento gerou a resposta: `"ors"` (openrouteservice real), `"pgrouting"` (fallback determinístico rodando dentro do próprio Postgres via extensão pgRouting) ou `"fixture"` (resposta gravada, usada em testes/demos sem rede). `cache` indica se a resposta veio de `rota_cache` (ver migration 004) em vez de recalculada — é o campo que os testes de contrato usam para provar que o cache funciona (`cache is False` na primeira chamada, `True` na segunda com o mesmo par origem/destino).

### `app/routers/`: os três endpoints HTTP

#### `GET /health` (`app/routers/health.py`)

```python
@router.get("/health", response_model=HealthOut)
def health(request: Request, db: Session = Depends(get_db)) -> HealthOut:
    ultimo_etl = None
    try:
        db.execute(text("SELECT 1"))
        ultimo_etl = db.execute(
            text("SELECT max(fim) FROM etl_execucao WHERE status = 'ok'")
        ).scalar_one_or_none()
        banco = "ok"
    except Exception:
        banco = "indisponivel"
    ...
```

Sempre devolve **200** — mesmo quando o banco está fora do ar. Esse é um detalhe importante e deliberado (confirmado por `test_health_degradado_quando_banco_cai`, que espera `status_code == 200` com `banco == "indisponivel"`): a rota captura qualquer `Exception` genérica do `db.execute`, marca `banco = "indisponivel"` e segue em frente montando a resposta — nunca deixa a exceção subir e virar um 500. Essa é a diferença entre uma rota de *liveness* (o processo está de pé? sempre 200 se a rota responde) e uma rota que reportaria falhas com código HTTP de erro; aqui o **corpo** da resposta é que comunica o problema (`status: "degradado"`), não o código HTTP. O `text("SELECT 1")` roda antes da consulta real como teste de conectividade explícito, e seu resultado é descartado (nem é atribuído a uma variável) — embora, na prática, se a conexão estivesse morta a segunda query já falharia sozinha — o padrão aqui é redundante mas inofensivo. A consulta a `etl_execucao` busca o timestamp de fim da última execução do ETL com `status = 'ok'` — se nunca rodou, ou todas falharam, `scalar_one_or_none()` devolve `None` sem lançar erro (diferente de `scalar_one()`, que lançaria se não houvesse nenhuma linha).

O cliente ORS é lido de `request.app.state.cliente_ors` — o mesmo singleton criado em `create_app()` (ver seção de `main.py`) — e seus campos `estado.restante`/`estado.reset_em` alimentam `ors_cota_restante`/`ors_cota_reset` da resposta. `modo_fixtures` é calculado com `isinstance(cliente_ors, OrsFixtureClient)`.

#### `GET /api/fontes` (`app/routers/fontes.py`)

```python
@router.get("/api/fontes", response_model=list[FonteOut])
def listar_fontes(db: Session = Depends(get_db)) -> list[FonteOut]:
    fontes = db.scalars(select(FonteDados).order_by(FonteDados.chave)).all()
    return [FonteOut.model_validate(f) for f in fontes]
```
(o prefixo `/api` vem de `APIRouter(prefix="/api", tags=["fontes"])`, não está escrito literalmente na função). Sempre devolve **200** com uma lista (vazia na pior hipótese) — não há tratamento de erro de banco aqui; se o banco estiver fora, a exceção do SQLAlchemy sobe crua e o FastAPI devolve **500** (implicitamente, via seu handler padrão de exceção não tratada — não há um `except` nesta rota, ao contrário de `/health`). A ordenação por `FonteDados.chave` é o que faz `test_lista_fontes_com_atribuicao_e_licenca` esperar a lista alfabética (`colaborativo, geosampa, ors, osm, sp156, sptrans`).

#### `POST /api/rotas` (`app/routers/rotas.py`)

Esse é o endpoint mais complexo, mas o router em si é deliberadamente fino — o comentário no topo do arquivo resume a intenção: "o router não sabe nada de ORS, barreiras ou pgRouting — só traduz `RotaNaoEncontrada` para o código HTTP certo".

```python
def obter_cliente_ors(request: Request) -> OrsClient:
    return request.app.state.cliente_ors


@router.post("/rotas", response_model=RotaOut)
def criar_rota(
    entrada: RotaIn,
    db: Session = Depends(get_db),
    cliente: OrsClient = Depends(obter_cliente_ors),
) -> RotaOut:
    agora = datetime.now(UTC)
    try:
        saida = calcular(db, entrada, cliente, agora)
    except RotaNaoEncontrada as erro:
        db.rollback()
        if erro.erro_ors is not None:
            raise HTTPException(status_code=503, detail=str(erro)) from erro
        raise HTTPException(status_code=404, detail=str(erro)) from erro
    db.commit()
    return saida
```

`obter_cliente_ors` é declarada como uma dependência do FastAPI (não chamada diretamente) justamente para poder ser **substituída nos testes** via `app.dependency_overrides[obter_cliente_ors] = ...` (usado extensivamente em `tests/test_rotas_api.py`), sem precisar mexer em `app.state` a mão em cada teste.

A tabela de códigos de resposta desse endpoint:

| Código | Quando ocorre |
|---|---|
| `200` | `calcular()` devolveu uma `RotaOut` com sucesso (veio do ORS, do pgRouting ou de um cache hit); `db.commit()` roda depois, persistindo o que `calcular()` tenha gravado (ex. entrada em `rota_cache`). |
| `422` | Corpo da requisição não passa na validação Pydantic de `RotaIn` — por exemplo, `lat: 91` fora da faixa `[-90, 90]` de `Coordenada`. Gerado automaticamente pelo FastAPI, antes mesmo da função `criar_rota` rodar. |
| `404` | `calcular()` lançou `RotaNaoEncontrada` com `erro_ors is None` — ou seja, o ORS esgotou todos os níveis do fallback progressivo respondendo "sem rota" genuinamente (não por cota/indisponibilidade), **e** o fallback pgRouting também não achou nada. Semântica: "não existe rota acessível entre esses pontos com os dados que temos", não uma falha do serviço. |
| `503` | `calcular()` lançou `RotaNaoEncontrada` com `erro_ors` presente — o ORS foi tirado do laço de tentativas por um problema de serviço genuíno (cota diária/por minuto esgotada, ou indisponibilidade do ORS), e o pgRouting, sendo subsidiário, também não achou rota. Semântica: "o serviço falhou em calcular", diferente de "não existe rota". |

Em ambos os casos de erro, `db.rollback()` desfaz qualquer alteração pendente na sessão antes de propagar o erro HTTP — importante porque `calcular()` pode ter começado a escrever no `rota_cache` ou em outra tabela antes de descobrir que não há rota. O teste `test_post_rotas_sem_rota_em_nenhum_motor_devolve_404` documenta explicitamente essa lógica com um comentário de alerta: *"Se alguém inverter `if erro.erro_ors is not None` no router, este teste passa a ver 503 e falha"* — ou seja, a distinção 404-vs-503 é tratada pela equipe como comportamento crítico e coberto por teste de regressão dedicado (o mesmo vale, espelhado, para o teste de 503).

### Migrations: o que são e como o Alembic funciona neste projeto

Uma **migration** é um script versionado que descreve uma mudança incremental no esquema do banco de dados (criar tabela, adicionar coluna, criar índice etc.), escrito de forma que possa ser aplicado (`upgrade`) ou desfeito (`downgrade`). O objetivo é o mesmo do Git para código-fonte: qualquer pessoa (ou qualquer ambiente — dev, CI, produção) consegue partir de um banco vazio e chegar exatamente ao mesmo esquema, executando as migrations em ordem, em vez de depender de alguém lembrar de rodar `ALTER TABLE` manualmente.

O Alembic (a ferramenta de migrations usada aqui, irmã do SQLAlchemy) rastreia qual migration já foi aplicada usando uma tabela especial, **`alembic_version`**, que ele mesmo cria automaticamente no banco na primeira execução. Essa tabela tem uma única linha com o `revision id` da última migration aplicada (por exemplo, `"005_rls"`). Quando você roda `alembic upgrade head`, o Alembic lê o valor atual de `alembic_version`, monta a cadeia de migrations a partir dali (seguindo os `down_revision` — cada migration declara de qual migration ela "vem", formando uma lista encadeada, não uma numeração solta) até a última (`head`), aplica cada `upgrade()` em ordem, e atualiza `alembic_version` ao final de cada uma. Se o banco já estiver atualizado, não faz nada.

`backend/alembic/env.py` é o script de bootstrap que o comando `alembic` executa antes de rodar qualquer migration:

```python
config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)
...
target_metadata = Base.metadata

def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
```

Dois pontos importantes: primeiro, a URL de conexão usada pelas migrations vem do **mesmo `settings.database_url`** do `app/config.py` (não de uma URL separada hardcoded em `alembic.ini` — de fato, `backend/alembic.ini` não tem nenhuma linha `sqlalchemy.url`; quem define isso em tempo de execução é sempre `env.py`) — então a normalização de driver (`normalizar_url_banco`) e a leitura do `.env` valem também para migrations, garantindo que `alembic upgrade head` rodado localmente aponte para o mesmo banco que a aplicação usaria. Segundo, `target_metadata = Base.metadata` conecta o Alembic aos modelos ORM (`app/models/`) — é isso que possibilitaria `alembic revision --autogenerate` (gerar automaticamente o diff entre modelos Python e o esquema real do banco), embora, como visto adiante, a maior parte das tabelas deste projeto foi criada com SQL cru via `op.execute(...)`, não a partir de modelos declarativos — então o autogenerate só enxergaria `fonte_dados`, a única tabela com modelo `Mapped` correspondente. `poolclass=pool.NullPool` desliga o pool de conexões para a sessão de migration (que é de curta duração e não deve reter conexões no pool compartilhado da aplicação).

O código também suporta `run_migrations_offline()` — modo que gera o SQL das migrations sem se conectar a um banco (`literal_binds=True` embute os valores diretamente no SQL gerado), útil para revisar o SQL antes de rodar em produção ou para gerar um script para alguém aplicar manualmente.

A seguir, cada uma das 5 migrations, na ordem em que formam a cadeia (`001 → 002 → 003 → 004 → 005`, via `down_revision`).

#### `001_fundacao.py` — extensões PostGIS e catálogo de fontes

`upgrade()` primeiro habilita três **extensões** do PostgreSQL (um plugin que adiciona tipos/funções ao banco):
- `postgis`: adiciona os tipos de dado geométrico (`geometry(Point, 4326)` etc.) e centenas de funções espaciais (`ST_Distance`, `ST_Transform`, `ST_MakeEnvelope`...) usadas em todo o projeto.
- `pgrouting`: adiciona algoritmos de roteamento em grafo (Dijkstra, A* etc.) que rodam dentro do próprio banco — é o motor do fallback quando o ORS está indisponível.
- `pg_trgm`: adiciona busca por similaridade de texto via trigramas (trigram = sequência de 3 caracteres); provavelmente usado para casar nomes de logradouros de fontes diferentes com grafia levemente distinta (não confirmado nesta seção — pertence à lógica de conflação/enriquecimento, coberta em outra seção).

Depois cria a tabela `fonte_dados` (mesmas colunas do modelo `FonteDados` descrito acima) e já **popula** ela com `op.bulk_insert(tabela, FONTES)` — uma lista fixa de 6 fontes de dados do projeto (`osm`, `geosampa`, `sp156`, `sptrans`, `ors`, `colaborativo`), cada uma com sua licença e texto de atribuição já definidos no código da migration. Isso é uma decisão de design notável: a migration não só cria estrutura, mas também **dados de referência** (seed data) que a aplicação depende para funcionar (todo o resto das tabelas referenciam `fonte_dados.id` via chave estrangeira). `downgrade()` simplesmente derruba a tabela.

#### `002_fontes_oficiais.py` — o grafo de vias, calçadas e paradas

Esta é a maior migration, criando 8 tabelas via `op.execute()` com SQL cru (não `op.create_table` do Alembic) — escolha provavelmente feita porque as `CHECK` constraints, os `GENERATED ALWAYS AS` e os índices `GIST` (específicos do PostGIS) seriam mais verbosos de expressar na API Python do Alembic do que em SQL direto.

| Tabela | Propósito |
|---|---|
| `area_piloto` | 3 polígonos fixos (Vila Mariana, Lapa, Ipiranga) que delimitam a área geográfica coberta pelo piloto do projeto — inseridos via `ST_MakeEnvelope` (retângulo a partir de 2 cantos). Usada para restringir onde o app aceita calcular rota. |
| `etl_execucao` | Log de execuções do pipeline de ETL: `fonte`, `inicio`/`fim`, `status` (`executando`/`ok`/`erro`, forçado por `CHECK`), `linhas`/`esperado` (contagem real vs. esperada, provável checagem de sanidade), `detalhe`. É essa tabela que `GET /health` consulta para `ultimo_etl`. |
| `no_pedestre` | Nós do grafo de caminhada — cruzamentos e pontos notáveis do OpenStreetMap. `id bigint` usa o **osmid original do OSM** como chave primária (não um serial próprio) — decisão que facilita reprocessar o ETL sem duplicar nós. Colunas `kerb`, `tactile_paving`, `crossing`, `wheelchair`, `barrier` são atributos crus do OSM relacionados a acessibilidade (`kerb` = tipo de guia de calçada, `tactile_paving` = piso tátil, etc.). |
| `via_pedestre` | Arestas do grafo — trechos de calçada/via entre dois `no_pedestre` (`source`/`target`, nomenclatura padrão do pgRouting, que espera colunas assim chamadas). Além do índice espacial em `geom`, a tabela ganha dois índices comuns (B-tree) separados em `source` e `target` — são as colunas que o pgRouting percorre para montar o grafo de caminho mínimo, então acelerar buscas por elas é tão importante quanto acelerar consultas espaciais. `esquema_calcada` (`CHECK IN ('geometria_propria','atributo_via','via_generica')`) registra **de onde veio o dado de calçada daquele trecho**: geometria própria de calçada (GeoSampa), um atributo `sidewalk=*` na via (OSM), ou nenhuma informação de calçada (assume-se a via genérica). `kerb_transponivel boolean` é nullable de propósito — o comentário no SQL é explícito: *"NULL = desconhecido (inclui kerb=yes)"*, ou seja, o OSM tem um valor `kerb=yes` que significa "tem guia, mas não se sabe se é baixa o suficiente" — modelado como `NULL`, não como `false`, para não afirmar algo que não se sabe. `custo_acessivel`/`custo_reverso` são os pesos que o pgRouting usa no algoritmo de caminho mínimo (provavelmente penalizando trechos ruins de acessibilidade; a lógica de cálculo fica em `services/`). |
| `calcada_sp` | Polígonos de calçada do GeoSampa (`MultiPolygon`), com métricas de largura e declividade já resumidas em min/max/média. Duas **colunas geradas**: `largura_medida boolean GENERATED ALWAYS AS (largura_min_m > 0) STORED` e `declividade_medida boolean GENERATED ALWAYS AS (declividade_max_pct > 0) STORED`. Uma coluna gerada (*generated column*) é calculada automaticamente pelo próprio PostgreSQL a partir de outras colunas da mesma linha, e `STORED` significa que o valor é fisicamente gravado em disco (recalculado a cada `INSERT`/`UPDATE`), não computado sob demanda — o motivo de existir é o mesmo padrão já visto em `Passo`: distinguir "esse trecho tem largura zero porque medimos e é zero" (impossível na prática) de "esse trecho não tem medição de largura no GeoSampa" — o valor default de `largura_min_m` é `0`, então sem essa coluna gerada seria ambíguo se um `0` significa "sem dado" ou "medido como zero". `data_referencia` tem um `DEFAULT DATE '2021-08-13'` fixo — a data de publicação do diagnóstico de calçadas do GeoSampa usado pelo ETL (mesma data citada na atribuição da fonte `geosampa` em `001_fundacao.py`). |
| `barreira_oficial` | Barreiras físicas reportadas oficialmente (prefeitura, via SP156) — obras, buracos, etc. `categoria` é um texto normalizado (a partir do `servico`, texto original do SP156) mapeado por lógica de ETL fora desta seção. |
| `parada` / `linha` | Paradas e linhas de ônibus (dados GTFS da SPTrans) — `stop_id`/`route_id` são os identificadores originais do GTFS, mantidos `UNIQUE` para permitir `UPSERT` idempotente ao reimportar. |

A maioria das tabelas com geometria recebe um índice `GIST` sobre a coluna `geom` (`CREATE INDEX ... USING GIST (geom)`) — GiST (*Generalized Search Tree*) é o tipo de índice que o PostGIS usa para acelerar consultas espaciais (`ST_DWithin`, `ST_Contains`, "o que está perto deste ponto?"); sem ele, toda consulta espacial faria um *full scan* da tabela. Nesta migration isso vale para `no_pedestre`, `via_pedestre`, `calcada_sp`, `barreira_oficial` e `parada` — 5 índices GIST ao todo (`linha` não tem coluna de geometria, então não precisa de um). A exceção notável é `area_piloto`: tem uma coluna `geom geometry(Polygon, 4326)`, mas nenhuma migration (001 a 005) cria um índice espacial sobre ela — plausivelmente porque a tabela guarda só 3 linhas fixas e um índice não traria ganho de performance sobre uma tabela desse tamanho, embora isso não esteja documentado explicitamente no código. `downgrade()` derruba as 8 tabelas na ordem inversa de dependência (FKs primeiro).

#### `003_conflacao.py` — ligar vias a calçadas, e índices métricos

**Conflação**, no contexto de dados geoespaciais, é o processo de ligar duas representações diferentes da mesma realidade física vindas de fontes distintas — aqui, cada trecho de via do OSM (`via_pedestre`) com o polígono de calçada correspondente do GeoSampa (`calcada_sp`), para poder herdar largura/declividade medidas no trecho do grafo de roteamento.

```sql
CREATE TABLE conflacao_via_calcada (
  via_id bigint NOT NULL REFERENCES via_pedestre(id) ON DELETE CASCADE,
  calcada_id bigint NOT NULL REFERENCES calcada_sp(id) ON DELETE CASCADE,
  distancia_m numeric NOT NULL CHECK (distancia_m >= 0),
  confianca numeric NOT NULL CHECK (confianca >= 0 AND confianca <= 1),
  metodo text NOT NULL CHECK (metodo IN ('contido','mais_proximo','mesmo_lado')),
  buffer_m numeric NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (via_id)
);
```

`PRIMARY KEY (via_id)` — não um par composto `(via_id, calcada_id)` — significa que cada `via_pedestre` casa com **no máximo uma** `calcada_sp` (relação N:1, cada calçada pode atender várias vias, mas cada via só tem uma calçada "vencedora"). `metodo` registra qual heurística de casamento foi usada (`contido`: a via está dentro do polígono da calçada; `mais_proximo`: casamento por proximidade quando não há contenção; `mesmo_lado`: alguma checagem de lado da rua). `confianca` (0 a 1) e `distancia_m` guardam o quão bom foi o casamento, permitindo à aplicação decidir se confia na conflação ou trata como "sem dado de calçada". `ON DELETE CASCADE` em ambas as FKs significa que, se a via ou a calçada de origem forem apagadas, a linha de conflação correspondente desaparece automaticamente — evita registros órfãos sem precisar de lógica de limpeza manual.

A segunda parte da migration cria **índices funcionais**:
```sql
CREATE INDEX via_pedestre_geom_31983_idx ON via_pedestre USING GIST (ST_Transform(geom, 31983))
```
Um índice funcional indexa o *resultado de uma expressão*, não a coluna crua. Aqui, `ST_Transform(geom, 31983)` reprojeta a geometria (armazenada em SRID 4326, WGS84 — o sistema de coordenadas geográficas em graus, usado por GPS) para o SRID 31983 (SIRGAS 2000 / UTM zona 23S — um sistema métrico, em metros, apropriado para o estado de São Paulo). **SRID** (*Spatial Reference Identifier*) é o código que identifica qual sistema de coordenadas uma geometria usa — comparações de distância em graus (4326) não fazem sentido físico direto (um grau de longitude não vale a mesma distância em todo lugar do planeta), então cálculos de distância/buffer em metros precisam de uma projeção métrica como 31983. A mesma migration cria um índice funcional análogo sobre `calcada_sp` (`calcada_sp_geom_31983_idx`). Esses índices existem para que consultas que já fazem esse `ST_Transform` na cláusula `WHERE` (como as da própria conflação, ou do cálculo de barreiras próximas em `services/barreira_geom.py`) usem o índice em vez de recalcular a transformação linha a linha sem aceleração. `downgrade()` desfaz os dois índices e a tabela, nessa ordem.

#### `004_roteamento.py` — barreiras de usuários e cache de rota

```sql
CREATE TABLE barreira_colaborativa (
  id bigserial PRIMARY KEY,
  categoria text NOT NULL,
  severidade text NOT NULL
    CHECK (severidade IN ('intransponivel','dificulta','informativo')),
  descricao text,
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','validada','contestada','resolvida','expirada')),
  confirmacoes integer NOT NULL DEFAULT 0,
  geom geometry(Point, 4326) NOT NULL,
  fonte_id integer NOT NULL REFERENCES fonte_dados(id),
  data_referencia date NOT NULL DEFAULT CURRENT_DATE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
```
Um comentário no SQL já avisa que é uma **"versão mínima"**: *"o Plano 6 acrescenta usuário, foto, eventos"* — ou seja, esta é uma limitação conhecida e documentada: hoje não há coluna de autoria (quem cadastrou a barreira), nem foto, nem histórico de eventos de moderação; só o estado atual (`status`) e uma contagem simples (`confirmacoes`). `severidade` com 3 níveis (`intransponivel`/`dificulta`/`informativo`) é o que a lógica de roteamento usa para decidir se uma barreira colaborativa bloqueia a rota, só a penaliza, ou é apenas informativa. `status` modela um fluxo de moderação (`pendente → validada/contestada → resolvida/expirada`) — mas as transições em si (quem/quando muda o status) não estão nesta migration nem, aparentemente, em nenhum router lido nesta seção: não há endpoint de escrita para `barreira_colaborativa` entre as rotas cobertas aqui (`/health`, `/api/fontes`, `/api/rotas` são todas de leitura ou cálculo, nenhuma faz `INSERT` nessa tabela) — a moderação provavelmente é tratada em outra parte do sistema não coberta nesta seção, ou ainda não implementada.

```sql
CREATE TABLE rota_cache (
  chave text PRIMARY KEY,
  resposta jsonb NOT NULL,
  regiao geometry(Polygon, 4326) NOT NULL,
  motor text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL
);
CREATE INDEX rota_cache_regiao_idx ON rota_cache USING GIST (regiao);
CREATE INDEX rota_cache_expira_idx ON rota_cache (expira_em);
```
`resposta jsonb` guarda a `RotaOut` inteira já serializada — `jsonb` é o tipo binário de JSON do PostgreSQL (mais rápido de consultar/indexar que `json` texto puro, embora aqui não haja índice sobre o conteúdo do JSON, só sobre `regiao` e `expira_em`). `chave text PRIMARY KEY` é provavelmente um hash/serialização determinística de origem+destino+perfil (a lógica de geração dessa chave está em `services/cache_rota.py`, fora desta seção). `regiao geometry(Polygon, 4326)` com índice `GIST` sugere que o cache pode ser invalidado espacialmente — por exemplo, quando uma nova barreira colaborativa é cadastrada dentro da `regiao` de uma rota em cache, essa entrada pode ser descartada (de novo, lógica não confirmada nesta seção). `rota_cache_expira_idx` (índice comum, não espacial) acelera a limpeza/consulta por TTL — os testes de contrato mencionam TTL de 6h para entradas de cache. Essa tabela também recebe `barreira_colaborativa_geom_idx` (GIST sobre `geom`), criado logo depois do `CREATE TABLE barreira_colaborativa`, coerente com o padrão do resto do esquema.

#### `005_rls.py` — Row Level Security em todas as tabelas

```python
TABELAS = [
    "alembic_version", "area_piloto", "etl_execucao", "fonte_dados",
    "no_pedestre", "via_pedestre", "calcada_sp", "barreira_oficial",
    "parada", "linha", "conflacao_via_calcada", "barreira_colaborativa",
    "rota_cache",
]

def upgrade() -> None:
    for tabela in TABELAS:
        op.execute(f"ALTER TABLE {tabela} ENABLE ROW LEVEL SECURITY")
```

**RLS** (*Row Level Security*) é um recurso do PostgreSQL que, uma vez ligado numa tabela, faz o banco negar acesso (leitura e escrita) a qualquer papel (role) de conexão que não tenha uma **política** (`POLICY`) explícita autorizando — mesmo que esse papel tecnicamente tenha permissão de `SELECT`/`INSERT` na tabela via `GRANT`. Sem nenhuma política definida (e nenhuma é criada por esta migration), RLS ligado numa tabela equivale a **bloquear o acesso por completo** para todo papel que não seja o dono da tabela (que ignora RLS por padrão).

O docstring da própria migration explica o motivo de negócio: o projeto usa Supabase, que expõe uma **Data API** automática (REST/GraphQL) sobre qualquer tabela do banco, autenticada pelos papéis `anon` (visitante anônimo) e `authenticated` (usuário logado) do Supabase Auth. O backend FastAPI conecta ao banco com o papel **dono** do banco (por isso ignora RLS e continua funcionando normalmente após esta migration), mas sem essa migration, **qualquer pessoa com a URL pública do Supabase poderia ler ou escrever diretamente nas tabelas via Data API, contornando toda a lógica do FastAPI** — inclusive inserir barreiras falsas em `barreira_colaborativa` sem passar pela moderação. Ligar RLS sem políticas é, na prática, uma forma econômica de dizer "essa tabela só é acessível pelo dono do banco" e fechar esse buraco de segurança, sem precisar desligar a Data API do Supabase inteira. O docstring também nota que, rodando PostgreSQL puro (o `docker-compose` local, sem Supabase), o comando é **inócuo** — não há Data API ali para bloquear, então RLS ligado sem políticas simplesmente não afeta o backend (que sempre conecta como dono).

Note que `alembic_version` está na lista — a própria tabela de controle do Alembic também recebe RLS, coerente com "bloquear tudo que não seja o backend/dono". A lista tem 13 tabelas ao todo: as 11 tabelas de negócio criadas em 002/003/004, mais `fonte_dados` (001) e a própria `alembic_version`. `downgrade()` reverte com `DISABLE ROW LEVEL SECURITY` para cada tabela, na mesma ordem (não haveria motivo para ordem inversa aqui, já que `ENABLE`/`DISABLE ROW LEVEL SECURITY` não tem dependência entre tabelas).

### Limitações e observações identificadas no código

- **Cobertura parcial de modelos ORM**: só `FonteDados` tem uma classe SQLAlchemy `Mapped` em `app/models/`. As outras 11 tabelas de negócio (`via_pedestre`, `calcada_sp`, `barreira_oficial`, `barreira_colaborativa`, `rota_cache` etc.) existem apenas como SQL cru dentro das migrations — o código Python em `app/services/` que as consulta (fora do escopo desta seção) provavelmente usa `text()`/SQL cru ou `Table` reflection, não o ORM declarativo. Isso também significa que `alembic revision --autogenerate` só detectaria mudanças relacionadas a `fonte_dados`; qualquer alteração nas outras tabelas precisa ser escrita manualmente como uma nova migration com SQL cru.
- **`barreira_colaborativa` é uma "versão mínima" por design**: o próprio código documenta que falta coluna de autoria (usuário), foto e histórico de eventos de moderação, deixados para um plano futuro ("Plano 6") não coberto pelo código atual.
- **Nenhum endpoint de escrita para barreiras colaborativas** foi encontrado entre os 3 routers lidos nesta seção — o fluxo de cadastro/moderação de `barreira_colaborativa` (se existir) está em código não coberto por esta seção, ou ainda não implementado.
- **`GET /api/fontes` não trata falha de banco**: diferente de `/health`, não há `try/except` — uma falha de conexão vira um 500 não estruturado (comportamento padrão do FastAPI para exceção não tratada), não documentado explicitamente em teste desta rota.
- **O `SELECT 1` em `/health` é redundante**: roda antes da consulta real a `etl_execucao` dentro do mesmo bloco `try`, e seu resultado é descartado — qualquer falha de conexão já seria pega pela segunda consulta.
- **`area_piloto` não tem índice espacial**: diferente das outras 5 tabelas com geometria de `002_fontes_oficiais.py`, nenhuma migration cria um índice `GIST` sobre `area_piloto.geom` — consistente com a tabela ter só 3 linhas fixas, mas é uma assimetria que vale notar para quem for ler o esquema esperando o mesmo padrão em toda tabela geométrica.


## 3. Backend: serviços de roteamento

### Visão geral

Esta é a parte mais densa do backend: o conjunto de módulos em `backend/app/services/` que transforma um par de coordenadas (origem, destino) numa rota a pé acessível, com passos, avisos e proveniência dos dados. Nenhum desses módulos é chamado diretamente por outro código do projeto além do router `POST /api/rotas` (`backend/app/routers/rotas.py`), que é uma casca fina: valida a entrada com Pydantic (`RotaIn`) e delega tudo para `app.services.rota.calcular`.

A ideia central do desenho é **dois motores de roteamento com um fallback determinístico entre eles**:

1. **ORS (OpenRouteService)**, perfil `wheelchair` — um serviço externo que já sabe calcular rotas respeitando inclinação, degraus e largura mínima, mas que tem cota diária/por minuto e pode simplesmente não devolver rota.
2. **pgRouting**, rodando dentro do próprio Postgres (extensão `pgr_dijkstra`) sobre a malha de vias que o ETL já carregou — sempre disponível, sem cota, mas sem inteligência de acessibilidade além do que o ETL já "queimou" no custo de cada aresta.

Por cima dos dois, há uma camada de geometria (`barreira_geom.py`) que decide quais barreiras (buracos, degraus, obstáculos denunciados) devem ser fisicamente evitadas pelo ORS, uma camada de enriquecimento (`enriquecimento.py`) que completa cada passo da rota com largura de calçada, declividade e guias rebaixadas vindas do GeoSampa/OSM, e um cache espacial (`cache_rota.py`) para não recalcular a mesma rota o tempo todo.

```mermaid
flowchart TB
    A["rota.calcular()"] --> B["ors_client.py\n(OrsClient / OrsFixtureClient)"]
    A --> C["pgrouting.py\n(fallback determinístico)"]
    A --> D["barreira_geom.py\n(corredor, avoid_polygons)"]
    A --> E["cache_rota.py\n(chave, TTL, invalidação)"]
    B --> F["enriquecimento.py\nenriquecer_passos()"]
    C --> F
    D --> F
    F --> G["RotaOut (schemas/rota.py)"]
```

### `app/services/ors_client.py` — cliente do OpenRouteService

Este arquivo isola completamente a integração com o ORS: é o único lugar do backend que sabe montar a requisição HTTP, ler os headers de cota e traduzir códigos de erro da API externa para erros de domínio. Ele expõe três peças usadas pelo resto do sistema: a interface `OrsClient` (chamadas reais), `OrsFixtureClient` (substituto que lê arquivos JSON gravados em disco, sem rede) e a fábrica `criar_cliente`.

**`EstadoCota`** (dataclass, linhas 33-42) é um objeto **mutável e compartilhado**: guarda `restante`, `reset_em` e `atualizado_em`. Ele não é recriado a cada requisição — é injetado uma única vez no `OrsClient` do processo (criado em `main.create_app` e guardado em `app.state.cliente_ors`; ver `obter_cliente_ors` em `routers/rotas.py`) e atualizado a cada resposta do ORS. O endpoint `/health` lê esse mesmo objeto para expor `ors_cota_restante`/`ors_cota_reset` (e também `modo_fixtures`, checando `isinstance(cliente_ors, OrsFixtureClient)`). Se cada requisição criasse um `OrsClient` novo, a cota "observada" nunca acumularia — por isso o comentário no router insiste que precisa ser "o mesmo objeto em toda requisição".

**`OrsErro`** (linhas 45-53) é uma `Exception` com um atributo `codigo` estável de domínio — `sem_rota`, `cota_diaria`, `cota_minuto`, `entrada_invalida` ou `indisponivel` — em vez de deixar vazar status HTTP ou códigos de erro específicos do ORS pelo resto do backend. Isso é o que permite ao `rota.py` decidir, sem saber nada de HTTP, se deve tentar o próximo nível de exigência ou desistir do ORS.

**`OrsClient.rota()`** (linhas 65-126) monta o corpo da requisição POST para `{base_url}/v2/directions/wheelchair/geojson`:

```python
corpo = {
    "coordinates": [[lng, lat] for lng, lat in coords],
    "elevation": True,
    "instructions": True,
    "language": "pt",
    "extra_info": ["steepness", "surface", "waytype"],
    "units": "m",
    "options": opcoes,
}
```

`opcoes` é montado condicionalmente: `profile_params.restrictions` sempre vai (vem de `_restricoes()` em `rota.py` — `maximum_incline`, `maximum_sloped_kerb`, `minimum_width`, mais `surface_type`/`smoothness_type` fixos), `avoid_features: ["steps"]` só entra se `evitar_degraus` for `True`, e `avoid_polygons` só entra se não for `None` (é aqui que os polígonos de barreiras intransponíveis calculados por `barreira_geom.py` chegam ao ORS). O uso de **POST em vez de GET** é deliberado — está no docstring do módulo: a API do ORS exige POST para corpos com `options` desse tamanho.

Depois de cada chamada (sucesso ou erro HTTP), `_atualizar_cota()` (linhas 128-135) lê os headers `x-ratelimit-remaining`/`x-ratelimit-reset` e atualiza o `EstadoCota` compartilhado — isso acontece **antes** de decidir o que fazer com o status code, então mesmo uma resposta de erro atualiza a cota observada.

O mapeamento de erros (linhas 113-126) é uma cadeia de `if` sobre o `status_code`:

| Status HTTP | Condição extra | `OrsErro.codigo` |
|---|---|---|
| 200 | — | (sucesso, devolve o JSON) |
| 403 | — | `cota_diaria` |
| 429 | — | `cota_minuto` |
| 404 | `error.code` do corpo é 2009 ou 2010 | `sem_rota` |
| 404 | qualquer outro código | `indisponivel` |
| 400 ou 406 | — | `entrada_invalida` |
| qualquer outro | — | `indisponivel` |
| timeout / erro de rede (`httpx.TimeoutException`, `httpx.HTTPError`) | — | `indisponivel` |

Os códigos 2009/2010 são lidos por `_codigo_erro_ors()` (linhas 138-148), uma função defensiva que tenta fazer `resposta.json()` e navega no dicionário `{"error": {"code": ...}}` devolvendo `None` em qualquer formato inesperado (corpo não é JSON, não é dict, não tem `error`) — nunca lança exceção por conta própria, só devolve `None`, que cai no ramo `indisponivel`.

**`OrsFixtureClient`** (linhas 151-195) herda de `OrsClient` e sobrescreve `rota()` para nunca tocar a rede. A escolha do arquivo de fixture usa `_nome_fixture()` (linhas 198-203), que arredonda lat/lng de origem e destino a 5 casas decimais e monta o nome `<lat_o>_<lng_o>_<lat_d>_<lng_d>_<inclinacao>.json`. Se esse arquivo exato não existir no diretório de fixtures, cai para `generica.json` **transladada** por `_traduzir_feature_collection()` (linhas 206-221): soma um delta de `(lng, lat)` a todos os pontos da geometria da primeira feature, para que o primeiro ponto coincida com a origem pedida — preservando a forma (distâncias relativas) da rota sintética, mas "movendo" ela para qualquer par de coordenadas do piloto. A elevação (3ª coordenada de cada ponto, quando existe) não é alterada nessa translação (`*ponto[2:]` no final da list comprehension). Se o conteúdo da fixture tiver a chave `erro_codigo`, o cliente levanta `OrsErro(codigo_erro)` em vez de devolver a resposta — assim é possível simular falhas do ORS (cota, sem rota etc.) só escrevendo um JSON de fixture com esse campo.

**`criar_cliente(settings)`** (linhas 224-239) é a fábrica única: devolve `OrsFixtureClient` se `settings.use_fixtures` for `True` **ou** se `ors_api_key` estiver vazia; caso contrário devolve o `OrsClient` real. Isso significa que rodar o backend sem configurar `ORS_API_KEY` cai automaticamente em modo fixture, sem erro — decisão de design que permite rodar o projeto localmente/em CI sem segredo nenhum.

### `app/services/barreira_geom.py` — geometria de barreiras

Este módulo resolve um problema puramente geométrico: dado o traçado de uma rota, quais barreiras cadastradas (oficiais do SP156 ou reportadas pela comunidade) estão perto o bastante para importar, e quais delas devem virar polígonos que o ORS é instruído a **evitar fisicamente** (`avoid_polygons`).

O docstring do módulo explica uma decisão de engenharia importante e não óbvia: **todo cálculo métrico (buffer, distância, área) roda em EPSG:31983 com Shapely em Python, nunca com `ST_Buffer` no Postgres**. EPSG:4326 é o sistema de coordenadas geográfico (lat/lng em graus, o "padrão GPS") — não é métrico, então buffers e distâncias nele não têm unidade física direta. EPSG:31983 é SIRGAS 2000 / UTM zona 23S, um sistema **projetado** cujas unidades são metros, adequado para São Paulo. A conversão entre os dois é feita com `pyproj.Transformer` (linhas 45-46, `PROJ_4326_31983`/`PROJ_31983_4326`, ambos criados uma vez no nível do módulo) e as funções auxiliares `_para_31983`/`_para_4326` (linhas 72-77), que usam `shapely.ops.transform` para aplicar a reprojeção a qualquer geometria Shapely.

O motivo de evitar `ST_Buffer`/`ST_Intersection`/`ST_Difference` no banco é um **bug de robustez do GEOS 3.9.0** (a versão empacotada na imagem `pgrouting/pgrouting:latest`, usada tanto no `docker-compose.yml` local quanto no `.github/workflows/ci.yml`), documentado também em `etl/etl/conflacao.py`: essas operações podem devolver geometria vazia entre `LineString` e `Polygon`/`MultiPolygon` mesmo quando uma geometria claramente contém a outra. Por isso `barreiras_no_corredor` usa **só `ST_Intersects`** (um predicado booleano, que funciona corretamente nessa instância) para filtrar candidatas, e todo buffer real é calculado depois, em Python/Shapely.

**`corredor(linha_4326, largura_m=50.0)`** (linhas 80-85) transforma a linha para 31983, aplica `.buffer(largura_m)` (um retângulo arredondado ao redor de toda a linha, `largura_m` metros para cada lado) e devolve o resultado de volta em 4326. É usado tanto para o corredor *provisório* (reta origem→destino, para a chave de cache antes de saber a rota real) quanto para o corredor *real* (a geometria devolvida pelo ORS ou pgRouting), sempre com o mesmo valor padrão de 50 m.

**`barreiras_no_corredor(db, corredor_4326)`** (linhas 129-156) executa a query `_SQL_CANDIDATOS` (uma `UNION ALL` entre `barreira_colaborativa` e `barreira_oficial`, linhas 88-126) e mapeia cada linha para um `BarreiraCandidata` (dataclass, linhas 56-69). A regra de severidade efetiva — citada no topo do docstring do módulo e replicada na query SQL via `CASE` — é a parte mais delicada do domínio:

| Origem | Condição para `intransponivel` (bloqueia, vira `avoid_polygons`) | Condição para `dificulta` (vira aviso) | Caso contrário |
|---|---|---|---|
| `barreira_colaborativa` | `status='validada'` E `confirmacoes >= 2` E `severidade='intransponivel'` | `status='validada'` E `severidade='dificulta'` | descartada (`NULL`, fora do `WHERE severidade_efetiva IS NOT NULL`) |
| `barreira_oficial` | `categoria` em (`obstaculo_calcada`, `guia_sem_rebaixamento`, `buraco`) E `data_abertura >= hoje - 180 dias` E `data_finalizacao IS NULL` | `categoria` **fora** dessas três | uma das três categorias, mas já expirada (>180 dias ou finalizada) — some, "problema presumidamente resolvido" |

Note que uma barreira colaborativa não validada, ou validada mas com menos de 2 confirmações e severidade `intransponivel`, simplesmente não entra em nada — nem bloqueia nem vira aviso. Isso evita que uma única denúncia não verificada trave o roteamento de todo mundo.

**`poligonos_para_evitar(barreiras, linha_4326, teto=15, buffer_m=8.0)`** (linhas 159-209) filtra só as `intransponivel`, ordena por distância até a linha da rota (`_distancia_a_linha`, linhas 183-185, também calculada em 31983) e mantém as `teto` mais próximas — o ORS aceita um número máximo de polígonos por requisição, então o excesso é descartado por decisão do spec. Cada barreira vira um círculo (`Point(...).buffer(8.0)`) em metros. Depois, um laço `while` (linhas 194-200) une todos os buffers com `unary_union` e checa dois limites de forma exigidos pelo `avoid_polygons` do ORS — área máxima de 200 km² e extensão (diagonal do bounding box) máxima de 20 km — removendo a barreira mais distante da lista a cada iteração até caber dentro dos dois limites (ou esvaziar a lista, caso degenerado em que a função devolve `None`). O resultado final é convertido para GeoJSON com `shapely.geometry.mapping`, sempre como `MultiPolygon` mesmo que sobre um único polígono.

**`hash_barreiras(db, corredor_4326)`** (linhas 222-238) não reclassifica severidade — só soma `count(*)` de colaborativas e oficiais dentro do corredor mais o `max(atualizado_em)` das colaborativas, concatena numa string e tira um SHA-256. Esse hash entra na chave de cache (`cache_rota.chave`): se qualquer barreira no corredor mudar (nova denúncia, validação, expiração por prazo), o hash muda e o cache antigo simplesmente não bate mais — não precisa de invalidação ativa para esse caso (a invalidação ativa, `cache_rota.invalidar_regiao`, cobre outro cenário: apagar entradas já gravadas quando uma barreira é validada).

### `app/services/pgrouting.py` — fallback determinístico

Módulo usado quando o ORS não devolve rota acessível em nenhum nível de exigência, ou quando a cota estourou. Roda inteiramente dentro do Postgres via a extensão `pgr_dijkstra` (pgRouting 3.7.3), sobre a tabela `via_pedestre` que o ETL já populou com colunas `custo_acessivel`/`custo_reverso` — o mesmo ETL (`etl/etl/osm.py`, `etl/etl/osm_regras.py::fator_custo`) já atribui um custo de `BLOQUEIO = 1_000_000.0` (replicado aqui na linha 38) a qualquer aresta com `highway=steps` ou `wheelchair=no`.

Um detalhe crítico explicado no docstring do módulo: o `pgr_dijkstra` ainda pode **incluir** uma aresta bloqueada no caminho encontrado, porque o custo é alto, não infinito — não existe nenhuma proteção matemática que garanta que o caminho de menor custo total nunca passe por uma aresta de custo `1e6`, especialmente se não houver alternativa. Por isso `rota_pgrouting` sempre confere o custo de cada passo do caminho devolvido e **descarta a rota inteira** (devolve `None`) se algum for `>= BLOQUEIO` (linha 153-154) — do contrário o sistema afirmaria "rota acessível" atravessando uma escada.

Outro ponto de engenharia citado no docstring: o SQL passado como primeiro argumento textual de `pgr_dijkstra` é uma **string interna** executada pela própria extensão dentro do Postgres — parâmetros ligados do SQLAlchemy (`:nome`) não atravessam essa borda (o SQLAlchemy tentaria resolvê-los antes mesmo de chegar ao Postgres). Por isso `_sql_dijkstra()` (linhas 97-114) interpola bbox e ids de nó **diretamente na string** com f-strings e `!r`. O comentário justifica que isso é seguro porque nenhum desses valores é texto vindo do usuário: são `float`/`int` já validados pelos schemas Pydantic (`Coordenada`) ou ids de `no_pedestre` obtidos de outra query — nunca uma string arbitrária. Vale notar que essa garantia depende inteiramente da validação Pydantic continuar acontecendo antes; não há nenhuma sanitização adicional dentro do próprio módulo `pgrouting.py`.

**`no_mais_proximo(db, lat, lng, raio_m=300.0)`** (linhas 89-94) roda `_SQL_NO_MAIS_PROXIMO` (linhas 72-86), que usa `ST_DWithin` (filtra por distância, em 31983) combinado com o operador `<->` (distância KNN, usado no `ORDER BY` para aproveitar índice espacial) para achar o nó de `no_pedestre` mais próximo dentro do raio. Devolve `None` se não há nenhum — o caso de origem/destino fora da área piloto (por exemplo, fora de Vila Mariana/Lapa/Ipiranga, os bairros cobertos pelo ETL).

**`rota_pgrouting(db, origem, destino, bbox_margem_m=1500.0)`** (linhas 117-177) é a função principal do fallback. Primeiro resolve os nós mais próximos de origem e destino; devolve `None` se algum não existir ou se coincidirem (rota degenerada). Depois monta uma bounding box ao redor dos dois pontos, expandida por `bbox_margem_m` convertido para graus via a constante aproximada `_GRAUS_POR_METRO = 0.00001` (≈0,0001° por 10 m na latitude de São Paulo — uma aproximação grosseira, não uma conversão geodésica exata, mas suficiente porque serve só para limitar o espaço de busca do Dijkstra, não para medir nada com precisão). O SQL final faz `pgr_dijkstra` restrito por essa bbox (`geom && ST_MakeEnvelope(...)`, o operador `&&` de interseção de bounding boxes) e junta (`LEFT JOIN`) com `via_pedestre` para trazer geometria, nome e flags de cada aresta do caminho.

Depois de validar que o caminho chegou ao nó de destino (`linhas[-1]["node"] != no_destino` → `None`) e que nenhuma aresta está bloqueada, a função reconstrói a geometria completa concatenando os trechos de cada aresta na ordem certa — invertendo a lista de coordenadas quando a aresta está "de costas" em relação ao sentido do caminho (`if linha["source"] != linha["node"]: coords = reversed(...)`), e evitando duplicar o ponto de junção entre arestas consecutivas. Devolve um `RotaBruta` (dataclass, linhas 44-53) com a geometria já orientada origem→destino, a lista de ids de arestas percorridas e a distância real (soma de `comprimento_m`, não do custo penalizado — o custo pode ser inflado por outros fatores do ETL além de metros).

**`instrucoes(db, rota_bruta)`** (linhas 225-318) converte a lista de arestas em passos legíveis (`PassoBruto`, dataclass linhas 56-69, com `ordem`, `instrucao`, `distancia_m`, `direcao`, `geometria`, `is_degrau`, `kerb_transponivel`, `arestas`), **sem nenhuma heurística de IA generativa** — regra dura do projeto citada explicitamente no docstring. A lógica agrupa arestas consecutivas em "trechos" (`grupos`) quebrando sempre que o nome da via muda **ou** o rumo (ângulo, calculado por `_rumo_graus`, linhas 196-201, com `atan2`) varia mais de 30° entre uma aresta e a seguinte (`_diferenca_angular`/`_direcao_da_virada`, linhas 204-214). Um comentário no código (linhas 237-246) documenta uma correção de bug real: a orientação da primeira aresta (saber se a rota "entra" nela pelo `source` ou pelo `target`) precisa ser decidida comparando com o primeiro ponto da geometria já orientada de `rota_bruta` — código antigo assumia cegamente `no_atual = source` quando o caminho tinha uma única aresta, o que dava direção errada. `_instrucao()` (linhas 217-222) gera texto fixo tipo `"Siga por {via}"` ou `"Vire à direita e siga por {via}"`, usando `"a via"` como nome genérico quando `nome` é `None`.

### `app/services/enriquecimento.py` — enriquecer_passos

Este módulo resolve um problema de **conflação**: dado um passo bruto de qualquer um dos dois motores (ORS ou pgRouting), completar com largura de calçada, declividade, transponibilidade de guia e barreiras próximas — dados que **nenhum dos dois motores conhece**, porque vêm de fontes municipais (GeoSampa) e do OSM já processadas pelo ETL.

O ponto mais importante do docstring do módulo (linhas 12-20): mesmo que `PassoBruto` já traga `is_degrau`/`kerb_transponivel` preenchidos (caso do pgRouting, que lê direto de `via_pedestre`), a função **sempre** busca de novo a `via_pedestre` mais próxima (≤10 m em EPSG:31983) do ponto médio de cada passo, e usa essa leitura fresca como fonte da verdade. Os campos de `PassoBruto` só entram como reserva quando nenhuma via é encontrada a 10 m — isto é, quando a rota passa por um trecho sem malha OSM correspondente (comum em rotas do ORS, que não conhecem `via_pedestre` nenhuma, só uma geometria). Essa escolha unifica o tratamento dos dois motores no mesmo código, em vez de ramificar toda a função em "se veio do ORS" / "se veio do pgRouting".

`_via_mais_proxima()` (linhas 118-127) roda `_SQL_VIA_MAIS_PROXIMA` (linhas 89-104), com o mesmo padrão `ST_DWithin` + `<->` já visto em `pgrouting.py`, com `_RAIO_VIA_M = 10.0`. Se achar uma via, `_conflacao_da_via()` (linhas 130-132) busca em `conflacao_via_calcada` a calçada já casada pelo ETL com aquela via (`_SQL_CONFLACAO`, linhas 106-115).

A **regra inegociável** do módulo (documentada em destaque no docstring, linhas 22-27, e reforçada num comentário inline nas linhas 200-201): a coluna gerada `calcada_sp.largura_medida` distingue "não medido" de "medido como zero" — zero no GeoSampa é **ausência de medição**, nunca "calçada de largura zero". Por isso:

```python
largura_medida = bool(conflacao["largura_medida"])
# regra inegociável: largura_medida=False ⇒ largura_m=None,
# mesmo que largura_min_m valha 0 (GeoSampa: zero é ausência).
largura_m = float(conflacao["largura_min_m"]) if largura_medida else None
```

A mesma regra se repete para `declividade_medida`/`declividade_max_pct`.

`conflacao` (e portanto largura/declividade `None`) acontece em **dois** cenários distintos, não só um: (1) nenhuma `via_pedestre` a 10 m do ponto médio do passo (`via is None`) — nesse caso `is_degrau`/`kerb_transponivel` também caem para o valor de reserva vindo do `PassoBruto`; ou (2) uma `via_pedestre` **foi** encontrada, mas ela não tem calçada conflada correspondente em `conflacao_via_calcada` (`_conflacao_da_via` não encontra linha) — nesse segundo caso `is_degrau`/`kerb_transponivel` continuam vindo normalmente da via encontrada no OSM, só largura/declividade do GeoSampa é que ficam ausentes. Em ambos os casos um único aviso `trecho_sem_dados` é emitido **uma vez por rota** (controlado pela flag local `aviso_sem_dados_emitido`), não um por passo — evitaria inundar o usuário com avisos repetidos numa rota longa sem cobertura GeoSampa.

Para declividade, há uma segunda fonte possível: `extras_steepness`, uma lista alinhada por índice com `passos_brutos`, que `rota.py` já resolveu a partir de `properties.extras.steepness.values` do ORS (só existe quando o motor é o ORS). Quando presente para aquele passo, **sobrepõe** o valor do GeoSampa — o comentário justifica que o ORS mede elevação real via SRTM ao longo de toda a rota, enquanto o GeoSampa é um diagnóstico estático de 2021 que só existe onde houve conflação. A tabela `_PCT_POR_CLASSE_STEEPNESS` (linhas 72-79) converte a classe de steepness do ORS (-5 a 5, documentação oficial do ORS citada no comentário) num percentual representativo:

| Classe (magnitude) | Faixa real do ORS | `declividade_pct` usado |
|---|---|---|
| 0 | 0–<1% | 0.0 |
| 1 | 1–<4% | 3.0 |
| 2 | 4–<7% | 6.0 |
| 3 | 7–<10% | 10.0 |
| 4 | 10–<16% | 15.0 |
| 5 | ≥16% (sem teto) | 20.0 |

Os valores escolhidos (3, 6, 10) não são o limite literal de cada faixa: foram alinhados de propósito aos próprios limiares de `PerfilAcessibilidade.inclinacao_max` (`Literal[3, 6, 10, "any"]`, ver `app/schemas/rota.py`), para o frontend poder comparar `declividade_pct` de um passo direto contra o nível pedido/atendido sem reabrir a tabela de faixas do ORS.

`enriquecer_passos(db, passos_brutos, barreiras_dificulta, extras_steepness)` devolve `(passos, avisos, fontes)` — a lista de `Passo` prontos para `RotaOut`, os `Aviso` levantados (`trecho_sem_dados` e `barreira_dificulta`, um por barreira `dificulta` a ≤15 m — `_RAIO_BARREIRA_M`) e o conjunto de chaves de `fonte_dados` realmente usadas (para o rodapé de proveniência no frontend). Barreiras `intransponivel` são explicitamente ignoradas aqui (`if barreira.severidade != "dificulta": continue`) porque já viraram `avoid_polygons` antes — não fazem sentido como aviso, já foram fisicamente evitadas. `duracao_s` de cada `Passo` sai sempre como `0.0` — nenhum dos dois motores calcula a duração certa para o perfil pedido, então `rota.py` recalcula depois com a `velocidade_kmh` do perfil.

### `app/services/rota.py` — calcular(): a orquestração

`calcular(db, entrada, cliente, agora)` é a função de mais alto nível, chamada diretamente pelo router. O parâmetro `agora` é passado explicitamente (não lido de `datetime.now()` internamente) para manter a função testável sem depender do relógio real — o mesmo padrão aparece em `cache_rota.obter`/`guardar`.

**Passo 1 — cache.** Calcula um corredor **provisório** (buffer de 50 m em cima da reta origem→destino — ainda não se sabe a geometria real da rota, então usa a aproximação mais simples possível) e o hash de barreiras nesse corredor provisório. A chave de cache (`cache_rota.chave`) combina isso com origem/destino arredondados e o perfil pedido. Se houver uma entrada de cache válida, devolve na hora, sem tocar ORS nem pgRouting.

**Passo 2 — fallback progressivo por nível de exigência.** `NIVEIS_ORDENADOS = (3, 6, 10, "any")` (linha 54) é a ordem fixa dos valores possíveis de `maximum_incline`. `_niveis_a_partir(pedido)` (linhas 109-111) corta essa tupla a partir do valor pedido pelo usuário — se o perfil pede inclinação máxima 6%, tenta 6, depois 10, depois `any` (nunca volta a tentar 3%, que seria mais restritivo que o pedido). Para cada nível, `_tentar_nivel()` (linhas 133-187) faz **até duas passadas** no ORS:

1. 1ª passada: chama `cliente.rota(...)` sem `avoid_polygons`. Se o ORS levantar `OrsErro("sem_rota")`, a função devolve `None` (sinal para `calcular()` tentar o próximo nível). Qualquer outro `OrsErro` vira `_OrsIndisponivel` (exceção interna só deste módulo), que sai do laço de níveis inteiro e vai direto para o pgRouting — cota ou indisponibilidade não é "tente o próximo nível", é "abandone o ORS agora".
2. Com a resposta da 1ª passada, calcula o corredor real (agora em cima da geometria devolvida), busca barreiras nesse corredor e chama `poligonos_para_evitar`. Se não há nenhuma barreira intransponível para evitar (`poligonos is None`), a 1ª passada já é o resultado final desse nível.
3. Se há polígonos a evitar, faz uma **2ª passada** repetindo a chamada com `avoid_polygons=poligonos` — pedindo ao ORS para recalcular desviando fisicamente das barreiras. O resultado dessa 2ª passada (ou `None`/`_OrsIndisponivel`, mesmas regras) é o que vale.

O laço principal em `calcular()` (linhas 294-303) para assim que algum nível devolve um `_ResultadoOrs` não nulo, ou assim que `_OrsIndisponivel` é levantado (guarda o motivo em `erro_ors_motivo` e sai do laço via `break`).

**Passo 3 — fallback pgRouting.** Se nenhum nível do ORS deu resultado (`resultado_ors is None`), chama `rota_pgrouting`. Se isso também devolver `None`, levanta `RotaNaoEncontrada(erro_ors=erro_ors_motivo)` — essa exceção carrega o `OrsErro` original (se houver) para o router decidir entre 404 ("nenhum motor acha rota mesmo entre esses pontos") e 503 ("o ORS caiu e o pgRouting também não achou nada nessa dupla específica de pontos", ver `rotas.py` linhas 46-52). Quando o pgRouting **funciona**, o `nivel_atendido` é forçado para `"any"` — comentário explícito (linhas 326-328, seguido pela atribuição na linha 329) explica que o custo do pgRouting é binário (acessível/bloqueado, já decidido estaticamente pelo ETL), então não há como afirmar honestamente que um nível numérico específico (3/6/10) foi respeitado.

**Passo 4 — passos brutos do ORS.** Quando o ORS deu certo, `_passos_brutos_do_ors()` (linhas 198-235) converte cada `step` de cada `segment` da resposta GeoJSON do ORS num `PassoBruto` — o mesmo dataclass usado pelo pgRouting, o que é o que permite `enriquecer_passos` tratar os dois motores de forma unificada. Passos degenerados (`way_points` com início igual a fim, como o "chegou ao destino" final, ou cujo trecho de geometria resultante tem menos de 2 pontos) são descartados. `_direcao_do_tipo_ors()` (linhas 190-195) mapeia os códigos numéricos de `step.type` do ORS/GraphHopper para `vire_esquerda`/`vire_direita`/`siga`, usando conjuntos fixos (`_TIPOS_ESQUERDA = {0,2,4,12}`, `_TIPOS_DIREITA = {1,3,5,13}`) — de novo, sem heurística de IA, só uma tabela. `_extras_steepness_do_ors()` (linhas 238-259) casa cada passo com a classe de steepness dominante do `extra_info` do ORS, escolhendo a faixa de `extras.steepness.values` com maior sobreposição de índices com a faixa `(inicio, fim)` do passo.

**Passo 5 — avisos e finalização.** Depois de `enriquecer_passos`, `calcular()` acrescenta dois avisos condicionais: `exigencia_relaxada` se `nivel_atendido != pedido` (mensagem muda dependendo se caiu para `"any"` ou para um nível numérico intermediário, via `_mensagem_exigencia_relaxada`), e `motor_fallback` se `motor == "pgrouting"`. A duração de cada passo é recalculada com `velocidade_ms = perfil.velocidade_kmh * 1000/3600` e `passo.distancia_m / velocidade_ms` — usando `model_copy(update=...)` do Pydantic em vez de mutar o objeto original. `motor` no `RotaOut` final é `"ors"`, `"fixture"` (quando o cliente é `OrsFixtureClient` — distinção só para depuração/telemetria, ambos os casos vieram "do ORS" logicamente) ou `"pgrouting"`.

**Passo 6 — grava cache.** `cache_rota.guardar` é chamado antes do `return`, usando o `corredor_final` (a geometria real da rota vencedora, não mais o corredor provisório) como `regiao` — é essa região que permite invalidação espacial depois.

### `app/services/cache_rota.py` — cache espacial

Cache anônimo (nenhuma referência a usuário) sobre a tabela `rota_cache` no PostGIS, com TTL de 6 horas e invalidação por proximidade geométrica. Nenhuma função aqui faz `commit()` — como o resto dos serviços do projeto, quem decide persistir (ou dar rollback, em teste) é quem segura a `Session` (o router, no caso de produção).

**`chave(entrada, hash_barreiras)`** (linhas 28-38) monta um dicionário com origem/destino arredondados a 5 casas, o perfil inteiro serializado (`model_dump(mode="json")`) e o `hash_barreiras` recebido de fora, serializa com `json.dumps(..., sort_keys=True)` (chaves ordenadas para determinismo) e tira SHA-256. Arredondar a 5 casas decimais (~1,1 m de precisão em latitude) significa que cliques de mapa muito próximos caem na mesma chave — reduz a cardinalidade do cache sem perder relevância prática para uma rota a pé.

**`obter(db, chave_cache, agora)`** (linhas 44-55) busca por `chave` e compara `expira_em` contra `agora` (não `now()` do banco — mesma razão de testabilidade já citada). Se válido, reconstrói o `RotaOut` a partir do JSON salvo (`RotaOut.model_validate`) e devolve uma cópia com `cache=True` — a linha salva no banco continua com `cache=False`, é sempre a leitura que marca o `True`.

**`guardar(db, chave_cache, saida, regiao, agora, ttl_horas=6.0)`** (linhas 73-97) faz um `INSERT ... ON CONFLICT (chave) DO UPDATE` — se a mesma chave já existir (corrida entre duas requisições simultâneas, ou uma chave que expirou e está sendo recalculada), sobrescreve em vez de duplicar ou falhar. `regiao` vira uma coluna geométrica (`ST_GeomFromText`) usada **só para invalidação espacial**, nunca lida de volta pela aplicação.

**`invalidar_regiao(db, ponto_4326)`** (linhas 105-110) apaga toda entrada cuja `regiao` contém um ponto dado, via `ST_Intersects(regiao, ST_SetSRID(ST_MakePoint(...), 4326))`. É chamada pelo fluxo de validação de barreiras (fora do escopo desta seção) quando uma barreira nova é confirmada perto de rotas já cacheadas, forçando-as a serem recalculadas na próxima consulta em vez de esperar o TTL de 6h vencer.

### `app/fixtures/` — fixtures do ORS

Os arquivos JSON de fixture do ORS ficam em `backend/app/fixtures/ors/` (subdiretório `ors/`, apontado por `DIRETORIO_FIXTURES_PADRAO` em `ors_client.py`); o `README.md` de referência fica um nível acima, em `backend/app/fixtures/README.md`. Esses arquivos são usados por `OrsFixtureClient` sempre que `USE_FIXTURES=true` no `.env` ou quando `ORS_API_KEY` não está configurada — o modo padrão para desenvolvimento local e CI, sem depender de rede nem de segredo algum.

| Arquivo | Natureza |
|---|---|
| `generica.json` | **Sintética** — escrita à mão para reproduzir fielmente a estrutura documentada da resposta do ORS (`FeatureCollection` com `features[0].properties.segments[].steps[]`, `properties.extras.steepness/surface/waytype`, `properties.summary`, `geometry.coordinates` 3D com elevação), mas **nunca veio de uma chamada real** — o README documenta que, no momento em que foi escrita, não havia `ORS_API_KEY` configurada. Serve de fallback para qualquer par origem/destino sem fixture própria (via a translação de `_traduzir_feature_collection`). |
| `-23.57131_-46.63984_-23.57596_-46.63793_6.json`, `-23.59039_-46.64337_-23.60275_-46.64465_6.json`, `-23.59737_-46.63991_-23.58407_-46.64061_6.json`, `-23.60053_-46.62453_-23.60292_-46.62607_6.json` | **Reais** — segundo o README (atualizado em 14/09/2026), foram gravadas com `scripts/gravar_fixtures_ors.py` usando uma chave real do ORS, perfil `wheelchair`, sem segredo nenhum embutido no conteúdo. |

O `README.md` (`backend/app/fixtures/README.md`) é o documento de referência que registra essa distinção sintética/real — importante porque uma fixture sintética garante só que o *parsing* do código funciona com a forma esperada da resposta, não que a integração real com a API do ORS de fato funciona daquele jeito.

### `backend/scripts/gravar_fixtures_ors.py`

Script utilitário (não faz parte do runtime do backend, roda manualmente) para regravar fixtures reais. Fluxo: verifica `settings.ors_api_key` (aborta com uma mensagem se vazia, sem nunca imprimir a chave); carrega casos de `backend/tests/casos_referencia.json` se existir (só os 4 primeiros, `casos[:4]` — "poucas requisições"), senão usa `CASOS_PADRAO`, dois pares de coordenadas de Vila Mariana embutidos no próprio script; para cada caso, chama `OrsClient.rota()` de verdade (um `OrsClient` "cru", não o `OrsFixtureClient`) com `inclinacao_max` do caso (padrão 6) e `evitar_degraus=True`; grava a resposta em `<DIRETORIO_FIXTURES>/<nome_fixture>.json`, usando a mesma função `_nome_fixture()` do `ors_client.py` (importada diretamente, garantindo que o nome do arquivo bate exatamente com o que `OrsFixtureClient` vai procurar depois) — dessa forma, uma fixture recém-gravada passa a ser servida automaticamente na próxima vez que `USE_FIXTURES=true` for usado, sem nenhuma outra configuração. Entre chamadas (exceto após a última), dorme `PAUSA_ENTRE_CHAMADAS_S = 2.0` segundos, respeitando a cota de 40 requisições/minuto do ORS documentada em `ors_client.py` (na mensagem de erro `cota_minuto`).

### `backend/tests/casos_referencia.json`

Arquivo de 13 casos de teste manuais/de referência (não um arquivo de fixtures do ORS). É consumido, de forma confirmável no código, por três lugares: o script acima (`scripts/gravar_fixtures_ors.py`), e dois arquivos de teste que leem o JSON diretamente — `backend/tests/services/test_rota.py` (funções `test_casos_referencia_cumprem_espera_com_pgrouting_real` e `test_casos_referencia_calculam_rota_com_fixtures_do_ors`) e `backend/tests/test_rotas_api.py`. Cada entrada tem `nome`, `origem`/`destino` (lat/lng), `recorte` (bairro do piloto: Vila Mariana, Lapa, Ipiranga), um bloco `espera` com expectativas de validação manual (`sem_degraus`, `distancia_max_m`, `evita_barreira_id`) e `verificado_streetview: false` — indicando que essas expectativas ainda não foram confirmadas visualmente contra o Street View, uma verificação manual pendente. O último caso (`vila_mariana_regressao_poi_wheelchair_no`) traz também um campo `observacao` documentando um teste de regressão específico do spec (seção 6): um POI OSM `wheelchair=no` perto da calçada não deve, por si só, bloquear a rota nem virar aviso.

### Sequência completa: `POST /api/rotas`

```mermaid
sequenceDiagram
    participant C as Cliente (frontend)
    participant R as router (rotas.py)
    participant S as rota.calcular()
    participant Cache as cache_rota.py
    participant BG as barreira_geom.py
    participant ORS as ors_client.py
    participant PGR as pgrouting.py
    participant Enr as enriquecimento.py
    participant DB as Postgres/PostGIS

    C->>R: POST /api/rotas {origem, destino, perfil}
    R->>S: calcular(db, entrada, cliente, agora)
    S->>BG: corredor(reta origem→destino, 50m)
    S->>BG: hash_barreiras(corredor provisório)
    BG->>DB: SELECT count/max sobre barreiras (ST_Intersects)
    S->>Cache: chave(entrada, hash) / obter()
    Cache->>DB: SELECT rota_cache WHERE chave=...
    alt cache válido
        Cache-->>S: RotaOut (cache=True)
        S-->>R: RotaOut
    else sem cache
        loop níveis 3→6→10→any (a partir do pedido)
            S->>ORS: rota(coords, restricoes, avoid_polygons=None)
            ORS-->>S: GeoJSON ou OrsErro
            alt sem_rota
                Note over S: tenta o próximo nível
            else cota/indisponível
                Note over S: aborta laço, vai para pgRouting
            else sucesso
                S->>BG: corredor(linha real) + barreiras_no_corredor
                BG->>DB: SELECT barreiras (ST_Intersects)
                S->>BG: poligonos_para_evitar()
                opt há barreira intransponível
                    S->>ORS: rota(coords, ..., avoid_polygons=poligonos)
                    ORS-->>S: GeoJSON (2ª passada)
                end
            end
        end
        alt nenhum nível do ORS funcionou
            S->>PGR: rota_pgrouting(origem, destino)
            PGR->>DB: no_mais_proximo() + pgr_dijkstra
            alt também falhou
                S-->>R: raise RotaNaoEncontrada
                R-->>C: 404 ou 503
            else sucesso
                PGR->>DB: instrucoes() -> SELECT arestas por id
                PGR-->>S: RotaBruta + PassoBruto[]
            end
        end
        S->>Enr: enriquecer_passos(passos_brutos, barreiras_dificulta, extras_steepness)
        Enr->>DB: via_mais_proxima + conflacao (por passo)
        Enr-->>S: passos, avisos, fontes
        S->>S: recalcula duracao_s com velocidade do perfil
        S->>Cache: guardar(chave, RotaOut, regiao=corredor_final)
        Cache->>DB: INSERT ... ON CONFLICT DO UPDATE
        S-->>R: RotaOut (cache=False)
        R-->>C: 200 RotaOut
    end
```

### Limitações e dívidas técnicas observadas no código

- `generica.json` (fixture padrão do ORS) continua **sintética** — nunca veio de uma chamada real à API, conforme o próprio README admite; só as 4 fixtures nomeadas por coordenadas são reais.
- O comentário em `pgrouting.py` sobre interpolação direta de valores na string SQL de `pgr_dijkstra` é uma decisão deliberada (parâmetros ligados não atravessam a borda da extensão), mas depende inteiramente da validação Pydantic upstream continuar garantindo que nada além de `float`/`int` chegue ali — não há nenhuma sanitização adicional dentro do próprio módulo.
- `_GRAUS_POR_METRO = 0.00001` em `pgrouting.py` é uma aproximação (comentário do próprio código: "~0,0001° por 10 m na latitude de São Paulo"), não uma conversão geodésica exata — adequada só porque serve para expandir uma bbox de busca, não para medir distância real.
- O bug do GEOS 3.9.0 citado em `barreira_geom.py` (falha de `ST_Intersection`/`ST_Difference` entre `LineString` e `Polygon`) é contornado, mas é uma característica da imagem Docker `pgrouting/pgrouting:latest` — confirmada tanto no `docker-compose.yml` local quanto no `.github/workflows/ci.yml`, mas sem garantia no código de que a mesma imagem/versão do GEOS é a usada em produção (Render), o que é um ponto a confirmar fora desta seção.
- `casos_referencia.json` tem `verificado_streetview: false` em todos os 13 casos — as expectativas de distância/sem-degraus ainda não foram validadas manualmente contra imagens reais das ruas.
- Em `enriquecimento.py`, quando uma `via_pedestre` é encontrada mas não tem calçada conflada correspondente (`conflacao_via_calcada`/`calcada_sp`), o passo perde largura/declividade do GeoSampa mesmo tendo `is_degrau`/`kerb_transponivel` corretos vindos do OSM — é um segundo caminho (além de "nenhuma via a 10 m") para o mesmo aviso `trecho_sem_dados`, que vale a pena ter em mente ao depurar rotas com poucos dados de calçada.


## 4. Backend: estratégia de testes

### Backend: estratégia de testes

A suíte do backend vive em `backend/tests/` (arquivos soltos, testes de unidade/contrato/configuração) e `backend/tests/services/` (testes dos módulos de `app/services/`, que concentram a lógica de roteamento e enriquecimento). São 16 arquivos de teste no total — 9 em `backend/tests/` e 7 em `backend/tests/services/` —, cobrindo desde validação pura de Pydantic até o fluxo completo `POST /api/rotas` contra um banco PostGIS real. O que amarra tudo isso — e decide o que roda onde — é um único arquivo: `backend/tests/conftest.py`.

#### `conftest.py`: os dois marcadores e como a suíte se autoajusta ao ambiente

Um **marcador** (`marker`) no pytest é uma etiqueta (`@pytest.mark.algo`) que se pluga num teste ou módulo inteiro (via `pytestmark = pytest.mark.algo` no topo do arquivo) para que o pytest — ou um `conftest.py` — possa filtrá-los depois. Os dois marcadores deste projeto estão declarados em `backend/pyproject.toml`:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
markers = [
  "integration: precisa de banco PostGIS acessível em DATABASE_URL",
  "dados_reais: precisa do ETL carregado (via_pedestre não vazia); pulado no CI",
]
```

O `conftest.py` implementa o hook `pytest_collection_modifyitems`, que o pytest chama depois de "coletar" (descobrir) todos os testes e antes de rodá-los, dando a chance de adicionar marcadores dinamicamente — aqui, um `pytest.mark.skip` condicional:

```python
# backend/tests/conftest.py
def _banco_disponivel() -> bool:
    try:
        with create_engine(settings.database_url).connect() as conexao:
            conexao.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


def _dados_carregados() -> bool:
    """O ETL do Plano 2 já populou o grafo? No CI só as migrations rodam."""
    try:
        with create_engine(settings.database_url).connect() as conexao:
            total = conexao.execute(text("SELECT count(*) FROM via_pedestre")).scalar_one()
        return total > 0
    except Exception:
        return False


def pytest_collection_modifyitems(config, items):
    if not _banco_disponivel():
        pular = pytest.mark.skip(reason="banco indisponível em DATABASE_URL; rode docker compose up -d")
        for item in items:
            if "integration" in item.keywords:
                item.add_marker(pular)
        return
    if not _dados_carregados():
        pular = pytest.mark.skip(reason="ETL não carregado (via_pedestre vazia); rode o Plano 2 antes")
        for item in items:
            if "dados_reais" in item.keywords:
                item.add_marker(pular)
```

A lógica é uma cascata de dois filtros:

1. **`_banco_disponivel()`** abre uma conexão de teste (`SELECT 1`) contra `settings.database_url`. Se falhar (nenhum Postgres rodando), **todo** teste marcado `integration` é pulado (com `pytest.mark.skip`, que aparece como `s` no relatório, não como falha) e a função retorna — nem chega a checar `_dados_carregados()`.
2. Se o banco existe mas está "vazio de dados de verdade" — só com o schema das migrations, sem o ETL ter rodado —, `_dados_carregados()` conta linhas de `via_pedestre` (a tabela do grafo de calçadas; populada apenas pelo ETL, nunca pelas migrations). Se `0`, todo teste marcado `dados_reais` é pulado.

Isso significa que **o mesmo `pytest -q`** roda coisas diferentes dependendo de onde é executado:

| Ambiente | `integration` | `dados_reais` |
|---|---|---|
| Sem Postgres rodando | pulado | pulado (nem chega a checar) |
| Postgres com só as migrations (é o caso do CI) | roda | pulado |
| Postgres com ETL do Plano 2 carregado (ambiente local do dev) | roda | roda |

Note que `dados_reais` é um superconjunto de `integration` na prática (todo teste `dados_reais` também depende de banco), mas os dois marcadores são checados por características diferentes: um pelo banco *existir*, outro pelos dados *terem sido carregados* — por isso os testes que citam ids de `via_pedestre`/`no_pedestre` específicos (ex.: `_VIA_COM_CONFLACAO_MEDIDA = 25041` em `test_enriquecimento.py`) levam `pytestmark = [pytest.mark.integration, pytest.mark.dados_reais]`: sem o ETL, aquele id nem existe na tabela.

#### Os três níveis de teste deste projeto

O guia de quem lê `backend/tests/` pela primeira vez costuma confundir "teste de integração" com "teste que bate na rede" — aqui não é isso. Vale separar três categorias que convivem no mesmo diretório:

1. **Teste unitário (sem marcador, sem banco, sem rede)** — função pura, roda em milissegundos, sempre executa (inclusive fora deste projeto, com `pytest` puro). Exemplos: `test_config.py` (parsing de string), `test_schemas_rota.py` (validação Pydantic), a parte de `test_barreira_geom.py` que só usa Shapely, e `test_ors_client.py`/`test_ors_fixture_client.py`, que usam `respx` para nunca tocar a rede de verdade (ver seção própria abaixo).
2. **Teste de integração com banco (`@pytest.mark.integration`, às vezes também `dados_reais`)** — abre uma sessão SQLAlchemy real contra o Postgres/PostGIS/pgRouting de `DATABASE_URL`, faz `INSERT`/`SELECT` de verdade e confere schema, constraints, ou o resultado de uma função de serviço que consulta o banco. É a maioria dos arquivos: as quatro migrações (`test_migracao_*.py`), `test_barreira_geom_db.py`, `test_pgrouting.py`, `test_enriquecimento.py`, `test_rota.py` e os testes `@pytest.mark.integration` dentro de `test_health.py`/`test_fontes.py`/`test_rotas_api.py`.
3. **Teste de contrato HTTP** — usa `fastapi.testclient.TestClient` para subir a aplicação FastAPI inteira (`create_app()`) em processo e bater nos endpoints via HTTP simulado (sem socket real), conferindo status code e forma do JSON de resposta. É o que `test_health.py`, `test_fontes.py` e `test_rotas_api.py` fazem — e como o roteador consulta o banco (para `/health`) ou o `OrsClient` (para `/api/rotas`), a maioria desses também carrega `@pytest.mark.integration`.

A diferença prática entre (2) e (3): um teste de integração "puro" chama a função Python de serviço diretamente (ex.: `enriquecer_passos(db, ...)`, `rota_pgrouting(db, ...)`) e confere o objeto Python devolvido; um teste de contrato HTTP passa pela camada FastAPI inteira — roteamento, validação de `RotaIn` pelo Pydantic, serialização de `RotaOut` — e confere o **JSON** que um cliente real receberia. Isso importa porque bugs de serialização (campo faltando, tipo errado) só aparecem no nível 3.

#### Cada arquivo de teste, o que garante

| Arquivo | Nível | O que garante |
|---|---|---|
| `test_config.py` | unitário | `parsear_origens` aceita tanto `"a, b"` quanto `'["a","b"]"'` (o Render não deixa configurar JSON facilmente, daí o formato CSV) e ignora entradas vazias/só espaço; `normalizar_url_banco` reescreve `postgres://`/`postgresql://` para `postgresql+psycopg://` (sem isso o SQLAlchemy tentaria usar `psycopg2`, que não está instalado) e não mexe numa URL já correta. |
| `test_schemas_rota.py` | unitário | Os `Coordenada` de `app/schemas/rota.py` rejeitam lat/lng fora do intervalo geográfico e aceitam os limites exatos (-90/180); `PerfilAcessibilidade` tem os defaults do spec (`inclinacao_max=6`, `guia_max_m=0.06`, `largura_min_m=0.9`, `evitar_degraus=True`, `velocidade_kmh=3.0`) e rejeita valores fora do domínio (`inclinacao_max` é `Literal[3, 6, 10, "any"]` — aceita esses quatro valores e mais nada, ex.: `5` é rejeitado); `RotaOut.model_dump(mode="json")` serializa `date` como string ISO (`"2026-01-01"`), inclusive dentro de listas aninhadas (`barreiras_proximas`); `Aviso` rejeita um `tipo` fora do enum esperado. |
| `test_health.py` | contrato HTTP (2 unitários + 1 integração) | `GET /health` reporta `"degradado"` quando a sessão do banco lança exceção (usa uma sessão falsa, `SessaoQuebrada`, via `app.dependency_overrides[get_db]`), sem nunca abrir conexão de verdade — por isso não precisa de `@pytest.mark.integration`; expõe a cota do ORS (`ors_cota_restante`/`ors_cota_reset`) lida do `EstadoCota` do cliente já injetado em `app.state.cliente_ors`; e (com banco real) confere a resposta `"ok"` completa. |
| `test_fontes.py` | contrato HTTP | `GET /api/fontes` devolve as 6 fontes na ordem alfabética esperada, com licença e atribuição corretas (ex.: OSM = `ODbL 1.0`, GeoSampa com `data_referencia="2021-08-13"`). |
| `test_rotas_api.py` | contrato HTTP (majoritariamente integração) | O contrato completo de `POST /api/rotas`: 422 para coordenada inválida (puro, sem banco); 200 com todos os 15 campos de `Passo` presentes no primeiro passo, usando sempre `OrsFixtureClient` (nunca a rede) sobre um caso de `casos_referencia.json`; grava no cache e a segunda chamada idêntica devolve `cache: true`; e as duas branches de tradução de erro do roteador — `OrsErro('sem_rota')` em todos os níveis + pgRouting também sem rota → 404; `OrsErro('cota_diaria')` (que tira o ORS do laço antes de esgotar níveis) + pgRouting sem rota → 503. Os dois últimos usam coordenadas propositalmente fora das três `area_piloto`, para que o fallback pgRouting também falhe e a branch do roteador (`if erro.erro_ors is not None`) fique isolada. Usa o fixture `cache_rota_vazio` (`DELETE FROM rota_cache` antes do teste) porque os testes de contrato commitam de verdade contra o banco real, via `get_db` — uma rodada anterior da suíte pode deixar uma entrada de cache válida (TTL 6h) para o mesmo par origem/destino. |
| `test_migracao_fundacao.py` | integração | Extensões `postgis`, `pgrouting`, `pg_trgm` instaladas; `fonte_dados` semeada com as 6 licenças certas (osm, geosampa, sp156, colaborativo, entre outras); `geosampa` com `data_referencia` de 2021-08-13. |
| `test_migracao_fontes_oficiais.py` | integração | As tabelas `area_piloto`, `etl_execucao`, `no_pedestre`, `via_pedestre`, `calcada_sp`, `barreira_oficial`, `parada`, `linha` existem; `area_piloto` semeada com os três recortes (Vila Mariana, Lapa, Ipiranga); `calcada_sp.largura_medida` é uma coluna **gerada** (`is_generated = 'ALWAYS'`, isto é, calculada automaticamente pelo Postgres a partir de outra coluna, nunca gravada diretamente); nenhuma coluna de `via_pedestre` carrega atributos de licença cruzada (`largura`/`declividade`, que vêm só do GeoSampa via conflação). |
| `test_migracao_conflacao.py` | integração | `conflacao_via_calcada` existe com `via_id` como chave primária isolada (é uma tabela "de ligação", sem geometria própria nem atributos de licença cruzada — só o relacionamento via↔calçada). |
| `test_migracao_roteamento.py` | integração | `barreira_colaborativa` e `rota_cache` existem; `rota_cache` tem `chave` como PK e os índices `rota_cache_regiao_idx`/`rota_cache_expira_idx`; `barreira_colaborativa` tem índice espacial em `geom` e FK para `fonte_dados`; os `CHECK` constraints de domínio de `severidade` e `status` rejeitam valores fora da lista permitida (inserindo um valor inválido e esperando `sqlalchemy.exc.DBAPIError` — a exceção com que o SQLAlchemy envelopa o erro que o driver DBAPI subjacente, aqui o psycopg 3, reporta quando o Postgres recusa a constraint). |
| `services/test_barreira_geom.py` | unitário (geometria pura, Shapely) | `corredor()` gera um polígono ao redor de uma linha com a área esperada (comprimento × 2×largura, conferida em EPSG:31983 — o SRID projetado métrico de São Paulo, diferente do EPSG:4326 geográfico em graus usado para armazenar/trafegar coordenadas); `poligonos_para_evitar()` respeita o teto de 15 polígonos, gera buffers com raio correto (~8 m), devolve `None` sem barreiras `intransponivel` ou com lista vazia, descarta a barreira mais distante quando a extensão total estouraria os 20 km do `avoid_polygons` do ORS, e devolve `None` no caso degenerado em que nem um único buffer cabe nos 200 km² permitidos. |
| `services/test_barreira_geom_db.py` | integração | `barreiras_no_corredor()` só traz barreira colaborativa **validada** e ignora barreira oficial **expirada**. A regra efetiva, documentada no docstring de `app/services/barreira_geom.py`: uma colaborativa só bloqueia (`intransponivel`) se estiver `validada` e com pelo menos 2 confirmações; uma oficial só bloqueia se a categoria for `obstaculo_calcada`, `guia_sem_rebaixamento` ou `buraco`, **aberta há menos de 180 dias** e sem `data_finalizacao` — é por isso que o teste usa uma barreira oficial aberta há **200 dias** (> 180): ela deixa de contar como bloqueio e nem vira aviso `dificulta` (some do roteamento, "como um problema presumidamente resolvido"); só oficiais de **outras** categorias (fora as três de cima) viram aviso `dificulta`. `hash_barreiras()` muda quando uma nova barreira aparece dentro do corredor (é a chave de invalidação de cache espacial). Insere dados sintéticos numa transação sempre revertida (`sessao.rollback()` no `finally` do fixture `db`) — nunca commita, nunca contamina dados reais. |
| `services/test_enriquecimento.py` | integração + `dados_reais` | `enriquecer_passos()` é a função que transforma um `PassoBruto` do pgRouting num `Passo` completo do contrato (`largura_m`, `declividade_pct`, `guia`, `barreiras_proximas`, `fonte`, `data_referencia`). Cobre: via com conflação medida preenche `largura_medida=True`; via sem conflação devolve `largura_m=None` e um aviso `trecho_sem_dados` (uma única vez por rota, mesmo com múltiplos passos sem dado); aresta com `kerb_transponivel=False` vira `guia="nao_transponivel"`; a regra inegociável do GeoSampa — largura `0` é ausência de medição, nunca "calçada de largura zero" — faz `largura_medida=False` implicar sempre `largura_m=None`; via a mais de 10 m de qualquer `via_pedestre` real devolve `guia="desconhecida"`; barreira `dificulta` a até 15 m vira `BarreiraResumo` no passo e aviso `barreira_dificulta`, enquanto uma barreira longe não aparece; classes de `steepness` do ORS (extras) sobrepõem a declividade do GeoSampa quando presentes, senão o GeoSampa prevalece; e o mapeamento oficial `_pct_da_classe_steepness` (classe → percentual) é conferido por amostragem em classes de -5 a 5. Os ids de `via_pedestre` usados (`25041`, `25044`, `26002`, `49085`) foram escolhidos consultando o banco real do piloto — daí a dependência de `dados_reais`. |
| `services/test_ors_client.py` | unitário (rede simulada com `respx`) | Ver seção dedicada abaixo, mais os três testes de `criar_cliente` (a fábrica que decide qual cliente ORS instanciar): sem `ORS_API_KEY` → `OrsFixtureClient`; com `USE_FIXTURES=true` (mesmo com chave presente) → `OrsFixtureClient`; com chave e sem `USE_FIXTURES` → `OrsClient` real. |
| `services/test_ors_fixture_client.py` | unitário | `OrsFixtureClient` (o "dublê" do ORS usado em CI/demo) lê uma fixture exata pelo nome de arquivo `"{lat_o}_{lng_o}_{lat_d}_{lng_d}_{inclinacao}"` (coordenadas arredondadas); na falta de uma fixture exata, usa uma fixture genérica **traladada** para a origem pedida, preservando a forma (deltas relativos) e sem alterar a elevação; simula erro do ORS lendo um JSON com `{"erro_codigo": "..."}`; e, crucialmente, `test_nunca_chama_rede` faz `monkeypatch.setattr("httpx.post", _explode)` — se qualquer código chamar `httpx.post` de verdade, o teste falha imediatamente, garantindo que o cliente fixture é hermético. |
| `services/test_pgrouting.py` | integração + `dados_reais` | `no_mais_proximo()` acha o nó real na própria coordenada e devolve `None` fora do piloto; `rota_pgrouting()` calcula uma rota real de ~402 m entre dois nós de Vila Mariana, confere que a geometria concatenada começa/termina exatamente nas coordenadas pedidas, e que nenhuma aresta tem `is_degrau`; devolve `None` quando a origem está fora do piloto ou quando um "corte" artificial (custo `1e6` nas arestas do nó de origem — a mesma técnica de bloqueio do ETL) isola o nó; `instrucoes()` agrupa passos por nome de via mantendo a soma de distâncias e a ordem sequencial; um teste de regressão parametrizado (`entra_pelo_source`/`entra_pelo_target`) trava um bug já corrigido em que uma rota de aresta única podia sair com a geometria invertida; e `_diferenca_angular`/`_direcao_da_virada` são conferidos com bearings sintéticos conhecidos (0°→90° = direita, 0°→270° = esquerda, diferença pequena = "siga"). |
| `services/test_rota.py` | integração + `dados_reais` | O teste mais abrangente: exercita `calcular()` (a orquestração completa: duas passadas ao ORS, fallback progressivo de inclinação 3→6→10→"any", fallback para pgRouting, cache). Cobre cache miss→hit e expiração por TTL (6h); fallback de nível quando `sem_rota` (avisa `exigencia_relaxada`); queda para pgRouting quando todos os níveis falham ou a cota do ORS estoura (avisa `motor_fallback`); `RotaNaoEncontrada` carregando o `erro_ors` correto para o roteador decidir 404 vs 503; a segunda passada com `avoid_polygons` disparada quando uma barreira intransponível cruza o corredor da primeira rota (usa um `_ClienteEspiao` que grava os argumentos de cada chamada); invalidação espacial do cache (`cache_rota.invalidar_regiao`) apagando a entrada cujo corredor contém um ponto novo; os 13 casos de `casos_referencia.json` rodados duas vezes — uma direto contra `rota_pgrouting` (checando distância e ausência de degraus) e outra pelo `calcular()` completo com fixtures do ORS; e uma regressão do spec: um POI colaborativo com severidade `informativo` (ex. `wheelchair=no` do OSM), mesmo validado e com confirmações, nunca vira polígono a evitar nem aviso — só `intransponivel` bloqueia. |

#### Como `respx` simula o ORS sem tocar a rede

`OrsClient` (`app/services/ors_client.py`) fala com o ORS via `httpx`. O pacote **`respx`** (dependência de teste em `pyproject.toml`, `respx>=0.21`) é um mock especializado em interceptar chamadas `httpx` no nível de transporte HTTP — ele registra rotas (`respx.post(URL)`) que casam por método+URL e devolvem uma `httpx.Response` fabricada, sem que nenhum pacote saia da máquina. Em `test_ors_client.py`, cada teste usa o decorator `@respx.mock`, que ativa o mock só durante aquele teste e garante que qualquer chamada HTTP não registrada explode (em vez de vazar para a rede real):

```python
# backend/tests/services/test_ors_client.py
@respx.mock
def test_403_levanta_ors_erro_cota_diaria():
    respx.post(URL_ORS).mock(return_value=httpx.Response(403, json={"error": "quota"}))
    cliente = _cliente()

    with pytest.raises(OrsErro) as exc:
        cliente.rota(COORDS, restricoes={}, evitar_degraus=True, avoid_polygons=None)
    assert exc.value.codigo == "cota_diaria"
```

Isso permite testar toda a tradução de códigos de erro do ORS (403→`cota_diaria`, 429→`cota_minuto`, 404 com código 2009/2010→`sem_rota`, 404 com outro código→`indisponivel`, 400/406→`entrada_invalida`, timeout/`ConnectError`/5xx→`indisponivel`, corpo 404 não-JSON ou sem campo `error`→`indisponivel`) sem depender do ORS de verdade estar no ar, e também inspecionar exatamente o corpo da requisição que o cliente monta (`rota_mock.calls.last.request`) — por exemplo, confirmar que `avoid_polygons` só aparece no JSON quando informado, e que `avoid_features: ["steps"]` só aparece quando `evitar_degraus=True`. Além disso, `respx` também é usado para ler os headers de resposta simulados (`x-ratelimit-remaining`, `x-ratelimit-reset`) e conferir que `EstadoCota` é atualizado corretamente — a mesma lógica que alimenta `ors_cota_restante`/`ors_cota_reset` em `GET /health`. O mesmo arquivo ainda testa a fábrica `criar_cliente(settings)` (sem `respx`, sem rede): ela devolve `OrsFixtureClient` quando não há `ORS_API_KEY` ou quando `USE_FIXTURES=true` (mesmo com chave presente), e só devolve um `OrsClient` real quando há chave e `USE_FIXTURES` está desligado.

Já `OrsFixtureClient` (usado por praticamente todos os testes de integração de rota, e em produção quando `USE_FIXTURES=true` ou não há `ORS_API_KEY`) não precisa de `respx` porque nunca usa `httpx` para requisições de rota — ele lê arquivos JSON estáticos do disco (fixtures gravadas de respostas reais do ORS). Isso é o que permite rodar `test_rotas_api.py`, `test_rota.py` etc. no CI sem nenhuma chave de API nem acesso à internet.

#### Como rodar localmente

A partir de `backend/`, com o ambiente virtual e as dependências de dev instaladas (`pip install -e ".[dev]"`):

```bash
pytest -q                 # roda tudo que o ambiente permitir (ver tabela de skip acima)
pytest -q -m "not integration"     # só os unitários, sem precisar de banco
pytest -q -m integration           # só os de integração (precisa de DATABASE_URL válido)
ruff check .                       # lint (regras E, F, I, B, UP — ver pyproject.toml)
ruff format --check .              # confere formatação sem reescrever os arquivos
```

Esses mesmos comandos já aparecem resumidos numa tabela "Comandos" no `README.md` da raiz do repositório (`pytest -q` e `ruff check . ; ruff format --check .` para o backend, ao lado dos equivalentes de frontend) — mas essa tabela não menciona os marcadores `integration`/`dados_reais` nem o pré-requisito do ETL, então vale entender o detalhe daqui.

Para os testes `integration`/`dados_reais` passarem de verdade localmente, é preciso um Postgres com PostGIS/pgRouting no ar (o projeto usa `docker compose up -d` — mencionado literalmente na mensagem de skip), as migrations do Alembic aplicadas (`alembic upgrade head`) e, para os `dados_reais`, o ETL do "Plano 2" já ter rodado e populado `via_pedestre`/`no_pedestre`/`calcada_sp` etc. com os três recortes-piloto (Vila Mariana, Lapa, Ipiranga).

Vale notar que `pytest-cov>=5` está nas dependências de dev do `pyproject.toml`, mas nenhum comando roda com `--cov` — nem localmente (pelos exemplos acima) nem no CI. Ou seja: a suíte não mede nem impõe um piso de cobertura de código; a ferramenta está instalada, mas não é usada ativamente.

#### O que o CI roda, e por que parte só roda localmente

O job `backend` de `.github/workflows/ci.yml` sobe um container de serviço `pgrouting/pgrouting:latest` (a imagem oficial que já vem com PostGIS+pgRouting instalados) como banco de `DATABASE_URL`, instala o pacote em modo editável com extras de dev, roda lint e formatação, aplica as migrations (`alembic upgrade head`) e só então `pytest -q`:

```yaml
# .github/workflows/ci.yml (job backend)
- run: pip install -e ".[dev]"
- run: ruff check . && ruff format --check .
- run: alembic upgrade head
- run: pytest -q
```

Note que **não há nenhum passo de ETL** nesse job — só `alembic upgrade head`. Isso significa que, seguindo exatamente a lógica de `conftest.py`:

- `_banco_disponivel()` é `True` (o serviço `db` está de pé e saudável, com `health-cmd "pg_isready -U postgres"`), então **todo teste `integration` roda no CI** — inclusive os que fazem `INSERT`/`ROLLBACK` sintéticos, os de contrato HTTP e os de schema das migrations.
- `_dados_carregados()` é `False` (`via_pedestre` está vazia — só o schema existe, sem linhas), então **todo teste `dados_reais` é pulado no CI** — é exatamente o que o próprio marcador documenta em `pyproject.toml` (`"pulado no CI"`). Isso cobre `services/test_enriquecimento.py`, `services/test_pgrouting.py`, `services/test_rota.py` inteiros (todos os três levam `pytest.mark.dados_reais` no módulo).

Ou seja: o CI garante que o *schema* do banco está correto (migrations, constraints, índices, colunas geradas) e que a *lógica pura* (validação Pydantic, parsing de config, geometria com Shapely, tradução de erros do ORS via `respx`, fixtures do ORS) está correta — mas não garante que o *grafo de roteamento com dados reais de São Paulo* continua produzindo as rotas esperadas. Essa segunda garantia só existe quando alguém roda a suíte completa localmente (ou, presumivelmente, num pipeline separado) depois de rodar o ETL — o workflow `etl.yml` no mesmo diretório sugere que a carga de dados é tratada como um processo à parte do CI de testes, não integrado a ele.

#### Limitações observadas

- Não há um job de CI dedicado a rodar os testes `dados_reais` — a garantia "roteamento real de SP continua funcionando" depende de execução manual do desenvolvedor, localmente, depois de rodar o ETL.
- Não existe um arquivo `backend/README.md` no repositório (só há README em `docs/`, `etl/`, `frontend/` e na raiz do projeto). A raiz documenta os comandos básicos (`pytest -q`, `ruff check . ; ruff format --check .`) numa tabela "Comandos", mas nenhuma documentação — nem a raiz, nem um README do backend (que não existe) — explica os marcadores `integration`/`dados_reais`, o pré-requisito de `docker compose up -d` + `alembic upgrade head`, ou a necessidade do ETL para os testes `dados_reais`; isso só está documentado no código (`conftest.py`, `pyproject.toml`) e nos comentários dos próprios testes.
- `test_rotas_api.py` depende de estado compartilhado em `rota_cache` entre execuções (por isso o fixture `cache_rota_vazio` existe e o comentário no código avisa que "uma rodada anterior da suíte... pode ter deixado uma entrada válida"): é um indício de acoplamento entre testes via banco que exige atenção ao adicionar novos testes de rota.
- Os ids de `via_pedestre`/`no_pedestre` usados em vários testes `dados_reais` (`25041`, `9509943143` etc.) são "mágicos" — amarrados ao estado atual do ETL do piloto; se o ETL for re-rodado com dados atualizados do GeoSampa/OSM, esses ids podem não existir mais ou mudar de características, quebrando os testes silenciosamente até alguém investigar.
- `pytest-cov` está instalado como dependência de dev, mas nenhum comando (local ou de CI) roda com `--cov`: não há piso de cobertura medido nem imposto em nenhuma etapa do projeto.


## 5. ETL: carga das fontes oficiais e conflação

### Onde este pacote entra no sistema

`etl/` é um pacote Python **independente do backend** — outro `requirements.txt`, outro ponto de entrada, outra imagem Docker — cuja única responsabilidade é ler quatro fontes públicas (OpenStreetMap, GeoSampa, SP156, GTFS da SPTrans), transformá-las e gravar linhas nas tabelas que o Alembic do backend já criou (`backend/alembic/versions/002_fontes_oficiais.py`). Ele nunca cria schema, nunca lê o `.env` da raiz — a URL do banco vem só da variável de ambiente `DATABASE_URL`, a mesma que o backend usa — e é a peça que efetivamente coloca dados reais no PostGIS que a API de rotas consulta depois.

Além das quatro cargas, o pacote tem uma quinta etapa, a **conflação**: liga cada aresta do grafo de pedestres (vindo do OSM) ao polígono de calçada do GeoSampa que a representa, sem nunca misturar geometria ou atributos das duas fontes numa mesma linha — decisão deliberada para não violar as licenças ODbL (OSM) e CC-BY-SA (GeoSampa) ao "fundir" os dados.

```
etl/
├── Dockerfile              python:3.12-slim + osmium-tool + requirements
├── requirements.txt
├── pytest.ini
├── gabarito_conflacao.csv  gabarito da conflação (fonte de verdade p/ calibrar o buffer)
├── dados/                  downloads cacheados (fora do git)
├── etl/
│   ├── config.py            AREA_PILOTO, URLs, BUFFER_CONFLACAO_M, METODO_CONFLACAO
│   ├── db.py                 engine(), fonte_id(), registrar_execucao(), concluir_execucao()
│   ├── download.py           baixar(url, destino, max_idade_dias=7) com cache
│   ├── geo.py                 bbox_para_poligono(), PROJ_31983, comprimento_m()
│   ├── osm_regras.py          classificar_kerb(), esquema_calcada(), fator_custo(), eh_via_de_pedestre()
│   ├── osm.py                osmium (recorte+filtro) + osmnx (topologia) → no_pedestre/via_pedestre
│   ├── geosampa.py            WFS paginado → calcada_sp
│   ├── sp156.py                CSV do CKAN → barreira_oficial
│   ├── gtfs.py                 zip GTFS → parada/linha
│   ├── conflacao.py            liga via_pedestre × calcada_sp → conflacao_via_calcada
│   ├── calibracao_conflacao.py gabarito + calibração do buffer (ferramenta de pesquisa)
│   └── cli.py                  python -m etl.cli osm|geosampa|sp156|gtfs|conflacao|tudo
└── tests/                    unitários (sem banco) + integração (com banco, marcador `integration`)
```

### `Dockerfile`, `requirements.txt`, `pytest.ini`

```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends osmium-tool && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENTRYPOINT ["python", "-m", "etl.cli"]
```

A imagem parte de `python:3.12-slim` e instala `osmium-tool` via `apt` — é o único binário externo (C++) de que o pipeline depende, usado só para recortar e filtrar o `.osm.pbf` gigante antes de entregá-lo ao `osmnx`. O `ENTRYPOINT` já aponta para `python -m etl.cli`, então `docker compose --profile etl run --rm etl osm` na prática roda `python -m etl.cli osm` dentro do container.

`requirements.txt` reúne as bibliotecas geoespaciais Python: `osmnx`/`networkx` (grafo do OSM), `geopandas`/`shapely`/`pyproj`/`pyogrio` (geometria e projeção), `pandas`/`requests` (dados tabulares e HTTP), `sqlalchemy`+`geoalchemy2`+`psycopg[binary]` (acesso ao PostGIS) e `pytest`. O README observa uma armadilha prática: `osmnx`/`geopandas` dependem de wheels que podem não existir ainda para a versão de Python do host — por isso os testes "sempre funcionam" dentro do container (mesmo ambiente do CI), mas podem falhar ao instalar no host.

`pytest.ini` define `pythonpath = .` (para `import etl.xxx` funcionar sem instalar o pacote) e registra o marcador `integration`, usado por todo teste que precisa de um PostGIS real — é o gancho que o `conftest.py` usa para pular esses testes quando não há banco acessível (ver seção de testes).

### `etl/etl/config.py` — a área piloto e os parâmetros calibrados

```python
# oeste, sul, leste, norte (lon/lat, EPSG:4326)
AREA_PILOTO: dict[str, tuple[float, float, float, float]] = {
    "Vila Mariana": (-46.660, -23.610, -46.615, -23.570),
    "Lapa": (-46.720, -23.545, -46.680, -23.510),
    "Ipiranga": (-46.625, -23.615, -46.590, -23.575),
}
```

Em 02/11/2026 o Ipiranga foi estendido para o sul até -23.615 para incluir a FATEC Ipiranga (migration 007).

`AREA_PILOTO` são três bounding boxes independentes (bairros escolhidos no Plano 2) em EPSG:4326 — o SRID (*Spatial Reference System Identifier*, o código que identifica um sistema de coordenadas; 4326 é "latitude/longitude em graus, como o GPS entrega") padrão usado para guardar geometria no banco. `BBOX_UNIAO` é o retângulo que envolve os três recortes (mín/máx de cada coordenada), usado pelo `osmium extract` para baixar de uma vez só a região que cobre as três áreas — o filtro fino por polígono exato vem depois, em Python.

`BUFFER_CONFLACAO_M = 5.0` e `METODO_CONFLACAO = "mesmo_lado"` são os parâmetros de produção da conflação, fixados pela calibração descrita mais adiante — não são um palpite, é o resultado documentado em `docs/pesquisa/2026-09-14-calibracao-conflacao.md`.

`DATABASE_URL` tem um padrão de desenvolvimento local (`postgresql+psycopg://postgres:dev@localhost:5433/acessibilidade`) sobrescrito pela variável de ambiente em produção/CI. As quatro URLs de fonte (`URL_GEOFABRIK`, `URL_GEOSAMPA_WFS`, `URL_CKAN_SP156`, `URL_GTFS`) e o `UA` (User-Agent enviado em toda requisição, identificando o projeto) completam o módulo.

### `db.py` — acesso ao banco compartilhado com o backend

Só quatro funções, todas puras em termos de responsabilidade (sem lógica de negócio):

```python
def engine() -> Engine:
    return create_engine(DATABASE_URL, pool_pre_ping=True)
```

`pool_pre_ping=True` faz o SQLAlchemy testar cada conexão do pool antes de usá-la (um `SELECT 1` rápido) — evita que uma conexão morta por timeout do lado do banco (comum atrás de um *pooler*, um proxy que multiplexa muitas conexões de aplicação sobre poucas conexões reais ao Postgres, como o Supabase Session Pooler mencionado no README) gere um erro de "conexão fechada" no meio de uma query.

`fonte_id(engine, chave)` traduz uma chave textual (`'osm'`, `'geosampa'`...) para o `id` inteiro da tabela `fonte_dados` — cada linha carregada guarda esse `fonte_id`, a rastreabilidade de proveniência que os testes de qualidade verificam depois.

`registrar_execucao`/`concluir_execucao` são o par que grava o ciclo de vida de uma execução em `etl_execucao`: a primeira insere uma linha `status='executando'` e devolve o `id`; a segunda faz `UPDATE` para `'ok'` ou `'erro'` com `linhas`/`esperado`/`detalhe`. Todo módulo de fonte (osm, geosampa, sp156, gtfs, conflacao) segue o mesmo padrão `try/except` em volta dessas duas chamadas — é o que dá ao endpoint `/health` do backend a capacidade de reportar `ultimo_etl` sem nenhum acoplamento direto ao código do ETL.

Vale notar que a chave passada para `registrar_execucao` e a chave passada para `fonte_id` não são necessariamente a mesma string, porque apontam para tabelas com vocabulários independentes: `etl_execucao.fonte` rastreia execuções do *pipeline* (por módulo), enquanto `fonte_dados.chave` rastreia a proveniência de cada linha gravada. No `gtfs.py`, por exemplo, `registrar_execucao(engine, "gtfs")` usa a chave `'gtfs'`, mas `fonte_id(engine, "sptrans")` usa `'sptrans'` — não é um erro, mas é fácil de confundir lendo o código rápido.

### `download.py` — cache com validação de tamanho

```python
def baixar(url, destino, max_idade_dias=7, tamanho_minimo=1024) -> Path:
    if destino.exists():
        idade_segundos = time.time() - destino.stat().st_mtime
        if idade_segundos < max_idade_dias * 86400:
            return destino
    ...
    tmp = destino.with_suffix(destino.suffix + ".tmp")
    with open(tmp, "wb") as arquivo:
        arquivo.writelines(resposta.iter_content(chunk_size=1024 * 1024))
    tmp.replace(destino)

    tamanho = destino.stat().st_size
    if tamanho < tamanho_minimo:
        raise DownloadInvalido(...)
    return destino
```

Duas decisões valem destacar. Primeiro, o cache é por **idade do arquivo em disco**, não por ETag/hash — simples, e suficiente porque as quatro fontes não mudam com frequência (a mais volátil, o SP156, é trimestral). Segundo, o download escreve num arquivo `.tmp` e só faz `rename` para o destino final ao concluir — `Path.replace` é atômico no mesmo sistema de arquivos, então um download interrompido no meio nunca deixa um arquivo parcial no lugar do nome esperado, o que corromperia a corrida seguinte (que veria o arquivo "presente e recente" e pularia o download de um arquivo truncado). O `tamanho_minimo` (cada fonte passa o seu: 500 MB para o PBF do Brasil sudeste, 10 MB para o CSV do SP156, 5 MB para o zip do GTFS) pega o caso de a fonte devolver uma página de erro HTML disfarçada de 200 OK — um arquivo pequeno demais para ser dado real.

### `geo.py` — projeção métrica

```python
PROJ_31983 = Transformer.from_crs("EPSG:4326", "EPSG:31983", always_xy=True)

def comprimento_m(linestring_4326: LineString) -> float:
    coords_31983 = [PROJ_31983.transform(x, y) for x, y in linestring_4326.coords]
    return LineString(coords_31983).length
```

O banco guarda tudo em EPSG:4326 (graus), mas grau não é uma unidade de distância constante — um grau de longitude em São Paulo vale menos metros que um grau de latitude. Para medir comprimento de verdade é preciso projetar para um sistema métrico local; o projeto usa EPSG:31983 (SIRGAS 2000 / UTM 23S), que cobre bem a Região Metropolitana de SP com baixa distorção. `comprimento_m` é usada tanto no ETL do OSM (para calcular `comprimento_m`/`custo_acessivel` de cada aresta) quanto nos testes sintéticos de conflação.

### `osm_regras.py` — as regras de acessibilidade, puras e testáveis

Este módulo não faz nenhum I/O (rede, disco, banco) — é só funções sobre dicionários de tags e listas de valores, o que permite testar cada regra de negócio isoladamente, sem precisar de um PBF real nem de um banco no ar (são os 31 testes "unitários de `osm_regras`" citados a cada contagem do README).

**`classificar_kerb(valores)`** decide o pior caso de acessibilidade entre as guias (*kerb*, a tag do OSM para a guia de rebaixamento de calçada) das duas extremidades de uma aresta:

| tags de entrada | saída | por quê |
|---|---|---|
| `[]` ou só `None` | `(None, None)` | nenhuma informação |
| contém `"yes"` | `("yes", None)` | guia existe, altura indeterminada — **nunca vira acessível**, mesmo com a outra ponta `lowered` |
| alguma em `{raised, rolled}` | `(valor, False)` | barreira confirmada |
| alguma em `{lowered, flush, no}` | `(valor, True)` | transponível |
| valor fora do vocabulário do OSM | `(valor, None)` | mantém o texto, não arrisca "acessível" |

```python
def classificar_kerb(valores: list[str | None]) -> tuple[str | None, bool | None]:
    presentes = [v for v in valores if v]
    if not presentes:
        return (None, None)
    if "yes" in presentes:
        return ("yes", None)
    ...
```

A regra `kerb='yes' → sempre pior caso` é intencional e é validada com dado real: o README registra **0 ocorrências de `kerb='yes'` com `kerb_transponivel` diferente de `NULL`** na carga de 14/09/2026 — a regra se sustenta na prática, não só na teoria (é o que `test_kerb_yes_nunca_vira_acessivel`, em `test_qualidade_dados.py`, verifica sobre o banco real).

**`esquema_calcada(tags)`** classifica como a via representa a calçada no OSM — informação usada depois pela conflação para decidir o quão "ambígua" é a ligação a um polígono do GeoSampa:

- `footway == 'sidewalk'` → `'geometria_propria'` (a calçada tem sua própria geometria, separada da rua — uma via desenhada só para o pedestre);
- `sidewalk` em `{left, right, both, yes, separate}` → `'atributo_via'` (a calçada é apenas um atributo da via de carro, sem geometria própria);
- caso contrário → `'via_generica'`.

**`fator_custo(tags, kerb_transponivel)`** multiplica o comprimento da aresta para produzir o custo de roteamento acessível:

```python
def fator_custo(tags, kerb_transponivel):
    if tags.get("highway") == "steps" or tags.get("wheelchair") == "no":
        return BLOQUEIO           # 1_000_000.0
    fator = 1.0
    if kerb_transponivel is False:
        fator *= 25.0
    if tags.get("surface") in SUPERFICIE_RUIM:
        fator *= 3.0
    if tags.get("smoothness") in SMOOTHNESS_RUIM:
        fator *= 5.0
    return fator
```

Escadas ou `wheelchair=no` bloqueiam de vez (custo praticamente infinito, o suficiente para o pgRouting nunca escolher esse trecho a não ser que não haja alternativa alguma). Os demais fatores se combinam multiplicando — uma via com guia intransponível **e** piso ruim recebe `25 × 3 = 75×` o comprimento real como custo (é exatamente o caso testado em `test_osm_regras.py::TestFatorCusto::test_kerb_e_surface_ruim_combinam_multiplicando`). Isso é o que faz o algoritmo de menor caminho (Dijkstra, no backend) preferir uma rota mais longa em distância, porém mais acessível.

**`eh_via_de_pedestre(tags)`** é o filtro binário que decide se uma via do OSM entra no grafo: exige `highway` presente e fora de `VIAS_EXCLUIDAS` (`motorway`, `motorway_link`, `trunk`, `trunk_link`, `construction`, `proposed`, `raceway`, `bus_guideway`, `busway`), exclui `foot=no` e `access=private`, e trata ciclovia como caso especial — só entra se tiver `foot=yes` ou `foot=designated` explícito (senão presume-se que é só para bicicleta).

### `osm.py` — o pipeline osmium → osmnx → PostGIS

Este é o módulo mais longo e o que mais tempo consome no ETL (a fonte "mais lenta" mesmo com cache quente, ~1min30s, segundo o README). O ADR (*Architecture Decision Record*, documento curto que registra uma decisão de arquitetura e seu porquê) `docs/adr/002-grafo-com-osmnx.md` explica a escolha: `osm2pgsql`, a ferramenta mais comum para importar OSM ao Postgres, **não divide as vias nos cruzamentos** — ela mantém a via inteira como uma linha só, sem um nó por cruzamento, e o pgRouting precisa exatamente desses nós (`source`/`target` por segmento) para montar o grafo de roteamento. Por isso o pipeline usa `osmium` (ferramenta em C++, rápida mesmo sobre o PBF do sudeste do Brasil inteiro) para recortar e filtrar, e `osmnx` (Python) para de fato montar a topologia do grafo.

```mermaid
flowchart LR
    A[sudeste-latest.osm.pbf<br/>~858 MB, Geofabrik] -->|osmium extract -s smart<br/>bbox união dos 3 recortes| B[piloto.osm.pbf]
    B -->|osmium tags-filter w/highway| C[piloto-vias.osm.pbf]
    C -->|osmium cat → XML| D[piloto-vias.osm]
    D -->|osmnx.graph_from_xml| E[grafo bruto MultiDiGraph]
    E -->|remove arestas eh_via_de_pedestre=False<br/>remove nós isolados| F[grafo filtrado]
    F -->|simplify_graph edge_attrs_differ| G[grafo simplificado]
    G -->|graph_to_gdfs + dedup de pares<br/>bidirecionais| H[GeoDataFrames nós/arestas]
    H -->|recorte final pelos 3<br/>polígonos area_piloto| I[nós/arestas dentro do piloto]
    I -->|classificar_kerb, esquema_calcada,<br/>fator_custo por aresta| J[gdf_nos / gdf_arestas]
    J -->|to_postgis, rename_geometry geom| K[(no_pedestre / via_pedestre)]
```

Passo a passo:

1. **Download** (`baixar`, com `tamanho_minimo=500_000_000` — meio GB, sanidade contra download truncado do arquivo de ~858 MB) e **data de referência** via cabeçalho HTTP `Last-Modified` do Geofabrik (`_data_referencia_pbf`), com fallback para "hoje" se o `HEAD` falhar.

2. **`_extrair_piloto`**: três chamadas a `osmium` em sequência — `extract --bbox ... -s smart` (recorta para `BBOX_UNIAO`; o modo `smart` mantém inteiras as vias que cruzam a borda do recorte, deixando "sobras" fora da área exata, removidas depois pelo filtro geométrico), `tags-filter w/highway` (descarta tudo que não é via, mantendo só os nós referenciados) e `cat` (converte para XML, formato que o `osmnx` sabe ler).

3. **`_montar_grafo`**: `ox.settings.useful_tags_way`/`useful_tags_node` restringem as tags que o `osmnx` mantém ao ler o XML (`TAGS_UTEIS_VIA`/`TAGS_UTEIS_NO`, listas fechadas no topo do módulo — entre as principais estão `highway`, `footway`, `sidewalk`, `wheelchair`, `surface`, `smoothness`, `width`, `incline` e `name` para as vias, e `kerb`, `tactile_paving`, `crossing`, `wheelchair`, `barrier` para os nós) — sem isso o grafo cresceria com centenas de tags irrelevantes. `graph_from_xml(bidirectional=True, simplify=False, retain_all=True)` monta o grafo bruto (uma aresta por segmento OSM, sem fundir nada ainda). Em seguida:
   ```python
   arestas_fora_do_pedestre = [
       (u, v, k) for u, v, k, dados in grafo.edges(keys=True, data=True)
       if not eh_via_de_pedestre({chave: _valor(valor) for chave, valor in dados.items()})
   ]
   grafo.remove_edges_from(arestas_fora_do_pedestre)
   grafo.remove_nodes_from(list(nx.isolates(grafo)))
   return ox.simplification.simplify_graph(grafo, edge_attrs_differ=ATRIBUTOS_QUE_DIFEREM)
   ```
   `eh_via_de_pedestre` (de `osm_regras.py`) filtra o grafo; nós que ficaram sem nenhuma aresta (`nx.isolates`) são removidos; e só então `simplify_graph` funde segmentos consecutivos num único trecho — mas **não** funde segmentos cujos atributos em `ATRIBUTOS_QUE_DIFEREM` (`highway`, `footway`, `sidewalk`, `wheelchair`, `surface`, `smoothness`, `width`, `incline`, `name`) sejam diferentes. Essa lista existe para não perder informação de acessibilidade: fundir um trecho com guia baixa a um sem guia apagaria justamente o dado que o projeto existe para capturar.

4. Logo depois de montar os `GeoDataFrame`s a partir do grafo (`ox.graph_to_gdfs(grafo)`), o código deduplica pares bidirecionais — o grafo do `osmnx` é dirigido nos dois sentidos (mesma calçada, duas arestas `u→v` e `v→u`):
   ```python
   pares = set(zip(arestas["u"], arestas["v"], strict=True))
   arestas = arestas[
       (arestas["u"] < arestas["v"])
       | ~arestas.apply(lambda linha: (linha["v"], linha["u"]) in pares, axis=1)
   ]
   ```
   mantém uma única aresta por par não ordenado (a de `u < v`, ou qualquer uma se o par reverso não existir), preservando o mesmo `custo_acessivel`/`custo_reverso` nos dois sentidos. Esse deduplicação acontece **antes** do recorte final pela área piloto (passo seguinte), não depois.

5. **`_recortar_para_area_piloto`**: mantém só nós cuja geometria está de fato dentro da união dos três polígonos exatos (não só da bbox) e arestas cujas duas extremidades sobreviveram — garante que todo `source`/`target` gravado em `via_pedestre` tem o nó correspondente em `no_pedestre`, e é a garantia que `test_nos_referenciados_existem` valida depois.

6. **`_gdf_nos`/`_gdf_arestas`** montam os `GeoDataFrame` finais. Antes, `_preencher_colunas` garante que toda coluna esperada exista no GeoDataFrame (preenchida com `None` se faltar) — necessário porque o `osmnx` só cria uma coluna se pelo menos uma feição do recorte tiver aquela tag; sem isso, um recorte pequeno onde nenhuma via tem `incline`, por exemplo, quebraria com `KeyError`. Aplicam-se então `classificar_kerb`, `esquema_calcada`, `fator_custo` e `comprimento_m` por aresta, além de `_parse_width` — que converte a tag `width` (texto solto como `"1.5"`, `"1,5"` ou `"1.5 m"`) para metros na coluna `width_m`, tratando vírgula decimal e o sufixo `"m"`, e devolvendo `None` quando o valor está vazio ou não é conversível. Um detalhe de infraestrutura documentado explicitamente no código e no README como "armadilha conhecida": `GeoDataFrame.to_postgis` grava por padrão numa coluna chamada `geometry`, mas as tabelas do projeto usam `geom` — sem `gdf.rename_geometry("geom")` antes de gravar, o Postgres falha com `find_srid(): could not find the corresponding SRID` (a coluna `geometry` simplesmente não existe na tabela). As duas funções terminam sempre com esse `rename_geometry`.

7. **`executar(engine, *, pbf=None)`** orquestra tudo dentro de `registrar_execucao`/`concluir_execucao`; o parâmetro `pbf` (opcional) permite passar um PBF pequeno já em disco, usado pelos testes de qualidade para não precisar baixar 858 MB a cada corrida de CI. A carga em si é `DELETE FROM via_pedestre; DELETE FROM no_pedestre;` seguido dos dois `to_postgis` — recarga completa, não incremental (coerente com o fato de o ETL rodar semanalmente sobre uma área piloto pequena, não em produção contínua com milhões de linhas).

Resultado real (14/09/2026): **18.333 `no_pedestre`**, **25.040 `via_pedestre`**, 174 escadas (todas bloqueadas), 3.838 nós com `kerb` preenchido, `esquema_calcada` com 3.088 `geometria_propria` / 3.342 `atributo_via` / 18.610 `via_generica`.

### `geosampa.py` — WFS paginado, com verificação de truncamento

O WFS (*Web Feature Service*, um protocolo OGC padrão para consultar feições geográficas por HTTP) do GeoSampa tem um comportamento perigoso, documentado tanto no docstring do módulo quanto no README: ele **trunca resultado em silêncio** — devolve HTTP 200, sem qualquer erro — se a paginação não for feita corretamente. O módulo lida com isso de duas formas.

A `data_referencia` gravada em toda linha de `calcada_sp` é fixa no código: `DATA_REFERENCIA = date(2021, 8, 13)` — a data de publicação do levantamento de calçadas do GeoSampa, não a data em que o ETL rodou. Isso é deliberado: o GeoSampa não versiona por data de download, só por data do próprio levantamento cadastral; é diferente do SP156, que usa a maior `Data de Abertura` do CSV baixado como referência de cada carga (ver `sp156.py` mais abaixo).

Primeiro, `contar(bbox)` faz uma requisição com `resultType=hits` para saber de antemão quantas feições o servidor promete devolver (`numberMatched`):

```python
def contar(bbox, sessao=None) -> int:
    ...
    resposta = sessao.get(URL_GEOSAMPA_WFS, params=params, ...)
    correspondencia = re.search(r'numberMatched="(\d+)"', resposta.text)
    if not correspondencia:
        raise TruncamentoWFS(...)
    return int(correspondencia.group(1))
```
Curiosidade de implementação: mesmo pedindo `outputFormat=application/json`, o GeoServer devolve XML quando `resultType=hits` (não há feições para serializar em JSON) — por isso a contagem usa regex sobre o texto bruto da resposta em vez de `response.json()`.

Segundo, `paginar(bbox, count=2000, sessao=None)` é um gerador que itera páginas por `startIndex`, soma o `numberReturned` de cada uma, e só ao final compara a soma acumulada contra o `numberMatched` reportado:

```python
while True:
    params = {..., "count": count, "startIndex": start_index,
              "sortBy": "cd_identificador_calcada"}
    resposta = sessao.get(URL_GEOSAMPA_WFS, params=params, ...)
    dados = resposta.json()
    numero_esperado = dados["numberMatched"]
    retornadas = dados["numberReturned"]
    total_retornado += retornadas
    yield from dados["features"]
    if retornadas == 0 or retornadas < count:
        break
    start_index += retornadas
    time.sleep(1)

if total_retornado != numero_esperado:
    raise TruncamentoWFS(...)
```

A condição de parada (`retornadas < count`) é a ingênua e potencialmente errada se usada sozinha — é exatamente o que `test_geosampa_paginacao.py::test_paginar_levanta_truncamento_quando_soma_nao_bate` testa: uma página menor que `count` que, somada às anteriores, ainda fica abaixo do `numberMatched` real, e o teste garante que isso levanta `TruncamentoWFS` em vez de terminar silenciosamente. O `sortBy=cd_identificador_calcada` é necessário porque a paginação WFS 2.0 exige uma ordenação explícita e estável entre páginas — sem isso, a mesma feição pode aparecer em duas páginas ou nenhuma. O README registra que isso foi testado ao vivo contra o serviço real (14/09/2026) e funciona sem precisar do sufixo `+A` (ordem ascendente explícita) nem de subdividir a bbox — simplificações que o plano original previa como possivelmente necessárias.

`_numero(valor)` converte para `float`, tratando nulo/inválido como `0.0` — e o docstring é explícito sobre a semântica: **"0 = não medido" no GeoSampa, não uma medição real de largura/declividade zero.** A distinção fica a cargo de colunas geradas do banco (`largura_medida`, `declividade_medida` — colunas calculadas automaticamente pelo Postgres a partir de outras colunas, não escritas diretamente pelo ETL), validadas com dado real: 21.952 linhas com `largura_medida = true` contra 470 `false`.

`_dentro_da_area_piloto` é o segundo filtro geométrico necessário: o parâmetro `bbox` do WFS testa a **bounding box da feição** contra a bbox pedida, não a geometria exata — uma calçada cuja borda está fora do recorte, mas cuja bbox toca a bbox da consulta, ainda é devolvida. Sem este filtro final por `ST_Intersects`/`.intersects()`, o README registra que 402 linhas ficariam com geometria fora da área piloto.

`executar(engine)` roda as três bboxes de `AREA_PILOTO` em sequência, deduplicando por `cd_identificador_calcada` — necessário porque as bboxes de Vila Mariana e Ipiranga se sobrepõem num pequeno canto (definidas de forma independente no Plano 2), então a mesma calçada pode ser devolvida por mais de uma consulta. O `linhas` gravado em `etl_execucao` é deliberadamente a contagem **bruta** (antes do dedup) — é essa contagem, comparada a `esperado` (soma dos `numberMatched`), que valida ausência de truncamento; `test_wfs_nao_truncou` lê exatamente essas duas colunas da última execução `'ok'`.

Resultado real: `numberMatched` de **11.313 + 7.135 + 6.830 = 25.278** feições, 14 requisições HTTP, **22.422 `calcada_sp`** carregadas após dedup e filtro geométrico.

### `sp156.py` — CKAN, `cp1252` e a normalização de traço

O SP156 é o sistema de atendimento ao cidadão da prefeitura de SP; o CSV de reclamações é publicado via CKAN (uma plataforma de portal de dados abertos, usada por várias prefeituras e governos). O módulo tem três problemas de dados reais resolvidos explicitamente:

**Encoding.** O CSV é `cp1252` (Windows-1252), não UTF-8 nem latin-1 estrito — o docstring aponta que o campo `Serviço` mistura hífen comum com travessão, inclusive o **byte solto `\x96`**, que em cp1252 é o travessão curto (`–`), mas que exportações antigas do sistema deixam como byte cru sem re-codificar corretamente. `ler()` usa `pd.read_csv(caminho, sep=";", encoding="cp1252", usecols=COLUNAS, dtype=str)` — `dtype=str` para não deixar o pandas inferir tipos (evita, por exemplo, que um CEP ou código vire número e perca zeros à esquerda); `usecols=COLUNAS` restringe a leitura às oito colunas de fato usadas (`Data de Abertura`, `Data de Finalização`, `Assunto`, `Serviço`, `Status`, `Latitude`, `Longitude`, `Distrito`).

**Normalização de traço.**
```python
_TRAVESSAO = re.compile(r"\s*[–—\x96]\s*")

def normalizar_traco(s: str) -> str:
    return _TRAVESSAO.sub(" - ", s).strip()
```
Troca qualquer um dos três caracteres de travessão (en dash, em dash, ou o byte `\x96`) — cercados de espaço opcional — por `" - "` padronizado. O regex explicitamente **não** toca hífen comum (`-`), preservando "Tapa-buraco" como uma palavra composta, não como separador. Sem essa normalização, o mesmo serviço apareceria com textos ligeiramente diferentes entre trimestres e nunca bateria com o dicionário `CATEGORIAS`.

**`CATEGORIAS`** é o mapeamento de texto de serviço (já normalizado) para categoria da tabela `barreira_oficial`:

| Serviço (após `normalizar_traco`) | categoria |
|---|---|
| Acessibilidade - solicitar avaliação de obstáculo na calçada | `obstaculo_calcada` |
| Calçada pública - solicitar manutenção | `calcada_danificada` |
| Calçada particular - denunciar calçada danificada ou inexistente | `calcada_danificada` |
| Guias para travessia de pedestres - Solicitar rebaixamento | `guia_sem_rebaixamento` |
| Travessia de pedestres - Solicitar avaliação | `travessia` |
| Guias, sarjetas e sarjetões - solicitar manutenção | `guia_danificada` |
| Árvore - Solicitar avaliação em calçadas e praças | `raiz_de_arvore` |
| Tapa-buraco | `buraco` |

A comparação (`_chave_normalizada`) ignora acento e caixa via `unicodedata.normalize("NFKD", ...)` seguido de `.encode("ascii", "ignore")` — a fonte não usa as duas de forma consistente entre trimestres. Vale registrar uma limitação encontrada com dado real: a categoria `raiz_de_arvore` **não apareceu** no trimestre carregado (2º TRI 2026) porque o texto exato do serviço nesse trimestre tem palavras a mais no fim ("...para fins de poda ou remoção") que não batem com o texto fixo em `CATEGORIAS` — não é bug de normalização (a comparação funciona corretamente byte a byte), é uma categoria do serviço real da PMSP que mudou de nome.

**Descoberta da URL mais recente.** `descobrir_url()` consulta `package_show` do CKAN e escolhe, entre os recursos CSV cujo nome contém "sp156", o mais recente — mas não confia em `last_modified`:

```python
def _chave_periodo(nome: str) -> float | None:
    correspondencia = _PERIODO_NO_NOME.search(_chave_normalizada(nome))
    if not correspondencia:
        return None
    periodo, tipo, ano = correspondencia.groups()
    divisor = 4 if tipo == "tri" else 2
    return int(ano) + (int(periodo) - 1) / divisor
```
Extrai o período do próprio **nome** do recurso (ex. "Dados do SP156 - 2º TRI 2026" → `2026 + 1/4 = 2026.25`) e usa isso como chave de ordenação, só caindo em `last_modified`/`created` se nenhum candidato tiver nome reconhecível. A razão, documentada com um achado real e verificado ao vivo em 14/09/2026: o recurso "2º TRI 2021" tinha `last_modified` (17:29:39) *depois* do "2º TRI 2026" de fato mais novo (17:20:14) — porque alguém editou o metadado do recurso antigo mais tarde no CKAN. Confiar em `last_modified` teria baixado dados de cinco anos atrás pensando que eram os mais recentes. `descobrir_url` também tenta dois User-Agents (o do projeto, depois um de navegador) antes de cair no `URL_CSV_FALLBACK` fixo, caso o WAF (*Web Application Firewall*, camada de proteção que pode bloquear requisições por User-Agent suspeito) da prefeitura passe a filtrar.

`executar(engine)` lê o CSV, mapeia `categoria_de`, filtra linhas sem categoria reconhecida e fora da área piloto, e usa a maior `Data de Abertura` do arquivo como `data_referencia` (diferente do GeoSampa, que usa uma data fixa — aqui a "data de referência" é a da própria carga, porque o SP156 realmente muda a cada trimestre). Resultado real: 463.686 linhas no CSV inteiro, 34.134 batendo alguma categoria, **1.865 dentro da área piloto**, por categoria: 1.223 `buraco`, 242 `guia_danificada`, 220 `calcada_danificada`, 109 `obstaculo_calcada`, 50 `travessia`, 21 `guia_sem_rebaixamento`.

### `gtfs.py` — feed sem campos de acessibilidade, por design

O GTFS (*General Transit Feed Specification*, formato padrão para dados de transporte público) da SPTrans é baixado anonimamente de uma URL **http** (não https — confirmado em pesquisa anterior do projeto, `docs/pesquisa/2026-09-08-sptrans.md`). O ponto central deste módulo é uma decisão de projeto tornada código: o feed atual **não tem** nenhum campo de acessibilidade (`wheelchair_boarding` em `stops.txt`, `wheelchair_accessible` em `routes.txt`, nem os arquivos `pathways.txt`/`levels.txt`/`calendar_dates.txt`). Em vez de simplesmente ignorar esses campos se algum dia aparecerem, o módulo **falha alto**:

```python
class GtfsComCamposDeAcessibilidade(Exception):
    """O feed passou a trazer arquivo(s)/campo(s) de acessibilidade que o
    escopo do projeto não previa; revisar antes de seguir..."""

def _verificar_sem_campos_de_acessibilidade(caminho_zip) -> None:
    with zipfile.ZipFile(caminho_zip) as zf:
        nomes = set(zf.namelist())
        arquivos_inesperados = ARQUIVOS_ACESSIBILIDADE & nomes
        if arquivos_inesperados:
            raise GtfsComCamposDeAcessibilidade(...)
        for arquivo, campos in CAMPOS_ACESSIBILIDADE.items():
            if arquivo not in nomes:
                continue
            with zf.open(arquivo) as f:
                cabecalho = f.readline().decode("utf-8-sig")
            colunas = {c.strip().strip('"') for c in cabecalho.strip().split(",")}
            campos_inesperados = campos & colunas
            if campos_inesperados:
                raise GtfsComCamposDeAcessibilidade(...)
```
A ideia: se a SPTrans um dia passar a publicar `wheelchair_boarding`, o escopo do projeto (hoje "GTFS só como seed de paradas e linhas, sem dado de acessibilidade de transporte") precisa ser **revisto por uma pessoa**, não silenciosamente ignorado — daí a exceção em vez de um `if` que descarta a coluna. Esse mesmo canário é re-testado sobre o zip cacheado por `test_qualidade_dados.py::test_gtfs_sem_campos_de_acessibilidade`.

O restante é direto: lê `stops.txt`/`routes.txt` do zip, filtra `stops` pela área piloto (`route`/`linha` entra inteira, "são poucas" — 1.362 no total), e monta `nome_curto` com uma cadeia de fallback (`route_short_name` → `route_long_name` → `route_id`) para nunca violar o `NOT NULL` da coluna, mesmo que um feed futuro venha com `route_short_name` vazio. Vale notar um detalhe de proveniência: `registrar_execucao(engine, "gtfs")` grava a execução em `etl_execucao` sob a chave `'gtfs'`, mas `fonte_id(engine, "sptrans")` grava a proveniência de cada `parada`/`linha` sob a chave `'sptrans'` — as duas tabelas têm vocabulários independentes (uma rastreia execuções do pipeline por módulo, a outra rastreia a fonte de dado por linha), então a diferença é proposital, mas fácil de confundir numa leitura rápida do código. Resultado real: 22.266 paradas no feed inteiro, **1.142 dentro do piloto**; 1.362 linhas, todas carregadas.

### `conflacao.py` — ligando OSM a GeoSampa sem misturar licenças

Este é o módulo mais denso do pacote — uma única query SQL complexa e um bug de biblioteca contornado com uma técnica não óbvia. A ideia central: `conflacao_via_calcada` guarda **só `via_id`, `calcada_id`, `distancia_m`, `confianca`, `metodo`, `buffer_m`** — nunca geometria, nunca um atributo copiado (largura, declividade). É a peça que resolve o conflito de licenças por modelagem: o OSM é ODbL e o GeoSampa é CC-BY-SA, licenças que não podem ser livremente misturadas numa única obra derivada; guardando só a **chave** que liga os dois, cada tabela continua sob sua própria licença e nenhuma delas "contamina" a outra. `test_conflacao_sem_geometria_nem_atributos` é o teste que garante essa invariante para sempre, mesmo que a migration mude no futuro.

**A query** (`_SQL_CANDIDATOS`) roda inteira em EPSG:31983 (métrico), usando a mesma expressão `ST_Transform(geom, 31983)` dos índices funcionais criados na migration 003 — condição para o planner do Postgres reconhecer e usar o índice GiST (*Generalized Search Tree*, o tipo de índice espacial do PostGIS) em vez de comparar geometricamente todas as ~25 mil vias contra as ~22 mil calçadas (561 milhões de pares, inviável). O `EXPLAIN` real citado no README confirma `Index Scan` e 4,2 s de execução.

Estrutura em três CTEs (*Common Table Expression*, um `WITH` nomeado dentro do SQL):

```sql
WITH v AS (
    SELECT id, esquema_calcada,
        ST_Transform(geom, 31983) AS g,
        ST_Buffer(ST_Transform(geom, 31983), 0.001, 'endcap=flat') AS g_fino,
        ST_Area(ST_Buffer(ST_Transform(geom, 31983), 0.001, 'endcap=flat')) AS area_fino
    FROM via_pedestre
),
c AS ( SELECT id, ST_Transform(geom, 31983) AS g FROM calcada_sp ),
cand AS (
    SELECT v.id AS via_id, v.esquema_calcada, c.id AS calcada_id,
        ST_Distance(v.g, c.g) AS distancia_m,
        ST_Area(ST_Intersection(v.g_fino, c.g)) / NULLIF(v.area_fino, 0) AS fracao_dentro
    FROM v JOIN c ON ST_DWithin(v.g, c.g, :buffer)
),
ranqueado AS (
    SELECT *,
        row_number() OVER (PARTITION BY via_id ORDER BY distancia_m, calcada_id) AS pos,
        lead(distancia_m) OVER (PARTITION BY via_id ORDER BY distancia_m, calcada_id) AS distancia_segundo
    FROM cand
)
SELECT via_id, calcada_id, distancia_m,
    CASE WHEN fracao_dentro >= 0.8 THEN 'contido' ELSE :metodo END AS metodo,
    CASE WHEN fracao_dentro >= 0.8 THEN 1.0 ELSE 1 - distancia_m / :buffer END AS confianca,
    ( fracao_dentro >= 0.8
      OR :metodo = 'mais_proximo'
      OR esquema_calcada = 'geometria_propria'
      OR distancia_segundo IS NULL
      OR distancia_segundo > 1.5 * GREATEST(distancia_m, 0.5)
    ) AS ligada
FROM ranqueado WHERE pos = 1
```

`cand` faz o único `JOIN` caro (`ST_DWithin`, "está a até `buffer` metros"). `ranqueado` usa duas *window functions* do Postgres: `row_number()` numera os candidatos de cada via por distância crescente, e `lead()` traz a distância do **segundo colocado** na mesma linha do primeiro — é o dado que a regra de desempate `mesmo_lado` precisa (comparar o 1º com o 2º candidato sem precisar de um segundo `SELECT`). A query final filtra `pos = 1` (só o candidato mais próximo de cada via) e aplica as regras de desempate, em ordem de prioridade:

1. **`contido`** — `fracao_dentro >= 0.8` (80% do comprimento da via dentro do polígono) vence sempre, independente do `metodo` pedido; `distancia_m = 0`, `confianca = 1.0`.
2. **`mesmo_lado`** — liga ao candidato mais próximo só quando ele **não é ambíguo**: a via já é a própria geometria da calçada (`esquema_calcada = 'geometria_propria'`, onde não existe "outro lado da rua" a confundir), ou não há segundo candidato dentro do buffer, ou o segundo está a mais de 1,5× a distância do primeiro. Um empate (dois lados da rua igualmente próximos) **não liga** — fica só contabilizado como "ambígua", de propósito, para nunca inventar um lado.
3. **`mais_proximo`** — sempre liga ao mais próximo dentro do buffer, sem regra de desempate; é a linha de base usada só pela calibração, nunca em produção.

**O bug do GEOS contornado.** O docstring do módulo (e o README) documentam um achado de robustez real: o GEOS 3.9.0 desta imagem (`pgrouting/pgrouting:latest`, PostGIS 3.5.2 — GEOS é a biblioteca C++ que o PostGIS usa por baixo para operações geométricas) tem um bug em que `ST_Intersection`/`ST_Difference` entre uma `LineString` e um `Polygon`/`MultiPolygon` **sempre devolve geometria vazia** — reproduzido até com o caso mais trivial possível (`LINESTRING(0 0,10 0)` contra um polígono que a contém inteira), independente de SRID, ordem dos operandos, ou o workaround usual (`ST_Buffer(geom, 0)`, que costuma "corrigir" geometrias inválidas mas aqui não ajuda). Isso significaria que não daria para calcular, com a expressão óbvia `ST_Length(ST_Intersection(via, calcada))`, quanto de uma via está dentro de uma calçada.

A solução: em vez de intersectar a **linha** com o polígono, a via é primeiro transformada numa **faixa fininha** (`ST_Buffer(via, 0.001, 'endcap=flat')` — um retângulo de 2 mm de largura ao longo da linha, sem arredondar nem alongar as pontas graças a `endcap=flat`), e a fração dentro é calculada como razão de **áreas** entre essa faixa e sua interseção com o polígono da calçada — uma operação **Polígono × Polígono**, que funciona corretamente nesta mesma instância do GEOS (confirmado à parte). Como a faixa é fininha o bastante, a razão de áreas aproxima com precisão suficiente a fração do comprimento da linha original contida no polígono.

Sobre a validação desse contorno: `etl/tests/test_conflacao_sql.py::test_regras_de_desempate_da_conflacao` insere dados sintéticos e confirma, entre outras coisas, que uma via **inteiramente contida** num polígono é de fato classificada como `'contido'` (com `confianca=1.0` e `distancia_m=0.0`) — ou seja, valida indiretamente que a razão de áreas se comporta como esperado no caso de sobreposição total. Vale registrar, porém, que a query final não devolve a coluna `fracao_dentro` (só `via_id, calcada_id, distancia_m, metodo, confianca, ligada`), e não há nenhum caso sintético no arquivo de teste que exercite e confira explicitamente uma fração *parcial* (por exemplo 0,5) de sobreposição — o restante do teste cobre as regras de desempate por distância (empate entre dois lados da rua; segundo candidato fora do buffer), não a métrica de área em si.

**`executar(engine, buffer_m=5.0, metodo="mesmo_lado", *, so_medir=False)`** valida `metodo` contra `METODOS_VALIDOS = {"mesmo_lado", "mais_proximo"}` (levanta `ValueError` para qualquer outro valor — inclusive `"contido"`, que não é um parâmetro de entrada válido, é só uma classificação que a própria query decide). Com `so_medir=True`, a query roda mas nada é gravado (nem em `conflacao_via_calcada`, nem em `etl_execucao`) — é o modo usado pela calibração, que roda a query dezenas de vezes seguidas. Com `so_medir=False` (padrão de produção), tudo acontece numa única transação: mede, recria a tabela do zero (`DELETE` + `INSERT` das linhas com `ligada=True`) e registra em `etl_execucao`.

Resultado real (buffer 5, `mesmo_lado`): **11.001 vias ligadas de 25.040 (cobertura 43,9%)** — 1.202 por `'contido'`, 9.799 por `'mesmo_lado'`; das 20.034 vias que tinham ao menos um candidato dentro do buffer de 5 m, 9.033 ficaram ambíguas (empate entre os dois lados da rua, deliberadamente não ligadas — as demais ~5.006 vias sequer tinham candidato dentro do buffer). Distância média das ligadas: 1,11 m.

### `calibracao_conflacao.py` e `gabarito_conflacao.csv` — como o buffer de 5 m foi escolhido

Este script não faz parte do pipeline de dados (`cli.py` não o chama) — é uma ferramenta de pesquisa, rodada à mão, que produz dois artefatos: o gabarito (`etl/gabarito_conflacao.csv`, commitado) e o relatório de calibração (`docs/pesquisa/2026-09-14-calibracao-conflacao.md`, também commitado).

**Gerar o gabarito automático.** `gerar_gabarito(engine, por_recorte=20)` roda uma query separada (`_SQL_CANDIDATOS_GABARITO`) que busca arestas com `esquema_calcada = 'geometria_propria'` cuja fração dentro de um único polígono do GeoSampa é `>= 0.95` (bem mais rigoroso que o `>= 0.8` do método `'contido'` de produção — aqui não pode haver dúvida nenhuma, é "verdade dada" para calibrar contra, não uma amostra do desempenho normal). O mesmo truque de faixa fininha/razão de áreas de `conflacao.py` é reaplicado aqui.

Uma armadilha real encontrada ao implementar: o campo natural para identificar uma via no gabarito seria `via_pedestre.osmid` (como o plano original pedia), mas **`osmid` não é único** em `via_pedestre` — o `osmnx` nem sempre consegue fundir todos os segmentos de uma via original do OSM num único trecho simplificado (por causa de `ATRIBUTOS_QUE_DIFEREM`, ver seção do `osm.py`), então o mesmo `osmid` pode identificar várias arestas com geometrias diferentes. Confirmado com dado real: **6.690 grupos de `osmid` duplicado** no total, 527 só dentro de `geometria_propria`. Gravar um `osmid` ambíguo no gabarito tornaria a avaliação indeterminada — a query filtra explicitamente `GROUP BY osmid HAVING count(*) = 1` antes de considerar candidatos, o que reduziu bastante a amostra automática (de 122/284/597 candidatos por recorte para só 20/4/3 depois do filtro de unicidade).

`_resolver_gabarito` ainda aceita `osmid` duplicado nas futuras linhas `manual_streetview` (a via toda, como aparece no Street View) — resolve para **todos** os `via_id` daquele `osmid` e considera acerto se **qualquer um** deles ligou certo (`_classificar`, abaixo).

**Classificação** (`_classificar`, função pura, sem I/O — testável com dados sintéticos):

| caso | condição |
|---|---|
| **inválido** | `via_osmid` não resolveu nenhum `via_id`, ou o `cd_identificador` esperado não existe mais em `calcada_sp` |
| **acerto** | pelo menos um `via_id` daquele `osmid` ligou (na conflação) exatamente à calçada esperada |
| **erro** | nenhum acertou, mas pelo menos um ligou a uma calçada **diferente** — a conflação decidiu, e decidiu errado |
| **sem_par** | nenhum ligou a nada — a conflação preferiu não decidir (candidato ambíguo, ou fora do buffer), não decidiu errado |

**`detectar_joelho`** procura o menor buffer a partir do qual os acertos param de crescer mais de 2 pontos percentuais em relação ao buffer anterior **enquanto** os erros continuam subindo — sinal de que aumentar o buffer só adiciona erro sem ganho real. Com o gabarito atual (só 27 linhas `automatico_contido`, todas testando a regra `'contido'`, que vence a disputa **independente do buffer**), essa curva ficou **constante em todo buffer testado** (24 acertos, 3 erros, de 2 a 15 m) — não há joelho, `detectar_joelho` devolve `(None, maior_buffer_testado)`.

Por isso `detectar_pico_cobertura` é quem de fato decide na prática atual: acha o buffer que maximiza a **cobertura** (% de arestas ligadas), critério que **é** sensível ao buffer no método `mesmo_lado`, porque a regra de desempate rejeita mais candidatos como empate conforme o buffer cresce e traz o lado oposto da rua para dentro do alcance. Em caso de empate de cobertura entre dois buffers testados, a função prefere o **menor** buffer (`max(..., key=lambda i: (cobertura_pct[i], -buffers[i]))`) — mesma cobertura com menos risco de ligar do lado errado da rua. Os números reais (tabela do relatório, método `mesmo_lado`): 34,2% (2 m) → 38,7% (3 m) → **43,9% (5 m, pico)** → 41,8% (8 m) → 41,9% (10 m) → 42,6% (15 m) — a cobertura cai depois do pico e só recupera parcialmente com buffers maiores. O pico em 5 m é o que fixa `BUFFER_CONFLACAO_M = 5.0` em `config.py`.

O relatório também documenta, como achado e não como correção (fora do escopo desta task), os **3 erros** que aparecem em todo buffer: são dois polígonos do GeoSampa sobrepostos no mesmo lugar, fazendo a via ficar a distância 0 de duas calçadas; o desempate de `conflacao.py` (`ORDER BY distancia_m, calcada_id`) escolhe a de menor `id`, nem sempre a certa segundo o critério mais rigoroso do gabarito.

**`gabarito_conflacao.csv`** tem 27 linhas, formato `via_osmid;calcada_cd_identificador;origem;observacao` (`;` como separador, conforme o plano), todas com `origem=automatico_contido` hoje. `ler_gabarito` recusa (com `ValueError`) qualquer `origem` fora de `{"automatico_contido", "manual_streetview"}` — protege contra erro de digitação que contaminaria a calibração em silêncio. `atualizar_gabarito` regenera só as linhas automáticas, preservando quaisquer linhas `manual_streetview` já presentes (a verificação humana no Street View não é refeita a cada corrida).

**Pendência explícita** (documentada no README, no relatório e no código): faltam as linhas `manual_streetview` (mínimo 40, verificação humana no Street View, prevista para as semanas 5–6 do plano). Enquanto elas não existirem, a calibração só testa a regra `'contido'` (insensível a buffer) e o critério de decisão fica no pico de cobertura, não no joelho de acertos — o código já está pronto para as duas origens, só falta o trabalho manual de preencher o CSV.

### `cli.py` — o ponto de entrada e o orquestrador `tudo`

```python
FONTES = ["osm", "geosampa", "sp156", "gtfs", "conflacao", "tudo"]
```

Cada subcomando isolado (`osm`, `geosampa`, `sp156`, `gtfs`, `conflacao`) faz um `import` **dentro** da função que o executa (`_executar_osm` importa `etl.osm` só quando chamada) — evita que `python -m etl.cli --help` precise carregar `osmnx`/`geopandas` (pesados) só para imprimir a ajuda, e facilita mockar cada `_executar_*` nos testes do orquestrador (`test_cli_tudo.py`, que faz `monkeypatch.setattr(cli, "_executar_osm", ...)`).

O subcomando `conflacao` expõe `--buffer`/`--metodo` como argumentos de linha de comando, com o valor calibrado (`BUFFER_CONFLACAO_M`/`METODO_CONFLACAO`) como padrão — permite rodar experimentos manuais com outro buffer sem editar código. O orquestrador `tudo`, por outro lado, **não** usa os padrões do subcomando isolado; chama `_executar_conflacao_tudo`, que passa `BUFFER_CONFLACAO_M`/`METODO_CONFLACAO` explicitamente — o comentário no código deixa claro que hoje são os mesmos valores por coincidência, mas isso poderia divergir no futuro se alguém mudasse só um dos dois lugares.

```python
def _tudo() -> int:
    motor = _engine_para_tudo()
    passos = [("osm", _executar_osm), ("geosampa", _executar_geosampa),
              ("sp156", _executar_sp156), ("gtfs", _executar_gtfs),
              ("conflacao", _executar_conflacao_tudo)]
    houve_erro = False
    for nome, executar in passos:
        try:
            resultado = executar(motor)
        except Exception as exc:
            houve_erro = True
            print(f"{nome}: ERRO — {exc}", file=sys.stderr)
        else:
            print(f"{nome}: {resultado}")
    return 1 if houve_erro else 0
```

A decisão de design central: cada fonte **já** registra sua própria linha de erro em `etl_execucao` (dentro do próprio `executar`, antes de relançar a exceção) — o orquestrador só precisa capturar a exceção por fonte para que **uma falha não impeça as demais de rodar**. Isso é o que garante que, se o download do OSM falhar por instabilidade de rede, o GeoSampa/SP156/GTFS ainda carregam normalmente na mesma execução semanal — só o código de saída final vira `1` para o CI/Actions marcar o job como falho. A conflação roda por último de propósito: depende de `via_pedestre` e `calcada_sp`, carregadas pelas duas primeiras fontes da lista. Note que a conflação já faz parte do orquestrador **no código atual** (é o quinto passo da lista `passos`); a medição de tempo abaixo, porém, é anterior a essa integração — foi feita quando `tudo` ainda rodava só as quatro fontes de dado.

Resultado real da corrida completa (14/09/2026, cache quente): ~2min24s de ponta a ponta, **as quatro fontes** (osm, geosampa, sp156, gtfs — a conflação ainda não tinha sido integrada ao orquestrador nessa medição específica) terminaram `ok`, saída `osm: {'nos': 18333, 'vias': 25040}`, `geosampa: {'calcadas': 22422, 'esperado': 25278}`, `sp156: {'barreiras': 1865}`, `gtfs: {'paradas': 1142, 'linhas': 1362}`, código de saída `0` — as contagens batem exatamente com as corridas isoladas, confirmando que `tudo` é só o encadeamento, sem efeito colateral entre fontes. A adição da conflação como quinto passo do orquestrador (mesma função `_tudo` mostrada acima) veio depois, junto da calibração do buffer.

### `etl/tests` — os dois tipos de teste e por que um deles "falha o build"

| arquivo | tipo | testa |
|---|---|---|
| `test_osm_regras.py` | unitário (sem banco) | `classificar_kerb`, `esquema_calcada`, `fator_custo`, `eh_via_de_pedestre` — 31 casos |
| `test_geosampa_paginacao.py` | unitário (sessão HTTP falsa) | `paginar` detecta truncamento; parâmetros corretos (`sortBy`, `count`, `startIndex`) |
| `test_sp156_leitura.py` | unitário (CSV sintético em `cp1252`) | `ler`, `normalizar_traco`, `_chave_periodo`, `descobrir_url` (com CKAN falso) |
| `test_conflacao_sql.py` | integração (marcador `integration`) | as regras de desempate (`contido`/empate/mais_próximo) com dados sintéticos, revertidos por `rollback`; `metodo` inválido levanta `ValueError` |
| `test_calibracao_conflacao.py` | misto (a maioria unitário, 2 de integração) | `_classificar`, `detectar_joelho`, `detectar_pico_cobertura`, round-trip do CSV do gabarito, `gerar_gabarito`/`_resolver_gabarito` contra o banco real |
| `test_cli_tudo.py` | unitário (com `monkeypatch`) | `tudo` roda as cinco fontes em ordem; continua após uma falhar; código de saída `0`/`1` |
| `test_qualidade_dados.py` | **integração**, `pytestmark = pytest.mark.integration` no módulo inteiro | ver abaixo |

**`conftest.py`** é o que decide, a cada execução do pytest, se os testes marcados `integration` rodam ou são pulados:

```python
def _banco_disponivel() -> bool:
    try:
        with create_engine(DATABASE_URL).connect() as conexao:
            conexao.execute(text("SELECT 1"))
        return True
    except Exception:
        return False

def pytest_collection_modifyitems(config, items):
    if _banco_disponivel():
        return
    pular = pytest.mark.skip(reason="banco indisponível em DATABASE_URL; rode docker compose up -d")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(pular)
```
`pytest_collection_modifyitems` é um *hook* do pytest chamado depois que todos os testes foram coletados, mas antes de rodarem — aqui ele testa a conexão uma única vez e, se falhar, marca todo teste com `integration` como `skip` (em vez de deixá-los falhar um por um com erro de conexão). Isso permite rodar `pytest etl/tests -q` no host sem Docker e ver só os unitários passarem, ou dentro do container com o banco no ar e ver os 75 (contagem mais recente registrada) passarem de verdade.

**`test_qualidade_dados.py` como "camada que falha o build".** Este é o arquivo mais importante do ponto de vista de engenharia de dados do projeto: ele não testa código isolado, testa **o estado do banco depois de uma carga real** — é a garantia de que o ETL não só "rodou sem exceção", mas produziu dados que respeitam as regras de negócio. Alguns exemplos, organizados por fonte:

- **OSM**: `test_via_pedestre_populada` (`>= 5000` linhas — um mínimo de sanidade, não um número exato, porque a contagem real varia um pouco entre corridas do Geofabrik), `test_nos_referenciados_existem` (nenhum `source`/`target` órfão), `test_kerb_yes_nunca_vira_acessivel` (a regra de negócio de `classificar_kerb` se sustenta com dado real, não só nos testes unitários), `test_degraus_bloqueiam` (todo `highway='steps'` tem `custo_acessivel >= 1_000_000`).
- **GeoSampa**: `test_wfs_nao_truncou` lê a última execução `'ok'` de `etl_execucao` e compara `linhas == esperado` — é o teste que fecha o ciclo da garantia contra truncamento silencioso descrita em `geosampa.py`, mas verificando o efeito real gravado no banco, não só o comportamento da função `paginar` isolada. `test_calcada_sem_zeros_mascarados` verifica que nenhuma calçada tem `largura_min_m = 0 AND largura_medida` (zero mascarando ausência) e que existe pelo menos uma linha `NOT largura_medida` (a distinção realmente acontece com dado real, não é uma coluna morta).
- **SP156**: `test_barreira_categoria_valida` garante que toda categoria gravada está em `CATEGORIAS.values()` — importa a constante direto do módulo de produção, então uma categoria nova adicionada ao código sem estar de fato nos dados não quebra o teste, mas uma categoria nos dados que não existe no código quebraria.
- **Conflação**: `test_conflacao_cobertura_minima` é o teste mais carregado de decisão de produto do arquivo inteiro — verifica que a cobertura real é `>= 30%` (o "gate" definido no spec do projeto) e, se cair abaixo, **falha de propósito**, com uma mensagem de erro que explica que a resposta não é "afrouxar o limiar", é uma decisão humana sobre tratar o OSM como fonte principal de topologia. `test_conflacao_sem_geometria_nem_atributos` é a guarda de licença descrita antes. `test_conflacao_confianca_coerente` e `test_conflacao_uma_calcada_por_aresta` verificam invariantes estruturais (nenhuma linha `'contido'` com confiança/distância diferente do esperado; nenhuma via ligada a mais de uma calçada).
- **GTFS**: `test_gtfs_sem_campos_de_acessibilidade` roda sobre o **zip cacheado em disco** (não sobre o banco) — um canário independente da carga, que pula (`pytest.skip`) se o zip não estiver em cache em vez de falhar, já que nem toda corrida de teste necessariamente rodou o GTFS antes.

É esse arquivo, especificamente, que o workflow `.github/workflows/etl.yml` roda depois de `python -m etl.cli tudo` no cron semanal — a frase "camada que falha o build" do enunciado desta seção é literal: se qualquer uma dessas asserções falhar, o job do GitHub Actions falha, e é assim que o projeto detecta uma regressão de qualidade de dados (uma fonte que mudou de formato, uma regra de negócio que parou de valer) sem depender de alguém notar manualmente.

### Contagens e tempos reais (consolidado)

| fonte | medido em | resultado principal | tempo (cache quente) |
|---|---|---|---|
| OSM | 14/09/2026 | 18.333 nós, 25.040 vias; 174 escadas; 3.838 nós com `kerb` | ~1min30s (~3min20s frio) |
| GeoSampa | 14/09/2026 | 22.422 `calcada_sp` (de 25.278 `numberMatched`, sem truncamento) | ~29s |
| SP156 | 14/09/2026 | 1.865 barreiras no piloto (de 463.686 linhas no CSV) | ~6s |
| GTFS | 14/09/2026 | 1.142 paradas, 1.362 linhas | ~2,1s |
| `tudo` (4 fontes, antes de a conflação ser integrada ao orquestrador) | 14/09/2026 | todas `ok`, saída 0 | ~2min24s |
| Conflação (5 m, `mesmo_lado`) | 14/09/2026 | 11.001/25.040 vias ligadas (cobertura 43,9%) | ~4,2s (query) |
| Calibração (6 buffers × 2 métodos) | 14/09/2026 | pico de cobertura em 5 m; joelho de acertos: nenhum (gabarito só automático) | ~52s |
| `pytest etl/tests -q` | 14/09/2026 | **75 passed** (com banco populado por `tudo` + conflação + calibração) | — |

### Limitações e pendências encontradas no código

- **`manual_streetview` do gabarito ainda não existe** (0 de um mínimo de 40 linhas previsto) — a calibração do buffer hoje só testa a regra `'contido'` (insensível a buffer); o critério de decisão real (`detectar_pico_cobertura`) é um proxy, não o critério ideal do plano (`detectar_joelho`). O código (`ler_gabarito`/`avaliar_buffer`) já aceita as duas origens sem mudança — falta só o trabalho humano de preencher o CSV.
- **3 erros do gabarito `automatico_contido`, em todo buffer testado** — causados por polígonos do GeoSampa sobrepostos no mesmo lugar (a via fica a distância 0 de duas calçadas); o desempate atual (`ORDER BY distancia_m, calcada_id`) às vezes escolhe a errada. Documentado como achado, não corrigido — mudar o desempate é considerado fora do escopo da task que descobriu o problema.
- **`DATABASE_URL_PROD` (Secret do GitHub) ainda não existe** — o workflow `.github/workflows/etl.yml` (cron semanal + `workflow_dispatch`) falha no primeiro passo (`python -m etl.cli tudo`) por erro de conexão até essa pendência ser resolvida pelo dono do projeto; comportamento esperado, documentado no README, não um bug do ETL.
- **`raiz_de_arvore` (categoria do SP156) não aparece nos dados do trimestre carregado** — o texto do serviço real da PMSP mudou (ganhou um sufixo "...para fins de poda ou remoção") em relação ao texto fixo em `CATEGORIAS`; não é tratado como bug porque a normalização funciona corretamente, é a fonte que mudou de texto — mas é uma categoria do dicionário que hoje nunca é atingida com os dados reais mais recentes.
- **`via_pedestre.osmid` não é único** (6.690 grupos duplicados) — consequência de como `osmnx.simplify_graph` funde segmentos; não é tratado como erro (é esperado dado o `ATRIBUTOS_QUE_DIFEREM`), mas obrigou a geração do gabarito a filtrar por unicidade de `osmid`, reduzindo a amostra automática disponível.
- **A validação sintética do contorno do bug do GEOS em `conflacao.py` é parcial** — `test_conflacao_sql.py` confirma o caso de sobreposição total (via inteiramente dentro de um polígono → classificada `'contido'`, confiança 1.0), mas não existe hoje nenhum caso sintético que exercite e confira explicitamente uma fração de sobreposição parcial (por exemplo 0,5); a query nem devolve a coluna `fracao_dentro` para fora. Não é um bug funcional (a classificação observável está coberta), mas é uma lacuna de cobertura de teste sobre o valor bruto da métrica.
</markdown_corrigido>


## 6. Frontend: React acessível

### Visão geral do frontend

O frontend mora em `frontend/` e é uma SPA (*single-page application*) em React 19 + TypeScript, servida como arquivos estáticos pelo Cloudflare Workers (ver `frontend/wrangler.jsonc`). Hoje ela cobre só o que o **Plano 1 — Fundação** exigia: três páginas de conteúdo (`/`, `/fontes`, `/acessibilidade`), consumo de um único endpoint real do backend (`GET /api/fontes`) e uma bateria de testes de acessibilidade automatizados. O endpoint de cálculo de rota (`POST /api/rotas`) já existe no backend e já tem tipos TypeScript gerados, mas **nenhuma tela ainda o chama** — isso fica para o Plano 5, discutido no fim desta seção.

O fio condutor de todo o código desta pasta não é "fazer bonito", é fazer o produto funcionar de ponta a ponta com teclado e leitor de tela, porque o público-alvo do Rota Falada SP inclui pessoas com baixa visão e usuários de leitor de tela navegando rotas a pé. Por isso quase todo arquivo aqui tem uma decisão de acessibilidade por trás, e o objetivo desta seção é explicar qual critério do WCAG 2.2 cada decisão atende.

### `package.json` — scripts e dependências

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "lint": "eslint .",
  "preview": "vite preview",
  "test": "vitest",
  "gerar-tipos": "openapi-typescript http://localhost:8000/openapi.json -o src/api/types.gen.ts"
}
```

- **`dev`** sobe o servidor de desenvolvimento do Vite (HMR — *hot module replacement*, recarrega só o módulo alterado sem perder o estado da página).
- **`build`** roda em duas etapas: primeiro `tsc -b` (modo *build* do TypeScript, usa `tsconfig.json`/*project references*, explicado abaixo) só para checar tipos — ele não gera JavaScript (`noEmit: true` no `tsconfig.app.json`) — e só se isso passar é que `vite build` de fato empacota. Ou seja, um erro de tipo quebra o build antes mesmo de o bundler rodar; é o "gate" de qualidade estática do frontend.
- **`lint`** roda o ESLint sobre o projeto inteiro usando o *flat config* de `eslint.config.js` (detalhado a seguir).
- **`test`** roda o Vitest (test runner compatível com a API do Jest, mas integrado ao Vite — reusa a mesma configuração de bundling/transformação dos testes).
- **`gerar-tipos`** é o comando que fecha o contrato entre backend e frontend: ele baixa o `openapi.json` que o FastAPI expõe automaticamente (gerado a partir dos modelos Pydantic do backend) e o converte num arquivo TypeScript só de tipos, sem lógica. Isso é explicado com mais detalhe na seção de `client.ts`/`types.gen.ts`.

Dependências de runtime (`dependencies`) são deliberadamente poucas:

| Pacote | Versão | Para que serve |
|---|---|---|
| `react` | `^19.2.8` | biblioteca de UI |
| `react-dom` | `^19.2.8` | *renderer* que conecta a árvore React ao DOM do navegador |
| `react-router` | `^7.18.3` | roteamento client-side (troca de "página" sem recarregar o documento); na v7 o pacote `react-router` sozinho já inclui os bindings de navegador (`BrowserRouter`, `Routes`, `NavLink` etc.), sem precisar de um pacote `-dom` separado |

`devDependencies` cobre quatro frentes:

| Frente | Pacotes | Papel |
|---|---|---|
| Build | `vite`, `@vitejs/plugin-react`, `typescript` | bundler, transform de JSX/Fast Refresh, compilador/checador de tipos |
| Lint | `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `eslint-plugin-jsx-a11y`, `globals` | qualidade estática de código e, em especial, `jsx-a11y` para acessibilidade estática (ver próxima seção) |
| Teste | `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event`, `@testing-library/jest-dom`, `vitest-axe`, `@types/node`, `@types/react`, `@types/react-dom` | runner, DOM simulado em Node, utilitários de teste centrados no usuário e o motor de auditoria de acessibilidade `axe-core` integrado ao Vitest |
| Contrato de API | `openapi-typescript` | gera `types.gen.ts` a partir do schema OpenAPI do backend |

Todos os pacotes acima existem de fato em `frontend/package.json` — não há dependência citada aqui que não esteja no arquivo, nem dependência real do arquivo que tenha ficado de fora desta lista.

### Configuração de build e qualidade

#### `vite.config.ts`

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
})
```

Este arquivo faz duas coisas em um só lugar, o que é possível porque o Vitest reaproveita a configuração do Vite: (1) configura o **build/dev server** — o plugin `@vitejs/plugin-react` ensina o Vite a transformar JSX/TSX e habilita o Fast Refresh; (2) configura os **testes**. `environment: 'jsdom'` diz ao Vitest para simular um DOM de navegador dentro do Node (sem isso, `render()` do Testing Library não teria `document`/`window` para desenhar componentes). `globals: true` injeta `describe`/`it`/`expect`/`vi` como globais, dispensando import em cada arquivo de teste. `setupFiles` aponta para `src/test/setup.ts`, que roda **antes de cada arquivo de teste** (ver seção de testes). `css: true` faz o Vitest processar de fato os imports de CSS em vez de ignorá-los — importante porque parte do contrato de acessibilidade deste projeto (foco visível, alvos de 44px) é visual/CSS, então os testes rodam contra estilos reais, não mockados.

#### `eslint.config.js` — o `jsx-a11y` em modo estrito

```js
export default defineConfig([
  globalIgnores(['dist', 'src/api/types.gen.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.strict,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
  },
])
```

É o *flat config* do ESLint 9 (um array de objetos de configuração, sucessor do antigo `.eslintrc`). Dois pontos merecem atenção:

- `globalIgnores(['dist', 'src/api/types.gen.ts'])` exclui o build e o arquivo **gerado automaticamente** do lint — faz sentido, porque ninguém edita `types.gen.ts` à mão (o próprio cabeçalho do arquivo avisa isso) e aplicar regras de estilo a código gerado só geraria ruído.
- `jsxA11y.flatConfigs.strict` é a peça central para esta seção. O plugin `eslint-plugin-jsx-a11y` tem presets em ordem crescente de rigor (`recommended` → `strict`); o projeto escolheu **`strict`**, que promove para erro (em vez de aviso, ou de nem existir) regras como: exigir `alt` em imagens, proibir `role`/`aria-*` inválidos ou redundantes, exigir que elementos com `onClick` também sejam alcançáveis/operáveis por teclado (`no-noninteractive-element-interactions`, `click-events-have-key-events`), proibir `tabIndex` positivo, exigir rótulos acessíveis em controles interativos, entre outras. Isso é um **lint estático** — roda em cima do JSX escrito, sem montar componente nenhum — e complementa o `vitest-axe`, que é uma auditoria **em runtime** sobre o DOM já renderizado (seção de testes). Os dois pegam classes de erro diferentes: o ESLint pega "você esqueceu de escrever isso direito" antes mesmo de rodar; o axe pega "o resultado renderizado, com toda a lógica condicional, ainda está correto".

As demais entradas do `extends` são padrão de qualquer projeto Vite+React+TS moderno: `tseslint.configs.recommended` traz regras cientes de tipos, `reactHooks` garante uso correto de hooks (regra das dependências de `useEffect`, por exemplo — relevante para `usePaginaAcessivel`, que depende disso para não recriar o efeito à toa), `reactRefresh.configs.vite` garante que cada arquivo exporte componentes de um jeito compatível com o Fast Refresh do `dev`.

#### `tsconfig.app.json`

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023", "DOM"],
    "module": "esnext",
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"],
    "allowArbitraryExtensions": true,
    "skipLibCheck": true,

    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",

    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

Este é o `tsconfig` que efetivamente tipa o código de `src/`. `tsconfig.json` (a raiz) não configura nada sozinho — ele só declara `"references"` para `tsconfig.app.json` (este) e `tsconfig.node.json` (que tipa `vite.config.ts`, que roda em Node, não no navegador — usa `module: "nodenext"` e `types: ["node"]`, em vez de `DOM`). Esse padrão de *project references* é o que permite ao `tsc -b` do script `build` compilar/checar os dois "mundos" (app no browser vs. config em Node) com regras de `lib`/`module` diferentes, sem conflito.

Pontos que valem explicação para quem não os viu antes:

- **`tsBuildInfoFile`**: aponta para onde o `tsc -b` guarda seu cache incremental (`./node_modules/.tmp/tsconfig.app.tsbuildinfo`). Graças a ele, uma segunda chamada a `tsc -b` só reprocessa os arquivos que mudaram desde a última checagem, em vez do projeto inteiro — é parte do que torna o modo *build* de *project references* mais rápido que rodar `tsc` "solto" a cada vez.
- **`allowArbitraryExtensions: true`**: permite importar arquivos com extensões que o TypeScript não reconhece nativamente (por exemplo, `import estilo from './botao.module.css'`) desde que exista uma declaração de tipo correspondente — não é usado hoje de forma visível no código (não há imports de CSS Modules em `src/`), mas mantém essa porta aberta sem exigir configuração adicional se o projeto passar a usá-la.
- **`skipLibCheck: true`**: pula a checagem de tipos dentro dos arquivos `.d.ts` de bibliotecas de terceiros (só confia nas declarações, sem reverificá-las). Isso acelera o build e evita que o projeto quebre por causa de um tipo mal declarado numa dependência que ele não controla.
- **`moduleResolution: "bundler"`**: diz ao TypeScript para resolver imports do jeito que um bundler moderno (o Vite) resolve — não do jeito que o Node resolve em runtime. É o que permite, por exemplo, importar `'./App'` sem sufixo mesmo sendo `App.tsx`.
- **`noEmit: true`**: o TypeScript aqui **nunca gera JavaScript**. Quem transpila de fato é o Vite/esbuild dentro do plugin React; o `tsc` só é usado como *checador de tipos* (por isso o script `build` roda `tsc -b` antes do `vite build`, como um portão de qualidade, e não como parte do pipeline de transpilação).
- **`verbatimModuleSyntax: true`**: obriga a marcar explicitamente imports que só existem em tempo de tipo com `import type`. É por isso que `src/api/client.ts` escreve `import type { components } from './types.gen'` — sem o `type`, essa opção geraria erro, porque o import não deixa nenhum traço em runtime (só é usado para anotar tipos) e o compilador quer que isso fique explícito no código-fonte, não inferido.
- **`erasableSyntaxOnly: true`**: recurso recente do TypeScript que restringe o código a uma sintaxe que pode ser **apagada** sem nenhuma transformação (nada de `enum` com valor, `namespace` com valor, parâmetros de construtor com modificador de visibilidade etc.). Isso alinha o projeto com o jeito que ferramentas como o Vite/esbuild (e o próprio Node, em suas versões recentes com *type stripping* nativo) tratam TypeScript: elas só apagam anotações de tipo, não reescrevem sintaxe.
- **`types: [...]`**: injeta três "pacotes de tipos ambiente" globalmente — `vite/client` (tipa `import.meta.env`, usado em `client.ts`), `vitest/globals` (tipa `describe`/`it`/`expect` como globais, complementando o `globals: true` do `vite.config.ts`) e `@testing-library/jest-dom` (tipa os matchers extras usados nos testes, como `.toHaveFocus()`).
- `noUnusedLocals`/`noUnusedParameters`/`noFallthroughCasesInSwitch` são travas de qualidade geral (código morto e `switch` sem `break` viram erro de compilação, não só aviso de lint).

### `index.html` e o idioma da página

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Rotas a pé em São Paulo sem escadas e barreiras, descritas em texto e lidas em voz alta." />
    <title>Rota Falada SP</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

O detalhe que mais importa aqui para acessibilidade é `<html lang="pt-BR">`, que satisfaz o **WCAG 3.1.1 (Language of Page)**. Isso não é cosmético: é o que diz ao leitor de tela (e, mais adiante no roadmap, à API `SpeechSynthesis` que vai ler os passos da rota em voz alta) **qual voz e quais regras de pronúncia usar**. Sem essa declaração, um leitor de tela configurado em inglês pode tentar ler texto em português com fonética inglesa — no contexto de um produto cujo diferencial é justamente "ouvir a rota", isso quebraria a experiência central. O `<div id="root">` é o único nó que o React controla; tudo dentro dele é substituído pela árvore React montada por `main.tsx`.

### Bootstrap da aplicação: `src/main.tsx`

```tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

`createRoot` é a API de montagem do React 19 (o "root" concorrente, que substitui o antigo `ReactDOM.render`). `StrictMode` faz o React, só em desenvolvimento, invocar componentes e efeitos duas vezes de propósito, para expor efeitos colaterais impuros — é relevante aqui porque `usePaginaAcessivel` tem um efeito com efeito colateral real (`document.title = ...` e `.focus()`); rodando em `StrictMode`, qualquer bug de "o foco pula duas vezes" ou "o título fica errado na segunda chamada" apareceria cedo. `BrowserRouter` é o roteador do `react-router` baseado na History API real do navegador (URLs limpas como `/fontes`, sem `#`) — isso é o motivo de o `wrangler.jsonc` do deploy declarar `"not_found_handling": "single-page-application"`: como não existe de fato um arquivo `fontes.html` no servidor, o Cloudflare Workers precisa devolver `index.html` para qualquer rota desconhecida e deixar o `react-router`, já no navegador, decidir qual componente renderizar a partir da URL.

### `App.tsx` — layout, navegação e rotas

```tsx
export default function App() {
  return (
    <>
      <SkipLink />
      <header>
        <nav aria-label="Principal">
          <ul className="menu">
            <li><NavLink className="alvo" to="/">Início</NavLink></li>
            <li><NavLink className="alvo" to="/fontes">Fontes</NavLink></li>
            <li><NavLink className="alvo" to="/acessibilidade">Acessibilidade</NavLink></li>
          </ul>
        </nav>
      </header>
      <main id="conteudo" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/fontes" element={<Fontes />} />
          <Route path="/acessibilidade" element={<Acessibilidade />} />
        </Routes>
      </main>
      <footer>
        <p>Dados do mapa © colaboradores do OpenStreetMap. Veja <Link to="/fontes">todas as fontes e licenças</Link>.</p>
      </footer>
    </>
  )
}
```

Ordem de leitura/DOM importa aqui, e não é coincidência:

1. **`<SkipLink />` é o primeiro elemento do documento.** Isso atende ao **WCAG 2.4.1 (Bypass Blocks)**: quem navega só por teclado precisaria, sem esse link, apertar Tab várias vezes passando por todos os itens do menu antes de chegar ao conteúdo em cada página — o skip link deixa isso em um Tab só.
2. **`<nav aria-label="Principal">`** nomeia explicitamente o *landmark* de navegação. Isso importa porque uma página pode ter mais de um `<nav>` (aqui já existe potencialmente o link do rodapé, e o roadmap prevê mais navegação); sem um nome, leitores de tela anunciariam "navegação" genérica todas as vezes, sem distinguir qual é qual — parte do **WCAG 1.3.1/4.1.2 (Info and Relationships / Name, Role, Value)**.
3. `NavLink` (em vez de `Link`) aplica automaticamente `aria-current="page"` no link da rota ativa — um recurso do `react-router`, não escrito à mão aqui — o que dá ao leitor de tela e a estilos CSS (`:aria-current`) uma forma de indicar "você está aqui" de forma semanticamente correta, em vez de só uma classe visual.
4. `<main id="conteudo" tabIndex={-1}>` é o alvo tanto do `href="#conteudo"` do skip link quanto (indiretamente) do fluxo de foco de cada página — `tabIndex={-1}` torna um elemento **focável via script/fragmento de URL sem entrar na ordem normal de Tab**, que é exatamente o que se quer: o usuário só cai ali ao ativar o skip link ou por navegação de rota, nunca ao apertar Tab no meio do fluxo normal.
5. O rodapé cumpre a exigência de atribuição da licença ODbL do OpenStreetMap (ver `Fontes.tsx`/`types.gen.ts` mais abaixo) em todas as páginas, não só na página de fontes.

### Os dois pilares de acessibilidade em `src/a11y/`

#### `SkipLink.tsx`

```tsx
export function SkipLink() {
  return (
    <a className="skip-link" href="#conteudo">
      Pular para o conteúdo
    </a>
  )
}
```

Componente deliberadamente pequeno: é um `<a>` comum apontando para o `id="conteudo"` do `<main>`. Toda a "mágica" de ficar invisível e aparecer só ao receber foco está no CSS (`.skip-link` em `index.css`, explicado adiante) — o componente em si só garante que o link exista e seja **o primeiro elemento focável do documento**.

#### `usePaginaAcessivel.ts`

```ts
const SUFIXO = ' · Rota Falada SP'

export function usePaginaAcessivel(titulo: string) {
  const h1Ref = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => {
    document.title = titulo + SUFIXO
    h1Ref.current?.focus()
  }, [titulo])

  return h1Ref
}
```

Esse hook é o mecanismo central de acessibilidade de **navegação por rota** do projeto, e existe por um motivo muito concreto: numa SPA, trocar de "página" **não recarrega o documento**. Num site tradicional, cada navegação é uma nova página HTML — o navegador reseta o foco para o topo e anuncia o novo `<title>` sozinho. Numa SPA isso não acontece de graça: se ninguém fizer nada, o usuário de leitor de tela clica em "Fontes", o DOM troca de conteúdo por baixo, mas o foco continua fisicamente em cima do link "Fontes" no menu e o título da aba não muda — a pessoa não tem nenhum sinal de que algo mudou. Esse é um dos bugs de acessibilidade mais comuns e mais graves em SPAs.

`usePaginaAcessivel` resolve isso com duas ações, cada uma mapeada a um critério do WCAG 2.2:

- `document.title = titulo + SUFIXO` → **2.4.2 (Page Titled)**: cada página tem um título único e descritivo (ex.: "Fontes de dados e licenças · Rota Falada SP"), que é o que a aba do navegador mostra e o que muitos leitores de tela anunciam ao detectar a troca.
- `h1Ref.current?.focus()` → **2.4.3 (Focus Order)**: move o foco do teclado para o `<h1>` da nova página, simulando o que aconteceria numa navegação de página inteira. Isso faz o leitor de tela anunciar imediatamente o `<h1>`, que é o resumo mais curto do que a página é.

Duas decisões de implementação valem nota:

- O hook devolve uma **ref**, não recebe uma; cada página é responsável por fazer `<h1 ref={h1} tabIndex={-1}>`. O próprio arquivo documenta essa regra em um comentário JSDoc logo acima da função ("O h1 precisa ter tabIndex={-1} e receber a ref devolvida"), mas isso é um **contrato manual, não garantido pelo compilador nem pelo ESLint**: se uma página futura esquecer o `tabIndex={-1}` no `h1`, `h1Ref.current.focus()` simplesmente não faz nada (elementos não interativos sem `tabIndex` ignoram `.focus()` silenciosamente, sem erro). É uma limitação real do desenho atual — só os testes de `App.test.tsx`/`Acessibilidade.test.tsx`, que checam `toHaveFocus()`, pegariam o esquecimento, e só se alguém escrever um teste para a página nova.
- O array de dependências `[titulo]` faz o efeito rodar de novo sempre que o título muda — como cada página passa uma string literal diferente (`'Início'`, `'Fontes de dados e licenças'`, `'Declaração de acessibilidade'`), trocar de rota naturalmente dispara o efeito de novo, mesmo sem nenhuma lógica de detecção de rota explícita no hook.

### As páginas em `src/pages/`

| Página | Rota | O que faz |
|---|---|---|
| `Inicio.tsx` | `/` | Página estática de apresentação; deixa explícito no texto que "o cálculo de rotas ainda não está disponível nesta versão" — o código é honesto sobre seu próprio escopo atual. |
| `Fontes.tsx` | `/fontes` | Busca `GET /api/fontes` no backend e lista cada fonte de dados com licença, data e atribuição. |
| `Acessibilidade.tsx` | `/acessibilidade` | Declaração de acessibilidade estática, exigida por lei (a página cita explicitamente o art. 63, §1º, da Lei Brasileira de Inclusão — Lei 13.146/2015 — e declara conformidade com WCAG 2.2 nível AA, tendo eMAG 3.1 e ABNT NBR 17225:2025 como referências nacionais). |

Todas as três chamam `usePaginaAcessivel(titulo)` e repetem o mesmo padrão `<h1 ref={h1} tabIndex={-1}>titulo</h1>` — é o contrato manual descrito acima, aplicado de forma consistente nas três páginas hoje existentes.

`Fontes.tsx` é a única com estado assíncrono e por isso é a mais instrutiva:

```tsx
const [fontes, setFontes] = useState<Fonte[] | null>(null)
const [erro, setErro] = useState<string | null>(null)

useEffect(() => {
  listarFontes()
    .then(setFontes)
    .catch((e: unknown) => setErro(e instanceof Error ? e.message : String(e)))
}, [])
```

e na renderização:

```tsx
{erro && <p role="alert">{erro}</p>}
{!fontes && !erro && <p role="status">Carregando fontes…</p>}
```

`role="alert"` cria uma **região viva assertiva** (o leitor de tela interrompe o que estiver anunciando para falar o erro assim que ele aparece no DOM) e `role="status"` cria uma **região viva educada/*polite*** (anunciada quando o leitor de tela estiver livre, sem interromper). Isso atende ao **WCAG 4.1.3 (Status Messages)**: mudanças de estado que não movem o foco (carregando → carregou / carregando → deu erro) ainda assim precisam ser **anunciadas**, porque quem não enxerga a tela não veria o spinner nem o texto de erro aparecer sozinho. Vale notar que este é o único lugar do código atual com uma região viva — o roadmap do Plano 5 fala em consolidar isso numa "região viva única" para toda a aplicação (mais abaixo).

Há também um pequeno cuidado de fuso horário em `formatarData`:

```ts
function formatarData(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR')
}
```

O backend manda datas como `"2021-08-13"` (só data, sem hora). Se essa string fosse passada direto para `new Date(...)`, o JavaScript a interpretaria como meia-noite em **UTC**, e ao converter para um fuso horário atrás de UTC (como o horário de Brasília) o `toLocaleDateString` poderia exibir o dia anterior — um bug de off-by-one bem conhecido em JS. Completar com `'T00:00:00'` força o `Date` a interpretar a string como hora **local**, evitando esse deslocamento. Note também que `data_referencia` é opcional no schema (`string | null`) e a renderização em `Fontes.tsx` só chama `formatarData` quando o campo existe (`{f.data_referencia && <>Dados de {formatarData(f.data_referencia)}. </>}`) — é o caso, por exemplo, da fonte OpenStreetMap nos testes, que não tem data de referência única.

### Tipos gerados do backend: `src/api/client.ts` e `types.gen.ts`

```ts
import type { components } from './types.gen'

export type Fonte = components['schemas']['FonteOut']

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export function apiUrl(caminho: string): string {
  return BASE + caminho
}

export async function listarFontes(): Promise<Fonte[]> {
  const resposta = await fetch(apiUrl('/api/fontes'))
  if (!resposta.ok) {
    throw new Error(`Não foi possível carregar as fontes (HTTP ${resposta.status}).`)
  }
  return resposta.json()
}
```

`types.gen.ts` (351 linhas, cabeçalho `// This file was auto-generated by openapi-typescript. Do not make direct changes to the file.`) não é escrito à mão: é produzido pelo script `gerar-tipos` (`openapi-typescript http://localhost:8000/openapi.json -o src/api/types.gen.ts`), que se conecta ao backend FastAPI **rodando localmente** e lê `/openapi.json` — um documento que o próprio FastAPI gera automaticamente a partir dos modelos Pydantic dos endpoints. O `openapi-typescript` converte esse schema JSON (que segue a especificação OpenAPI/JSON Schema) em tipos TypeScript puros — sem nenhum código executável, só `interface`/`type`. Isso fecha o contrato entre as duas linguagens: se um campo do backend muda de nome ou de tipo (por exemplo, se `distancia_m` virasse opcional), regerar este arquivo faria o `tsc -b` do frontend **falhar** em qualquer lugar do React que dependesse do formato antigo — um erro de compilação em vez de um bug descoberto em produção.

O arquivo expõe três blocos:

- **`paths`**: os três endpoints atuais do backend — `/health`, `/api/fontes`, `/api/rotas` — cada um com seu verbo HTTP mapeado para uma `operation`.
- **`components.schemas`**: os modelos de dados propriamente ditos. Já existem tipos completos para `FonteOut`, `HealthOut`, `Coordenada`, `PerfilAcessibilidade`, `RotaIn`, `RotaOut`, `Passo`, `Aviso`, `BarreiraResumo`, `ValidationError`/`HTTPValidationError` (o formato padrão de erro 422 do FastAPI/Pydantic). O tipo `Passo`, por exemplo, traz `ordem`, `instrucao`, `distancia_m`, `duracao_s`, `direcao`, `largura_m`/`largura_medida`, `declividade_pct`/`declividade_medida`, `guia` (`"transponivel" | "nao_transponivel" | "desconhecida"`), `is_degrau`, `barreiras_proximas` (lista de `BarreiraResumo`), `fonte`, `data_referencia` e `geometria` — ou seja, cada passo já carrega tanto a instrução textual quanto os dados brutos de acessibilidade (guia rebaixada, degrau, largura, declividade) que sustentam essa instrução.
- **`operations`**: liga cada rota a seu tipo de requisição/resposta — por exemplo, `criar_rota_api_rotas_post` amarra `RotaIn` (corpo da requisição) a `RotaOut` (resposta 200) e a `HTTPValidationError` (resposta 422).

`client.ts` é a camada fina que **usa** esses tipos gerados: hoje ela só declara `export type Fonte = components['schemas']['FonteOut']` e a função `listarFontes()`. Do lado de rotas, os tipos `RotaIn`/`RotaOut` já existem no arquivo gerado — o backend, no Plano 4, já implementou `POST /api/rotas` de verdade — mas **nenhuma função em `client.ts` os consome ainda**, e nenhuma tela chama esse endpoint. Isso é exatamente o trabalho que falta e que abre o Plano 5: escrever, por exemplo, uma `criarRota(entrada: RotaIn): Promise<RotaOut>` e uma tela de busca que a chame.

Dois detalhes de robustez de `client.ts`: `apiUrl()` centraliza a URL base (lida de `import.meta.env.VITE_API_URL`, tipada em `src/vite-env.d.ts`, com fallback para `http://localhost:8000` em desenvolvimento) para que nenhuma outra parte do código precise saber o endereço do backend; e `listarFontes()` converte uma resposta HTTP não-OK em um `Error` com mensagem em português antes de propagar — é essa mensagem que acaba, sem tratamento adicional, dentro do `role="alert"` de `Fontes.tsx`.

```mermaid
flowchart LR
  BE["Backend FastAPI<br/>/openapi.json"] -- "npm run gerar-tipos" --> TG["src/api/types.gen.ts<br/>(tipos gerados)"]
  TG -- "import type" --> CL["src/api/client.ts<br/>(listarFontes)"]
  CL -- "fetch em runtime" --> API["GET /api/fontes"]
  API --> PG["src/pages/Fontes.tsx"]
  PG -- "usePaginaAcessivel" --> HOOK["a11y/usePaginaAcessivel.ts"]
  HOOK -- "title + foco no h1" --> SR["leitor de tela / aba do navegador"]
```

### `src/index.css` — o CSS que sustenta os critérios WCAG

```css
button,
.alvo {
  min-height: 44px;
  min-width: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 0.75rem;
}

:focus-visible {
  outline: 3px solid var(--cor-foco);
  outline-offset: 2px;
}

.skip-link {
  position: absolute;
  left: -999px;
  top: 0;
  z-index: 1000;
  background: var(--cor-fundo);
  color: var(--cor-texto);
  padding: 0.75rem 1rem;
}
.skip-link:focus {
  left: 0;
}

img, svg { max-width: 100%; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}
```

Cada regra aqui mapeia direto para um critério de sucesso:

- **Alvos de 44×44px** (`button`, `.alvo` — usado em `NavLink` no menu): o comentário no próprio arquivo já registra a decisão — "acima do mínimo AA (24px) por decisão de projeto". O WCAG 2.2 introduziu **2.5.8 (Target Size Minimum, AA)** exigindo 24×24px como piso; o projeto optou por 44px, que é o tamanho do critério AAA (**2.5.5, Target Size Enhanced**) e também a recomendação de plataformas móveis (iOS HIG, Material Design) — decisão sensata dado que o produto é pensado para uso a pé, no celular, possivelmente com mobilidade reduzida.
- **`:focus-visible`** com contorno de 3px e `outline-offset`: atende **2.4.7 (Focus Visible)** — garante que quem navega por teclado sempre veja onde está, usando a pseudo-classe moderna que só mostra o anel de foco quando o navegador julga que a interação foi por teclado (não pelo clique do mouse), evitando o efeito colateral comum de designers removerem `outline` para "limpar" o clique do mouse e acabarem quebrando o teclado.
- **`.skip-link`**: implementa o padrão "fora da tela até ganhar foco" com posicionamento absoluto (`left: -999px`) em vez de `display: none` — a diferença importa porque `display: none` tiraria o link da árvore de acessibilidade e da ordem de tabulação, o que quebraria o próprio propósito do skip link; com posicionamento, o elemento continua no DOM e focável, só não é visto até `:focus` trazê-lo de volta (`left: 0`).
- **`img, svg { max-width: 100% }`** faz parte do critério de **Reflow (1.4.10)**: a exigência de que o conteúdo se reorganize sem rolagem horizontal a 320px de largura com 400% de zoom — imagens que nunca estouram o contêiner são uma peça desse quebra-cabeça (o `main { max-width: 45rem; margin: 0 auto }` cuida do restante, limitando a largura de leitura sem impor rolagem lateral).
- **`prefers-reduced-motion: reduce`** desliga animações/transições/rolagem suave quando o sistema operacional do usuário pede menos movimento — atende **2.3.3 (Animation from Interactions, AAA)**, relevante para quem tem distúrbios vestibulares ou é sensível a movimento na tela.
- O bloco `:root`/`@media (prefers-color-scheme: dark)` define `--cor-foco`, `--cor-fundo`, `--cor-texto` como variáveis, com um conjunto de cores para claro (`#005a9c`/`#ffffff`/`#1a1a1a`) e outro para escuro (`#9ecbff`/`#121212`/`#f2f2f2`) — não há ainda uma checagem automatizada de contraste no código (isso ficaria a cargo de uma auditoria manual ou de uma ferramenta externa; o `axe-core` cobre estrutura/semântica, não é garantido que capture todo caso de contraste insuficiente em texto renderizado via JSDOM sem CSS de cor computada perfeitamente fiel).

### Testes de acessibilidade em `src/test/`

`setup.ts` roda antes de cada arquivo de teste (configurado em `vite.config.ts` → `test.setupFiles`):

```ts
import '@testing-library/jest-dom/vitest'
import * as axeMatchers from 'vitest-axe/matchers'
import { expect } from 'vitest'

expect.extend(axeMatchers)
```

Ele faz duas extensões ao `expect` do Vitest: `@testing-library/jest-dom/vitest` adiciona matchers de DOM como `.toHaveFocus()`, `.toBeInTheDocument()`, `.toHaveAttribute()`; `vitest-axe/matchers` adiciona `.toHaveNoViolations()`, que roda o motor `axe-core` (o mesmo motor por trás de extensões de navegador como o axe DevTools) sobre um container DOM e falha o teste se ele encontrar qualquer violação de acessibilidade — contraste, ARIA inválido, falta de rótulo, estrutura de heading quebrada etc. `src/test/vitest.d.ts` só declara esses matchers extras para o TypeScript (via `declare module 'vitest'`, estendendo `Assertion` e `AsymmetricMatchersContaining` com `AxeMatchers`), para que `expect(x).toHaveNoViolations()` não seja um erro de tipo.

Os três arquivos de teste garantem, cada um, um conjunto específico de comportamentos:

- **`App.test.tsx`**: (1) que o skip link é o **primeiro elemento focável** do documento (o teste tira o foco do `body` e simula um único `Tab`, então verifica que quem recebeu o foco foi o link "Pular para o conteúdo" apontando para `#conteudo`); (2) que abrir a rota `/` já deixa `document.title` como `"Início · Rota Falada SP"` e o `<h1>` com foco — validação direta do contrato de `usePaginaAcessivel`; (3) que a navegação principal tem os três links esperados, cada um com o `href` certo; (4) roda `axe(container)` na página inicial inteira e exige zero violações. Todas as renderizações usam um `<MemoryRouter>` envolvendo `<App>`, definido num helper local `renderizar(rota)`.
- **`Fontes.test.tsx`**: usa `vi.stubGlobal('fetch', ...)` para simular respostas do backend sem rede real (com `vi.unstubAllGlobals()` no `afterEach`), e cobre três cenários: lista renderizada corretamente (link, licença, data formatada em pt-BR — `13/08/2021` a partir de `2021-08-13` —, atribuição, mais `axe` sem violações); a chamada de fato bate no endereço configurado (`http://localhost:8000/api/fontes`, confirmando o `apiUrl()`); e uma resposta HTTP 503 aparece dentro de um elemento com `role="alert"` contendo o texto "HTTP 503" — ou seja, o teste garante não só que o erro aparece, mas que aparece **de um jeito que um leitor de tela anuncia**.
- **`Acessibilidade.test.tsx`**: garante que a página legal tem as quatro seções esperadas (`h2` "Meta de conformidade", "Recursos disponíveis", "Limitações conhecidas", "Como relatar um problema"), menciona "WCAG 2.2 nível AA" no texto, foca o `h1` e atualiza o título para `"Declaração de acessibilidade · Rota Falada SP"` — e roda `axe` no final.

Em conjunto, esses testes são a rede de segurança que faz o **jsx-a11y estático** (pega erros de sintaxe/estrutura antes de rodar) e o **axe em runtime** (pega o resultado renderizado de verdade, inclusive depois de fetch assíncrono) se complementarem, cobrindo tanto erros óbvios de marcação quanto regressões de comportamento (foco, título, regiões vivas).

### O que o Plano 5 ainda vai adicionar

O roteiro de planos (`docs/superpowers/plans/2026-09-13-roteiro-de-planos.md`) já descreve o escopo do Plano 5 — "Frontend da rota" (semanas 9–10) —, ainda não escrito em detalhe nem implementado (não existe hoje um `plano-05-*.md` na pasta `docs/superpowers/plans/`, só `plano-01-fundacao`, `plano-02-etl`, `plano-03-conflacao` e `plano-04-roteamento`), mas com contrato de API já fechado no backend (Plano 4). O entregável verificável listado na linha do Plano 5 do roteiro é:

- **Busca com autocomplete local**, consumindo um futuro `GET /api/geocode` do backend, com **Photon** como serviço de geocodificação de fallback quando a busca local não encontrar resultado.
- **Lista de passos canônica**: hoje o tipo `Passo` já existe em `types.gen.ts` (com `instrucao`, `distancia_m`, `duracao_s`, `direcao`, informações de guia rebaixada/degrau, barreiras próximas) — falta a tela que consome `RotaOut` e renderiza essa lista como o conteúdo principal e "oficial" da rota (o mapa é só ilustração redundante, não a fonte da informação, conforme já adiantado no texto de `Acessibilidade.tsx`: "Toda rota é apresentada como lista de passos em texto; o mapa é uma ilustração opcional").
- **Região viva única**: consolidar os anúncios de mudança de estado (hoje só existentes em `Fontes.tsx`, com `role="alert"`/`role="status"` isolados) numa única região viva compartilhada pela aplicação, para anunciar de forma consistente eventos como "rota calculada", "sem rota encontrada", "usando dados de fallback" etc. — o mecanismo de `role="alert"`/`role="status"` já usado em `Fontes.tsx` é o precedente de código que essa região vai generalizar.
- **Foco no `h1`**: já implementado e reutilizável via `usePaginaAcessivel` — a tela de busca de rota deveria seguir o mesmo padrão das três páginas atuais.
- **Mapa Leaflet redundante**, deliberadamente planejado para **só a segunda metade do plano** (semana 10): a decisão de projeto documentada no roadmap é que o mapa nunca deve ser a única forma de entender a rota, daí ele vir depois, como complemento visual, e não como pré-requisito do fluxo funcional.
- O **gate de saída** do plano deixa claro o padrão de qualidade esperado: "fluxo completo só por teclado e NVDA; Lighthouse ≥ 95; zero violações críticas" — ou seja, a mesma disciplina de teste que hoje cobre três páginas estáticas (skip link, foco de `h1`, `axe` sem violações) precisa se estender ao fluxo interativo de busca e leitura de rota, que é bem mais complexo em termos de estado (formulário, requisição assíncrona, mapa, lista longa de passos, anúncios de erro/sucesso).

Vale registrar, como limitação concreta hoje, que o *client* TypeScript (`client.ts`) e os tipos gerados (`RotaIn`/`RotaOut`) já estão prontos do lado de dados, mas a UI de busca de rota simplesmente não existe ainda no código — o que está descrito acima é o que falta, não o que já funciona.

### Sobras e pontas soltas verificadas no código

Três detalhes não afetam o funcionamento, mas valem registro para quem for arrumar a casa:

- `src/assets/hero.png` e `public/icons.svg` (junto de `src/assets/vite.svg` e `public/favicon.svg`) existem no repositório, mas uma busca por `hero.png`, `icons.svg` e `vite.svg` em `src/` e em `index.html` não encontra nenhuma referência a eles — são sobras do template padrão do Vite/React, ainda não usadas nem removidas.
- `frontend/README.md` ainda é o README genérico gerado pelo template Vite+React (fala em "Oxlint", em `@vitejs/plugin-react-swc` e em habilitar o "React Compiler" — nenhum desses três é usado ou mencionado em nenhum outro lugar do projeto real), não foi adaptado para descrever o Rota Falada SP.
- Não há checagem automatizada de contraste de cor no código (nem no CSS nem nos testes); o `axe-core` cobre estrutura/semântica/ARIA, mas contraste de texto renderizado não é validado por nenhum teste hoje visto.


## 7. Apêndice A — correções feitas pela verificação

Cada seção foi escrita por um agente e conferida por outro contra o código. Estas são as afirmações que o verificador considerou erradas e corrigiu no texto acima. Ficam registradas para você saber onde a leitura de código exige mais atenção.

- **Visão geral, infraestrutura e deploy** — .github/workflows/keep-alive.yml: O intervalo de cobertura em horário de Brasília está errado. UTC 10h–23h corresponde a BRT 7h–20h, e UTC 0h–2h corresponde a BRT 21h–23h (do dia anterior em UTC, mas mesmo dia local). Somados, os dois crons cobrem BRT 7h às 23h59 — não 'até as 3h'. O próprio comentário no arquivo `.github/workflows/keep-alive.yml` confirma isso: 'das 07h às 23h59 de Brasília (10h–02h59 UTC)'. Ou seja, o backend fica sem ping (e pode dormir) justamente de madrugada, das 0h às 7h BRT — o oposto do que o texto descreve. Correção aplicada: ...juntos cobrem das 7h às 23h59 de Brasília (ou seja, o backend só fica sem ping de madrugada, entre 0h e 7h) — evitando de propósito o minuto exato da hora cheia...
- **Visão geral, infraestrutura e deploy** — README.md: Impreciso: o item 6 do README não explica a razão de existir do keep-alive.yml (essa razão é o cold start do Render Free, coberta na seção 'Produção' do próprio README). O item 6 documenta, isso sim, um risco operacional que ameaça qualquer workflow agendado do repo (inclusive o `etl.yml`) — o GitHub desliga `schedule:` sozinho após 60 dias de inatividade. Vale manter a observação, mas sem dizer que é 'o motivo de existir' do workflow. Correção aplicada: Item 6 documenta um risco operacional que afeta qualquer workflow agendado do repositório, inclusive o `keep-alive.yml`: o GitHub desativa `schedule:` sozinho em repositórios públicos após 60 dias sem commits — então o cron que mantém o Render acordado (cuja razão de existir é o cold start do plano Free, não esse item) pode parar de rodar silenciosamente se o repo ficar parado.
- **Backend: núcleo (configuração, banco, modelos, schemas, rotas HTTP e migrations)** — backend/alembic/versions/002_fontes_oficiais.py: A migration 002_fontes_oficiais.py cria 8 tabelas via op.execute(), não 7: area_piloto, etl_execucao, no_pedestre, via_pedestre, calcada_sp, barreira_oficial, parada e linha. O downgrade() também confirma isso com 8 DROP TABLE. (O total de '11 tabelas de negócio sem modelo ORM', citado depois na seção de Limitações, está correto — é 002 sozinha que foi contada errado.) Correção aplicada: Trocar 'criando 7 tabelas' por 'criando 8 tabelas' e, mais adiante, 'downgrade() derruba as 7 tabelas' por 'downgrade() derruba as 8 tabelas'.
- **Backend: núcleo (configuração, banco, modelos, schemas, rotas HTTP e migrations)** — backend/alembic/versions/002_fontes_oficiais.py: Falso: `area_piloto` tem uma coluna `geom geometry(Polygon, 4326)` mas nenhuma migration (001 a 005) cria um índice GIST sobre ela — só 5 tabelas recebem esse índice em 002 (no_pedestre, via_pedestre, calcada_sp, barreira_oficial, parada); barreira_colaborativa e rota_cache ganham o seu próprio GIST em 004. area_piloto fica sem índice espacial em qualquer lugar do código. Correção aplicada: Trocar por algo como 'A maioria das tabelas com geometria recebe um índice GIST sobre geom [...]. A exceção é area_piloto: tem coluna geom (Polygon) mas nenhuma migration cria índice espacial sobre ela — plausivelmente porque a tabela guarda só 3 linhas fixas.'
- **Backend: serviços de roteamento** — backend/app/services/enriquecimento.py: Conflacao equals `None` in two distinct cases, not just 'no via within 10 m': (1) `via is None` (no `via_pedestre` within 10 m), OR (2) `via` was found but `_conflacao_da_via` returns no row (that `via_pedestre` has no matching `calcada_sp` via `conflacao_via_calcada`). In `enriquecimento.py` line 196: `conflacao = _conflacao_da_via(db, via["id"]) if via is not None else None`. The section's parenthetical equates the two, which understates a real code branch: a via CAN be found (its `is_degrau`/`kerb_transponivel` from OSM ARE used) while still having no GeoSampa largura/declividade data. Correção aplicada: Explicar que `conflacao is None` cobre dois cenários: nenhuma `via_pedestre` a 10 m (aí também `is_degrau`/`kerb_transponivel` caem para o valor de reserva do `PassoBruto`), OU uma `via_pedestre` foi encontrada mas não tem calçada conflada correspondente em `conflacao_via_calcada` (aí `is_degrau`/`kerb_transponivel` vêm do OSM normalmente, só largura/declividade ficam ausentes). O aviso `trecho_sem_dados` cobre ambos os casos.
- **Backend: serviços de roteamento** — backend/tests/casos_referencia.json: O 'presumivelmente' é desnecessário e impreciso: o consumo por testes de regressão é verificável e confirmado no código, não uma suposição. `backend/tests/services/test_rota.py` (linha 547: `_CAMINHO_CASOS_REFERENCIA = Path(__file__).resolve().parent.parent / "casos_referencia.json"`, funções `test_casos_referencia_cumprem_espera_com_pgrouting_real` e `test_casos_referencia_calculam_rota_com_fixtures_do_ors`) e `backend/tests/test_rotas_api.py` (linha 21: `_CASOS = json.loads((Path(__file__).parent / "casos_referencia.json").read_text(...))`) leem e usam esse arquivo diretamente. Correção aplicada: Trocar 'presumivelmente' por uma afirmação confirmada, citando os dois arquivos de teste que de fato leem `casos_referencia.json`: `backend/tests/services/test_rota.py` e `backend/tests/test_rotas_api.py`.
- **Backend: estratégia de testes** — backend/tests/ (listagem completa): Contagem errada. `backend/tests/` tem 9 arquivos de teste soltos (test_config.py, test_fontes.py, test_health.py, test_migracao_conflacao.py, test_migracao_fontes_oficiais.py, test_migracao_fundacao.py, test_migracao_roteamento.py, test_rotas_api.py, test_schemas_rota.py) e `backend/tests/services/` tem mais 7 (test_barreira_geom.py, test_barreira_geom_db.py, test_enriquecimento.py, test_ors_client.py, test_ors_fixture_client.py, test_pgrouting.py, test_rota.py) — 16 no total, não 15 (conftest.py não conta como arquivo de teste, é fixture/config). Isso bate com o fato de a tabela 'Cada arquivo de teste, o que garante' ter só 15 linhas: ela esqueceu de listar `test_rotas_api.py`. Correção aplicada: São 16 arquivos de teste no total (9 em `backend/tests/`, 7 em `backend/tests/services/`), cobrindo desde validação pura de Pydantic até o fluxo completo `POST /api/rotas` contra um banco PostGIS real.
- **Backend: estratégia de testes** — backend/tests/test_rotas_api.py: Lacuna: falta a linha de `test_rotas_api.py` na tabela de resumo por arquivo, o mesmo arquivo que o parágrafo anterior descreve em detalhe (422, 200 com todos os campos de Passo, cache, 404 vs 503). Correção aplicada: Adicionar linha `test_rotas_api.py | contrato HTTP | ...` na tabela, resumindo o que o arquivo garante.
- **Backend: estratégia de testes** — backend/app/schemas/rota.py: Incompleto/incorreto: em `backend/app/schemas/rota.py`, `inclinacao_max: Literal[3, 6, 10, "any"] = 6` — o domínio inclui também a string `"any"` (é o valor que `nivel_exigencia_atendido` pode assumir depois do fallback progressivo, conforme o próprio `test_rota.py` testa). Dizer que 'só aceita 3/6/10' é falso. Correção aplicada: `inclinacao_max` aceita `Literal[3, 6, 10, "any"]` (rejeita qualquer outro valor, como `5`, testado em `test_perfil_acessibilidade_rejeita_inclinacao_fora_do_dominio`); `guia_max_m` segue o mesmo padrão com `Literal[0.03, 0.06, 0.1, "any"]`.
- **Backend: estratégia de testes** — .github/workflows/ci.yml: Citação imprecisa do YAML: o `health-cmd` real inclui o parâmetro `-U postgres`. Correção aplicada: health-cmd `"pg_isready -U postgres"` (ver `.github/workflows/ci.yml`, linha 20).
- **Backend: estratégia de testes** — README.md; backend/ (ausência de README.md): Duplamente impreciso: (1) não existe arquivo `backend/README.md` no repositório — só há README em `docs/`, `etl/`, `frontend/` e na raiz; dizer que ele 'não tem seção de testes' sugere que o arquivo existe mas está incompleto, quando na verdade ele simplesmente não existe. (2) Os comandos `pytest -q` e `ruff check . ; ruff format --check .` ESTÃO centralizados em doc: a tabela 'Comandos' do `README.md` da raiz do projeto (linhas 66-71) já os lista para backend e frontend lado a lado — não são 'só inferíveis do pyproject.toml e do ci.yml'. Correção aplicada: Não existe um arquivo `backend/README.md` — a única documentação de como rodar os testes/lint do backend vive na tabela 'Comandos' do `README.md` da raiz do projeto (`pytest -q` e `ruff check . ; ruff format --check .`), que não detalha os marcadores `integration`/`dados_reais` nem o pré-requisito do ETL. Isso não muda a limitação real (nenhum job de CI roda `dados_reais`, dependendo de execução manual local pós-ETL), só a formulação de onde a lacuna de documentação está.
- **Backend: estratégia de testes** — backend/tests/test_migracao_roteamento.py: Impreciso tecnicamente: `sqlalchemy.exc.DBAPIError` é uma exceção do próprio SQLAlchemy que ENVELOPA o erro relatado pelo driver DBAPI subjacente (aqui, psycopg 3) — não é a exceção nativa que o psycopg levanta. Um leitor que nunca viu essa camada pode achar que está importando algo do psycopg. Correção aplicada: esperando `sqlalchemy.exc.DBAPIError`, a exceção com que o SQLAlchemy envelopa qualquer erro que o driver DBAPI subjacente (aqui, psycopg 3) reporte — nesse caso, a violação do `CHECK` constraint que o Postgres recusa.
- **ETL: carga das fontes oficiais e conflação** — etl/etl/osm.py: A ordem dos passos está invertida em relação ao código real de `etl/etl/osm.py::executar`. No código, a deduplicação de pares bidirecionais (`pares = set(zip(...))` / filtro `u < v`) roda logo após `ox.graph_to_gdfs(grafo)` e ANTES de `_recortar_para_area_piloto`; o texto descreve o recorte como passo 4 e a deduplicação como passo 5 ('antes de montar os GeoDataFrames finais'), o que sugere a ordem contrária à real. Correção aplicada: Trocar a ordem: o passo de deduplicação de pares bidirecionais vem logo depois de `ox.graph_to_gdfs`, e só depois disso roda `_recortar_para_area_piloto`. Ver linhas 281-292 de `etl/etl/osm.py`: `nos, arestas = ox.graph_to_gdfs(grafo)` → dedup (`pares = set(...)`) → `nos, arestas = _recortar_para_area_piloto(nos, arestas)`.
- **ETL: carga das fontes oficiais e conflação** — etl/tests/test_conflacao_sql.py: `etl/tests/test_conflacao_sql.py` tem só duas funções de teste (`test_regras_de_desempate_da_conflacao` e `test_metodo_invalido_recusado`). A primeira cobre três cenários de desempate (via totalmente contida → `'contido'`; empate entre dois lados da rua → ambígua com `mesmo_lado`/ligada com `mais_proximo`; segundo candidato fora do buffer → liga ao mais próximo), mas em nenhum deles o teste lê ou afirma o valor bruto de `fracao_dentro` — a consulta final (`_SQL_CANDIDATOS`) nem sequer devolve essa coluna, só `via_id, calcada_id, distancia_m, metodo, confianca, ligada`. Não existe nenhum caso sintético que produza ou verifique explicitamente uma fração de 0,5 (busca por `0.5` em todo `etl/` só encontra uma constante não relacionada em `conflacao.py`, `GREATEST(distancia_m, 0.5)`). Correção aplicada: O que de fato é validado em `test_conflacao_sql.py` é o comportamento observável da classificação: uma via inteiramente dentro de um polígono é classificada como `'contido'` com `confianca=1.0`/`distancia_m=0.0` (caso a — equivalente a uma fração ≈1.0 por trás dos panos), e os outros dois casos testam as regras de desempate por distância, não a fração de sobreposição. Não há, no código atual, um teste sintético que exercite e confira explicitamente uma fração parcial de 0,5 — essa frase parece ter sido herdada literalmente de uma linha do `etl/README.md` que descreve uma validação não encontrada no arquivo de teste atual.
- **ETL: carga das fontes oficiais e conflação** — etl/README.md: O `etl/README.md` documenta essa mesma medição (mesmos números, mesmo tempo ~2min24s) explicitamente como as **quatro** fontes ("os quatro downloads já em cache", "as quatro fontes terminaram ok") — e de fato só há quatro chaves na saída citada (`osm`, `geosampa`, `sp156`, `gtfs`; nenhuma entrada `conflacao: {...}`). O código atual de `etl/etl/cli.py::_tudo` já inclui a conflação como quinto passo (`passos = [("osm", ...), ("geosampa", ...), ("sp156", ...), ("gtfs", ...), ("conflacao", _executar_conflacao_tudo)]`), mas essa integração da conflação ao orquestrador `tudo` é documentada no README como algo que veio **depois** dessa medição específica de 2min24s (na seção de calibração: "python -m etl.cli tudo agora também roda a conflação com esses valores no final"). Ou seja, a frase "as cinco fontes terminaram ok" aplicada a essa medição específica está incorreta — a essa altura eram quatro. Correção aplicada: Trocar "as cinco fontes terminaram ok" por "as quatro fontes terminaram ok" nessa medição específica, e deixar claro que a conflação só foi adicionada ao orquestrador `tudo` depois dessa medição (mesmo que hoje, lendo o código atual de `cli.py`, `tudo` já rode cinco passos, incluindo a conflação por último).
- **ETL: carga das fontes oficiais e conflação** — etl/README.md: Mesma inconsistência da linha anterior: a medição de ~2min24s citada no README é explicitamente de quatro fontes (a conflação foi integrada ao orquestrador depois), não cinco. Correção aplicada: Ajustar para `tudo (4 fontes nessa medição — a conflação só foi integrada ao orquestrador depois)` ou equivalente, para não sugerir que os 2min24s incluíram a conflação.
- **Frontend: React acessível** — frontend/tsconfig.app.json: O bloco é apresentado como o conteúdo de `tsconfig.app.json`, mas omite três chaves que o arquivo real tem: `tsBuildInfoFile` (`./node_modules/.tmp/tsconfig.app.tsbuildinfo`), `allowArbitraryExtensions: true` e `skipLibCheck: true`. Como transcrição literal de um arquivo de configuração (que o leitor pode querer comparar com o próprio repo), isso é uma citação incompleta. Correção aplicada: Reproduzir o arquivo completo: `tsconfig.app.json` também define `tsBuildInfoFile: "./node_modules/.tmp/tsconfig.app.tsbuildinfo"` (cache incremental do `tsc -b`, para não reprocessar tudo a cada build) e `allowArbitraryExtensions: true` / `skipLibCheck: true` (este último pula a checagem de tipos dentro dos `.d.ts` de bibliotecas de terceiros, acelerando o build e evitando erros em tipos que o próprio projeto não controla).

## 8. Apêndice B — limitações e dívidas técnicas encontradas no código

Coisas incompletas, simplificações e pontos frágeis que os agentes viram ao ler o código. Não são erros de documentação; são trabalho futuro.

- **Visão geral, infraestrutura e deploy:** ~~Secret DATABASE_URL_PROD (GitHub Actions) ainda não existe~~ **Resolvido em 14/09/2026:** o secret foi criado e o ETL completo já rodou contra o Supabase de produção (mesmas contagens do banco local). O item 12 do README ainda descreve a pendência antiga e precisa ser atualizado.
- **Visão geral, infraestrutura e deploy:** Sem atualização incremental (.osc) do grafo OSM: cada execução do ETL reprocessa o .osm.pbf inteiro do zero (ADR 002)
- **Visão geral, infraestrutura e deploy:** Licença da SPTrans (Olho Vivo/GTFS) não é declarada publicamente pela fonte; atribuição é por convenção (DATA-LICENSES.md)
- **Visão geral, infraestrutura e deploy:** RLS habilitado sem nenhuma política: bloqueia toda a Data API do Supabase por igual, sem exceção granular para leitura pública de tabelas como fonte_dados
- **Visão geral, infraestrutura e deploy (lacuna apontada pelo verificador):** render.yaml também define `region: oregon`, `PYTHON_VERSION: 3.12.6` e `APP_ENV: prod` como envVars, além dos dois com sync:false — o texto original só mostrou um trecho do arquivo sem mencionar isso. O `region: oregon` é relevante para a arquitetura: o backend roda nos EUA (Oregon) enquanto o banco Supabase está em sa-east-1 (São Paulo) — toda query do backend ao banco cruza o continente duas vezes (ida e volta), o que soma latência a cada requisição, algo que vale citar no diagrama/discussão de arquitetura.
- **Visão geral, infraestrutura e deploy (lacuna apontada pelo verificador):** `app_env` é um campo declarado em `Settings` (backend/app/config.py, valor padrão 'dev') e setado como 'prod' no render.yaml, mas uma busca no código (`grep -rn "app_env" backend/app/`) mostra que hoje nada no backend lê essa variável — ela existe mas não tem efeito observável ainda. Pequena pendência que vale mencionar para o dono do projeto.
- **Visão geral, infraestrutura e deploy (lacuna apontada pelo verificador):** O ADR 001 menciona que a escolha de Python veio de uma comparação com 'três arquiteturas independentes e dois juízes técnicos' registrada em `docs/pesquisa/2026-09-08-painel-de-designs.md` — um método de decisão (painel comparativo, não só a opinião de uma pessoa) que a seção original não menciona e que enriquece o entendimento de como o ADR foi decidido.
- **Visão geral, infraestrutura e deploy (lacuna apontada pelo verificador):** O ADR 001 lista um quarto motivo de justificativa ('Nada exige performance de JVM: buffer, interseção e caminho mínimo rodam dentro do PostGIS, em C') que a seção original omitiu ao listar os motivos.
- **Visão geral, infraestrutura e deploy (lacuna apontada pelo verificador):** A tabela do DATA-LICENSES.md registra que a licença ODbL 1.0 das contribuições dos usuários foi uma 'decisão de 10/09/2026' (ou seja, uma escolha deliberada do time, com data registrada, não algo automático) — detalhe que a seção original não citou.
- **Visão geral, infraestrutura e deploy (lacuna apontada pelo verificador):** A migration 005_rls.py aplica RLS em 13 tabelas ao todo, incluindo `alembic_version`, `area_piloto` e `etl_execucao` (não só as tabelas de dados geográficos citadas como exemplo) — vale listar a contagem completa em vez de só 'etc.'.
- **Backend: núcleo (configuração, banco, modelos, schemas, rotas HTTP e migrations):** Só FonteDados tem modelo ORM SQLAlchemy declarativo; as outras 11 tabelas existem só como SQL cru nas migrations, sem classe Mapped correspondente em app/models/.
- **Backend: núcleo (configuração, banco, modelos, schemas, rotas HTTP e migrations):** barreira_colaborativa é explicitamente documentada no SQL como 'versão mínima' — falta usuário, foto e eventos de moderação, previstos para um 'Plano 6' ainda não implementado.
- **Backend: núcleo (configuração, banco, modelos, schemas, rotas HTTP e migrations):** Não há endpoint de escrita (POST/PUT) para barreira_colaborativa entre os routers desta seção (health, fontes, rotas) — fluxo de cadastro/moderação não encontrado nesta área do código.
- **Backend: núcleo (configuração, banco, modelos, schemas, rotas HTTP e migrations):** GET /api/fontes não tem tratamento de exceção para falha de banco (diferente de /health), resultando em 500 não estruturado se o banco cair.
- **Backend: núcleo (configuração, banco, modelos, schemas, rotas HTTP e migrations):** O SELECT 1 em /health é redundante com a query seguinte dentro do mesmo bloco try — não agrega tratamento de erro adicional.
- **Backend: núcleo (configuração, banco, modelos, schemas, rotas HTTP e migrations) (lacuna apontada pelo verificador):** A seção não menciona que via_pedestre também recebe dois índices B-tree comuns (não espaciais) em 'source' e 'target' (via_pedestre_source_idx, via_pedestre_target_idx) — colunas que o pgRouting usa para navegar o grafo; vale citar junto da explicação de por que a nomenclatura source/target é usada.
- **Backend: núcleo (configuração, banco, modelos, schemas, rotas HTTP e migrations) (lacuna apontada pelo verificador):** Não foi conferido nesta rodada (fora do escopo desta seção, pertence a services/) se custo_acessivel/custo_reverso de via_pedestre são de fato consumidos por pgrouting.py — a seção já hedgeia isso com 'provavelmente', o que é apropriado.
- **Backend: núcleo (configuração, banco, modelos, schemas, rotas HTTP e migrations) (lacuna apontada pelo verificador):** app/routers/__init__.py, app/schemas/__init__.py, app/services/__init__.py e app/__init__.py estão vazios (só marcam os diretórios como pacotes Python) — não há nada de substância a documentar neles, mas vale uma nota rápida de que foram checados e não escondem lógica.
- **Backend: serviços de roteamento:** generica.json é fixture sintética (nunca veio de chamada real ao ORS), só as 4 fixtures nomeadas por coordenadas são reais, segundo o próprio README
- **Backend: serviços de roteamento:** Interpolação direta de valores na string SQL de pgr_dijkstra em pgrouting.py depende inteiramente da validação Pydantic upstream; não há sanitização adicional dentro do próprio módulo
- **Backend: serviços de roteamento:** _GRAUS_POR_METRO em pgrouting.py é uma conversão aproximada de metros para graus, não geodésica exata
- **Backend: serviços de roteamento:** O contorno do bug do GEOS 3.9.0 em barreira_geom.py é documentado como específico da imagem Docker local (pgrouting/pgrouting:latest); não há confirmação no código de que a mesma versão roda em produção
- **Backend: serviços de roteamento:** Todos os 13 casos em tests/casos_referencia.json têm verificado_streetview: false — expectativas de rota ainda não confirmadas manualmente
- **Backend: serviços de roteamento (lacuna apontada pelo verificador):** A seção não deixa claro que os arquivos JSON de fixture do ORS ficam em `backend/app/fixtures/ors/` (subdiretório `ors/`), não diretamente em `backend/app/fixtures/` — só o `README.md` fica na raiz de `fixtures/`. Isso vem de `DIRETORIO_FIXTURES_PADRAO = Path(__file__).resolve().parent.parent / "fixtures" / "ors"` em `ors_client.py`.
- **Backend: serviços de roteamento (lacuna apontada pelo verificador):** Não menciona que `backend/tests/services/test_rota.py` e `backend/tests/test_rotas_api.py` são os consumidores concretos e verificáveis de `casos_referencia.json` (só especula 'presumivelmente').
- **Backend: estratégia de testes:** Não há job de CI para os testes marcados dados_reais; dependem de execução manual local pós-ETL.
- **Backend: estratégia de testes:** test_rotas_api.py depende de rota_cache ser limpo entre execuções (acoplamento via estado compartilhado no banco).
- **Backend: estratégia de testes:** IDs de via_pedestre/no_pedestre usados em vários testes de integração são fixos/mágicos, amarrados ao estado atual do ETL do piloto — frágeis a uma nova carga de dados.
- **Backend: estratégia de testes:** backend/README.md não documenta como rodar os testes (comandos pytest/ruff não estão centralizados em nenhuma doc, só inferíveis do pyproject.toml e do ci.yml).
- **Backend: estratégia de testes (lacuna apontada pelo verificador):** A tabela por arquivo não menciona os três testes de `criar_cliente` em `services/test_ors_client.py` (sem chave → OrsFixtureClient; USE_FIXTURES=true mesmo com chave → OrsFixtureClient; com chave e sem USE_FIXTURES → OrsClient real) — é a fábrica que decide, em produção e nos testes, qual cliente ORS é usado.
- **Backend: estratégia de testes (lacuna apontada pelo verificador):** A descrição de `services/test_rota.py` não menciona `test_invalidar_regiao_apaga_entrada_cujo_corredor_contem_o_ponto`, que testa `cache_rota.invalidar_regiao` — a invalidação espacial do cache quando um ponto (ex.: uma barreira nova) cai dentro do corredor de uma rota já cacheada.
- **Backend: estratégia de testes (lacuna apontada pelo verificador):** A regra exata de expiração/severidade efetiva de barreiras (por que o teste usa '200 dias' especificamente) não é explicada: o docstring de `app/services/barreira_geom.py` documenta que uma oficial só bloqueia se a categoria for `obstaculo_calcada`, `guia_sem_rebaixamento` ou `buraco`, aberta há MENOS de 180 dias e sem `data_finalizacao`; e que uma colaborativa só bloqueia se `validada` e com pelo menos 2 confirmações.
- **Backend: estratégia de testes (lacuna apontada pelo verificador):** `pytest-cov>=5` está nas dependências de dev (`pyproject.toml`) mas não há nenhum comando de cobertura (`--cov`) usado em `pytest -q` nem no CI — a seção não menciona que a cobertura de testes não é medida nem imposta em nenhum lugar do projeto.
- **ETL: carga das fontes oficiais e conflação:** Gabarito manual_streetview (mínimo 40 linhas, verificação humana no Street View) ainda não existe — só as 27 linhas automatico_contido; calibração do buffer hoje usa um proxy (pico de cobertura) em vez do critério ideal (joelho de acertos)
- **ETL: carga das fontes oficiais e conflação:** 3 dos 27 casos do gabarito automático erram em todo buffer testado, por causa de polígonos do GeoSampa sobrepostos no mesmo lugar e um desempate (ORDER BY distancia_m, calcada_id) que às vezes escolhe a calçada errada — registrado como achado, não corrigido (fora do escopo da task que descobriu)
- **ETL: carga das fontes oficiais e conflação:** ~~Secret DATABASE_URL_PROD do GitHub Actions ainda não existe~~ **Resolvido em 14/09/2026** (ver item equivalente na seção de infraestrutura); o workflow `etl.yml` semanal já tem o que precisa para rodar.
- **ETL: carga das fontes oficiais e conflação:** Categoria 'raiz_de_arvore' do SP156 nunca aparece nos dados reais mais recentes porque o texto do serviço da PMSP mudou (ganhou sufixo) em relação ao texto fixo em CATEGORIAS
- **ETL: carga das fontes oficiais e conflação:** via_pedestre.osmid não é único (6.690 grupos duplicados) devido à forma como osmnx.simplify_graph funde segmentos — obrigou a geração do gabarito a filtrar por unicidade de osmid, reduzindo a amostra automática disponível em Ipiranga/Lapa
- **ETL: carga das fontes oficiais e conflação (lacuna apontada pelo verificador):** A data de referência fixa das calçadas do GeoSampa (DATA_REFERENCIA = date(2021, 8, 13), o dia de publicação do levantamento) não é citada em nenhum lugar do texto, embora o texto mencione de passagem que o GeoSampa 'usa uma data fixa' sem dizer qual.
- **ETL: carga das fontes oficiais e conflação (lacuna apontada pelo verificador):** O texto não menciona que a chave de fonte usada em registrar_execucao(engine, 'gtfs') (tabela etl_execucao) é 'gtfs', mas a chave usada em fonte_id(engine, 'sptrans') (tabela fonte_dados, proveniência de cada linha de parada/linha) é 'sptrans' — são vocabulários independentes e a diferença pode confundir quem lê o código rápido.
- **ETL: carga das fontes oficiais e conflação (lacuna apontada pelo verificador):** detectar_pico_cobertura tem uma regra de desempate não mencionada no texto: em caso de cobertura empatada entre dois buffers, prefere o menor (`key=lambda i: (cobertura_pct[i], -buffers[i])`), por ser 'menos risco de ligar do lado errado da rua com a mesma cobertura' (comentário no próprio código).
- **ETL: carga das fontes oficiais e conflação (lacuna apontada pelo verificador):** O texto não menciona `_parse_width` (etl/osm.py), a função que converte a tag `width` do OSM (texto solto como '1.5', '1,5' ou '1.5 m') para metros na coluna `width_m` de `via_pedestre`, nem `_preencher_colunas`, o helper que garante que toda coluna esperada exista no GeoDataFrame antes de montar os registros finais (mesmo quando nenhuma feição do recorte tinha aquela tag).
- **ETL: carga das fontes oficiais e conflação (lacuna apontada pelo verificador):** O texto não cita a lista completa de TAGS_UTEIS_VIA/TAGS_UTEIS_NO (as tags que o osmnx é instruído a manter ao ler o XML), apenas menciona que elas existem — poderia listar as principais para dar uma ideia concreta do que sobrevive ao filtro.
- **Frontend: React acessível:** O contrato entre usePaginaAcessivel e cada página (o h1 precisa de tabIndex={-1} e receber a ref) é uma convenção manual documentada só em JSDoc; nada no TypeScript/ESLint impede que uma página futura esqueça isso, o que faria .focus() falhar silenciosamente.
- **Frontend: React acessível:** Os tipos RotaIn/RotaOut já existem em src/api/types.gen.ts (o backend já implementa POST /api/rotas desde o Plano 4), mas nenhuma função em client.ts os consome e nenhuma tela chama esse endpoint ainda — é trabalho do Plano 5, que ainda não tem um plano-05-*.md escrito.
- **Frontend: React acessível:** src/assets/hero.png e public/icons.svg existem no repositório mas não são referenciados em nenhum lugar do código-fonte (sobras do template padrão do Vite/React).
- **Frontend: React acessível:** frontend/README.md ainda é o README padrão gerado pelo template Vite+React (fala em Oxlint, plugins genéricos), não foi adaptado ao projeto.
- **Frontend: React acessível:** Existe só uma região viva isolada hoje (role=alert/role=status em Fontes.tsx); o roadmap do Plano 5 prevê consolidar isso numa 'região viva única' para toda a aplicação, o que ainda não existe.
- **Frontend: React acessível:** Não há checagem automatizada de contraste de cor no código (nem no CSS nem nos testes); o axe-core cobre estrutura/semântica/ARIA, mas contraste de texto renderizado não é validado por nenhum teste hoje visto.
- **Frontend: React acessível (lacuna apontada pelo verificador):** O texto não menciona public/favicon.svg, que existe no repositório ao lado de public/icons.svg (o favicon é de fato referenciado implicitamente pelo navegador via convenção, mas vale registrar sua existência junto dos ativos estáticos).

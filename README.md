# Rota Falada SP

Guia de rotas a pé em São Paulo que evita escadas, calçadas estreitas e outras barreiras físicas, pensado para cadeirantes, pessoas com baixa visão e idosos. Projeto da disciplina Engenharia de Software II (FATEC Ipiranga, 2º semestre de 2026).

**Tese do produto:** a rota é um texto (lista de passos navegável por teclado e leitor de tela); o mapa é uma ilustração opcional. Se o mapa falhar, o aplicativo continua inteiro.

## Documentação

- `docs/superpowers/specs/2026-09-08-rotas-acessiveis-sp-design.md` — design aprovado
- `docs/superpowers/plans/2026-09-13-roteiro-de-planos.md` — sequência de planos de implementação
- `docs/pesquisa/` — pesquisa verificada das APIs e fontes
- `DATA-LICENSES.md` — licenças dos dados e por que as tabelas são separadas
- `docs/adr/` — decisões de arquitetura

## Setup local

Pré-requisitos: Git, Docker Desktop, Python 3.12, Node 22.

```powershell
# 1. banco
docker compose up -d --wait

# 2. backend
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# 3. frontend (outro terminal)
cd frontend
npm ci
npm run dev
```

Copie `.env.example` para `.env` na raiz e preencha o que tiver. Nada do `.env` é versionado.

## Roteamento

`POST /api/rotas` calcula uma rota a pé acessível (perfil `wheelchair`) usando o
[OpenRouteService](https://openrouteservice.org/) (ORS), com fallback determinístico em
pgRouting quando o ORS não acha rota ou a cota estoura. Para rodar contra o ORS de verdade:

1. Crie uma chave gratuita em `openrouteservice.org/dev/#/signup` (o painel do ORS emite
   chaves novas como **JWT**, bem maiores que as chaves antigas — copie o token inteiro).
2. Coloque em `ORS_API_KEY=...` no `.env` da raiz (nunca commitado).
3. Deixe `USE_FIXTURES` ausente ou `false`. Com `USE_FIXTURES=true`, **ou** sem
   `ORS_API_KEY` configurada, o backend usa `OrsFixtureClient` e nunca chama a rede —
   é o modo usado pela suíte de testes e recomendado para demonstração sem depender de
   internet ou de cota.
4. Cota do ORS (`x-ratelimit-remaining`/`x-ratelimit-reset` da última chamada) aparece em
   `GET /health` como `ors_cota_restante`/`ors_cota_reset`; `modo_fixtures` diz se o
   backend está servindo fixtures.

Para regravar as fixtures de `backend/app/fixtures/ors/` com respostas reais (com uma
chave válida no `.env`, venv do backend ativado, a partir de `backend/`):

```
python scripts/gravar_fixtures_ors.py
```

Veja `backend/app/fixtures/README.md` para como o `OrsFixtureClient` escolhe o arquivo e o
estado atual (sintéticas ou gravadas de verdade).

## Comandos

| O quê | Backend (`backend/`) | Frontend (`frontend/`) |
|---|---|---|
| Testes | `pytest -q` | `npm test -- --run` |
| Lint | `ruff check . ; ruff format --check .` | `npm run lint` |
| Tipos da API | — | `npm run gerar-tipos` (backend precisa estar no ar) |

## Produção (custo zero)

| Componente | Serviço | URL |
|---|---|---|
| Frontend | Cloudflare Pages | https://<projeto>.pages.dev |
| Backend | Render Free (512 MB) | https://rota-falada-api.onrender.com |
| Banco | Supabase Free (PostGIS + pgRouting) | painel do Supabase |

Variáveis: `DATABASE_URL` e `CORS_ORIGINS` no Render; `VITE_API_URL` no Cloudflare Pages; Secret `RENDER_HEALTH_URL` no GitHub para o keep-alive. O backend dorme após 15 min sem tráfego e leva ~1 min para voltar; o workflow `keep-alive` faz ping a cada 10 min das 7h às 3h. **Antes de qualquer demonstração, abra `/health` cinco minutos antes.**

## Armadilhas conhecidas

Esta seção é obrigatória e cresce a cada plano. Do Plano 1:

1. `docker compose exec db psql` funciona sem instalar o psql na máquina.
1b. O container expõe o Postgres na porta **5433** do host (não 5432), porque máquinas com PostgreSQL nativo instalado já ocupam a 5432 e as conexões caem no banco errado com "senha falhou". A URL padrão do backend já usa 5433; no CI o serviço usa 5432 com `DATABASE_URL` explícita.
2. O `.env` fica na **raiz**; o backend lê `../.env` quando roda de `backend/`.
3. `CORS_ORIGINS` é uma lista JSON na variável de ambiente: `CORS_ORIGINS=["https://seu-site.pages.dev"]`.
4. **Nunca** use o Postgres gratuito do Render: expira em 30 dias e não tem backup. O banco fica no Supabase.
5. No Supabase, use a string de conexão do **Session pooler** (porta 5432); o Transaction pooler (6543) não suporta os prepared statements do psycopg.
6. GitHub desativa workflows agendados em repositório público após 60 dias sem commits.
7. A imagem `pgrouting/pgrouting:latest` local trouxe `postgis` 3.5.2, `pgrouting` 3.7.3 (série 3.x) e `pg_trgm` 1.6. O código deste plano não depende de funções removidas na 4.0.

Do Plano 2 (ETL, ver `etl/README.md` para os detalhes e as contagens reais de cada fonte):

8. O WFS do GeoSampa devolve HTTP 200 mesmo quando trunca o resultado — a paginação só está correta se verificar `numberReturned` somado contra `numberMatched` a cada página, nunca assumir que uma página menor que `count` é a última.
9. A paginação do WFS 2.0 do GeoSampa exige `sortBy` explícito (`sortBy=cd_identificador_calcada`); sem ordenação estável entre páginas, a paginação pode repetir ou pular feições em silêncio.
10. O CSV do SP156 é `cp1252`, não UTF-8/latin-1 estrito (o campo `Serviço` mistura hífen e travessão, inclusive o byte `0x96`, que `normalizar_traco` trata).
11. `osmium extract` usa `-s smart` (não o padrão `simple`) para manter inteiras as vias que cruzam a borda da bbox de recorte; com `simple`, uma via cortada no meio perde nós e o pgRouting fica sem `source`/`target` corretos.
12. O ETL roda em Docker (`docker compose --profile etl run --rm etl <fonte>`) e agendado no GitHub Actions (`.github/workflows/etl.yml`, cron semanal + `workflow_dispatch`); o workflow não roda em `push` de propósito. Enquanto o Secret `DATABASE_URL_PROD` não existir (depende do Supabase de produção), a execução agendada/manual falha no primeiro passo com banco — pendência do dono do projeto.

Do Plano 3 (conflação OSM x GeoSampa, ver `etl/README.md` para os detalhes e os números reais da calibração):

13. A conflação **não inventa um lado quando o caso é ambíguo**: quando uma aresta no eixo da rua (não é a própria geometria da calçada) tem dois polígonos do GeoSampa candidatos a distâncias parecidas — os dois lados da rua —, ela **fica sem calçada ligada** em vez de escolher uma ao acaso. É melhor não dizer a largura da calçada do que dizer a largura errada para quem depende da rota ser confiável; por isso o gate de cobertura do spec é de só 30% das arestas, não 100%, e o teste de qualidade (`test_conflacao_cobertura_minima`) falha — não afrouxa o limiar — se a cobertura real cair abaixo disso.

Do Plano 4 (roteamento acessível):

14. O ORS **sempre** por `POST` — mesmo o endpoint `/geojson`, que em outras APIs de rota costuma aceitar `GET` com querystring. A chave nunca sai do servidor (vai só no header `Authorization`, nunca no frontend); chaves novas emitidas pelo ORS são **JWT**, bem mais longas que o formato antigo — não trunque nem valide por tamanho fixo.
15. `avoid_polygons` é um **bloqueio binário**: a rota não passa nem raspando, não é uma penalidade de custo. Por isso o teto de 15 polígonos e os limites de forma do ORS (≤ 200 km² e ≤ 20 km de extensão por polígono; rota com avoid areas ≤ 150 km) importam — passar poligonal demais ou grande demais faz o ORS rejeitar a requisição inteira (`entrada_invalida`), não ignorar os excedentes.
16. `pgr_dijkstra` roda com `directed := false`: `via_pedestre` não tem sentido único (é malha de pedestre, não viária), e rodar `directed := true` por padrão silenciosamente perde metade das rotas possíveis sem erro nenhum — o caminho simplesmente não é encontrado.
17. `EstadoCota` (a cota do ORS exposta em `/health`) precisa ser o **mesmo objeto** entre requisições — um `OrsClient` novo a cada chamada (por exemplo, criado dentro da própria função de rota em vez de guardado em `app.state`) sempre reporta cota "nunca observada", porque nada nunca atualizou aquele `EstadoCota` em particular.

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

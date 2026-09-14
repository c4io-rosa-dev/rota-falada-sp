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

## Armadilhas conhecidas

Esta seção é obrigatória e cresce a cada plano. Do Plano 1:

1. `docker compose exec db psql` funciona sem instalar o psql na máquina.
2. O `.env` fica na **raiz**; o backend lê `../.env` quando roda de `backend/`.
3. `CORS_ORIGINS` é uma lista JSON na variável de ambiente: `CORS_ORIGINS=["https://seu-site.pages.dev"]`.
4. **Nunca** use o Postgres gratuito do Render: expira em 30 dias e não tem backup. O banco fica no Supabase.
5. No Supabase, use a string de conexão do **Session pooler** (porta 5432); o Transaction pooler (6543) não suporta os prepared statements do psycopg.
6. GitHub desativa workflows agendados em repositório público após 60 dias sem commits.
7. A imagem `pgrouting/pgrouting:latest` local trouxe `postgis` 3.5.2, `pgrouting` 3.7.3 (série 3.x) e `pg_trgm` 1.6. O código deste plano não depende de funções removidas na 4.0.

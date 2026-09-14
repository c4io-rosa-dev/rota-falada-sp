# Plano 1 — Fundação: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar, de ponta a ponta, um Rota Falada SP "vazio": banco PostGIS com catálogo de fontes, API FastAPI com `/health` e `/api/fontes`, frontend React acessível com três páginas, CI que falha em violação de acessibilidade ou segredo vazado, e deploy gratuito em Render + Supabase + Cloudflare Pages.

**Architecture:** Monorepo com `backend/` (FastAPI + SQLAlchemy 2 + Alembic sobre PostgreSQL/PostGIS/pgRouting), `frontend/` (Vite + React 19 + TypeScript + react-router) e `.github/workflows/` (CI, keep-alive). O banco local roda em Docker com a imagem `pgrouting/pgrouting`; em produção fica no Supabase. A primeira migration cria as extensões e a tabela `fonte_dados`, que alimenta o rodapé e a página `/fontes` automaticamente: cumprir licença vira consequência do esquema.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, pydantic-settings, SQLAlchemy 2, GeoAlchemy2, psycopg 3, Alembic, pytest, ruff · Node 22, Vite, React 19, TypeScript, react-router 7, Vitest, Testing Library, vitest-axe, eslint-plugin-jsx-a11y · Docker Compose, GitHub Actions, gitleaks, Render, Supabase, Cloudflare Pages.

## Global Constraints

Copiadas do spec; valem para todas as tarefas.

- Frontend obrigatoriamente **React + TypeScript**; react-leaflet v5 (Plano 5) exige **React 19**.
- Backend **Python 3.12 + FastAPI**, `pydantic>=2`, `sqlalchemy>=2 + geoalchemy2`, `psycopg[binary]`.
- Banco **PostgreSQL 16/17 + PostGIS 3.5 + pgRouting 4.x**; extensões `postgis`, `pgrouting`, `pg_trgm`.
- Toda linha espacial (a partir do Plano 2) carrega `fonte_id`, `data_referencia` e `geom` em SRID 4326; métrica em **EPSG:31983**.
- `<html lang="pt-BR">`; meta **WCAG 2.2 nível AA**; alvos de **44×44 px**; uma única região viva `polite`; foco no `<h1>` ao trocar de página; `prefers-reduced-motion` respeitado.
- **Nenhuma chave no frontend nem em arquivo versionado.** `.env` está no `.gitignore`. Repositório é **público**.
- **Aplicação 100% determinística:** nenhuma chamada a IA generativa.
- Sem histórico de trajetos por usuário (LGPD).
- Backend em produção no **Render Free (512 MB)**; banco no **Supabase Free (500 MB)**; frontend no **Cloudflare Pages**. Nunca usar o Postgres gratuito do Render (expira em 30 dias).
- Atribuições obrigatórias em texto legível por leitor de tela: `© openrouteservice.org by HeiGIT | Map data © OpenStreetMap contributors · Calçadas: GeoSampa/PMSP (CC-BY-SA 4.0), diagnóstico de 2021 · Solicitações: SP156/SMIT (CC0) · Ônibus: SPTrans/Olho Vivo`.

## Pré-requisitos na máquina de cada integrante

- Git, Docker Desktop (com WSL 2 no Windows), Python 3.12, Node 22 (LTS).
- Os comandos abaixo estão em PowerShell. Em Linux/macOS troque `.\.venv\Scripts\Activate.ps1` por `source .venv/bin/activate`.
- Todos os comandos de backend rodam com o venv ativado dentro de `backend/`; os de frontend, dentro de `frontend/`.

## Estrutura de arquivos criada por este plano

```
rota-falada-sp/                      (raiz do repositório atual)
├── README.md                        propósito, setup, armadilhas
├── DATA-LICENSES.md                 ODbL × CC-BY-SA × CC0 e a decisão de tabelas separadas
├── docker-compose.yml               PostGIS + pgRouting local
├── render.yaml                      blueprint do backend no Render
├── .env.example                     (já existe)
├── .pre-commit-config.yaml          gitleaks + ruff
├── .github/workflows/ci.yml         backend + frontend + gitleaks
├── .github/workflows/keep-alive.yml ping no Render em horário de uso
├── docs/adr/001-backend-python.md   registro da decisão
├── backend/
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/env.py
│   ├── alembic/versions/001_fundacao.py
│   ├── app/__init__.py
│   ├── app/config.py                Settings (pydantic-settings)
│   ├── app/main.py                  create_app()
│   ├── app/db.py                    engine, SessionLocal, get_db
│   ├── app/models/__init__.py
│   ├── app/models/base.py           Base declarativa
│   ├── app/models/fonte_dados.py    FonteDados
│   ├── app/schemas/__init__.py
│   ├── app/schemas/health.py        HealthOut
│   ├── app/schemas/fontes.py        FonteOut
│   ├── app/routers/__init__.py
│   ├── app/routers/health.py        GET /health
│   ├── app/routers/fontes.py        GET /api/fontes
│   └── tests/
│       ├── conftest.py              pula testes de integração sem banco
│       ├── test_health.py
│       ├── test_migracao_fundacao.py
│       └── test_fontes.py
└── frontend/
    ├── index.html                   lang="pt-BR"
    ├── package.json
    ├── vite.config.ts               vitest configurado
    ├── eslint.config.js             jsx-a11y strict
    ├── tsconfig.app.json
    └── src/
        ├── main.tsx                 BrowserRouter
        ├── App.tsx                  SkipLink, nav, main, rotas, rodapé
        ├── index.css                alvos 44 px, foco visível, reduced-motion
        ├── vite-env.d.ts            VITE_API_URL tipada
        ├── a11y/SkipLink.tsx
        ├── a11y/usePaginaAcessivel.ts   título da aba + foco no h1
        ├── api/client.ts            listarFontes()
        ├── api/types.gen.ts         gerado do OpenAPI
        ├── pages/Inicio.tsx
        ├── pages/Fontes.tsx
        ├── pages/Acessibilidade.tsx
        └── test/
            ├── setup.ts
            ├── vitest.d.ts
            ├── App.test.tsx
            ├── Fontes.test.tsx
            └── Acessibilidade.test.tsx
```

---

### Task 1: Monorepo, banco local em Docker e documentos de base

**Files:**
- Create: `docker-compose.yml`
- Create: `README.md`
- Create: `DATA-LICENSES.md`
- Create: `docs/adr/001-backend-python.md`
- Modify: `.gitignore`

**Interfaces:**
- Produces: banco PostgreSQL acessível em `postgresql+psycopg://postgres:dev@localhost:5433/acessibilidade`, com as extensões `postgis`, `pgrouting` e `pg_trgm` disponíveis para instalação (a migration da Task 3 as instala).

- [ ] **Step 1: Escrever o `docker-compose.yml`**

```yaml
services:
  db:
    image: pgrouting/pgrouting:latest
    container_name: rota-falada-db
    environment:
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: acessibilidade
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d acessibilidade"]
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  pgdata:
```

- [ ] **Step 2: Subir o banco e verificar que as três extensões existem**

Run:
```powershell
docker compose up -d --wait
docker compose exec db psql -U postgres -d acessibilidade -c "SELECT name, default_version FROM pg_available_extensions WHERE name IN ('postgis','pgrouting','pg_trgm') ORDER BY name;"
```
Expected: três linhas (`pg_trgm`, `pgrouting` 3.x ou 4.x, `postgis` 3.x). Se `pgrouting` vier 3.x, registre a versão no README; o código deste plano não depende de funções removidas na 4.0.

- [ ] **Step 3: Completar o `.gitignore`**

Substitua o conteúdo atual por:
```
# segredos
.env
.env.*
!.env.example

# python
.venv/
__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
*.egg-info/

# node
node_modules/
dist/
frontend/coverage/

# dados brutos (nunca versionar)
*.pbf
*.zip
etl/dados/

# sistema
.DS_Store
Thumbs.db
```

- [ ] **Step 4: Escrever o `README.md`**

````markdown
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
````

- [ ] **Step 5: Escrever o `DATA-LICENSES.md`**

```markdown
# Licenças dos dados

| Fonte | Licença | Obrigações | Tabelas |
|---|---|---|---|
| OpenStreetMap (via Geofabrik) | ODbL 1.0 | Atribuição "© OpenStreetMap contributors"; share-alike em bases derivadas | `via_pedestre`, `no_pedestre` |
| GeoSampa / PMSP | CC-BY-SA 4.0 | Atribuição; manter licença semelhante em obras derivadas | `calcada_sp` (fisicamente isolada) |
| SP156 / SMIT | CC0 1.0 | Nenhuma (atribuímos por boa prática) | `barreira_oficial` |
| SPTrans (Olho Vivo e GTFS) | Não declarada publicamente | Atribuímos "Dados: SPTrans / API Olho Vivo" | `parada`, `linha` |
| openrouteservice | Dados ODbL; serviço CC-BY 4.0 | "© openrouteservice.org by HeiGIT" | respostas em `rota_cache` |
| Contribuições dos usuários | ODbL 1.0 (decisão de 10/09/2026) | Permite devolução futura ao OSM | `barreira_colaborativa`, `confirmacao` |

## Por que as tabelas são separadas

ODbL e CC-BY-SA 4.0 são dois copyleft mutuamente incompatíveis para gerar uma base derivada única. A solução é de modelagem, não jurídica: os dados do OSM e do GeoSampa ficam em tabelas fisicamente separadas, ligadas pela tabela `conflacao_via_calcada`, que guarda **apenas chaves estrangeiras, distância, confiança e método**. Nenhuma geometria é fundida e nenhum atributo é copiado entre elas. O conjunto se caracteriza como *Collective Database* e o share-alike de uma fonte não contamina a outra nem os dados próprios do grupo.

Regras práticas:

1. Jamais fazer upload de dados do GeoSampa para o OpenStreetMap.
2. Jamais copiar `largura` ou `declividade` do GeoSampa para uma coluna da tabela do OSM. A junção é feita na consulta.
3. A tabela `fonte_dados` é a fonte da verdade das atribuições exibidas na interface; toda linha espacial aponta para ela.
```

- [ ] **Step 6: Escrever o ADR 001**

```markdown
# ADR 001 — Backend em Python + FastAPI

**Data:** 13/09/2026 · **Status:** aceito

## Contexto

O frontend é React + TypeScript por decisão do grupo. O backend estava aberto entre Python, Java e C#. Três arquiteturas independentes e dois juízes técnicos convergiram em Python (ver `docs/pesquisa/2026-09-08-painel-de-designs.md`).

## Decisão

Python 3.12 com FastAPI, SQLAlchemy 2 + GeoAlchemy2 sobre PostgreSQL/PostGIS/pgRouting.

## Justificativa

1. Cerca de 70% do esforço real é ETL geoespacial (recortar PBF, paginar WFS, ler CSV cp1252, conflar com o grafo). Python tem ferramenta madura em cada etapa: pyrosm, GeoPandas/pyogrio, Shapely, pyproj, OWSLib.
2. Calibrar a conflação é experimentação com ciclo de segundos em Jupyter.
3. O Render Free tem 512 MB; Spring Boot consome 250–400 MB e soma 10–30 s ao cold start.
4. Nada exige performance de JVM: buffer, interseção e caminho mínimo rodam dentro do PostGIS, em C.

## Consequências

- C# não é inferior como linguagem (Npgsql + NetTopologySuite é excelente); o que falta é o ecossistema de dados OSM.
- Se o escopo fosse construir o próprio motor de rotas, Java com GraphHopper seria a escolha certa. Não é o escopo.
```

- [ ] **Step 7: Commit**

```powershell
git add docker-compose.yml README.md DATA-LICENSES.md docs/adr/001-backend-python.md .gitignore
git commit -m "chore: banco local em docker, README, licenças de dados e ADR 001"
```

---

### Task 2: Esqueleto do backend FastAPI com `/health`

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/app/__init__.py` (vazio)
- Create: `backend/app/config.py`
- Create: `backend/app/main.py`
- Create: `backend/app/schemas/__init__.py` (vazio)
- Create: `backend/app/schemas/health.py`
- Create: `backend/app/routers/__init__.py` (vazio)
- Create: `backend/app/routers/health.py`
- Test: `backend/tests/test_health.py`

**Interfaces:**
- Produces: `create_app() -> FastAPI` em `app.main`; `settings: Settings` em `app.config` com campos `app_env: str`, `database_url: str`, `cors_origins: list[str]`, `use_fixtures: bool`, `sptrans_token: str | None`, `ors_api_key: str | None`; `HealthOut(status: str, versao: str)`.

- [ ] **Step 1: Criar o `pyproject.toml`**

```toml
[build-system]
requires = ["setuptools>=69"]
build-backend = "setuptools.build_meta"

[project]
name = "rota-falada-backend"
version = "0.1.0"
description = "API do Rota Falada SP"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.30",
  "pydantic>=2.7",
  "pydantic-settings>=2.3",
  "sqlalchemy>=2.0",
  "geoalchemy2>=0.15",
  "psycopg[binary]>=3.2",
  "alembic>=1.13",
  "httpx>=0.27",
]

[project.optional-dependencies]
dev = [
  "pytest>=8",
  "pytest-cov>=5",
  "ruff>=0.6",
  "respx>=0.21",
]

[tool.setuptools.packages.find]
include = ["app*"]

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP"]

[tool.pytest.ini_options]
testpaths = ["tests"]
markers = ["integration: precisa de banco PostGIS acessível em DATABASE_URL"]
```

- [ ] **Step 2: Criar o venv e instalar**

Run:
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
```
Expected: termina com `Successfully installed ...` incluindo `fastapi`, `sqlalchemy`, `geoalchemy2`, `psycopg`.

- [ ] **Step 3: Escrever o teste que falha**

`backend/tests/test_health.py`:
```python
from fastapi.testclient import TestClient

from app.main import create_app


def test_health_responde_ok():
    client = TestClient(create_app())
    resposta = client.get("/health")
    assert resposta.status_code == 200
    assert resposta.json() == {"status": "ok", "versao": "0.1.0"}
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `pytest tests/test_health.py -v`
Expected: `ERROR` na coleta com `ModuleNotFoundError: No module named 'app.main'`.

- [ ] **Step 5: Escrever a configuração**

`backend/app/config.py`:
```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuração lida de variáveis de ambiente e do .env da raiz do repositório."""

    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    app_env: str = "dev"
    database_url: str = "postgresql+psycopg://postgres:dev@localhost:5433/acessibilidade"
    cors_origins: list[str] = ["http://localhost:5173"]
    use_fixtures: bool = False
    sptrans_token: str | None = None
    ors_api_key: str | None = None


settings = Settings()
```

- [ ] **Step 6: Escrever o schema e o router de saúde**

`backend/app/schemas/health.py`:
```python
from pydantic import BaseModel


class HealthOut(BaseModel):
    status: str
    versao: str
```

`backend/app/routers/health.py`:
```python
from fastapi import APIRouter

from app.schemas.health import HealthOut

VERSAO = "0.1.0"

router = APIRouter(tags=["saude"])


@router.get("/health", response_model=HealthOut)
def health() -> HealthOut:
    return HealthOut(status="ok", versao=VERSAO)
```

- [ ] **Step 7: Escrever o `main.py`**

`backend/app/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import health


def create_app() -> FastAPI:
    app = FastAPI(title="Rota Falada SP API", version=health.VERSAO)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    return app


app = create_app()
```

- [ ] **Step 8: Rodar e ver passar**

Run: `pytest tests/test_health.py -v`
Expected: `1 passed`.

- [ ] **Step 9: Lint e subida manual**

Run:
```powershell
ruff check . ; ruff format .
uvicorn app.main:app --port 8000
```
Expected: `ruff` sem erros; abrir `http://localhost:8000/docs` mostra o endpoint `GET /health`. Encerre com Ctrl+C.

- [ ] **Step 10: Commit**

```powershell
git add backend/
git commit -m "feat(backend): esqueleto FastAPI com /health e configuração por ambiente"
```

---

### Task 3: Conexão com o banco, Alembic e migration `001_fundacao` (extensões + `fonte_dados`)

**Files:**
- Create: `backend/app/db.py`
- Create: `backend/app/models/__init__.py`
- Create: `backend/app/models/base.py`
- Create: `backend/app/models/fonte_dados.py`
- Create: `backend/alembic.ini`, `backend/alembic/env.py`, `backend/alembic/script.py.mako` (gerados por `alembic init`)
- Create: `backend/alembic/versions/001_fundacao.py`
- Create: `backend/tests/conftest.py`
- Test: `backend/tests/test_migracao_fundacao.py`

**Interfaces:**
- Consumes: `settings.database_url` (Task 2).
- Produces: `engine`, `SessionLocal`, `get_db()` (gerador FastAPI) em `app.db`; `Base` em `app.models.base`; modelo `FonteDados` com colunas `id, chave, nome, licenca, url, atribuicao, data_referencia, data_extracao`; tabela `fonte_dados` semeada com as chaves `osm, geosampa, sp156, sptrans, ors, colaborativo`.

- [ ] **Step 1: Escrever o `conftest.py` que pula integração sem banco**

`backend/tests/conftest.py`:
```python
import pytest
from sqlalchemy import create_engine, text

from app.config import settings


def _banco_disponivel() -> bool:
    try:
        with create_engine(settings.database_url).connect() as conexao:
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

- [ ] **Step 2: Escrever o teste de integração que falha**

`backend/tests/test_migracao_fundacao.py`:
```python
import pytest
from sqlalchemy import text

pytestmark = pytest.mark.integration


@pytest.fixture
def db():
    from app.db import SessionLocal

    sessao = SessionLocal()
    try:
        yield sessao
    finally:
        sessao.close()


def test_extensoes_instaladas(db):
    nomes = {linha[0] for linha in db.execute(text("SELECT extname FROM pg_extension"))}
    assert {"postgis", "pgrouting", "pg_trgm"} <= nomes


def test_fonte_dados_semeada_com_licencas(db):
    linhas = db.execute(text("SELECT chave, licenca FROM fonte_dados")).all()
    licencas = {chave: licenca for chave, licenca in linhas}
    assert licencas["osm"] == "ODbL 1.0"
    assert licencas["geosampa"] == "CC-BY-SA 4.0"
    assert licencas["sp156"] == "CC0 1.0"
    assert licencas["colaborativo"] == "ODbL 1.0"
    assert len(licencas) == 6


def test_geosampa_tem_data_de_referencia_de_2021(db):
    data = db.execute(
        text("SELECT data_referencia FROM fonte_dados WHERE chave = 'geosampa'")
    ).scalar_one()
    assert str(data) == "2021-08-13"
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pytest tests/test_migracao_fundacao.py -v`
Expected: `ERROR` com `ModuleNotFoundError: No module named 'app.db'` (com o banco no ar) ou `SKIPPED` (sem banco; suba o Docker antes de continuar).

- [ ] **Step 4: Escrever `db.py`, `Base` e o modelo**

`backend/app/db.py`:
```python
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    sessao = SessionLocal()
    try:
        yield sessao
    finally:
        sessao.close()
```

`backend/app/models/base.py`:
```python
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
```

`backend/app/models/fonte_dados.py`:
```python
from datetime import date

from sqlalchemy import Date, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


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

`backend/app/models/__init__.py`:
```python
from app.models.base import Base
from app.models.fonte_dados import FonteDados

__all__ = ["Base", "FonteDados"]
```

- [ ] **Step 5: Inicializar o Alembic e apontar para as settings**

Run (em `backend/`): `alembic init alembic`
Expected: cria `alembic.ini`, `alembic/env.py`, `alembic/script.py.mako`, `alembic/versions/`.

Substitua **todo** o conteúdo de `backend/alembic/env.py` por:
```python
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import settings
from app.models import Base

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


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


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

No `backend/alembic.ini`, apague a linha `sqlalchemy.url = driver://user:pass@localhost/dbname` (a URL vem das settings).

- [ ] **Step 6: Escrever a migration `001_fundacao`**

`backend/alembic/versions/001_fundacao.py`:
```python
"""extensões espaciais e catálogo fonte_dados

Revision ID: 001_fundacao
Revises:
Create Date: 2026-09-13
"""

from datetime import date

import sqlalchemy as sa
from alembic import op

revision = "001_fundacao"
down_revision = None
branch_labels = None
depends_on = None

FONTES = [
    {
        "chave": "osm",
        "nome": "OpenStreetMap",
        "licenca": "ODbL 1.0",
        "url": "https://www.openstreetmap.org/copyright",
        "atribuicao": "Dados do mapa © colaboradores do OpenStreetMap (ODbL)",
        "data_referencia": None,
        "data_extracao": None,
    },
    {
        "chave": "geosampa",
        "nome": "GeoSampa / Prefeitura de São Paulo",
        "licenca": "CC-BY-SA 4.0",
        "url": "https://geosampa.prefeitura.sp.gov.br",
        "atribuicao": "Calçadas: GeoSampa/PMSP (CC-BY-SA 4.0), diagnóstico de 2021",
        "data_referencia": date(2021, 8, 13),
        "data_extracao": None,
    },
    {
        "chave": "sp156",
        "nome": "SP156 / SMIT",
        "licenca": "CC0 1.0",
        "url": "https://dados.prefeitura.sp.gov.br/dataset/dados-do-sp156",
        "atribuicao": "Solicitações: SP156/SMIT (CC0)",
        "data_referencia": None,
        "data_extracao": None,
    },
    {
        "chave": "sptrans",
        "nome": "SPTrans — API Olho Vivo e GTFS",
        "licenca": "não declarada",
        "url": "https://www.sptrans.com.br/desenvolvedores/",
        "atribuicao": "Ônibus: SPTrans / API Olho Vivo",
        "data_referencia": None,
        "data_extracao": None,
    },
    {
        "chave": "ors",
        "nome": "openrouteservice (HeiGIT)",
        "licenca": "CC-BY 4.0",
        "url": "https://openrouteservice.org",
        "atribuicao": "© openrouteservice.org by HeiGIT",
        "data_referencia": None,
        "data_extracao": None,
    },
    {
        "chave": "colaborativo",
        "nome": "Contribuições dos usuários do Rota Falada SP",
        "licenca": "ODbL 1.0",
        "url": "/fontes",
        "atribuicao": "Barreiras cadastradas por usuários do Rota Falada SP (ODbL)",
        "data_referencia": None,
        "data_extracao": None,
    },
]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.execute("CREATE EXTENSION IF NOT EXISTS pgrouting")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    tabela = op.create_table(
        "fonte_dados",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("chave", sa.String(40), nullable=False, unique=True),
        sa.Column("nome", sa.String(120), nullable=False),
        sa.Column("licenca", sa.String(60), nullable=False),
        sa.Column("url", sa.Text, nullable=False),
        sa.Column("atribuicao", sa.Text, nullable=False),
        sa.Column("data_referencia", sa.Date, nullable=True),
        sa.Column("data_extracao", sa.Date, nullable=True),
    )
    op.bulk_insert(tabela, FONTES)


def downgrade() -> None:
    op.drop_table("fonte_dados")
```

- [ ] **Step 7: Aplicar a migration**

Run: `alembic upgrade head`
Expected: `INFO  [alembic.runtime.migration] Running upgrade  -> 001_fundacao, extensões espaciais e catálogo fonte_dados`.

- [ ] **Step 8: Rodar os testes e ver passar**

Run: `pytest -v`
Expected: `4 passed` (health + 3 de integração).

- [ ] **Step 9: Verificar que `downgrade` e `upgrade` são reversíveis**

Run: `alembic downgrade base ; alembic upgrade head ; pytest -q`
Expected: os dois comandos sem erro; `4 passed`.

- [ ] **Step 10: Commit**

```powershell
ruff check . ; ruff format .
git add backend/
git commit -m "feat(backend): alembic, extensões espaciais e catálogo fonte_dados semeado"
```

---

### Task 4: `GET /api/fontes`

**Files:**
- Create: `backend/app/schemas/fontes.py`
- Create: `backend/app/routers/fontes.py`
- Modify: `backend/app/main.py` (incluir o router)
- Test: `backend/tests/test_fontes.py`

**Interfaces:**
- Consumes: `get_db` (Task 3), `FonteDados` (Task 3).
- Produces: `FonteOut(chave, nome, licenca, url, atribuicao, data_referencia: date | None, data_extracao: date | None)`; endpoint `GET /api/fontes -> list[FonteOut]` ordenado por `chave`. O frontend (Task 7) gera seus tipos a partir deste schema, então o nome `FonteOut` é contrato.

- [ ] **Step 1: Escrever o teste que falha**

`backend/tests/test_fontes.py`:
```python
import pytest
from fastapi.testclient import TestClient

from app.main import create_app

pytestmark = pytest.mark.integration


def test_lista_fontes_com_atribuicao_e_licenca():
    client = TestClient(create_app())
    resposta = client.get("/api/fontes")
    assert resposta.status_code == 200
    fontes = resposta.json()
    assert [f["chave"] for f in fontes] == [
        "colaborativo",
        "geosampa",
        "ors",
        "osm",
        "sp156",
        "sptrans",
    ]
    osm = next(f for f in fontes if f["chave"] == "osm")
    assert osm["licenca"] == "ODbL 1.0"
    assert "OpenStreetMap" in osm["atribuicao"]
    geosampa = next(f for f in fontes if f["chave"] == "geosampa")
    assert geosampa["data_referencia"] == "2021-08-13"
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pytest tests/test_fontes.py -v`
Expected: `FAILED` com `assert 404 == 200`.

- [ ] **Step 3: Escrever schema e router**

`backend/app/schemas/fontes.py`:
```python
from datetime import date

from pydantic import BaseModel, ConfigDict


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

`backend/app/routers/fontes.py`:
```python
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import FonteDados
from app.schemas.fontes import FonteOut

router = APIRouter(prefix="/api", tags=["fontes"])


@router.get("/fontes", response_model=list[FonteOut])
def listar_fontes(db: Session = Depends(get_db)) -> list[FonteOut]:
    fontes = db.scalars(select(FonteDados).order_by(FonteDados.chave)).all()
    return [FonteOut.model_validate(f) for f in fontes]
```

- [ ] **Step 4: Registrar o router**

Em `backend/app/main.py`, troque a importação e a inclusão:
```python
from app.routers import fontes, health
```
e, logo após `app.include_router(health.router)`:
```python
    app.include_router(fontes.router)
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pytest -v`
Expected: `5 passed`.

- [ ] **Step 6: Commit**

```powershell
ruff check . ; ruff format .
git add backend/
git commit -m "feat(backend): GET /api/fontes com licenças e atribuições"
```

---

### Task 5: `/health` informa o estado do banco

**Files:**
- Modify: `backend/app/schemas/health.py`
- Modify: `backend/app/routers/health.py`
- Modify: `backend/tests/test_health.py`

**Interfaces:**
- Produces: `HealthOut(status: "ok" | "degradado", versao: str, banco: "ok" | "indisponivel")`. O Plano 2 acrescenta `ultimo_etl`; o Plano 4 acrescenta a cota do ORS. Render usa `/health` como health check, por isso ele responde 200 mesmo degradado.

- [ ] **Step 1: Reescrever o teste**

`backend/tests/test_health.py`:
```python
import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import create_app


class SessaoQuebrada:
    def execute(self, *args, **kwargs):
        raise RuntimeError("sem banco")


def test_health_degradado_quando_banco_cai():
    app = create_app()
    app.dependency_overrides[get_db] = lambda: SessaoQuebrada()
    resposta = TestClient(app).get("/health")
    assert resposta.status_code == 200
    assert resposta.json() == {"status": "degradado", "versao": "0.1.0", "banco": "indisponivel"}


@pytest.mark.integration
def test_health_ok_com_banco():
    resposta = TestClient(create_app()).get("/health")
    assert resposta.status_code == 200
    assert resposta.json() == {"status": "ok", "versao": "0.1.0", "banco": "ok"}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pytest tests/test_health.py -v`
Expected: 2 `FAILED` (o JSON atual não tem `banco`).

- [ ] **Step 3: Implementar**

`backend/app/schemas/health.py`:
```python
from typing import Literal

from pydantic import BaseModel


class HealthOut(BaseModel):
    status: Literal["ok", "degradado"]
    versao: str
    banco: Literal["ok", "indisponivel"]
```

`backend/app/routers/health.py`:
```python
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.health import HealthOut

VERSAO = "0.1.0"

router = APIRouter(tags=["saude"])


@router.get("/health", response_model=HealthOut)
def health(db: Session = Depends(get_db)) -> HealthOut:
    try:
        db.execute(text("SELECT 1"))
        banco = "ok"
    except Exception:
        banco = "indisponivel"
    return HealthOut(status="ok" if banco == "ok" else "degradado", versao=VERSAO, banco=banco)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pytest -v`
Expected: `6 passed`.

- [ ] **Step 5: Commit**

```powershell
ruff check . ; ruff format .
git add backend/
git commit -m "feat(backend): /health reporta disponibilidade do banco"
```

---

### Task 6: Esqueleto do frontend acessível (layout, skip link, foco, página inicial)

**Files:**
- Create: `frontend/` via Vite (template `react-ts`)
- Modify: `frontend/index.html`
- Modify: `frontend/package.json` (scripts)
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/eslint.config.js`
- Modify: `frontend/tsconfig.app.json`
- Create: `frontend/src/vite-env.d.ts` (substituir)
- Create: `frontend/src/index.css` (substituir)
- Create: `frontend/src/main.tsx` (substituir)
- Create: `frontend/src/App.tsx` (substituir)
- Create: `frontend/src/a11y/SkipLink.tsx`
- Create: `frontend/src/a11y/usePaginaAcessivel.ts`
- Create: `frontend/src/pages/Inicio.tsx`
- Create: `frontend/src/test/setup.ts`, `frontend/src/test/vitest.d.ts`
- Test: `frontend/src/test/App.test.tsx`
- Delete: `frontend/src/App.css`, `frontend/src/assets/react.svg`, `frontend/public/vite.svg`

**Interfaces:**
- Produces: `usePaginaAcessivel(titulo: string): RefObject<HTMLHeadingElement | null>` (define `document.title` como `"<titulo> · Rota Falada SP"` e foca o `<h1>`); `<SkipLink />`; `App` sem `BrowserRouter` (o roteador fica em `main.tsx`, para os testes usarem `MemoryRouter`); rotas `/`, `/fontes`, `/acessibilidade` (as duas últimas são criadas nas Tasks 7 e 8; nesta task ficam como `Inicio` provisório e são trocadas depois).

- [ ] **Step 1: Criar o projeto Vite e instalar dependências**

Run (na raiz do repositório):
```powershell
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install react-router
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event vitest-axe eslint-plugin-jsx-a11y openapi-typescript
Remove-Item src/App.css, src/assets/react.svg, public/vite.svg
```
Expected: `package.json` com `react` e `react-dom` na versão 19.x. Se vier 18.x, rode `npm install react@19 react-dom@19 @types/react@19 @types/react-dom@19`.

- [ ] **Step 2: Ajustar `index.html`**

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

- [ ] **Step 3: Configurar scripts, Vitest, ESLint e TypeScript**

Em `frontend/package.json`, deixe `scripts` assim:
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

`frontend/vite.config.ts`:
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

`frontend/eslint.config.js` (substituir todo o conteúdo):
```js
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

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

Em `frontend/tsconfig.app.json`, dentro de `compilerOptions`, acrescente:
```json
"types": ["vitest/globals", "@testing-library/jest-dom"]
```

`frontend/src/vite-env.d.ts` (substituir):
```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

`frontend/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
import * as axeMatchers from 'vitest-axe/matchers'
import { expect } from 'vitest'

expect.extend(axeMatchers)
```

`frontend/src/test/vitest.d.ts`:
```ts
/* eslint-disable @typescript-eslint/no-empty-object-type */
import 'vitest'
import type { AxeMatchers } from 'vitest-axe/matchers'

declare module 'vitest' {
  export interface Assertion extends AxeMatchers {}
  export interface AsymmetricMatchersContaining extends AxeMatchers {}
}
```

- [ ] **Step 4: Escrever o teste que falha**

`frontend/src/test/App.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { axe } from 'vitest-axe'
import App from '../App'

function renderizar(rota = '/') {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <App />
    </MemoryRouter>,
  )
}

describe('layout acessível', () => {
  it('tem skip link como primeiro elemento focável, apontando para o conteúdo', async () => {
    renderizar()
    // a página foca o h1 ao montar; volta o foco ao body para testar a ordem de Tab do zero
    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.tab()
    const skip = screen.getByRole('link', { name: 'Pular para o conteúdo' })
    expect(skip).toHaveFocus()
    expect(skip).toHaveAttribute('href', '#conteudo')
    expect(document.getElementById('conteudo')).not.toBeNull()
  })

  it('define o título da aba e foca o h1 ao abrir a página inicial', async () => {
    renderizar('/')
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Rota Falada SP' })
    expect(document.title).toBe('Início · Rota Falada SP')
    expect(h1).toHaveFocus()
  })

  it('tem navegação principal com os três links', () => {
    renderizar()
    const nav = screen.getByRole('navigation', { name: 'Principal' })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Início' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Fontes' })).toHaveAttribute('href', '/fontes')
    expect(screen.getByRole('link', { name: 'Acessibilidade' })).toHaveAttribute('href', '/acessibilidade')
  })

  it('não tem violações de acessibilidade na página inicial', async () => {
    const { container } = renderizar('/')
    expect(await axe(container)).toHaveNoViolations()
  })
})
```

- [ ] **Step 5: Rodar e ver falhar**

Run: `npm test -- --run`
Expected: falha de compilação/importação (`Cannot find module '../App'` ou módulos `a11y/` inexistentes).

- [ ] **Step 6: Escrever CSS base**

`frontend/src/index.css` (substituir):
```css
:root {
  color-scheme: light dark;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 100%;
  line-height: 1.5;
  --cor-foco: #005a9c;
  --cor-fundo: #ffffff;
  --cor-texto: #1a1a1a;
}

@media (prefers-color-scheme: dark) {
  :root {
    --cor-foco: #9ecbff;
    --cor-fundo: #121212;
    --cor-texto: #f2f2f2;
  }
}

body {
  margin: 0;
  background: var(--cor-fundo);
  color: var(--cor-texto);
}

/* Alvos de 44 px: acima do mínimo AA (24 px) por decisão de projeto */
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

.menu {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
  padding: 0.5rem;
}

main {
  max-width: 45rem;
  margin: 0 auto;
  padding: 1rem;
}

/* Reflow: nada pode gerar rolagem horizontal a 320 px */
img,
svg {
  max-width: 100%;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 7: Escrever `SkipLink` e `usePaginaAcessivel`**

`frontend/src/a11y/SkipLink.tsx`:
```tsx
export function SkipLink() {
  return (
    <a className="skip-link" href="#conteudo">
      Pular para o conteúdo
    </a>
  )
}
```

`frontend/src/a11y/usePaginaAcessivel.ts`:
```ts
import { useEffect, useRef } from 'react'

const SUFIXO = ' · Rota Falada SP'

/**
 * Toda página chama este hook: define o título da aba e move o foco para o h1,
 * para que leitores de tela anunciem a troca de página (WCAG 2.4.2 e 2.4.3).
 * O h1 precisa ter tabIndex={-1} e receber a ref devolvida.
 */
export function usePaginaAcessivel(titulo: string) {
  const h1Ref = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => {
    document.title = titulo + SUFIXO
    h1Ref.current?.focus()
  }, [titulo])

  return h1Ref
}
```

- [ ] **Step 8: Escrever a página inicial, o `App` e o `main`**

`frontend/src/pages/Inicio.tsx`:
```tsx
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'

export function Inicio() {
  const h1 = usePaginaAcessivel('Início')
  return (
    <>
      <h1 ref={h1} tabIndex={-1}>
        Rota Falada SP
      </h1>
      <p>
        Rotas a pé em São Paulo que evitam escadas, calçadas estreitas e outras barreiras,
        descritas em texto e lidas em voz alta.
      </p>
      <p>O cálculo de rotas ainda não está disponível nesta versão.</p>
    </>
  )
}
```

`frontend/src/App.tsx` (substituir):
```tsx
import { Link, NavLink, Route, Routes } from 'react-router'
import { SkipLink } from './a11y/SkipLink'
import { Inicio } from './pages/Inicio'

export default function App() {
  return (
    <>
      <SkipLink />
      <header>
        <nav aria-label="Principal">
          <ul className="menu">
            <li>
              <NavLink className="alvo" to="/">
                Início
              </NavLink>
            </li>
            <li>
              <NavLink className="alvo" to="/fontes">
                Fontes
              </NavLink>
            </li>
            <li>
              <NavLink className="alvo" to="/acessibilidade">
                Acessibilidade
              </NavLink>
            </li>
          </ul>
        </nav>
      </header>
      <main id="conteudo" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/fontes" element={<Inicio />} />
          <Route path="/acessibilidade" element={<Inicio />} />
        </Routes>
      </main>
      <footer>
        <p>
          Dados do mapa © colaboradores do OpenStreetMap. Veja{' '}
          <Link to="/fontes">todas as fontes e licenças</Link>.
        </p>
      </footer>
    </>
  )
}
```

`frontend/src/main.tsx` (substituir):
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 9: Rodar testes, lint e build**

Run:
```powershell
npm test -- --run
npm run lint
npm run build
```
Expected: `4 passed`; lint sem erros; build gera `dist/`.

- [ ] **Step 10: Commit**

```powershell
cd ..
git add frontend/
git commit -m "feat(frontend): esqueleto React acessível com skip link, foco no h1 e lint jsx-a11y"
```

---

### Task 7: Página `/fontes` consumindo `GET /api/fontes` com tipos gerados do OpenAPI

**Files:**
- Create: `frontend/src/api/types.gen.ts` (gerado)
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/pages/Fontes.tsx`
- Modify: `frontend/src/App.tsx` (rota `/fontes`)
- Test: `frontend/src/test/Fontes.test.tsx`

**Interfaces:**
- Consumes: `GET /api/fontes -> FonteOut[]` (Task 4); `usePaginaAcessivel` (Task 6).
- Produces: `type Fonte = components['schemas']['FonteOut']`; `listarFontes(): Promise<Fonte[]>`; `apiUrl(caminho: string): string` que prefixa `VITE_API_URL` (padrão `http://localhost:8000`).

- [ ] **Step 1: Gerar os tipos a partir do backend em execução**

Run (com o backend no ar em outro terminal: `uvicorn app.main:app --port 8000` dentro de `backend/`):
```powershell
cd frontend
npm run gerar-tipos
```
Expected: `src/api/types.gen.ts` criado, contendo um bloco `FonteOut: { chave: string; nome: string; licenca: string; url: string; atribuicao: string; data_referencia: string | null; data_extracao: string | null; }` dentro de `components.schemas`.

- [ ] **Step 2: Escrever o teste que falha**

`frontend/src/test/Fontes.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { axe } from 'vitest-axe'
import App from '../App'

const FONTES = [
  {
    chave: 'geosampa',
    nome: 'GeoSampa / Prefeitura de São Paulo',
    licenca: 'CC-BY-SA 4.0',
    url: 'https://geosampa.prefeitura.sp.gov.br',
    atribuicao: 'Calçadas: GeoSampa/PMSP (CC-BY-SA 4.0), diagnóstico de 2021',
    data_referencia: '2021-08-13',
    data_extracao: null,
  },
  {
    chave: 'osm',
    nome: 'OpenStreetMap',
    licenca: 'ODbL 1.0',
    url: 'https://www.openstreetmap.org/copyright',
    atribuicao: 'Dados do mapa © colaboradores do OpenStreetMap (ODbL)',
    data_referencia: null,
    data_extracao: null,
  },
]

function renderizarFontes() {
  return render(
    <MemoryRouter initialEntries={['/fontes']}>
      <App />
    </MemoryRouter>,
  )
}

describe('página /fontes', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lista cada fonte com link, licença, data de referência e atribuição', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(FONTES)))
    const { container } = renderizarFontes()

    expect(await screen.findByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    )
    expect(screen.getByText(/licença ODbL 1\.0/)).toBeInTheDocument()
    expect(screen.getByText(/Dados de 13\/08\/2021/)).toBeInTheDocument()
    expect(screen.getByText('Calçadas: GeoSampa/PMSP (CC-BY-SA 4.0), diagnóstico de 2021')).toBeInTheDocument()
    expect(document.title).toBe('Fontes de dados e licenças · Rota Falada SP')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('chama a API no endereço configurado', async () => {
    const fetchMock = vi.fn(async () => Response.json([]))
    vi.stubGlobal('fetch', fetchMock)
    renderizarFontes()
    await screen.findByRole('heading', { level: 1 })
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/api/fontes')
  })

  it('anuncia erro em role=alert quando a API falha', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('erro', { status: 503 })))
    renderizarFontes()
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 503')
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test -- --run src/test/Fontes.test.tsx`
Expected: falhas em `findByRole('link', { name: 'OpenStreetMap' })` (a rota ainda renderiza `Inicio`).

- [ ] **Step 4: Escrever o cliente da API**

`frontend/src/api/client.ts`:
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

- [ ] **Step 5: Escrever a página**

`frontend/src/pages/Fontes.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'
import { listarFontes, type Fonte } from '../api/client'

function formatarData(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR')
}

export function Fontes() {
  const h1 = usePaginaAcessivel('Fontes de dados e licenças')
  const [fontes, setFontes] = useState<Fonte[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    listarFontes()
      .then(setFontes)
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : String(e)))
  }, [])

  return (
    <>
      <h1 ref={h1} tabIndex={-1}>
        Fontes de dados e licenças
      </h1>
      <p>
        Toda informação exibida no Rota Falada SP declara de onde veio e de quando é. Esta
        página lista as fontes, suas licenças e a atribuição obrigatória de cada uma.
      </p>
      {erro && <p role="alert">{erro}</p>}
      {!fontes && !erro && <p role="status">Carregando fontes…</p>}
      {fontes && (
        <ul>
          {fontes.map((f) => (
            <li key={f.chave}>
              <a href={f.url}>{f.nome}</a>, licença {f.licenca}.{' '}
              {f.data_referencia && <>Dados de {formatarData(f.data_referencia)}. </>}
              <span>{f.atribuicao}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
```

- [ ] **Step 6: Registrar a rota**

Em `frontend/src/App.tsx`, importe a página e troque a rota:
```tsx
import { Fontes } from './pages/Fontes'
```
```tsx
          <Route path="/fontes" element={<Fontes />} />
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npm test -- --run ; npm run lint ; npm run build`
Expected: `7 passed`; lint e build limpos.

- [ ] **Step 8: Conferir de verdade contra o backend**

Run: `npm run dev` (backend no ar), abra `http://localhost:5173/fontes`.
Expected: seis fontes listadas; navegando por Tab, o primeiro Tab revela o "Pular para o conteúdo". No DevTools, o título da aba é "Fontes de dados e licenças · Rota Falada SP".

- [ ] **Step 9: Commit**

```powershell
cd ..
git add frontend/
git commit -m "feat(frontend): página /fontes com tipos gerados do OpenAPI"
```

---

### Task 8: Página `/acessibilidade` (declaração exigida pelo art. 63 §1º da LBI)

**Files:**
- Create: `frontend/src/pages/Acessibilidade.tsx`
- Modify: `frontend/src/App.tsx` (rota)
- Test: `frontend/src/test/Acessibilidade.test.tsx`

**Interfaces:**
- Consumes: `usePaginaAcessivel` (Task 6).

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/test/Acessibilidade.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { axe } from 'vitest-axe'
import App from '../App'

describe('página /acessibilidade', () => {
  it('declara a meta WCAG 2.2 AA, os recursos, as limitações e o contato', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/acessibilidade']}>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'Declaração de acessibilidade' })).toHaveFocus()
    expect(screen.getByRole('heading', { level: 2, name: 'Meta de conformidade' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Recursos disponíveis' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Limitações conhecidas' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Como relatar um problema' })).toBeInTheDocument()
    expect(screen.getByText(/WCAG 2\.2 nível AA/)).toBeInTheDocument()
    expect(document.title).toBe('Declaração de acessibilidade · Rota Falada SP')
    expect(await axe(container)).toHaveNoViolations()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- --run src/test/Acessibilidade.test.tsx`
Expected: `FAILED` (heading "Declaração de acessibilidade" não existe).

- [ ] **Step 3: Escrever a página**

`frontend/src/pages/Acessibilidade.tsx`:
```tsx
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'

export function Acessibilidade() {
  const h1 = usePaginaAcessivel('Declaração de acessibilidade')
  return (
    <>
      <h1 ref={h1} tabIndex={-1}>
        Declaração de acessibilidade
      </h1>
      <p>
        O Rota Falada SP é feito para pessoas com mobilidade reduzida, baixa visão e para quem
        usa leitor de tela. Esta declaração atende ao art. 63, §1º, da Lei Brasileira de Inclusão
        (Lei 13.146/2015) e é atualizada a cada versão.
      </p>

      <h2>Meta de conformidade</h2>
      <p>
        WCAG 2.2 nível AA, tendo o eMAG 3.1 e a ABNT NBR 17225:2025 como referências nacionais.
      </p>

      <h2>Recursos disponíveis</h2>
      <ul>
        <li>Toda rota é apresentada como lista de passos em texto; o mapa é uma ilustração opcional.</li>
        <li>Navegação completa por teclado, com link para pular ao conteúdo e foco visível.</li>
        <li>Alvos de toque de no mínimo 44 por 44 pixels.</li>
        <li>Layout que se reorganiza sem rolagem horizontal a 320 pixels de largura e zoom de 400%.</li>
        <li>Respeito à preferência do sistema por menos movimento.</li>
        <li>Idioma declarado como português do Brasil para leitores de tela e síntese de voz.</li>
      </ul>

      <h2>Limitações conhecidas</h2>
      <ul>
        <li>O cálculo de rotas e a leitura em voz alta ainda não estão disponíveis nesta versão.</li>
        <li>Os dados de calçadas cobrem apenas a área piloto (Vila Mariana, Lapa e Ipiranga) e são de 2021.</li>
        <li>Testes manuais com VoiceOver foram feitos apenas no iPhone, não no macOS.</li>
      </ul>

      <h2>Como relatar um problema</h2>
      <p>
        Encontrou uma barreira neste site? Abra um relato no repositório público do projeto no
        GitHub ou escreva para a equipe pelo e-mail indicado lá. Respondemos em até sete dias.
      </p>
    </>
  )
}
```

- [ ] **Step 4: Registrar a rota**

Em `frontend/src/App.tsx`:
```tsx
import { Acessibilidade } from './pages/Acessibilidade'
```
```tsx
          <Route path="/acessibilidade" element={<Acessibilidade />} />
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- --run ; npm run lint ; npm run build`
Expected: `8 passed`; lint e build limpos.

- [ ] **Step 6: Commit**

```powershell
cd ..
git add frontend/
git commit -m "feat(frontend): declaração de acessibilidade (art. 63 LBI)"
```

---

### Task 9: gitleaks no pre-commit e CI no GitHub Actions

**Files:**
- Create: `.pre-commit-config.yaml`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: CI com três jobs (`backend`, `frontend`, `gitleaks`) que roda em todo push e pull request. Os planos seguintes acrescentam jobs (ETL agendado, Lighthouse CI) neste mesmo arquivo ou em arquivos irmãos.

- [ ] **Step 1: Configurar o pre-commit**

`.pre-commit-config.yaml`:
```yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.21.2
    hooks:
      - id: gitleaks
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.6.9
    hooks:
      - id: ruff
        args: [--fix]
        files: ^backend/
      - id: ruff-format
        files: ^backend/
```

Run (venv do backend ativado):
```powershell
pip install pre-commit
pre-commit install
pre-commit run --all-files
```
Expected: `gitleaks...Passed`, `ruff...Passed`, `ruff-format...Passed`.

- [ ] **Step 2: Provar que o gitleaks bloqueia uma chave**

Run:
```powershell
Set-Content -Path teste-vazamento.txt -Value 'SPTRANS_TOKEN=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
git add teste-vazamento.txt
git commit -m "teste"
```
Expected: o commit é **recusado** com `gitleaks...Failed` e um achado do tipo `generic-api-key`. Em seguida:
```powershell
git reset teste-vazamento.txt
Remove-Item teste-vazamento.txt
```
Se o gitleaks **não** bloquear (a regra genérica exige entropia alta e pode não pegar todo formato), acrescente na raiz um `.gitleaks.toml`:
```toml
[extend]
useDefault = true

[[rules]]
id = "sptrans-token"
description = "Chave da API Olho Vivo (64 hex)"
regex = '''(?i)sptrans[_-]?token\s*[=:]\s*['"]?[0-9a-f]{64}'''
```
e repita o teste até o commit ser recusado.

- [ ] **Step 3: Escrever o workflow de CI**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main, master]
  pull_request:

jobs:
  backend:
    runs-on: ubuntu-latest
    services:
      db:
        image: pgrouting/pgrouting:latest
        env:
          POSTGRES_PASSWORD: dev
          POSTGRES_DB: acessibilidade
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 20
    defaults:
      run:
        working-directory: backend
    env:
      DATABASE_URL: postgresql+psycopg://postgres:dev@localhost:5432/acessibilidade
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
      - run: pip install -e ".[dev]"
      - run: ruff check . && ruff format --check .
      - run: alembic upgrade head
      - run: pytest -q

  frontend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm test -- --run
      - run: npm run build

  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 4: Criar o repositório público no GitHub e enviar**

Run (na raiz; substitua o nome de usuário):
```powershell
git branch -M main
gh repo create rota-falada-sp --public --source=. --remote=origin --push
```
Se não tiver o `gh`, crie o repositório vazio em github.com e rode `git remote add origin https://github.com/<usuario>/rota-falada-sp.git ; git push -u origin main`.

Expected: na aba Actions do GitHub, os três jobs ficam verdes. O job `backend` deve mostrar `6 passed` (nenhum teste pulado, porque o serviço PostGIS está no ar).

- [ ] **Step 5: Ativar o Secret Scanning**

No GitHub: Settings → Code security → ativar **Secret scanning** e **Push protection**. Expected: as duas opções com "Enabled".

- [ ] **Step 6: Commit local do pre-commit (já enviado com o push acima, se feito antes)**

```powershell
git add .pre-commit-config.yaml .github/workflows/ci.yml
git commit -m "ci: pipeline backend/frontend/gitleaks e pre-commit"
git push
```

---

### Task 10: Deploy ponta a ponta (Supabase + Render + Cloudflare Pages) e keep-alive

**Files:**
- Create: `render.yaml`
- Create: `.github/workflows/keep-alive.yml`
- Modify: `README.md` (seção "Produção")

**Interfaces:**
- Produces: URL pública do backend (`https://rota-falada-api.onrender.com/health`) e do frontend (`https://<projeto>.pages.dev`). Variáveis de ambiente: `DATABASE_URL` e `CORS_ORIGINS` no Render; `VITE_API_URL` no Cloudflare Pages; Secret `RENDER_HEALTH_URL` no GitHub.

- [ ] **Step 1: Criar o banco no Supabase**

1. Em supabase.com, criar projeto `rota-falada-sp`, região **South America (São Paulo)**, senha forte gerada e guardada no gerenciador de senhas.
2. Em SQL Editor, rodar `SELECT name FROM pg_available_extensions WHERE name IN ('postgis','pgrouting','pg_trgm');` e confirmar as três linhas.
3. Em Connect → **Session pooler**, copiar a string, trocar o prefixo `postgresql://` por `postgresql+psycopg://` e guardar como `DATABASE_URL` de produção (não no repositório).

Expected: rodar localmente `DATABASE_URL="<string do supabase>" alembic upgrade head` (PowerShell: `$env:DATABASE_URL="..."; alembic upgrade head`) aplica a migration no Supabase; o Table Editor mostra `fonte_dados` com 6 linhas.

- [ ] **Step 2: Escrever o `render.yaml`**

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

- [ ] **Step 3: Publicar o backend no Render**

1. Em render.com → New → Blueprint, conectar o repositório; o Render lê o `render.yaml`.
2. Preencher `DATABASE_URL` (string do Supabase) e `CORS_ORIGINS` com `["http://localhost:5173"]` por enquanto.
3. Aguardar o deploy.

Expected: `curl https://rota-falada-api.onrender.com/health` responde `{"status":"ok","versao":"0.1.0","banco":"ok"}` (a primeira chamada pode levar até 1 minuto por causa do cold start). `curl https://rota-falada-api.onrender.com/api/fontes` devolve as 6 fontes.

- [ ] **Step 4: Publicar o frontend no Cloudflare Pages**

1. Em dash.cloudflare.com → Workers & Pages → Create → Pages → conectar o repositório.
2. Build settings: framework **Vite**, root directory `frontend`, build command `npm run build`, output `dist`.
3. Variável de ambiente (Production): `VITE_API_URL=https://rota-falada-api.onrender.com`.
4. Para o roteamento do React funcionar em URLs diretas, criar `frontend/public/_redirects` com o conteúdo `/* /index.html 200` e commitar.

Expected: `https://<projeto>.pages.dev/fontes` lista as seis fontes vindas do Render.

- [ ] **Step 5: Fechar o CORS**

No Render, alterar `CORS_ORIGINS` para `["https://<projeto>.pages.dev","http://localhost:5173"]` e reimplantar.

Expected: a página `/fontes` continua funcionando; no DevTools → Network, a resposta de `/api/fontes` traz `access-control-allow-origin: https://<projeto>.pages.dev`.

- [ ] **Step 6: Keep-alive em horário de uso**

`.github/workflows/keep-alive.yml`:
```yaml
name: keep-alive

on:
  schedule:
    # a cada 10 min, fora da hora cheia (crons na hora cheia atrasam),
    # das 07h às 23h59 de Brasília (10h–02h59 UTC)
    - cron: "7-59/10 10-23 * * *"
    - cron: "7-59/10 0-2 * * *"
  workflow_dispatch:

jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Acorda o backend no Render
        run: |
          codigo=$(curl -s -o /dev/null -w "%{http_code}" --max-time 90 "${{ secrets.RENDER_HEALTH_URL }}")
          echo "HTTP $codigo"
          test "$codigo" = "200"
```

No GitHub: Settings → Secrets and variables → Actions → New repository secret `RENDER_HEALTH_URL` = `https://rota-falada-api.onrender.com/health`.

Run: Actions → keep-alive → **Run workflow**.
Expected: job verde com `HTTP 200` no log.

- [ ] **Step 7: Documentar produção no README**

Acrescentar ao `README.md`, antes de "Armadilhas conhecidas":
```markdown
## Produção (custo zero)

| Componente | Serviço | URL |
|---|---|---|
| Frontend | Cloudflare Pages | https://<projeto>.pages.dev |
| Backend | Render Free (512 MB) | https://rota-falada-api.onrender.com |
| Banco | Supabase Free (PostGIS + pgRouting) | painel do Supabase |

Variáveis: `DATABASE_URL` e `CORS_ORIGINS` no Render; `VITE_API_URL` no Cloudflare Pages; Secret `RENDER_HEALTH_URL` no GitHub para o keep-alive. O backend dorme após 15 min sem tráfego e leva ~1 min para voltar; o workflow `keep-alive` faz ping a cada 10 min das 7h às 3h. **Antes de qualquer demonstração, abra `/health` cinco minutos antes.**
```

- [ ] **Step 8: Commit e verificação final do plano**

```powershell
git add render.yaml .github/workflows/keep-alive.yml README.md frontend/public/_redirects
git commit -m "deploy: blueprint do Render, keep-alive e documentação de produção"
git push
```

Verificação de saída do Plano 1 (todas precisam ser verdadeiras):
1. Actions do GitHub verde nos três jobs do CI.
2. `https://rota-falada-api.onrender.com/health` responde `{"status":"ok","versao":"0.1.0","banco":"ok"}`.
3. `https://<projeto>.pages.dev/fontes` lista seis fontes, navegável só por teclado, título da aba correto.
4. `npm test -- --run` local: `8 passed`; `pytest -q` local com Docker: `6 passed`.
5. Um commit contendo uma chave de 64 hex é recusado pelo pre-commit.

---

## Self-review do plano

**Cobertura do spec (partes atribuídas ao Plano 1 pelo roteiro):** estrutura de pastas (Tasks 1, 2, 6) ✔; `docker-compose.yml` com pgRouting ✔; `DATA-LICENSES.md` e decisão de tabelas separadas ✔ (Task 1); `fonte_dados` como catálogo que alimenta o rodapé ✔ (Tasks 3, 4, 6); `/health` e `/api/fontes` ✔ (Tasks 4, 5); `<html lang="pt-BR">`, skip link, foco no h1, `document.title`, alvos 44 px, reduced-motion, reflow ✔ (Task 6); páginas `/fontes` e `/acessibilidade` ✔ (Tasks 7, 8); `eslint-plugin-jsx-a11y` e axe no CI ✔ (Tasks 6, 9); gitleaks e Secret Scanning ✔ (Task 9); Cloudflare Pages + Render + Supabase, keep-alive fora da hora cheia, "nunca Postgres do Render" ✔ (Task 10); ADR 001 ✔ (Task 1). Itens do spec deixados para os planos seguintes por dependerem de dados: `ultimo_etl` no `/health` (Plano 2), cota do ORS no `/health` (Plano 4), `USE_FIXTURES` com fixtures reais (Plano 4; a flag já existe nas settings), Lighthouse CI (Plano 5, quando houver a página de rota).

**Placeholders:** nenhum "TBD/TODO"; todo passo de código traz o código; comandos trazem saída esperada.

**Consistência de nomes:** `create_app`, `get_db`, `FonteDados`, `FonteOut`, `HealthOut`, `VERSAO`, `usePaginaAcessivel`, `listarFontes`, `apiUrl`, `Fonte`, rota `#conteudo`, chaves `osm/geosampa/sp156/sptrans/ors/colaborativo` são idênticos em todas as tarefas em que aparecem. A contagem de testes cresce 1 → 4 → 5 → 6 no backend e 4 → 7 → 8 no frontend, coerente com os passos.

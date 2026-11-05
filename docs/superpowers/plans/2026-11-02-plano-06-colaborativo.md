# Camada colaborativa (Plano 6, backend) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pessoa logada (código no e-mail, Supabase Auth) cadastra barreira com foto opcional, outras pessoas votam (confirma/contesta/resolvida), a moderação muda o status com auditoria imutável, o admin decide na hora, e uma barreira validada passa a desviar a rota.

**Architecture:** Migration 008 cria `usuario`, `confirmacao`, `barreira_evento` (só inserção) e estende `barreira_colaborativa`. Regras de moderação ficam numa função pura (`services/moderacao.py`); escrita e leitura em `services/barreiras.py` e `services/votacao.py`; foto em `services/fotos.py` (Pillow + Supabase Storage atrás de uma interface). `app/auth.py` valida o JWT ES256 do Supabase pelo JWKS. Routers só validam e traduzem `ErroDominio` para HTTP.

**Tech Stack:** Python 3.12+, FastAPI, SQLAlchemy 2 (`text()`), PostgreSQL/PostGIS, Alembic, PyJWT[crypto], Pillow, python-multipart, httpx, respx, pytest.

**Spec:** `docs/superpowers/specs/2026-11-02-colaborativo-design.md` (aprovado em 02/11/2026). Em caso de dúvida, o spec manda.

## Global Constraints

- Aplicação 100% determinística, sem IA. O horário (`agora`) é parâmetro de todo serviço; routers obtêm `agora` pela dependência `obter_agora`.
- Nenhuma resposta pública (`BarreiraOut`) expõe autor nem votantes. Só `GET /api/admin/barreiras/{id}/eventos` mostra ids de usuário.
- Contribuições dos usuários são ODbL (`fonte_dados.chave = 'colaborativo'`).
- Nenhuma chave em arquivo versionado. `SUPABASE_SERVICE_ROLE_KEY` só no Render. **Nunca** usar `DATABASE_URL_PROD` como `DATABASE_URL` local. Nenhum teste acessa a rede.
- **Commits e pushes só quando o dono do repositório mandar.** Os passos "Commit" trazem a mensagem sugerida. Formato: português, `tipo(escopo): descrição`.
- Código, mensagens de erro e nomes de domínio em português.
- `ruff check` e `ruff format --check` passam no backend (linha 100, regras E, F, I, B, UP).
- TDD: teste falhando antes do código em todo passo que produz código.
- Ambiente local: Docker Desktop aberto; banco em `localhost:5433`; o PostgreSQL nativo na 5432 não é do projeto.
- No PowerShell deste ambiente, comandos com `rm` ou com o texto `/*` são bloqueados.

## Como rodar as coisas

- Instalar dependências novas (a partir de `backend/`): `.venv/Scripts/python.exe -m pip install -e ".[dev]"`
- Testes (a partir de `backend/`): `.venv/Scripts/python.exe -m pytest <alvo> -v`
- Migrations (a partir de `backend/`): `.venv/Scripts/python.exe -m alembic upgrade head`
- Lint (a partir de `backend/`): `.venv/Scripts/python.exe -m ruff check . ; .venv/Scripts/python.exe -m ruff format --check .`

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `backend/alembic/versions/008_colaborativo.py` | criar | tabelas e colunas novas, trigger, RLS |
| `backend/tests/test_migracao_colaborativo.py` | criar | testes da 008 |
| `backend/tests/services/test_rota.py` | modificar | categorias antigas → lista fechada |
| `backend/app/services/moderacao.py` | criar | regras puras: categorias, `decidir_status`, expiração |
| `backend/tests/test_moderacao.py` | criar | tabela de casos |
| `backend/app/config.py` | modificar | `supabase_url`, `supabase_service_role_key` |
| `backend/app/auth.py` | criar | `usuario_atual`, `exigir_admin`, `ConfigAuth` |
| `backend/tests/conftest.py` | modificar | fixtures de auth, transação, armazenamento, cliente |
| `backend/tests/test_auth.py` | criar | testes de login |
| `backend/app/services/erros.py` | criar | `ErroDominio` e subclasses com status HTTP |
| `backend/app/schemas/barreira.py` | criar | `BarreiraIn`, `BarreiraOut`, `VotoIn`, `StatusAdminIn`, `EventoOut` |
| `backend/app/services/barreiras.py` | criar | cadastro, leitura, eventos, URL da foto |
| `backend/tests/test_barreiras_cadastro.py` | criar | testes de cadastro e leitura |
| `backend/app/services/votacao.py` | criar | voto, status do admin, `expirar_vencidas` |
| `backend/app/services/barreira_geom.py` | modificar | ignora colaborativas expiradas |
| `backend/tests/test_votacao.py` | criar | testes de moderação com banco |
| `backend/app/services/admin.py` | criar | `promover_admin`, `buscar_id_por_email` |
| `backend/scripts/promover_admin.py`, `backend/scripts/expirar.py` | criar | CLIs finos |
| `backend/tests/test_admin.py` | criar | testes de promoção |
| `backend/app/services/fotos.py` | criar | reprocessamento e armazenamento |
| `backend/tests/test_fotos.py` | criar | testes de foto |
| `backend/app/routers/barreiras.py`, `backend/app/routers/admin.py` | criar | rotas HTTP |
| `backend/app/main.py` | modificar | routers, estado, CORS |
| `backend/tests/test_barreiras_api.py` | criar | contrato HTTP |
| `backend/pyproject.toml` | modificar | dependências novas |
| `render.yaml` | modificar | variáveis novas |
| `frontend/src/api/types.gen.ts` | regenerar | tipos |
| `backend/tests/test_colaborativo_rota.py` | criar | "cadastra e a rota muda" |
| `README.md`, `DATA-LICENSES.md` | modificar | documentação |

---

### Task 1: Migration 008

**Files:**
- Create: `backend/alembic/versions/008_colaborativo.py`
- Create: `backend/tests/test_migracao_colaborativo.py`
- Modify: `backend/tests/services/test_rota.py` (4 inserts de `barreira_colaborativa`)

**Interfaces:**
- Consumes: `barreira_colaborativa` (004; constraint de status chamada `barreira_colaborativa_status_check`), `fonte_dados`, migration `007_area_ipiranga_fatec`.
- Produces: tabelas `usuario(id uuid PK, papel, criado_em)`, `confirmacao(id, barreira_id, usuario_id, voto, criado_em, atualizado_em, UNIQUE(barreira_id, usuario_id))`, `barreira_evento(id, barreira_id NULL, usuario_id NULL, tipo, de_status, para_status, detalhe jsonb, criado_em)`; colunas novas em `barreira_colaborativa`: `autor_id`, `chave_idempotencia`, `ultima_confirmacao_em`, `foto_caminho`, `foto_descricao`; status aceita `removida`; categoria restrita à lista fechada.

- [ ] **Step 1: Escrever o teste**

`backend/tests/test_migracao_colaborativo.py`:

```python
"""Migration 008: camada colaborativa (spec 2026-11-02-colaborativo-design.md, 3)."""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

pytestmark = pytest.mark.integration


@pytest.fixture
def db():
    from app.db import SessionLocal

    sessao = SessionLocal()
    try:
        yield sessao
    finally:
        sessao.rollback()
        sessao.close()


def _usuario(db) -> uuid.UUID:
    uid = uuid.uuid4()
    db.execute(text("INSERT INTO usuario (id) VALUES (:id)"), {"id": uid})
    return uid


def _barreira(db, categoria="escada", status="pendente", autor=None, chave=None, **extra) -> int:
    colunas = {
        "categoria": categoria,
        "severidade": "intransponivel",
        "status": status,
        "autor_id": autor,
        "chave_idempotencia": chave,
        **extra,
    }
    nomes = ", ".join(colunas)
    valores = ", ".join(f":{c}" for c in colunas)
    return db.execute(
        text(
            f"INSERT INTO barreira_colaborativa ({nomes}, geom, fonte_id) VALUES ({valores}, "
            "ST_SetSRID(ST_MakePoint(-46.635, -23.59), 4326), "
            "(SELECT id FROM fonte_dados WHERE chave = 'colaborativo')) RETURNING id"
        ),
        colunas,
    ).scalar_one()


def test_tabelas_novas_existem_com_rls(db):
    for tabela in ("usuario", "confirmacao", "barreira_evento"):
        ligado = db.execute(
            text("SELECT relrowsecurity FROM pg_class WHERE oid = CAST(:t AS regclass)"),
            {"t": tabela},
        ).scalar_one()
        assert ligado is True, tabela


def test_usuario_papel_padrao_e_dominio(db):
    uid = _usuario(db)
    papel = db.execute(text("SELECT papel FROM usuario WHERE id = :id"), {"id": uid}).scalar_one()
    assert papel == "colaborador"
    with pytest.raises(DBAPIError):
        db.execute(
            text("INSERT INTO usuario (id, papel) VALUES (:id, 'chefe')"), {"id": uuid.uuid4()}
        )


def test_status_removida_aceito_e_categoria_fora_da_lista_recusada(db):
    _barreira(db, status="removida")
    with pytest.raises(DBAPIError):
        _barreira(db, categoria="obstaculo_calcada")


def test_foto_exige_caminho_e_descricao_juntos(db):
    _barreira(db, foto_caminho="1/a.webp", foto_descricao="Escada de três degraus")
    with pytest.raises(DBAPIError):
        _barreira(db, foto_caminho="1/b.webp")


def test_chave_idempotencia_unica_por_autor(db):
    autor = _usuario(db)
    chave = uuid.uuid4()
    _barreira(db, autor=autor, chave=chave)
    _barreira(db, autor=_usuario(db), chave=chave)  # outro autor pode repetir a chave
    with pytest.raises(DBAPIError):
        _barreira(db, autor=autor, chave=chave)


def test_confirmacao_voto_unico_por_usuario(db):
    barreira = _barreira(db)
    eleitor = _usuario(db)
    sql = text(
        "INSERT INTO confirmacao (barreira_id, usuario_id, voto) VALUES (:b, :u, :v)"
    )
    db.execute(sql, {"b": barreira, "u": eleitor, "v": "confirma"})
    with pytest.raises(DBAPIError):
        db.execute(sql, {"b": barreira, "u": eleitor, "v": "contesta"})


def test_confirmacao_rejeita_voto_fora_do_dominio(db):
    with pytest.raises(DBAPIError):
        db.execute(
            text("INSERT INTO confirmacao (barreira_id, usuario_id, voto) VALUES (:b, :u, 'talvez')"),
            {"b": _barreira(db), "u": _usuario(db)},
        )


def test_barreira_evento_e_so_insercao(db):
    evento = db.execute(
        text(
            "INSERT INTO barreira_evento (barreira_id, tipo, para_status) "
            "VALUES (:b, 'criada', 'pendente') RETURNING id"
        ),
        {"b": _barreira(db)},
    ).scalar_one()
    db.execute(text("SAVEPOINT antes_update"))
    with pytest.raises(DBAPIError):
        db.execute(text("UPDATE barreira_evento SET tipo = 'voto' WHERE id = :id"), {"id": evento})
    db.execute(text("ROLLBACK TO SAVEPOINT antes_update"))
    with pytest.raises(DBAPIError):
        db.execute(text("DELETE FROM barreira_evento WHERE id = :id"), {"id": evento})
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `backend/`): `.venv/Scripts/python.exe -m pytest tests/test_migracao_colaborativo.py -v`
Expected: FAIL (`relation "usuario" does not exist`).

- [ ] **Step 3: Escrever a migration**

`backend/alembic/versions/008_colaborativo.py`:

```python
"""camada colaborativa: usuario, confirmacao, barreira_evento e barreira_colaborativa completa

Spec: docs/superpowers/specs/2026-11-02-colaborativo-design.md, seção 3.
Categorias de barreira viram lista fechada; linhas antigas fora da lista
passam a `outro`. `barreira_evento` é só inserção (trigger). RLS ligado em
todas as tabelas novas, como desde a 005.

Revision ID: 008_colaborativo
Revises: 007_area_ipiranga_fatec
Create Date: 2026-11-02
"""

from alembic import op

revision = "008_colaborativo"
down_revision = "007_area_ipiranga_fatec"
branch_labels = None
depends_on = None

CATEGORIAS = (
    "escada",
    "sem_rampa",
    "elevador_quebrado",
    "obstaculo_bloqueando",
    "calcada_estreita",
    "rampa_ingreme",
    "buraco",
    "piso_irregular",
    "sem_piso_tatil",
    "outro",
)
_LISTA_SQL = ", ".join(f"'{c}'" for c in CATEGORIAS)


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE usuario (
          id uuid PRIMARY KEY,
          papel text NOT NULL DEFAULT 'colaborador' CHECK (papel IN ('colaborador','admin')),
          criado_em timestamptz NOT NULL DEFAULT now()
        );
        """
    )
    op.execute(
        f"""
        UPDATE barreira_colaborativa SET categoria = 'outro'
        WHERE categoria NOT IN ({_LISTA_SQL});

        ALTER TABLE barreira_colaborativa
          ADD COLUMN autor_id uuid REFERENCES usuario(id),
          ADD COLUMN chave_idempotencia uuid,
          ADD COLUMN ultima_confirmacao_em timestamptz,
          ADD COLUMN foto_caminho text,
          ADD COLUMN foto_descricao text,
          ADD CONSTRAINT barreira_colaborativa_categoria_check
            CHECK (categoria IN ({_LISTA_SQL})),
          ADD CONSTRAINT barreira_colaborativa_foto_check
            CHECK ((foto_caminho IS NULL) = (foto_descricao IS NULL)),
          ADD CONSTRAINT barreira_colaborativa_idempotencia_key
            UNIQUE (autor_id, chave_idempotencia);

        ALTER TABLE barreira_colaborativa DROP CONSTRAINT barreira_colaborativa_status_check;
        ALTER TABLE barreira_colaborativa ADD CONSTRAINT barreira_colaborativa_status_check
          CHECK (status IN ('pendente','validada','contestada','resolvida','expirada','removida'));

        CREATE INDEX barreira_colaborativa_autor_criado_idx
          ON barreira_colaborativa (autor_id, criado_em);
        """
    )
    op.execute(
        """
        CREATE TABLE confirmacao (
          id bigserial PRIMARY KEY,
          barreira_id bigint NOT NULL REFERENCES barreira_colaborativa(id),
          usuario_id uuid NOT NULL REFERENCES usuario(id),
          voto text NOT NULL CHECK (voto IN ('confirma','contesta','resolvida')),
          criado_em timestamptz NOT NULL DEFAULT now(),
          atualizado_em timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT confirmacao_voto_unico UNIQUE (barreira_id, usuario_id)
        );

        CREATE TABLE barreira_evento (
          id bigserial PRIMARY KEY,
          barreira_id bigint REFERENCES barreira_colaborativa(id),
          usuario_id uuid REFERENCES usuario(id),
          tipo text NOT NULL
            CHECK (tipo IN ('criada','voto','status','foto','admin','promocao')),
          de_status text,
          para_status text,
          detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
          criado_em timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX barreira_evento_barreira_idx ON barreira_evento (barreira_id, id);

        CREATE FUNCTION barreira_evento_imutavel() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'barreira_evento é só inserção (auditoria imutável)';
        END;
        $$;
        CREATE TRIGGER barreira_evento_sem_update_delete
          BEFORE UPDATE OR DELETE ON barreira_evento
          FOR EACH ROW EXECUTE FUNCTION barreira_evento_imutavel();

        ALTER TABLE usuario ENABLE ROW LEVEL SECURITY;
        ALTER TABLE confirmacao ENABLE ROW LEVEL SECURITY;
        ALTER TABLE barreira_evento ENABLE ROW LEVEL SECURITY;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE barreira_evento;
        DROP FUNCTION barreira_evento_imutavel();
        DROP TABLE confirmacao;
        UPDATE barreira_colaborativa SET status = 'expirada' WHERE status = 'removida';
        ALTER TABLE barreira_colaborativa DROP CONSTRAINT barreira_colaborativa_status_check;
        ALTER TABLE barreira_colaborativa ADD CONSTRAINT barreira_colaborativa_status_check
          CHECK (status IN ('pendente','validada','contestada','resolvida','expirada'));
        DROP INDEX barreira_colaborativa_autor_criado_idx;
        ALTER TABLE barreira_colaborativa
          DROP CONSTRAINT barreira_colaborativa_idempotencia_key,
          DROP CONSTRAINT barreira_colaborativa_foto_check,
          DROP CONSTRAINT barreira_colaborativa_categoria_check,
          DROP COLUMN foto_descricao,
          DROP COLUMN foto_caminho,
          DROP COLUMN ultima_confirmacao_em,
          DROP COLUMN chave_idempotencia,
          DROP COLUMN autor_id;
        DROP TABLE usuario;
        """
    )
```

Nota: o downgrade não restaura categorias antigas (a 008 as converteu para `outro`).

- [ ] **Step 4: Conferir a conversão de categoria antiga (manual, banco local)**

Antes de aplicar, a partir de `backend/`, rode (o banco local está na 007):

```powershell
docker exec rota-falada-db psql -U postgres -d acessibilidade -c "INSERT INTO barreira_colaborativa (id, categoria, severidade, geom, fonte_id) VALUES (999999901, 'obstaculo_calcada', 'intransponivel', ST_SetSRID(ST_MakePoint(-46.635,-23.59),4326), (SELECT id FROM fonte_dados WHERE chave='colaborativo'))"
.venv/Scripts/python.exe -m alembic upgrade head
docker exec rota-falada-db psql -U postgres -d acessibilidade -tAc "SELECT categoria FROM barreira_colaborativa WHERE id = 999999901"
docker exec rota-falada-db psql -U postgres -d acessibilidade -c "DELETE FROM barreira_colaborativa WHERE id = 999999901"
```

Expected: `Running upgrade 007_area_ipiranga_fatec -> 008_colaborativo`; a consulta imprime `outro`; o DELETE apaga 1 linha.

- [ ] **Step 5: Ver passar e ida e volta**

Run: `.venv/Scripts/python.exe -m pytest tests/test_migracao_colaborativo.py -v`
Expected: 8 passed.

Run: `.venv/Scripts/python.exe -m alembic downgrade 007_area_ipiranga_fatec ; .venv/Scripts/python.exe -m alembic upgrade head`
Expected: os dois sem erro.

- [ ] **Step 6: Ajustar testes antigos que usam categorias fora da lista**

Em `backend/tests/services/test_rota.py`, nos quatro `INSERT INTO barreira_colaborativa` (hoje perto das linhas 342, 421, 477 e 601):
- troque `'obstaculo_calcada'` por `'obstaculo_bloqueando'` nos três primeiros;
- troque `'poi_inacessivel'` por `'outro'` no quarto.

Não mexa em `obstaculo_calcada` usado em `barreira_oficial` nem em `_CATEGORIAS_INTRANSPONIVEIS`. Procure no mesmo arquivo asserções que comparem a categoria dessas barreiras colaborativas (`grep -n "obstaculo_calcada\|poi_inacessivel" tests/services/test_rota.py`) e atualize só as que se referem às colaborativas.

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: suíte inteira verde.

- [ ] **Step 7: Commit (só com autorização do dono)**

```bash
git add backend/alembic/versions/008_colaborativo.py backend/tests/test_migracao_colaborativo.py backend/tests/services/test_rota.py
git commit -m "feat(backend): migration 008 da camada colaborativa (usuario, confirmacao, barreira_evento)"
```

---

### Task 2: Regras de moderação (funções puras)

**Files:**
- Create: `backend/app/services/moderacao.py`
- Test: `backend/tests/test_moderacao.py`

**Interfaces:**
- Consumes: nada.
- Produces (em `app.services.moderacao`):
  - Tipos `Severidade`, `Status`, `Voto` (Literal).
  - `SEVERIDADE_POR_CATEGORIA: dict[str, Severidade]`, `CATEGORIAS: tuple[str, ...]`, `LIMIAR_VALIDACAO`, `PRAZO_PENDENTE = timedelta(days=30)`, `PRAZO_VALIDADA = timedelta(days=180)`, `STATUS_ENCERRADOS: frozenset[str]`.
  - `@dataclass(frozen=True) class Contagem(confirma: int = 0, contesta: int = 0, resolvida: int = 0)`.
  - `severidade_da_categoria(categoria: str) -> Severidade` (ValueError se desconhecida).
  - `status_inicial(severidade: Severidade) -> Status`.
  - `decidir_status(status_atual: str, severidade: Severidade, contagem: Contagem) -> Status`.
  - `status_efetivo(status: str, criado_em: datetime, ultima_confirmacao_em: datetime | None, agora: datetime) -> Status`.
  - `afeta_rota(status: str, severidade: str) -> bool`.
  - `expressao_status_efetivo(tabela: str, agora_sql: str) -> str` (fragmento SQL com a mesma regra de `status_efetivo`).

- [ ] **Step 1: Escrever os testes**

`backend/tests/test_moderacao.py`:

```python
"""Regras puras da moderação (spec 2026-11-02-colaborativo-design.md, 3.3 e 6)."""

from datetime import UTC, datetime, timedelta

import pytest

from app.services.moderacao import (
    CATEGORIAS,
    Contagem,
    afeta_rota,
    decidir_status,
    expressao_status_efetivo,
    severidade_da_categoria,
    status_efetivo,
    status_inicial,
)

AGORA = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("categoria", "severidade"),
    [
        ("escada", "intransponivel"),
        ("sem_rampa", "intransponivel"),
        ("elevador_quebrado", "intransponivel"),
        ("obstaculo_bloqueando", "intransponivel"),
        ("calcada_estreita", "dificulta"),
        ("rampa_ingreme", "dificulta"),
        ("buraco", "dificulta"),
        ("piso_irregular", "dificulta"),
        ("sem_piso_tatil", "informativo"),
        ("outro", "informativo"),
    ],
)
def test_severidade_da_categoria(categoria, severidade):
    assert severidade_da_categoria(categoria) == severidade


def test_lista_fechada_tem_dez_categorias():
    assert len(CATEGORIAS) == 10


def test_categoria_desconhecida():
    with pytest.raises(ValueError):
        severidade_da_categoria("inventada")


@pytest.mark.parametrize(
    ("severidade", "esperado"),
    [("intransponivel", "pendente"), ("dificulta", "pendente"), ("informativo", "validada")],
)
def test_status_inicial(severidade, esperado):
    assert status_inicial(severidade) == esperado


@pytest.mark.parametrize(
    ("atual", "severidade", "contagem", "esperado"),
    [
        ("pendente", "intransponivel", Contagem(confirma=1), "pendente"),
        ("pendente", "intransponivel", Contagem(confirma=2), "validada"),
        ("pendente", "dificulta", Contagem(), "pendente"),
        ("pendente", "dificulta", Contagem(confirma=1), "validada"),
        ("validada", "informativo", Contagem(), "validada"),
        ("validada", "intransponivel", Contagem(confirma=1), "pendente"),
        ("validada", "intransponivel", Contagem(confirma=5, contesta=2), "contestada"),
        ("pendente", "dificulta", Contagem(confirma=3, resolvida=2), "resolvida"),
        ("validada", "dificulta", Contagem(contesta=2, resolvida=2), "contestada"),
        ("pendente", "intransponivel", Contagem(confirma=1, contesta=1, resolvida=1), "pendente"),
        ("contestada", "intransponivel", Contagem(confirma=9), "contestada"),
        ("resolvida", "dificulta", Contagem(confirma=9), "resolvida"),
        ("expirada", "dificulta", Contagem(confirma=9), "expirada"),
        ("removida", "dificulta", Contagem(confirma=9), "removida"),
    ],
)
def test_decidir_status(atual, severidade, contagem, esperado):
    assert decidir_status(atual, severidade, contagem) == esperado


@pytest.mark.parametrize(
    ("status", "criado_dias", "ultima_dias", "esperado"),
    [
        ("pendente", 30, None, "pendente"),
        ("pendente", 31, None, "expirada"),
        ("validada", 180, None, "validada"),
        ("validada", 181, None, "expirada"),
        ("validada", 400, 10, "validada"),
        ("validada", 400, 181, "expirada"),
        ("contestada", 999, None, "contestada"),
        ("removida", 999, None, "removida"),
    ],
)
def test_status_efetivo(status, criado_dias, ultima_dias, esperado):
    criado = AGORA - timedelta(days=criado_dias)
    ultima = None if ultima_dias is None else AGORA - timedelta(days=ultima_dias)
    assert status_efetivo(status, criado, ultima, AGORA) == esperado


@pytest.mark.parametrize(
    ("status", "severidade", "esperado"),
    [
        ("validada", "intransponivel", True),
        ("validada", "dificulta", True),
        ("validada", "informativo", False),
        ("pendente", "intransponivel", False),
        ("contestada", "dificulta", False),
    ],
)
def test_afeta_rota(status, severidade, esperado):
    assert afeta_rota(status, severidade) is esperado


def test_expressao_sql_usa_os_mesmos_prazos():
    expressao = expressao_status_efetivo("b", ":agora")
    assert "b.status = 'pendente'" in expressao
    assert "interval '30 days'" in expressao
    assert "interval '180 days'" in expressao
    assert "coalesce(b.ultima_confirmacao_em, b.criado_em)" in expressao
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `backend/`): `.venv/Scripts/python.exe -m pytest tests/test_moderacao.py -v`
Expected: erro de coleta `ModuleNotFoundError: No module named 'app.services.moderacao'`.

- [ ] **Step 3: Implementar**

`backend/app/services/moderacao.py`:

```python
"""Regras de moderação da camada colaborativa (spec
docs/superpowers/specs/2026-11-02-colaborativo-design.md, seções 3.3 e 6).

Tudo aqui é puro: sem banco, sem relógio. `expressao_status_efetivo` repete
em SQL a regra de `status_efetivo` para as leituras e o roteamento; os
testes de `test_barreiras_cadastro.py` conferem que as duas concordam.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

Severidade = Literal["intransponivel", "dificulta", "informativo"]
Status = Literal["pendente", "validada", "contestada", "resolvida", "expirada", "removida"]
Voto = Literal["confirma", "contesta", "resolvida"]

SEVERIDADE_POR_CATEGORIA: dict[str, Severidade] = {
    "escada": "intransponivel",
    "sem_rampa": "intransponivel",
    "elevador_quebrado": "intransponivel",
    "obstaculo_bloqueando": "intransponivel",
    "calcada_estreita": "dificulta",
    "rampa_ingreme": "dificulta",
    "buraco": "dificulta",
    "piso_irregular": "dificulta",
    "sem_piso_tatil": "informativo",
    "outro": "informativo",
}
CATEGORIAS: tuple[str, ...] = tuple(SEVERIDADE_POR_CATEGORIA)

LIMIAR_VALIDACAO: dict[str, int] = {"intransponivel": 2, "dificulta": 1, "informativo": 0}
VOTOS_PARA_CONTESTAR = 2
VOTOS_PARA_RESOLVER = 2
PRAZO_PENDENTE = timedelta(days=30)
PRAZO_VALIDADA = timedelta(days=180)
STATUS_ENCERRADOS: frozenset[str] = frozenset({"removida", "contestada", "resolvida", "expirada"})
_SEVERIDADES_QUE_AFETAM_ROTA = frozenset({"intransponivel", "dificulta"})


@dataclass(frozen=True)
class Contagem:
    confirma: int = 0
    contesta: int = 0
    resolvida: int = 0


def severidade_da_categoria(categoria: str) -> Severidade:
    try:
        return SEVERIDADE_POR_CATEGORIA[categoria]
    except KeyError as erro:
        raise ValueError(f"categoria desconhecida: {categoria!r}") from erro


def status_inicial(severidade: Severidade) -> Status:
    """`informativo` (limiar 0) já nasce visível; as demais esperam votos."""
    return "validada" if LIMIAR_VALIDACAO[severidade] == 0 else "pendente"


def decidir_status(status_atual: str, severidade: Severidade, contagem: Contagem) -> Status:
    """Novo status depois de um voto, na ordem da seção 6.2 do spec."""
    if status_atual in STATUS_ENCERRADOS:
        return status_atual  # type: ignore[return-value]
    if contagem.contesta >= VOTOS_PARA_CONTESTAR:
        return "contestada"
    if contagem.resolvida >= VOTOS_PARA_RESOLVER:
        return "resolvida"
    if contagem.confirma >= LIMIAR_VALIDACAO[severidade]:
        return "validada"
    return "pendente"


def status_efetivo(
    status: str,
    criado_em: datetime,
    ultima_confirmacao_em: datetime | None,
    agora: datetime,
) -> Status:
    """Expiração calculada na leitura (seção 6.3): `pendente` há mais de 30
    dias e `validada` sem confirmação há mais de 180 dias contam como
    `expirada`."""
    if status == "pendente" and agora - criado_em > PRAZO_PENDENTE:
        return "expirada"
    if status == "validada" and agora - (ultima_confirmacao_em or criado_em) > PRAZO_VALIDADA:
        return "expirada"
    return status  # type: ignore[return-value]


def afeta_rota(status: str, severidade: str) -> bool:
    return status == "validada" and severidade in _SEVERIDADES_QUE_AFETAM_ROTA


def expressao_status_efetivo(tabela: str, agora_sql: str) -> str:
    """A regra de `status_efetivo` em SQL. `tabela` é o nome ou alias usado
    para qualificar as colunas; `agora_sql` é `:agora` (parâmetro) ou
    `now()`."""
    agora = f"CAST({agora_sql} AS timestamptz)"
    return (
        f"CASE WHEN {tabela}.status = 'pendente' "
        f"AND {tabela}.criado_em < {agora} - interval '{PRAZO_PENDENTE.days} days' "
        "THEN 'expirada' "
        f"WHEN {tabela}.status = 'validada' "
        f"AND coalesce({tabela}.ultima_confirmacao_em, {tabela}.criado_em) "
        f"< {agora} - interval '{PRAZO_VALIDADA.days} days' "
        "THEN 'expirada' "
        f"ELSE {tabela}.status END"
    )
```

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv/Scripts/python.exe -m pytest tests/test_moderacao.py -v`
Expected: 43 passed.

- [ ] **Step 5: Lint e commit (só com autorização do dono)**

Run: `.venv/Scripts/python.exe -m ruff check . ; .venv/Scripts/python.exe -m ruff format --check .`

```bash
git add backend/app/services/moderacao.py backend/tests/test_moderacao.py
git commit -m "feat(backend): regras puras de moderação de barreiras colaborativas"
```

---

### Task 3: Login (JWT do Supabase) e fixtures de teste

**Files:**
- Modify: `backend/pyproject.toml` (dependência `PyJWT[crypto]>=2.8`)
- Modify: `backend/app/config.py` (campo `supabase_url`)
- Create: `backend/app/auth.py`
- Modify: `backend/app/main.py` (cria `app.state.config_auth`)
- Modify: `backend/tests/conftest.py`
- Test: `backend/tests/test_auth.py`

**Interfaces:**
- Consumes: tabela `usuario` (Task 1); `app.db.get_db`.
- Produces (em `app.auth`):
  - `@dataclass(frozen=True) class UsuarioAtual(id: uuid.UUID, papel: str)` com propriedade `admin -> bool`.
  - `class FonteDeChaves(Protocol): def chave_para(self, token: str) -> Any`.
  - `class FonteJwks` (usa `jwt.PyJWKClient`).
  - `@dataclass(frozen=True) class ConfigAuth(emissor: str, fonte: FonteDeChaves)`.
  - `criar_config_auth(supabase_url: str | None) -> ConfigAuth | None`.
  - Dependências FastAPI: `obter_config_auth(request) -> ConfigAuth | None`, `usuario_atual(...) -> UsuarioAtual`, `exigir_admin(...) -> UsuarioAtual`.
  - Constantes `MSG_LOGIN = "Faça login para continuar."`, `MSG_LOGIN_INDISPONIVEL = "Login indisponível no momento."`, `MSG_SEM_PERMISSAO = "Você não tem permissão para esta ação."`.
- Produces (fixtures em `backend/tests/conftest.py`): `EMISSOR_TESTE` (constante), `chave_teste` (session), `config_auth_teste`, `emitir_token(sub, *, validade_s=3600, aud="authenticated", iss=EMISSOR_TESTE, chave=None) -> str`, `db_transacional` (sessão cujo `commit()` vira savepoint dentro de uma transação revertida no fim), `criar_usuario(papel="colaborador") -> UsuarioAtual`.

- [ ] **Step 1: Dependência**

Em `backend/pyproject.toml`, em `dependencies`, acrescente `"PyJWT[crypto]>=2.8",`. Run (em `backend/`): `.venv/Scripts/python.exe -m pip install -e ".[dev]"`.

- [ ] **Step 2: Fixtures compartilhadas**

Em `backend/tests/conftest.py`, acrescente aos imports do topo (mantendo a ordem do isort):

```python
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy.orm import Session
```

e, no fim do arquivo:

```python
# --- camada colaborativa (Plano 6) ---------------------------------------------

EMISSOR_TESTE = "https://projeto-teste.supabase.co/auth/v1"


class _FonteFixa:
    """Fonte de chaves que devolve sempre a mesma chave pública (sem rede)."""

    def __init__(self, chave_publica) -> None:
        self._chave = chave_publica

    def chave_para(self, token: str):
        return self._chave


@pytest.fixture(scope="session")
def chave_teste():
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture
def config_auth_teste(chave_teste):
    from app.auth import ConfigAuth

    return ConfigAuth(emissor=EMISSOR_TESTE, fonte=_FonteFixa(chave_teste.public_key()))


@pytest.fixture
def emitir_token(chave_teste):
    def _emitir(sub, *, validade_s=3600, aud="authenticated", iss=EMISSOR_TESTE, chave=None):
        agora = datetime.now(UTC)
        dados = {
            "sub": str(sub),
            "aud": aud,
            "iss": iss,
            "role": "authenticated",
            "iat": agora,
            "exp": agora + timedelta(seconds=validade_s),
        }
        return jwt.encode(dados, chave or chave_teste, algorithm="ES256")

    return _emitir


@pytest.fixture
def db_transacional():
    """Sessão dentro de uma transação revertida no fim; `commit()` do código
    testado vira apenas a liberação de um savepoint."""
    from app.db import engine

    conexao = engine.connect()
    transacao = conexao.begin()
    sessao = Session(bind=conexao, join_transaction_mode="create_savepoint")
    try:
        yield sessao
    finally:
        sessao.close()
        transacao.rollback()
        conexao.close()


@pytest.fixture
def criar_usuario(db_transacional):
    from app.auth import UsuarioAtual

    def _criar(papel: str = "colaborador") -> UsuarioAtual:
        usuario_id = uuid.uuid4()
        db_transacional.execute(
            text("INSERT INTO usuario (id, papel) VALUES (:id, :papel)"),
            {"id": usuario_id, "papel": papel},
        )
        return UsuarioAtual(id=usuario_id, papel=papel)

    return _criar
```

- [ ] **Step 3: Escrever os testes**

`backend/tests/test_auth.py`:

```python
"""Login com JWT do Supabase (spec 2026-11-02-colaborativo-design.md, 4)."""

import uuid

import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.auth import (
    MSG_LOGIN,
    MSG_LOGIN_INDISPONIVEL,
    MSG_SEM_PERMISSAO,
    UsuarioAtual,
    criar_config_auth,
    exigir_admin,
    obter_config_auth,
    usuario_atual,
)
from app.db import get_db

pytestmark = pytest.mark.integration


def _app(db, config):
    app = FastAPI()

    @app.get("/eu")
    def eu(usuario: UsuarioAtual = Depends(usuario_atual)):  # noqa: B008
        return {"id": str(usuario.id), "papel": usuario.papel}

    @app.get("/admin")
    def so_admin(usuario: UsuarioAtual = Depends(exigir_admin)):  # noqa: B008
        return {"ok": True}

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[obter_config_auth] = lambda: config
    return TestClient(app)


@pytest.fixture
def cliente(db_transacional, config_auth_teste):
    return _app(db_transacional, config_auth_teste)


def _cabecalho(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_token_valido_cria_usuario_colaborador(cliente, emitir_token, db_transacional):
    sub = uuid.uuid4()
    resposta = cliente.get("/eu", headers=_cabecalho(emitir_token(sub)))
    assert resposta.status_code == 200
    assert resposta.json() == {"id": str(sub), "papel": "colaborador"}
    papel = db_transacional.execute(
        text("SELECT papel FROM usuario WHERE id = :id"), {"id": sub}
    ).scalar_one()
    assert papel == "colaborador"
    assert cliente.get("/eu", headers=_cabecalho(emitir_token(sub))).status_code == 200


def test_sem_token_e_401(cliente):
    resposta = cliente.get("/eu")
    assert resposta.status_code == 401
    assert resposta.json()["detail"] == MSG_LOGIN
    assert resposta.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize(
    "ajuste",
    [
        {"validade_s": -10},
        {"aud": "anon"},
        {"iss": "https://outro.supabase.co/auth/v1"},
    ],
    ids=["vencido", "aud-errado", "emissor-errado"],
)
def test_token_invalido_e_401(cliente, emitir_token, ajuste):
    resposta = cliente.get("/eu", headers=_cabecalho(emitir_token(uuid.uuid4(), **ajuste)))
    assert resposta.status_code == 401
    assert resposta.json()["detail"] == MSG_LOGIN


def test_assinatura_de_outra_chave_e_401(cliente, emitir_token):
    outra = ec.generate_private_key(ec.SECP256R1())
    token = emitir_token(uuid.uuid4(), chave=outra)
    assert cliente.get("/eu", headers=_cabecalho(token)).status_code == 401


def test_sub_que_nao_e_uuid_e_401(cliente, emitir_token):
    assert cliente.get("/eu", headers=_cabecalho(emitir_token("abc"))).status_code == 401


def test_esquema_basic_e_401(cliente):
    assert cliente.get("/eu", headers={"Authorization": "Basic abc"}).status_code == 401


def test_colaborador_em_rota_de_admin_e_403(cliente, emitir_token):
    resposta = cliente.get("/admin", headers=_cabecalho(emitir_token(uuid.uuid4())))
    assert resposta.status_code == 403
    assert resposta.json()["detail"] == MSG_SEM_PERMISSAO


def test_admin_passa(cliente, emitir_token, criar_usuario):
    admin = criar_usuario("admin")
    assert cliente.get("/admin", headers=_cabecalho(emitir_token(admin.id))).status_code == 200


def test_sem_configuracao_de_login_e_503(db_transacional, emitir_token):
    resposta = _app(db_transacional, None).get(
        "/eu", headers=_cabecalho(emitir_token(uuid.uuid4()))
    )
    assert resposta.status_code == 503
    assert resposta.json()["detail"] == MSG_LOGIN_INDISPONIVEL


def test_criar_config_auth():
    assert criar_config_auth(None) is None
    assert criar_config_auth("") is None
    config = criar_config_auth("https://abc.supabase.co/")
    assert config.emissor == "https://abc.supabase.co/auth/v1"
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `.venv/Scripts/python.exe -m pytest tests/test_auth.py -v`
Expected: erro de coleta `ModuleNotFoundError: No module named 'app.auth'`.

- [ ] **Step 5: Config**

Em `backend/app/config.py`, na classe `Settings`, depois de `ors_timeout_s`:

```python
    # URL do projeto Supabase (pública); habilita o login. Sem ela, rotas com login dão 503.
    supabase_url: str | None = None
```

- [ ] **Step 6: Implementar `app/auth.py`**

```python
"""Login com o JWT do Supabase Auth (spec 2026-11-02-colaborativo-design.md, 4).

O token vem em `Authorization: Bearer`, assinado em ES256 com a chave do
projeto (JWKS público em `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`).
Nenhum segredo é necessário para verificar. O papel (`colaborador`/`admin`)
vive na tabela `usuario`, não no token.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated, Any, Protocol

import jwt
from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db

MSG_LOGIN = "Faça login para continuar."
MSG_LOGIN_INDISPONIVEL = "Login indisponível no momento."
MSG_SEM_PERMISSAO = "Você não tem permissão para esta ação."
AUDIENCIA = "authenticated"

_SQL_UPSERT_USUARIO = text(
    "INSERT INTO usuario (id) VALUES (:id) "
    "ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id RETURNING papel"
)


@dataclass(frozen=True)
class UsuarioAtual:
    id: uuid.UUID
    papel: str

    @property
    def admin(self) -> bool:
        return self.papel == "admin"


class FonteDeChaves(Protocol):
    def chave_para(self, token: str) -> Any: ...


class FonteJwks:
    """Chaves públicas do JWKS do Supabase, em cache; recarrega ao ver `kid` novo."""

    def __init__(self, url_jwks: str) -> None:
        self._cliente = jwt.PyJWKClient(url_jwks, cache_keys=True, lifespan=3600)

    def chave_para(self, token: str) -> Any:
        return self._cliente.get_signing_key_from_jwt(token).key


@dataclass(frozen=True)
class ConfigAuth:
    emissor: str
    fonte: FonteDeChaves


def criar_config_auth(supabase_url: str | None) -> ConfigAuth | None:
    if not supabase_url:
        return None
    base = supabase_url.rstrip("/")
    return ConfigAuth(
        emissor=f"{base}/auth/v1",
        fonte=FonteJwks(f"{base}/auth/v1/.well-known/jwks.json"),
    )


def obter_config_auth(request: Request) -> ConfigAuth | None:
    """A única `ConfigAuth` do processo, criada em `main.create_app`."""
    return request.app.state.config_auth


def _nao_autenticado() -> HTTPException:
    return HTTPException(status_code=401, detail=MSG_LOGIN, headers={"WWW-Authenticate": "Bearer"})


def usuario_atual(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),  # noqa: B008
    config: ConfigAuth | None = Depends(obter_config_auth),  # noqa: B008
) -> UsuarioAtual:
    if config is None:
        raise HTTPException(status_code=503, detail=MSG_LOGIN_INDISPONIVEL)
    if not authorization or not authorization.startswith("Bearer "):
        raise _nao_autenticado()
    token = authorization.removeprefix("Bearer ").strip()
    try:
        chave = config.fonte.chave_para(token)
        dados = jwt.decode(
            token,
            chave,
            algorithms=["ES256"],
            audience=AUDIENCIA,
            issuer=config.emissor,
            options={"require": ["exp", "sub", "aud", "iss"]},
        )
        usuario_id = uuid.UUID(dados["sub"])
    except jwt.PyJWKClientConnectionError as erro:
        raise HTTPException(status_code=503, detail=MSG_LOGIN_INDISPONIVEL) from erro
    except (jwt.PyJWTError, ValueError) as erro:
        raise _nao_autenticado() from erro
    papel = db.execute(_SQL_UPSERT_USUARIO, {"id": usuario_id}).scalar_one()
    db.commit()
    return UsuarioAtual(id=usuario_id, papel=papel)


def exigir_admin(usuario: UsuarioAtual = Depends(usuario_atual)) -> UsuarioAtual:  # noqa: B008
    if not usuario.admin:
        raise HTTPException(status_code=403, detail=MSG_SEM_PERMISSAO)
    return usuario
```

- [ ] **Step 7: Estado no app**

Em `backend/app/main.py`, importe `from app.auth import criar_config_auth` e, em `create_app`, logo depois de `app.state.cliente_ors = ...`:

```python
    # única ConfigAuth do processo (JWKS em cache); None sem SUPABASE_URL
    app.state.config_auth = criar_config_auth(settings.supabase_url)
```

- [ ] **Step 8: Rodar e ver passar**

Run: `.venv/Scripts/python.exe -m pytest tests/test_auth.py -v`
Expected: 12 passed.

Run: `.venv/Scripts/python.exe -m pytest -q ; .venv/Scripts/python.exe -m ruff check . ; .venv/Scripts/python.exe -m ruff format --check .`
Expected: tudo verde.

- [ ] **Step 9: Commit (só com autorização do dono)**

```bash
git add backend/pyproject.toml backend/app/config.py backend/app/auth.py backend/app/main.py backend/tests/conftest.py backend/tests/test_auth.py
git commit -m "feat(backend): login por JWT do Supabase (ES256/JWKS) com papel em usuario"
```

---

### Task 4: Cadastro e leitura de barreiras

**Files:**
- Create: `backend/app/services/erros.py`
- Create: `backend/app/schemas/barreira.py`
- Create: `backend/app/services/barreiras.py`
- Test: `backend/tests/test_barreiras_cadastro.py`

**Interfaces:**
- Consumes: `UsuarioAtual` (Task 3); `moderacao.expressao_status_efetivo`, `severidade_da_categoria`, `status_inicial`, `CATEGORIAS` (Task 2); fixtures `db_transacional`, `criar_usuario` (Task 3).
- Produces:
  - `app.services.erros`: `class ErroDominio(Exception)` com atributo de classe `status_http: int` e mensagem padrão `mensagem: str` (instanciar sem argumento usa a padrão); subclasses `NaoEncontrada` (404, "Barreira não encontrada."), `ForaDaArea` (422, "Este ponto está fora da área atendida pelo Rota Falada SP."), `LimiteDiario` (429, "Limite de 20 barreiras por dia atingido. Tente de novo amanhã."), `AutorNaoVota` (403, "Quem cadastrou a barreira não pode votar nela."), `BarreiraEncerrada` (409, "Esta barreira não recebe mais votos."), `SemPermissao` (403, "Você não tem permissão para esta ação."), `FotoGrande` (413, "A foto pode ter no máximo 5 MB."), `FotoFormato` (415, "Envie uma foto JPEG, PNG ou WebP de até 40 megapixels."), `DescricaoFotoInvalida` (422, "Descreva a foto com 5 a 300 caracteres."), `StorageIndisponivel` (503, "Envio de foto indisponível no momento.").
  - `app.schemas.barreira`: `Categoria` (Literal das 10), `BarreiraIn`, `Votos`, `BarreiraOut`, `VotoIn`, `StatusAdminIn`, `EventoOut`.
  - `app.services.barreiras`: `LIMITE_DIARIO = 20`, `BUCKET_FOTOS = "fotos-barreiras"`, `url_publica_foto(caminho: str | None) -> str | None`, `registrar_evento(db, *, tipo, agora, barreira_id=None, usuario_id=None, de_status=None, para_status=None, detalhe=None) -> None`, `obter(db, barreira_id, agora, *, incluir_removida=False) -> BarreiraOut`, `listar_proximas(db, lat, lon, raio_m, agora) -> list[BarreiraOut]`, `criar(db, usuario, entrada, agora) -> tuple[BarreiraOut, bool]` (bool = criada agora), `listar_eventos(db, barreira_id) -> list[EventoOut]`.

- [ ] **Step 1: Escrever os testes**

`backend/tests/test_barreiras_cadastro.py`:

```python
"""Cadastro e leitura de barreiras colaborativas (spec 2026-11-02, 5.1, 5.2 e 6.3)."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.config import settings
from app.schemas.barreira import BarreiraIn, BarreiraOut
from app.services import barreiras
from app.services.erros import ForaDaArea, LimiteDiario, NaoEncontrada

pytestmark = pytest.mark.integration

AGORA = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)
LON, LAT = -46.6350, -23.5900  # Vila Mariana, dentro da área piloto


def _entrada(categoria="escada", lon=LON, lat=LAT, descricao=None, chave=None) -> BarreiraIn:
    return BarreiraIn(
        categoria=categoria,
        lat=lat,
        lon=lon,
        descricao=descricao,
        chave_idempotencia=chave or uuid.uuid4(),
    )


def test_criar_barreira_intransponivel_nasce_pendente_com_evento(db_transacional, criar_usuario):
    autor = criar_usuario()
    barreira, criada = barreiras.criar(db_transacional, autor, _entrada(), AGORA)
    assert criada is True
    assert barreira.status == "pendente"
    assert barreira.severidade == "intransponivel"
    assert barreira.votos.model_dump() == {"confirma": 0, "contesta": 0, "resolvida": 0}
    assert barreira.lat == pytest.approx(LAT) and barreira.lon == pytest.approx(LON)
    eventos = barreiras.listar_eventos(db_transacional, barreira.id)
    assert [(e.tipo, e.para_status, e.usuario_id) for e in eventos] == [
        ("criada", "pendente", autor.id)
    ]


def test_informativo_nasce_validada(db_transacional, criar_usuario):
    barreira, _ = barreiras.criar(db_transacional, criar_usuario(), _entrada("outro"), AGORA)
    assert barreira.status == "validada"


def test_mesma_chave_do_mesmo_autor_devolve_a_existente(db_transacional, criar_usuario):
    autor = criar_usuario()
    chave = uuid.uuid4()
    primeira, criada1 = barreiras.criar(db_transacional, autor, _entrada(chave=chave), AGORA)
    segunda, criada2 = barreiras.criar(db_transacional, autor, _entrada(chave=chave), AGORA)
    assert (criada1, criada2) == (True, False)
    assert segunda.id == primeira.id
    total = db_transacional.execute(
        text("SELECT count(*) FROM barreira_colaborativa WHERE autor_id = :a"), {"a": autor.id}
    ).scalar_one()
    assert total == 1


def test_fora_da_area_piloto(db_transacional, criar_usuario):
    with pytest.raises(ForaDaArea):
        barreiras.criar(db_transacional, criar_usuario(), _entrada(lon=-46.5, lat=-23.5), AGORA)


def test_limite_de_20_por_dia(db_transacional, criar_usuario):
    autor = criar_usuario()
    for _ in range(barreiras.LIMITE_DIARIO):
        barreiras.criar(db_transacional, autor, _entrada(), AGORA)
    with pytest.raises(LimiteDiario):
        barreiras.criar(db_transacional, autor, _entrada(), AGORA)


def test_limite_conta_so_as_ultimas_24_horas(db_transacional, criar_usuario):
    autor = criar_usuario()
    ontem = AGORA - timedelta(hours=25)
    for _ in range(barreiras.LIMITE_DIARIO):
        barreiras.criar(db_transacional, autor, _entrada(), ontem)
    barreira, criada = barreiras.criar(db_transacional, autor, _entrada(), AGORA)
    assert criada is True


def test_descricao_em_branco_vira_nula(db_transacional, criar_usuario):
    barreira, _ = barreiras.criar(
        db_transacional, criar_usuario(), _entrada(descricao="   "), AGORA
    )
    assert barreira.descricao is None


def test_obter_inexistente(db_transacional):
    with pytest.raises(NaoEncontrada):
        barreiras.obter(db_transacional, 987_654_321, AGORA)


def test_removida_some_da_leitura_publica(db_transacional, criar_usuario):
    barreira, _ = barreiras.criar(db_transacional, criar_usuario(), _entrada(), AGORA)
    db_transacional.execute(
        text("UPDATE barreira_colaborativa SET status = 'removida' WHERE id = :id"),
        {"id": barreira.id},
    )
    with pytest.raises(NaoEncontrada):
        barreiras.obter(db_transacional, barreira.id, AGORA)
    assert barreiras.obter(db_transacional, barreira.id, AGORA, incluir_removida=True).status == (
        "removida"
    )
    proximas = barreiras.listar_proximas(db_transacional, LAT, LON, 200, AGORA)
    assert barreira.id not in [b.id for b in proximas]


def test_listar_proximas_ordena_por_distancia_e_respeita_raio(db_transacional, criar_usuario):
    autor = criar_usuario()
    perto, _ = barreiras.criar(db_transacional, autor, _entrada(lat=LAT), AGORA)
    a_100m, _ = barreiras.criar(db_transacional, autor, _entrada(lat=LAT + 0.0009), AGORA)
    a_600m, _ = barreiras.criar(db_transacional, autor, _entrada(lat=LAT + 0.0054), AGORA)
    ids = [b.id for b in barreiras.listar_proximas(db_transacional, LAT, LON, 200, AGORA)]
    nossos = [i for i in ids if i in {perto.id, a_100m.id, a_600m.id}]
    assert nossos == [perto.id, a_100m.id]


@pytest.mark.parametrize(
    ("status", "dias_criacao", "esperado"),
    [
        ("pendente", 30, "pendente"),
        ("pendente", 31, "expirada"),
        ("validada", 180, "validada"),
        ("validada", 181, "expirada"),
    ],
)
def test_expiracao_no_sql_igual_a_regra_python(
    db_transacional, criar_usuario, status, dias_criacao, esperado
):
    barreira, _ = barreiras.criar(
        db_transacional, criar_usuario(), _entrada(), AGORA - timedelta(days=dias_criacao)
    )
    db_transacional.execute(
        text("UPDATE barreira_colaborativa SET status = :s WHERE id = :id"),
        {"s": status, "id": barreira.id},
    )
    assert barreiras.obter(db_transacional, barreira.id, AGORA).status == esperado


def test_resposta_publica_nao_expoe_autor(db_transacional, criar_usuario):
    autor = criar_usuario()
    barreira, _ = barreiras.criar(db_transacional, autor, _entrada(), AGORA)
    assert "autor" not in " ".join(BarreiraOut.model_fields)
    assert str(autor.id) not in barreira.model_dump_json()


def test_url_publica_foto(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "https://abc.supabase.co/")
    assert barreiras.url_publica_foto(None) is None
    assert barreiras.url_publica_foto("7/x.webp") == (
        "https://abc.supabase.co/storage/v1/object/public/fotos-barreiras/7/x.webp"
    )
    monkeypatch.setattr(settings, "supabase_url", None)
    assert barreiras.url_publica_foto("7/x.webp") is None
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv/Scripts/python.exe -m pytest tests/test_barreiras_cadastro.py -v`
Expected: erro de coleta (`No module named 'app.schemas.barreira'`).

- [ ] **Step 3: Erros de domínio**

`backend/app/services/erros.py`:

```python
"""Erros de domínio da camada colaborativa, cada um com seu status HTTP. Os
routers traduzem qualquer `ErroDominio` em `HTTPException(status_http, str(erro))`."""

from __future__ import annotations


class ErroDominio(Exception):
    status_http: int = 400
    mensagem: str = "Requisição inválida."

    def __init__(self, mensagem: str | None = None) -> None:
        super().__init__(mensagem or self.mensagem)


class NaoEncontrada(ErroDominio):
    status_http = 404
    mensagem = "Barreira não encontrada."


class ForaDaArea(ErroDominio):
    status_http = 422
    mensagem = "Este ponto está fora da área atendida pelo Rota Falada SP."


class LimiteDiario(ErroDominio):
    status_http = 429
    mensagem = "Limite de 20 barreiras por dia atingido. Tente de novo amanhã."


class AutorNaoVota(ErroDominio):
    status_http = 403
    mensagem = "Quem cadastrou a barreira não pode votar nela."


class BarreiraEncerrada(ErroDominio):
    status_http = 409
    mensagem = "Esta barreira não recebe mais votos."


class SemPermissao(ErroDominio):
    status_http = 403
    mensagem = "Você não tem permissão para esta ação."


class FotoGrande(ErroDominio):
    status_http = 413
    mensagem = "A foto pode ter no máximo 5 MB."


class FotoFormato(ErroDominio):
    status_http = 415
    mensagem = "Envie uma foto JPEG, PNG ou WebP de até 40 megapixels."


class DescricaoFotoInvalida(ErroDominio):
    status_http = 422
    mensagem = "Descreva a foto com 5 a 300 caracteres."


class StorageIndisponivel(ErroDominio):
    status_http = 503
    mensagem = "Envio de foto indisponível no momento."
```

- [ ] **Step 4: Schemas**

`backend/app/schemas/barreira.py`:

```python
"""Contratos da camada colaborativa (spec 2026-11-02-colaborativo-design.md, 5)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

Categoria = Literal[
    "escada",
    "sem_rampa",
    "elevador_quebrado",
    "obstaculo_bloqueando",
    "calcada_estreita",
    "rampa_ingreme",
    "buraco",
    "piso_irregular",
    "sem_piso_tatil",
    "outro",
]
StatusBarreira = Literal["pendente", "validada", "contestada", "resolvida", "expirada", "removida"]


class BarreiraIn(BaseModel):
    categoria: Categoria
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    descricao: str | None = Field(default=None, max_length=500)
    # gerado pelo app; reenviar a mesma chave não duplica (fila offline)
    chave_idempotencia: uuid.UUID

    @field_validator("descricao")
    @classmethod
    def _em_branco_vira_nula(cls, valor: str | None) -> str | None:
        if valor is None:
            return None
        valor = valor.strip()
        return valor or None


class Votos(BaseModel):
    confirma: int
    contesta: int
    resolvida: int


class BarreiraOut(BaseModel):
    """Ficha pública: nunca inclui quem reportou nem quem votou (LGPD)."""

    id: int
    categoria: str
    severidade: Literal["intransponivel", "dificulta", "informativo"]
    status: StatusBarreira
    votos: Votos
    descricao: str | None
    lat: float
    lon: float
    criada_em: datetime
    ultima_confirmacao_em: datetime | None
    foto_url: str | None
    foto_descricao: str | None


class VotoIn(BaseModel):
    voto: Literal["confirma", "contesta", "resolvida"]


class StatusAdminIn(BaseModel):
    status: StatusBarreira
    motivo: str = Field(min_length=3, max_length=300)


class EventoOut(BaseModel):
    id: int
    barreira_id: int | None
    usuario_id: uuid.UUID | None
    tipo: str
    de_status: str | None
    para_status: str | None
    detalhe: dict[str, Any]
    criado_em: datetime
```

- [ ] **Step 5: Serviço de cadastro e leitura**

`backend/app/services/barreiras.py`:

```python
"""Cadastro e leitura de barreiras colaborativas (spec
docs/superpowers/specs/2026-11-02-colaborativo-design.md, 5 e 6.3).

Leituras aplicam a expiração na hora (`expressao_status_efetivo`) e nunca
devolvem autor nem votantes. `registrar_evento` é a única porta de escrita
em `barreira_evento` (só inserção).
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Row
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import UsuarioAtual
from app.config import settings
from app.schemas.barreira import BarreiraIn, BarreiraOut, EventoOut, Votos
from app.services.erros import ForaDaArea, LimiteDiario, NaoEncontrada
from app.services.moderacao import (
    expressao_status_efetivo,
    severidade_da_categoria,
    status_inicial,
)

LIMITE_DIARIO = 20
BUCKET_FOTOS = "fotos-barreiras"

_SELECT_FICHA = f"""
    SELECT b.id, b.categoria, b.severidade,
           {expressao_status_efetivo("b", ":agora")} AS status,
           b.descricao, ST_Y(b.geom) AS lat, ST_X(b.geom) AS lon,
           b.criado_em, b.ultima_confirmacao_em, b.foto_caminho, b.foto_descricao,
           count(c.id) FILTER (WHERE c.voto = 'confirma') AS confirma,
           count(c.id) FILTER (WHERE c.voto = 'contesta') AS contesta,
           count(c.id) FILTER (WHERE c.voto = 'resolvida') AS resolvida
    FROM barreira_colaborativa b
    LEFT JOIN confirmacao c ON c.barreira_id = b.id
"""

_SQL_OBTER = text(
    _SELECT_FICHA
    + " WHERE b.id = :id AND (:incluir_removida OR b.status <> 'removida') GROUP BY b.id"
)

_SQL_LISTAR = text(
    _SELECT_FICHA
    + """
    WHERE b.status <> 'removida'
      AND ST_DWithin(b.geom::geography,
                     ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, :raio)
    GROUP BY b.id
    ORDER BY ST_Distance(b.geom::geography,
                         ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography), b.id
    """
)

_SQL_POR_CHAVE = text(
    "SELECT id FROM barreira_colaborativa WHERE autor_id = :autor AND chave_idempotencia = :chave"
)

_SQL_DENTRO_DA_AREA = text(
    "SELECT EXISTS (SELECT 1 FROM area_piloto "
    "WHERE ST_Covers(geom, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)))"
)

_SQL_CRIADAS_24H = text(
    "SELECT count(*) FROM barreira_colaborativa "
    "WHERE autor_id = :autor AND criado_em > CAST(:agora AS timestamptz) - interval '24 hours' "
    "AND criado_em <= CAST(:agora AS timestamptz)"
)

_SQL_INSERIR = text(
    """
    INSERT INTO barreira_colaborativa
      (categoria, severidade, descricao, status, confirmacoes, geom, fonte_id,
       data_referencia, criado_em, atualizado_em, autor_id, chave_idempotencia)
    VALUES
      (:categoria, :severidade, :descricao, :status, 0,
       ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
       (SELECT id FROM fonte_dados WHERE chave = 'colaborativo'),
       :data_referencia, :agora, :agora, :autor, :chave)
    RETURNING id
    """
)

_SQL_EVENTO = text(
    """
    INSERT INTO barreira_evento
      (barreira_id, usuario_id, tipo, de_status, para_status, detalhe, criado_em)
    VALUES
      (:barreira_id, :usuario_id, :tipo, :de_status, :para_status, CAST(:detalhe AS jsonb), :agora)
    """
)

_SQL_EVENTOS = text(
    "SELECT id, barreira_id, usuario_id, tipo, de_status, para_status, detalhe, criado_em "
    "FROM barreira_evento WHERE barreira_id = :id ORDER BY id"
)


def url_publica_foto(caminho: str | None) -> str | None:
    if caminho is None or not settings.supabase_url:
        return None
    base = settings.supabase_url.rstrip("/")
    return f"{base}/storage/v1/object/public/{BUCKET_FOTOS}/{caminho}"


def _ficha(linha: Row) -> BarreiraOut:
    return BarreiraOut(
        id=linha.id,
        categoria=linha.categoria,
        severidade=linha.severidade,
        status=linha.status,
        votos=Votos(confirma=linha.confirma, contesta=linha.contesta, resolvida=linha.resolvida),
        descricao=linha.descricao,
        lat=linha.lat,
        lon=linha.lon,
        criada_em=linha.criado_em,
        ultima_confirmacao_em=linha.ultima_confirmacao_em,
        foto_url=url_publica_foto(linha.foto_caminho),
        foto_descricao=linha.foto_descricao,
    )


def registrar_evento(
    db: Session,
    *,
    tipo: str,
    agora: datetime,
    barreira_id: int | None = None,
    usuario_id=None,
    de_status: str | None = None,
    para_status: str | None = None,
    detalhe: dict[str, Any] | None = None,
) -> None:
    db.execute(
        _SQL_EVENTO,
        {
            "barreira_id": barreira_id,
            "usuario_id": usuario_id,
            "tipo": tipo,
            "de_status": de_status,
            "para_status": para_status,
            "detalhe": json.dumps(detalhe or {}, ensure_ascii=False),
            "agora": agora,
        },
    )


def obter(
    db: Session, barreira_id: int, agora: datetime, *, incluir_removida: bool = False
) -> BarreiraOut:
    linha = db.execute(
        _SQL_OBTER, {"id": barreira_id, "agora": agora, "incluir_removida": incluir_removida}
    ).first()
    if linha is None:
        raise NaoEncontrada()
    return _ficha(linha)


def listar_proximas(
    db: Session, lat: float, lon: float, raio_m: float, agora: datetime
) -> list[BarreiraOut]:
    linhas = db.execute(
        _SQL_LISTAR, {"lat": lat, "lon": lon, "raio": raio_m, "agora": agora}
    ).all()
    return [_ficha(linha) for linha in linhas]


def criar(
    db: Session, usuario: UsuarioAtual, entrada: BarreiraIn, agora: datetime
) -> tuple[BarreiraOut, bool]:
    """Cria a barreira, ou devolve a já criada com a mesma chave pelo mesmo
    autor (idempotência). O bool diz se foi criada agora."""
    chave = {"autor": usuario.id, "chave": entrada.chave_idempotencia}
    existente = db.execute(_SQL_POR_CHAVE, chave).scalar_one_or_none()
    if existente is not None:
        return obter(db, existente, agora), False
    if not db.execute(_SQL_DENTRO_DA_AREA, {"lon": entrada.lon, "lat": entrada.lat}).scalar_one():
        raise ForaDaArea()
    if (
        db.execute(_SQL_CRIADAS_24H, {"autor": usuario.id, "agora": agora}).scalar_one()
        >= LIMITE_DIARIO
    ):
        raise LimiteDiario()

    severidade = severidade_da_categoria(entrada.categoria)
    status = status_inicial(severidade)
    try:
        with db.begin_nested():
            barreira_id = db.execute(
                _SQL_INSERIR,
                {
                    **chave,
                    "categoria": entrada.categoria,
                    "severidade": severidade,
                    "descricao": entrada.descricao,
                    "status": status,
                    "lon": entrada.lon,
                    "lat": entrada.lat,
                    "data_referencia": agora.date(),
                    "agora": agora,
                },
            ).scalar_one()
    except IntegrityError:
        # outra requisição com a mesma chave venceu a corrida
        return obter(db, db.execute(_SQL_POR_CHAVE, chave).scalar_one(), agora), False

    registrar_evento(
        db,
        tipo="criada",
        agora=agora,
        barreira_id=barreira_id,
        usuario_id=usuario.id,
        para_status=status,
        detalhe={"categoria": entrada.categoria},
    )
    return obter(db, barreira_id, agora), True


def listar_eventos(db: Session, barreira_id: int) -> list[EventoOut]:
    existe = db.execute(
        text("SELECT 1 FROM barreira_colaborativa WHERE id = :id"), {"id": barreira_id}
    ).first()
    if existe is None:
        raise NaoEncontrada()
    return [
        EventoOut.model_validate(dict(linha._mapping))
        for linha in db.execute(_SQL_EVENTOS, {"id": barreira_id})
    ]
```

- [ ] **Step 6: Rodar e ver passar**

Run: `.venv/Scripts/python.exe -m pytest tests/test_barreiras_cadastro.py -v`
Expected: 16 passed.

Run: `.venv/Scripts/python.exe -m ruff check . ; .venv/Scripts/python.exe -m ruff format --check .`

- [ ] **Step 7: Commit (só com autorização do dono)**

```bash
git add backend/app/services/erros.py backend/app/schemas/barreira.py backend/app/services/barreiras.py backend/tests/test_barreiras_cadastro.py
git commit -m "feat(backend): cadastro idempotente e leitura pública de barreiras colaborativas"
```

---

### Task 5: Votação, decisão do admin, expiração e roteamento

**Files:**
- Create: `backend/app/services/votacao.py`
- Modify: `backend/app/services/barreira_geom.py` (ignora colaborativas expiradas)
- Test: `backend/tests/test_votacao.py`

**Interfaces:**
- Consumes: `moderacao` (Task 2); `barreiras.obter`, `barreiras.registrar_evento` (Task 4); erros (Task 4); `cache_rota.invalidar_regiao(db, ponto_4326: Point)`; `barreira_geom.corredor`, `barreira_geom.barreiras_no_corredor`.
- Produces (em `app.services.votacao`):
  - `votar(db, usuario: UsuarioAtual, barreira_id: int, voto: str, agora: datetime) -> BarreiraOut`
  - `mudar_status_admin(db, admin: UsuarioAtual, barreira_id: int, status: str, motivo: str, agora: datetime) -> BarreiraOut`
  - `expirar_vencidas(db, agora: datetime) -> list[int]` (ids que passaram a `expirada`)

- [ ] **Step 1: Escrever os testes**

`backend/tests/test_votacao.py`:

```python
"""Votação, decisão do admin e expiração (spec 2026-11-02-colaborativo-design.md, 6)."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from shapely.geometry import LineString
from sqlalchemy import text

from app.schemas.barreira import BarreiraIn
from app.services import barreiras, votacao
from app.services.barreira_geom import barreiras_no_corredor, corredor
from app.services.erros import AutorNaoVota, BarreiraEncerrada, NaoEncontrada

pytestmark = pytest.mark.integration

AGORA = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)
LON, LAT = -46.6350, -23.5900


def _criar(db, autor, categoria="escada", agora=AGORA):
    entrada = BarreiraIn(
        categoria=categoria, lat=LAT, lon=LON, chave_idempotencia=uuid.uuid4()
    )
    return barreiras.criar(db, autor, entrada, agora)[0]


def _tipos_de_evento(db, barreira_id):
    return [(e.tipo, e.de_status, e.para_status) for e in barreiras.listar_eventos(db, barreira_id)]


def _rota_em_cache_sobre_o_ponto(db) -> str:
    chave = f"teste-{uuid.uuid4()}"
    db.execute(
        text(
            "INSERT INTO rota_cache (chave, resposta, regiao, motor, criado_em, expira_em) "
            "VALUES (:chave, '{}'::jsonb, ST_MakeEnvelope(:o, :s, :l, :n, 4326), 'teste', "
            ":agora, :expira)"
        ),
        {
            "chave": chave,
            "o": LON - 0.001,
            "s": LAT - 0.001,
            "l": LON + 0.001,
            "n": LAT + 0.001,
            "agora": AGORA,
            "expira": AGORA + timedelta(hours=6),
        },
    )
    return chave


def _cache_existe(db, chave) -> bool:
    return db.execute(
        text("SELECT EXISTS (SELECT 1 FROM rota_cache WHERE chave = :c)"), {"c": chave}
    ).scalar_one()


def test_autor_nao_vota(db_transacional, criar_usuario):
    autor = criar_usuario()
    barreira = _criar(db_transacional, autor)
    with pytest.raises(AutorNaoVota):
        votacao.votar(db_transacional, autor, barreira.id, "confirma", AGORA)


def test_barreira_inexistente(db_transacional, criar_usuario):
    with pytest.raises(NaoEncontrada):
        votacao.votar(db_transacional, criar_usuario(), 987_654_321, "confirma", AGORA)


def test_intransponivel_valida_com_duas_confirmacoes_e_registra_eventos(
    db_transacional, criar_usuario
):
    barreira = _criar(db_transacional, criar_usuario())
    um, dois = criar_usuario(), criar_usuario()
    assert votacao.votar(db_transacional, um, barreira.id, "confirma", AGORA).status == "pendente"
    depois = votacao.votar(db_transacional, dois, barreira.id, "confirma", AGORA)
    assert depois.status == "validada"
    assert depois.votos.confirma == 2
    assert depois.ultima_confirmacao_em == AGORA
    assert _tipos_de_evento(db_transacional, barreira.id) == [
        ("criada", None, "pendente"),
        ("voto", None, None),
        ("voto", None, None),
        ("status", "pendente", "validada"),
    ]


def test_dificulta_valida_com_uma_confirmacao(db_transacional, criar_usuario):
    barreira = _criar(db_transacional, criar_usuario(), "buraco")
    resultado = votacao.votar(db_transacional, criar_usuario(), barreira.id, "confirma", AGORA)
    assert resultado.status == "validada"


def test_troca_de_voto_mantem_um_voto_por_pessoa(db_transacional, criar_usuario):
    barreira = _criar(db_transacional, criar_usuario(), "buraco")
    eleitor = criar_usuario()
    votacao.votar(db_transacional, eleitor, barreira.id, "confirma", AGORA)
    resultado = votacao.votar(db_transacional, eleitor, barreira.id, "contesta", AGORA)
    assert resultado.votos.model_dump() == {"confirma": 0, "contesta": 1, "resolvida": 0}
    assert resultado.status == "pendente"


def test_duas_contestacoes_encerram_e_bloqueiam_novos_votos(db_transacional, criar_usuario):
    barreira = _criar(db_transacional, criar_usuario(), "buraco")
    for _ in range(2):
        resultado = votacao.votar(
            db_transacional, criar_usuario(), barreira.id, "contesta", AGORA
        )
    assert resultado.status == "contestada"
    with pytest.raises(BarreiraEncerrada):
        votacao.votar(db_transacional, criar_usuario(), barreira.id, "confirma", AGORA)


def test_dois_votos_resolvida(db_transacional, criar_usuario):
    barreira = _criar(db_transacional, criar_usuario(), "buraco")
    for _ in range(2):
        resultado = votacao.votar(
            db_transacional, criar_usuario(), barreira.id, "resolvida", AGORA
        )
    assert resultado.status == "resolvida"


def test_pendente_vencida_nao_recebe_voto(db_transacional, criar_usuario):
    barreira = _criar(db_transacional, criar_usuario(), agora=AGORA - timedelta(days=31))
    with pytest.raises(BarreiraEncerrada):
        votacao.votar(db_transacional, criar_usuario(), barreira.id, "confirma", AGORA)


def test_cache_so_e_invalidado_quando_passa_a_afetar_a_rota(db_transacional, criar_usuario):
    barreira = _criar(db_transacional, criar_usuario())
    chave = _rota_em_cache_sobre_o_ponto(db_transacional)
    votacao.votar(db_transacional, criar_usuario(), barreira.id, "confirma", AGORA)
    assert _cache_existe(db_transacional, chave)  # ainda pendente: rota não muda
    votacao.votar(db_transacional, criar_usuario(), barreira.id, "confirma", AGORA)
    assert not _cache_existe(db_transacional, chave)  # validada: rota precisa mudar


def test_admin_remove_e_restaura_com_auditoria(db_transacional, criar_usuario):
    barreira = _criar(db_transacional, criar_usuario())
    admin = criar_usuario("admin")
    removida = votacao.mudar_status_admin(
        db_transacional, admin, barreira.id, "removida", "denúncia de barreira falsa", AGORA
    )
    assert removida.status == "removida"
    with pytest.raises(NaoEncontrada):
        barreiras.obter(db_transacional, barreira.id, AGORA)
    restaurada = votacao.mudar_status_admin(
        db_transacional, admin, barreira.id, "validada", "conferido no local", AGORA
    )
    assert restaurada.status == "validada"
    assert restaurada.ultima_confirmacao_em == AGORA
    eventos = barreiras.listar_eventos(db_transacional, barreira.id)
    admin_eventos = [e for e in eventos if e.tipo == "admin"]
    assert [(e.de_status, e.para_status, e.usuario_id) for e in admin_eventos] == [
        ("pendente", "removida", admin.id),
        ("removida", "validada", admin.id),
    ]
    assert admin_eventos[0].detalhe == {"motivo": "denúncia de barreira falsa"}


def test_expirar_vencidas_grava_status_e_evento(db_transacional, criar_usuario):
    autor = criar_usuario()
    velha_pendente = _criar(db_transacional, autor, agora=AGORA - timedelta(days=31))
    velha_validada = _criar(db_transacional, autor, "outro", agora=AGORA - timedelta(days=181))
    nova = _criar(db_transacional, autor)
    expiradas = votacao.expirar_vencidas(db_transacional, AGORA)
    assert {velha_pendente.id, velha_validada.id} <= set(expiradas)
    assert nova.id not in expiradas
    status = db_transacional.execute(
        text("SELECT status FROM barreira_colaborativa WHERE id = :id"),
        {"id": velha_pendente.id},
    ).scalar_one()
    assert status == "expirada"
    ultimo = barreiras.listar_eventos(db_transacional, velha_pendente.id)[-1]
    assert (ultimo.tipo, ultimo.para_status, ultimo.usuario_id) == ("status", "expirada", None)


def test_roteamento_usa_validada_e_ignora_expirada(db_transacional, criar_usuario):
    agora_real = datetime.now(UTC)  # barreira_geom usa now(); evita bomba-relógio
    barreira = _criar(db_transacional, criar_usuario(), agora=agora_real)
    for _ in range(2):
        votacao.votar(db_transacional, criar_usuario(), barreira.id, "confirma", agora_real)
    faixa = corredor(LineString([(LON - 0.001, LAT), (LON + 0.001, LAT)]))

    def _nossas():
        return [
            b
            for b in barreiras_no_corredor(db_transacional, faixa)
            if b.origem == "colaborativa" and b.id == barreira.id
        ]

    assert [b.severidade for b in _nossas()] == ["intransponivel"]
    db_transacional.execute(
        text(
            "UPDATE barreira_colaborativa SET ultima_confirmacao_em = now() - interval '181 days', "
            "criado_em = now() - interval '200 days' WHERE id = :id"
        ),
        {"id": barreira.id},
    )
    assert _nossas() == []
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv/Scripts/python.exe -m pytest tests/test_votacao.py -v`
Expected: erro de coleta (`cannot import name 'votacao'`).

- [ ] **Step 3: Implementar `services/votacao.py`**

```python
"""Votação, decisão do admin e expiração (spec
docs/superpowers/specs/2026-11-02-colaborativo-design.md, 6).

Cada operação trava a linha da barreira (`FOR UPDATE`), decide o status com
`moderacao.decidir_status`, grava eventos e, quando a barreira passa a
afetar rotas ou deixa de afetar, apaga as rotas em cache da região.
"""

from __future__ import annotations

from datetime import datetime

from shapely.geometry import Point
from sqlalchemy import text
from sqlalchemy.engine import Row
from sqlalchemy.orm import Session

from app.auth import UsuarioAtual
from app.schemas.barreira import BarreiraOut
from app.services.barreiras import obter, registrar_evento
from app.services.cache_rota import invalidar_regiao
from app.services.erros import AutorNaoVota, BarreiraEncerrada, NaoEncontrada
from app.services.moderacao import (
    STATUS_ENCERRADOS,
    Contagem,
    afeta_rota,
    decidir_status,
    expressao_status_efetivo,
    status_efetivo,
)

_SQL_TRAVAR = text(
    """
    SELECT id, autor_id, severidade, status, criado_em, ultima_confirmacao_em,
           ST_X(geom) AS lon, ST_Y(geom) AS lat
    FROM barreira_colaborativa WHERE id = :id FOR UPDATE
    """
)

_SQL_VOTO_ANTERIOR = text(
    "SELECT voto FROM confirmacao WHERE barreira_id = :b AND usuario_id = :u"
)

_SQL_GRAVAR_VOTO = text(
    """
    INSERT INTO confirmacao (barreira_id, usuario_id, voto, criado_em, atualizado_em)
    VALUES (:b, :u, :voto, :agora, :agora)
    ON CONFLICT ON CONSTRAINT confirmacao_voto_unico
    DO UPDATE SET voto = EXCLUDED.voto, atualizado_em = EXCLUDED.atualizado_em
    """
)

_SQL_CONTAGEM = text(
    """
    SELECT count(*) FILTER (WHERE voto = 'confirma') AS confirma,
           count(*) FILTER (WHERE voto = 'contesta') AS contesta,
           count(*) FILTER (WHERE voto = 'resolvida') AS resolvida
    FROM confirmacao WHERE barreira_id = :b
    """
)

_SQL_ATUALIZAR = text(
    """
    UPDATE barreira_colaborativa
    SET status = :status, confirmacoes = :confirmacoes,
        ultima_confirmacao_em = :ultima, atualizado_em = :agora
    WHERE id = :id
    """
)

_SQL_VENCIDAS = text(
    f"""
    SELECT id, autor_id, severidade, status, criado_em, ultima_confirmacao_em,
           ST_X(geom) AS lon, ST_Y(geom) AS lat
    FROM barreira_colaborativa
    WHERE status IN ('pendente', 'validada')
      AND {expressao_status_efetivo("barreira_colaborativa", ":agora")} = 'expirada'
    ORDER BY id
    FOR UPDATE
    """
)


def _travar(db: Session, barreira_id: int) -> Row:
    linha = db.execute(_SQL_TRAVAR, {"id": barreira_id}).first()
    if linha is None:
        raise NaoEncontrada()
    return linha


def _invalidar_se_mudou(db: Session, linha: Row, antes: str, depois: str) -> None:
    if afeta_rota(antes, linha.severidade) != afeta_rota(depois, linha.severidade):
        invalidar_regiao(db, Point(linha.lon, linha.lat))


def votar(
    db: Session, usuario: UsuarioAtual, barreira_id: int, voto: str, agora: datetime
) -> BarreiraOut:
    linha = _travar(db, barreira_id)
    if linha.status == "removida":
        raise NaoEncontrada()
    if linha.autor_id == usuario.id:
        raise AutorNaoVota()
    atual = status_efetivo(linha.status, linha.criado_em, linha.ultima_confirmacao_em, agora)
    if atual in STATUS_ENCERRADOS:
        raise BarreiraEncerrada()

    parametros = {"b": barreira_id, "u": usuario.id}
    anterior = db.execute(_SQL_VOTO_ANTERIOR, parametros).scalar_one_or_none()
    db.execute(_SQL_GRAVAR_VOTO, {**parametros, "voto": voto, "agora": agora})
    contagem = Contagem(**db.execute(_SQL_CONTAGEM, {"b": barreira_id}).one()._mapping)
    novo = decidir_status(atual, linha.severidade, contagem)
    ultima = agora if voto == "confirma" else linha.ultima_confirmacao_em
    db.execute(
        _SQL_ATUALIZAR,
        {
            "id": barreira_id,
            "status": novo,
            "confirmacoes": contagem.confirma,
            "ultima": ultima,
            "agora": agora,
        },
    )
    registrar_evento(
        db,
        tipo="voto",
        agora=agora,
        barreira_id=barreira_id,
        usuario_id=usuario.id,
        detalhe={"voto": voto, "anterior": anterior},
    )
    if novo != atual:
        registrar_evento(
            db,
            tipo="status",
            agora=agora,
            barreira_id=barreira_id,
            usuario_id=usuario.id,
            de_status=atual,
            para_status=novo,
        )
    _invalidar_se_mudou(db, linha, atual, novo)
    return obter(db, barreira_id, agora)


def mudar_status_admin(
    db: Session,
    admin: UsuarioAtual,
    barreira_id: int,
    status: str,
    motivo: str,
    agora: datetime,
) -> BarreiraOut:
    linha = _travar(db, barreira_id)
    atual = status_efetivo(linha.status, linha.criado_em, linha.ultima_confirmacao_em, agora)
    # validar pelo admin conta como confirmação: a barreira não nasce já vencida
    ultima = agora if status == "validada" else linha.ultima_confirmacao_em
    confirmacoes = db.execute(_SQL_CONTAGEM, {"b": barreira_id}).one().confirma
    db.execute(
        _SQL_ATUALIZAR,
        {
            "id": barreira_id,
            "status": status,
            "confirmacoes": confirmacoes,
            "ultima": ultima,
            "agora": agora,
        },
    )
    registrar_evento(
        db,
        tipo="admin",
        agora=agora,
        barreira_id=barreira_id,
        usuario_id=admin.id,
        de_status=atual,
        para_status=status,
        detalhe={"motivo": motivo},
    )
    _invalidar_se_mudou(db, linha, atual, status)
    return obter(db, barreira_id, agora, incluir_removida=True)


def expirar_vencidas(db: Session, agora: datetime) -> list[int]:
    """Grava `expirada` (e o evento) nas barreiras que a leitura já trata como
    vencidas. Roda pelo script `scripts/expirar.py`."""
    expiradas: list[int] = []
    for linha in db.execute(_SQL_VENCIDAS, {"agora": agora}).all():
        db.execute(
            text(
                "UPDATE barreira_colaborativa SET status = 'expirada', atualizado_em = :agora "
                "WHERE id = :id"
            ),
            {"id": linha.id, "agora": agora},
        )
        registrar_evento(
            db,
            tipo="status",
            agora=agora,
            barreira_id=linha.id,
            de_status=linha.status,
            para_status="expirada",
            detalhe={"motivo": "prazo"},
        )
        _invalidar_se_mudou(db, linha, linha.status, "expirada")
        expiradas.append(linha.id)
    return expiradas
```

Nota: em `mudar_status_admin`, `confirmacoes` é recontada só para manter a coluna coerente; o admin não altera votos.

- [ ] **Step 4: Roteamento ignora colaborativas expiradas**

Em `backend/app/services/barreira_geom.py`:

1. Acrescente o import `from app.services.moderacao import expressao_status_efetivo`.
2. Logo acima de `_SQL_CANDIDATOS = text(`, acrescente:

```python
# mesma regra de expiração da leitura pública (moderacao.status_efetivo), com now()
_STATUS_EFETIVO_COLABORATIVA = expressao_status_efetivo("barreira_colaborativa", "now()")
```

3. Troque `_SQL_CANDIDATOS = text(` + `"""` por `_SQL_CANDIDATOS = text(` + `f"""` e, **só no ramo das colaborativas** (o primeiro `WHERE ST_Intersects(...)`, logo depois de `FROM barreira_colaborativa`), acrescente uma linha:

```sql
        FROM barreira_colaborativa
        WHERE ST_Intersects(geom, ST_SetSRID(ST_GeomFromText(:corredor_wkt), 4326))
          AND {_STATUS_EFETIVO_COLABORATIVA} <> 'expirada'
```

O ramo de `barreira_oficial` não muda. O SQL não tem `{` nem `}` além dessa interpolação; confira antes de salvar.

- [ ] **Step 5: Rodar e ver passar**

Run: `.venv/Scripts/python.exe -m pytest tests/test_votacao.py -v`
Expected: 12 passed.

Run: `.venv/Scripts/python.exe -m pytest -q ; .venv/Scripts/python.exe -m ruff check . ; .venv/Scripts/python.exe -m ruff format --check .`
Expected: suíte inteira verde (inclui `tests/services/test_barreira_geom_db.py` e `test_rota.py`, que usam `barreira_geom`).

- [ ] **Step 6: Commit (só com autorização do dono)**

```bash
git add backend/app/services/votacao.py backend/app/services/barreira_geom.py backend/tests/test_votacao.py
git commit -m "feat(backend): votação com voto único, decisão do admin, expiração e invalidação do cache"
```

---

### Task 6: Promoção a admin e scripts

**Files:**
- Create: `backend/app/services/admin.py`
- Create: `backend/scripts/promover_admin.py`
- Create: `backend/scripts/expirar.py`
- Test: `backend/tests/test_admin.py`

**Interfaces:**
- Consumes: `barreiras.registrar_evento` (Task 4); `votacao.expirar_vencidas` (Task 5); fixture `db_transacional` (Task 3).
- Produces (em `app.services.admin`): `class UsuarioNaoEncontrado(Exception)`; `buscar_id_por_email(db, email: str) -> uuid.UUID`; `promover_admin(db, usuario_id: uuid.UUID, agora: datetime) -> None`. Scripts `python scripts/promover_admin.py --email X | --id UUID` e `python scripts/expirar.py`, a partir de `backend/`.

- [ ] **Step 1: Escrever os testes**

`backend/tests/test_admin.py`:

```python
"""Promoção a admin (spec 2026-11-02-colaborativo-design.md, 4.6)."""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from app.services.admin import UsuarioNaoEncontrado, buscar_id_por_email, promover_admin

pytestmark = pytest.mark.integration

AGORA = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)


def test_promover_por_id_cria_admin_e_registra_evento(db_transacional):
    usuario_id = uuid.uuid4()
    promover_admin(db_transacional, usuario_id, AGORA)
    papel = db_transacional.execute(
        text("SELECT papel FROM usuario WHERE id = :id"), {"id": usuario_id}
    ).scalar_one()
    assert papel == "admin"
    tipo, barreira = db_transacional.execute(
        text("SELECT tipo, barreira_id FROM barreira_evento WHERE usuario_id = :id"),
        {"id": usuario_id},
    ).one()
    assert (tipo, barreira) == ("promocao", None)


def test_promover_usuario_existente(db_transacional, criar_usuario):
    usuario = criar_usuario()
    promover_admin(db_transacional, usuario.id, AGORA)
    papel = db_transacional.execute(
        text("SELECT papel FROM usuario WHERE id = :id"), {"id": usuario.id}
    ).scalar_one()
    assert papel == "admin"


def test_buscar_por_email_sem_auth_users_explica_o_que_fazer(db_transacional):
    existe = db_transacional.execute(
        text("SELECT to_regclass('auth.users') IS NOT NULL")
    ).scalar_one()
    if existe:
        pytest.skip("este banco tem auth.users (Supabase); o teste é para o banco local")
    with pytest.raises(UsuarioNaoEncontrado, match="--id"):
        buscar_id_por_email(db_transacional, "caiorosa2006@gmail.com")
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv/Scripts/python.exe -m pytest tests/test_admin.py -v`
Expected: erro de coleta (`No module named 'app.services.admin'`).

- [ ] **Step 3: Implementar `services/admin.py`**

```python
"""Promoção de usuário a admin (spec 2026-11-02-colaborativo-design.md, 4.6).
O e-mail vive só no Supabase (`auth.users`); localmente, use o id."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.barreiras import registrar_evento


class UsuarioNaoEncontrado(Exception):
    pass


def buscar_id_por_email(db: Session, email: str) -> uuid.UUID:
    tem_auth = db.execute(text("SELECT to_regclass('auth.users') IS NOT NULL")).scalar_one()
    if not tem_auth:
        raise UsuarioNaoEncontrado(
            "auth.users não existe neste banco (só no Supabase); use --id <uuid>."
        )
    usuario_id = db.execute(
        text("SELECT id FROM auth.users WHERE lower(email) = lower(:email)"), {"email": email}
    ).scalar_one_or_none()
    if usuario_id is None:
        raise UsuarioNaoEncontrado(
            f"Nenhum usuário com o e-mail {email}; ele precisa entrar no app uma vez antes."
        )
    return usuario_id


def promover_admin(db: Session, usuario_id: uuid.UUID, agora: datetime) -> None:
    db.execute(
        text(
            "INSERT INTO usuario (id, papel) VALUES (:id, 'admin') "
            "ON CONFLICT (id) DO UPDATE SET papel = 'admin'"
        ),
        {"id": usuario_id},
    )
    registrar_evento(db, tipo="promocao", agora=agora, usuario_id=usuario_id, detalhe={"papel": "admin"})
```

- [ ] **Step 4: Scripts**

`backend/scripts/promover_admin.py`:

```python
"""Promove um usuário a admin.

Uso (a partir de backend/, com o venv do backend):
    python scripts/promover_admin.py --email pessoa@exemplo.com   # só no Supabase
    python scripts/promover_admin.py --id <uuid>                  # qualquer banco

O e-mail precisa ter entrado no app pelo menos uma vez. O banco é o de
DATABASE_URL; para produção, defina DATABASE_URL só neste comando.
"""

from __future__ import annotations

import argparse
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

RAIZ_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ_BACKEND))

from app.db import SessionLocal  # noqa: E402
from app.services.admin import (  # noqa: E402
    UsuarioNaoEncontrado,
    buscar_id_por_email,
    promover_admin,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Promove um usuário a admin.")
    grupo = parser.add_mutually_exclusive_group(required=True)
    grupo.add_argument("--email")
    grupo.add_argument("--id", type=uuid.UUID)
    args = parser.parse_args(argv)

    with SessionLocal() as db:
        try:
            usuario_id = args.id or buscar_id_por_email(db, args.email)
        except UsuarioNaoEncontrado as erro:
            print(f"erro: {erro}", file=sys.stderr)
            return 1
        promover_admin(db, usuario_id, datetime.now(UTC))
        db.commit()
    print(f"ok: {usuario_id} agora é admin")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

`backend/scripts/expirar.py`:

```python
"""Grava `expirada` nas barreiras colaborativas vencidas (pendente > 30 dias,
validada sem confirmação > 180 dias), com evento de auditoria.

Uso (a partir de backend/, com o venv do backend):
    python scripts/expirar.py
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime
from pathlib import Path

RAIZ_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ_BACKEND))

from app.db import SessionLocal  # noqa: E402
from app.services.votacao import expirar_vencidas  # noqa: E402


def main() -> int:
    with SessionLocal() as db:
        expiradas = expirar_vencidas(db, datetime.now(UTC))
        db.commit()
    print(f"{len(expiradas)} barreira(s) expirada(s): {expiradas}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Rodar e ver passar**

Run: `.venv/Scripts/python.exe -m pytest tests/test_admin.py -v`
Expected: 3 passed.

Run (em `backend/`, banco local; não grava nada):
```powershell
.venv/Scripts/python.exe scripts/promover_admin.py --email caiorosa2006@gmail.com
```
Expected: código de saída 1 e `erro: auth.users não existe neste banco (só no Supabase); use --id <uuid>.`

Run: `.venv/Scripts/python.exe scripts/expirar.py`
Expected: `0 barreira(s) expirada(s): []` (o banco local não tem barreiras colaborativas vencidas).

Run: `.venv/Scripts/python.exe -m ruff check . ; .venv/Scripts/python.exe -m ruff format --check .`

- [ ] **Step 6: Commit (só com autorização do dono)**

```bash
git add backend/app/services/admin.py backend/scripts/promover_admin.py backend/scripts/expirar.py backend/tests/test_admin.py
git commit -m "feat(backend): promoção a admin e scripts promover_admin/expirar"
```

---

### Task 7: Foto da barreira

**Files:**
- Modify: `backend/pyproject.toml` (`"Pillow>=10.4"`)
- Modify: `backend/app/config.py` (campo `supabase_service_role_key`)
- Create: `backend/app/services/fotos.py`
- Modify: `backend/tests/conftest.py` (fixture `armazenamento_memoria`)
- Test: `backend/tests/test_fotos.py`

**Interfaces:**
- Consumes: `barreiras.obter`, `barreiras.registrar_evento`, `barreiras.BUCKET_FOTOS` (Task 4); erros (Task 4); `UsuarioAtual` (Task 3).
- Produces (em `app.services.fotos`):
  - Constantes `TAMANHO_MAX_BYTES = 5 * 1024 * 1024`, `PIXELS_MAX = 40_000_000`, `LADO_MAX = 1600`.
  - `reprocessar(conteudo: bytes) -> bytes` (WebP sem metadados).
  - `class ArmazenamentoFotos(Protocol)`: `enviar(caminho: str, conteudo: bytes) -> None`, `remover(caminho: str) -> None`.
  - `class ArmazenamentoSupabase(url: str, chave: str, timeout_s: float = 15.0)`, `class ArmazenamentoMemoria` (atributo `objetos: dict[str, bytes]`).
  - `criar_armazenamento(supabase_url: str | None, chave: str | None) -> ArmazenamentoFotos | None`.
  - `anexar_foto(db, usuario, barreira_id, conteudo: bytes, descricao: str, armazenamento: ArmazenamentoFotos | None, agora) -> BarreiraOut`.
  - `remover_foto(db, usuario, barreira_id, armazenamento: ArmazenamentoFotos | None, agora) -> BarreiraOut`.
  - Fixture `armazenamento_memoria` em `conftest.py`.

- [ ] **Step 1: Dependência e config**

Em `backend/pyproject.toml`, `dependencies`: acrescente `"Pillow>=10.4",`. Run: `.venv/Scripts/python.exe -m pip install -e ".[dev]"`.

Em `backend/app/config.py`, depois de `supabase_url`:

```python
    # chave de serviço do Supabase, só para o Storage das fotos (segredo; só no Render)
    supabase_service_role_key: str | None = None
```

- [ ] **Step 2: Fixture**

No fim de `backend/tests/conftest.py`:

```python
@pytest.fixture
def armazenamento_memoria():
    from app.services.fotos import ArmazenamentoMemoria

    return ArmazenamentoMemoria()
```

- [ ] **Step 3: Escrever os testes**

`backend/tests/test_fotos.py`:

```python
"""Foto da barreira (spec 2026-11-02-colaborativo-design.md, 7)."""

import io
import json
import uuid
from datetime import UTC, datetime

import httpx
import pytest
import respx
from PIL import Image

from app.config import settings
from app.schemas.barreira import BarreiraIn
from app.services import barreiras, fotos
from app.services.erros import (
    DescricaoFotoInvalida,
    FotoFormato,
    FotoGrande,
    SemPermissao,
    StorageIndisponivel,
)

AGORA = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)
DESCRICAO = "Escada de três degraus na entrada"


def _jpeg(largura=300, altura=200, orientacao=None) -> bytes:
    imagem = Image.new("RGB", (largura, altura), (120, 80, 40))
    exif = Image.Exif()
    exif[0x010F] = "CameraTeste"  # Make
    if orientacao is not None:
        exif[0x0112] = orientacao  # Orientation
    saida = io.BytesIO()
    imagem.save(saida, "JPEG", exif=exif.tobytes())
    return saida.getvalue()


def _png(largura, altura) -> bytes:
    saida = io.BytesIO()
    Image.new("1", (largura, altura)).save(saida, "PNG")  # 1 bit: barato de gerar
    return saida.getvalue()


# --- reprocessar (puro) ---------------------------------------------------------


def test_reprocessar_remove_metadados_e_gera_webp():
    original = _jpeg()
    assert Image.open(io.BytesIO(original)).info.get("exif")
    resultado = Image.open(io.BytesIO(fotos.reprocessar(original)))
    assert resultado.format == "WEBP"
    assert not resultado.info.get("exif")
    assert len(resultado.getexif()) == 0


def test_reprocessar_aplica_a_rotacao_do_exif():
    resultado = Image.open(io.BytesIO(fotos.reprocessar(_jpeg(300, 200, orientacao=6))))
    assert resultado.size == (200, 300)


def test_reprocessar_reduz_para_1600_px():
    resultado = Image.open(io.BytesIO(fotos.reprocessar(_jpeg(4000, 3000))))
    assert resultado.size == (1600, 1200)


def test_arquivo_maior_que_5_mb():
    with pytest.raises(FotoGrande):
        fotos.reprocessar(b"0" * (fotos.TAMANHO_MAX_BYTES + 1))


@pytest.mark.parametrize(
    "conteudo",
    [b"isto nao e imagem", None],
    ids=["texto", "gif"],
)
def test_formato_nao_suportado(conteudo):
    if conteudo is None:
        saida = io.BytesIO()
        Image.new("RGB", (10, 10)).save(saida, "GIF")
        conteudo = saida.getvalue()
    with pytest.raises(FotoFormato):
        fotos.reprocessar(conteudo)


def test_imagem_acima_de_40_megapixels():
    with pytest.raises(FotoFormato):
        fotos.reprocessar(_png(8000, 6000))


# --- ArmazenamentoSupabase (HTTP simulado com respx) -----------------------------


@respx.mock
def test_supabase_envia_com_chave_de_servico():
    rota = respx.post(
        "https://abc.supabase.co/storage/v1/object/fotos-barreiras/7/x.webp"
    ).mock(return_value=httpx.Response(200, json={"Key": "fotos-barreiras/7/x.webp"}))
    fotos.ArmazenamentoSupabase("https://abc.supabase.co/", "segredo").enviar("7/x.webp", b"img")
    pedido = rota.calls.last.request
    assert pedido.headers["authorization"] == "Bearer segredo"
    assert pedido.headers["content-type"] == "image/webp"
    assert pedido.content == b"img"


@respx.mock
def test_supabase_fora_do_ar_vira_storage_indisponivel():
    respx.post(url__startswith="https://abc.supabase.co/storage/").mock(
        return_value=httpx.Response(500)
    )
    with pytest.raises(StorageIndisponivel):
        fotos.ArmazenamentoSupabase("https://abc.supabase.co", "segredo").enviar("7/x.webp", b"i")


@respx.mock
def test_supabase_remove_pelo_prefixo():
    rota = respx.delete("https://abc.supabase.co/storage/v1/object/fotos-barreiras").mock(
        return_value=httpx.Response(200, json=[])
    )
    fotos.ArmazenamentoSupabase("https://abc.supabase.co", "segredo").remover("7/x.webp")
    assert json.loads(rota.calls.last.request.content) == {"prefixes": ["7/x.webp"]}


def test_criar_armazenamento():
    assert fotos.criar_armazenamento(None, "x") is None
    assert fotos.criar_armazenamento("https://abc.supabase.co", None) is None
    assert isinstance(
        fotos.criar_armazenamento("https://abc.supabase.co", "x"), fotos.ArmazenamentoSupabase
    )


# --- anexar/remover (com banco) ---------------------------------------------------


@pytest.fixture
def barreira(db_transacional, criar_usuario):
    autor = criar_usuario()
    entrada = BarreiraIn(
        categoria="escada", lat=-23.59, lon=-46.635, chave_idempotencia=uuid.uuid4()
    )
    return autor, barreiras.criar(db_transacional, autor, entrada, AGORA)[0]


@pytest.mark.integration
def test_autor_anexa_e_troca_foto(
    db_transacional, barreira, armazenamento_memoria, monkeypatch
):
    monkeypatch.setattr(settings, "supabase_url", "https://abc.supabase.co")
    autor, b = barreira
    primeira = fotos.anexar_foto(
        db_transacional, autor, b.id, _jpeg(), DESCRICAO, armazenamento_memoria, AGORA
    )
    assert primeira.foto_descricao == DESCRICAO
    assert primeira.foto_url.startswith(
        f"https://abc.supabase.co/storage/v1/object/public/fotos-barreiras/{b.id}/"
    )
    assert len(armazenamento_memoria.objetos) == 1
    segunda = fotos.anexar_foto(
        db_transacional, autor, b.id, _jpeg(), DESCRICAO, armazenamento_memoria, AGORA
    )
    assert segunda.foto_url != primeira.foto_url
    assert len(armazenamento_memoria.objetos) == 1  # a anterior foi apagada
    tipos = [e.tipo for e in barreiras.listar_eventos(db_transacional, b.id)]
    assert tipos.count("foto") == 2


@pytest.mark.integration
def test_outra_pessoa_nao_anexa_mas_admin_anexa(
    db_transacional, barreira, armazenamento_memoria, criar_usuario
):
    _, b = barreira
    with pytest.raises(SemPermissao):
        fotos.anexar_foto(
            db_transacional, criar_usuario(), b.id, _jpeg(), DESCRICAO, armazenamento_memoria, AGORA
        )
    resultado = fotos.anexar_foto(
        db_transacional, criar_usuario("admin"), b.id, _jpeg(), DESCRICAO, armazenamento_memoria, AGORA
    )
    assert resultado.foto_descricao == DESCRICAO


@pytest.mark.integration
@pytest.mark.parametrize("descricao", ["abcd", "x" * 301, "    "])
def test_descricao_da_foto_invalida(db_transacional, barreira, armazenamento_memoria, descricao):
    autor, b = barreira
    with pytest.raises(DescricaoFotoInvalida):
        fotos.anexar_foto(
            db_transacional, autor, b.id, _jpeg(), descricao, armazenamento_memoria, AGORA
        )


@pytest.mark.integration
def test_sem_armazenamento_configurado(db_transacional, barreira):
    autor, b = barreira
    with pytest.raises(StorageIndisponivel):
        fotos.anexar_foto(db_transacional, autor, b.id, _jpeg(), DESCRICAO, None, AGORA)


@pytest.mark.integration
def test_remover_foto(db_transacional, barreira, armazenamento_memoria):
    autor, b = barreira
    fotos.anexar_foto(db_transacional, autor, b.id, _jpeg(), DESCRICAO, armazenamento_memoria, AGORA)
    resultado = fotos.remover_foto(db_transacional, autor, b.id, armazenamento_memoria, AGORA)
    assert (resultado.foto_url, resultado.foto_descricao) == (None, None)
    assert armazenamento_memoria.objetos == {}
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `.venv/Scripts/python.exe -m pytest tests/test_fotos.py -v`
Expected: erro de coleta (`No module named 'app.services.fotos'` ou `PIL` se o Step 1 não rodou).

- [ ] **Step 5: Implementar `services/fotos.py`**

```python
"""Foto opcional da barreira (spec 2026-11-02-colaborativo-design.md, 7).

Toda foto é reprocessada (rotação do EXIF aplicada, lado maior ≤ 1600 px,
WebP sem metadados) antes de ir ao Supabase Storage: é o que garante que o
GPS gravado pela câmera nunca seja publicado (LGPD). As imagens são servidas
pela CDN do Supabase, não pelo Render.
"""

from __future__ import annotations

import io
import uuid
from datetime import datetime
from typing import Protocol

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import UsuarioAtual
from app.schemas.barreira import BarreiraOut
from app.services.barreiras import BUCKET_FOTOS, obter, registrar_evento
from app.services.erros import (
    DescricaoFotoInvalida,
    FotoFormato,
    FotoGrande,
    NaoEncontrada,
    SemPermissao,
    StorageIndisponivel,
)

TAMANHO_MAX_BYTES = 5 * 1024 * 1024
PIXELS_MAX = 40_000_000
LADO_MAX = 1600
_FORMATOS_ACEITOS = frozenset({"JPEG", "PNG", "WEBP"})
_DESCRICAO_MIN, _DESCRICAO_MAX = 5, 300


def reprocessar(conteudo: bytes) -> bytes:
    if len(conteudo) > TAMANHO_MAX_BYTES:
        raise FotoGrande()
    try:
        with Image.open(io.BytesIO(conteudo)) as imagem:
            if imagem.format not in _FORMATOS_ACEITOS:
                raise FotoFormato()
            if imagem.width * imagem.height > PIXELS_MAX:
                raise FotoFormato()
            imagem.load()
            limpa = ImageOps.exif_transpose(imagem).convert("RGB")
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as erro:
        raise FotoFormato() from erro
    limpa.thumbnail((LADO_MAX, LADO_MAX))
    saida = io.BytesIO()
    limpa.save(saida, "WEBP", quality=80)  # sem exif=: nenhum metadado é gravado
    return saida.getvalue()


class ArmazenamentoFotos(Protocol):
    def enviar(self, caminho: str, conteudo: bytes) -> None: ...

    def remover(self, caminho: str) -> None: ...


class ArmazenamentoSupabase:
    def __init__(self, url: str, chave: str, timeout_s: float = 15.0) -> None:
        self._base = f"{url.rstrip('/')}/storage/v1/object/{BUCKET_FOTOS}"
        self._cabecalhos = {"Authorization": f"Bearer {chave}", "apikey": chave}
        self._timeout = timeout_s

    def enviar(self, caminho: str, conteudo: bytes) -> None:
        try:
            resposta = httpx.post(
                f"{self._base}/{caminho}",
                content=conteudo,
                headers={**self._cabecalhos, "Content-Type": "image/webp", "x-upsert": "true"},
                timeout=self._timeout,
            )
            resposta.raise_for_status()
        except httpx.HTTPError as erro:
            raise StorageIndisponivel() from erro

    def remover(self, caminho: str) -> None:
        try:
            resposta = httpx.request(
                "DELETE",
                self._base,
                json={"prefixes": [caminho]},
                headers=self._cabecalhos,
                timeout=self._timeout,
            )
            resposta.raise_for_status()
        except httpx.HTTPError as erro:
            raise StorageIndisponivel() from erro


class ArmazenamentoMemoria:
    """Armazenamento falso para testes e desenvolvimento local."""

    def __init__(self) -> None:
        self.objetos: dict[str, bytes] = {}

    def enviar(self, caminho: str, conteudo: bytes) -> None:
        self.objetos[caminho] = conteudo

    def remover(self, caminho: str) -> None:
        self.objetos.pop(caminho, None)


def criar_armazenamento(supabase_url: str | None, chave: str | None) -> ArmazenamentoFotos | None:
    if not supabase_url or not chave:
        return None
    return ArmazenamentoSupabase(supabase_url, chave)


_SQL_TRAVAR = text(
    "SELECT autor_id, status, foto_caminho FROM barreira_colaborativa WHERE id = :id FOR UPDATE"
)
_SQL_GRAVAR_FOTO = text(
    "UPDATE barreira_colaborativa SET foto_caminho = :caminho, foto_descricao = :descricao, "
    "atualizado_em = :agora WHERE id = :id"
)


def _travar_com_permissao(db: Session, usuario: UsuarioAtual, barreira_id: int):
    linha = db.execute(_SQL_TRAVAR, {"id": barreira_id}).first()
    if linha is None or linha.status == "removida":
        raise NaoEncontrada()
    if not (usuario.admin or linha.autor_id == usuario.id):
        raise SemPermissao()
    return linha


def _remover_sem_falhar(armazenamento: ArmazenamentoFotos, caminho: str | None) -> None:
    """Uma foto antiga que não sai do Storage vira só um arquivo órfão; não
    pode impedir a troca nem a remoção."""
    if caminho is None:
        return
    try:
        armazenamento.remover(caminho)
    except StorageIndisponivel:
        pass


def anexar_foto(
    db: Session,
    usuario: UsuarioAtual,
    barreira_id: int,
    conteudo: bytes,
    descricao: str,
    armazenamento: ArmazenamentoFotos | None,
    agora: datetime,
) -> BarreiraOut:
    if armazenamento is None:
        raise StorageIndisponivel()
    descricao = descricao.strip()
    if not _DESCRICAO_MIN <= len(descricao) <= _DESCRICAO_MAX:
        raise DescricaoFotoInvalida()
    linha = _travar_com_permissao(db, usuario, barreira_id)
    webp = reprocessar(conteudo)
    caminho = f"{barreira_id}/{uuid.uuid4().hex}.webp"
    armazenamento.enviar(caminho, webp)
    db.execute(
        _SQL_GRAVAR_FOTO,
        {"id": barreira_id, "caminho": caminho, "descricao": descricao, "agora": agora},
    )
    registrar_evento(
        db,
        tipo="foto",
        agora=agora,
        barreira_id=barreira_id,
        usuario_id=usuario.id,
        detalhe={"acao": "anexada"},
    )
    _remover_sem_falhar(armazenamento, linha.foto_caminho)
    return obter(db, barreira_id, agora)


def remover_foto(
    db: Session,
    usuario: UsuarioAtual,
    barreira_id: int,
    armazenamento: ArmazenamentoFotos | None,
    agora: datetime,
) -> BarreiraOut:
    if armazenamento is None:
        raise StorageIndisponivel()
    linha = _travar_com_permissao(db, usuario, barreira_id)
    db.execute(
        _SQL_GRAVAR_FOTO, {"id": barreira_id, "caminho": None, "descricao": None, "agora": agora}
    )
    registrar_evento(
        db,
        tipo="foto",
        agora=agora,
        barreira_id=barreira_id,
        usuario_id=usuario.id,
        detalhe={"acao": "removida"},
    )
    _remover_sem_falhar(armazenamento, linha.foto_caminho)
    return obter(db, barreira_id, agora)
```

- [ ] **Step 6: Rodar e ver passar**

Run: `.venv/Scripts/python.exe -m pytest tests/test_fotos.py -v`
Expected: 18 passed (rode `ruff format tests/test_fotos.py` antes do lint: algumas chamadas passam de 100 colunas). Se o teste de rotação falhar porque a versão do Pillow não grava a tag de orientação via `Image.Exif`, confira com `Image.open(io.BytesIO(_jpeg(orientacao=6))).getexif().get(0x0112)` e reporte; não remova o teste.

Run: `.venv/Scripts/python.exe -m pytest -q ; .venv/Scripts/python.exe -m ruff check . ; .venv/Scripts/python.exe -m ruff format --check .`

- [ ] **Step 7: Commit (só com autorização do dono)**

```bash
git add backend/pyproject.toml backend/app/config.py backend/app/services/fotos.py backend/tests/conftest.py backend/tests/test_fotos.py
git commit -m "feat(backend): foto opcional da barreira reprocessada sem metadados no Supabase Storage"
```

---

### Task 8: Rotas HTTP, CORS, Render e tipos do frontend

**Files:**
- Modify: `backend/pyproject.toml` (`"python-multipart>=0.0.9"`)
- Create: `backend/app/routers/barreiras.py`
- Create: `backend/app/routers/admin.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/conftest.py` (fixture `cliente_api`)
- Modify: `render.yaml`
- Test: `backend/tests/test_barreiras_api.py`
- Regenerate: `frontend/src/api/types.gen.ts`

**Interfaces:**
- Consumes: tudo das Tasks 3–7.
- Produces: rotas da seção 5 do spec; dependências `obter_agora() -> datetime` e `obter_armazenamento(request) -> ArmazenamentoFotos | None` em `app.routers.barreiras`; constante `MSG_INDISPONIVEL = "Serviço de barreiras indisponível no momento."`; fixture `cliente_api`.

- [ ] **Step 1: Dependência e fixture**

`backend/pyproject.toml`, `dependencies`: `"python-multipart>=0.0.9",`. Run: `.venv/Scripts/python.exe -m pip install -e ".[dev]"`.

No fim de `backend/tests/conftest.py`:

```python
@pytest.fixture
def cliente_api(db_transacional, config_auth_teste, armazenamento_memoria):
    from fastapi.testclient import TestClient

    from app.auth import obter_config_auth
    from app.db import get_db
    from app.main import create_app
    from app.routers.barreiras import obter_armazenamento

    app = create_app()
    app.dependency_overrides[get_db] = lambda: db_transacional
    app.dependency_overrides[obter_config_auth] = lambda: config_auth_teste
    app.dependency_overrides[obter_armazenamento] = lambda: armazenamento_memoria
    return TestClient(app)
```

- [ ] **Step 2: Escrever os testes de contrato**

`backend/tests/test_barreiras_api.py`:

```python
"""Contrato HTTP da camada colaborativa (spec 2026-11-02-colaborativo-design.md, 5 e 8)."""

import io
import uuid

import pytest
from PIL import Image

from app.auth import MSG_LOGIN, MSG_SEM_PERMISSAO
from app.config import settings
from app.routers.barreiras import obter_armazenamento
from app.services.erros import AutorNaoVota, ForaDaArea, StorageIndisponivel

pytestmark = pytest.mark.integration

LON, LAT = -46.6350, -23.5900
CAMPOS_PUBLICOS = {
    "id",
    "categoria",
    "severidade",
    "status",
    "votos",
    "descricao",
    "lat",
    "lon",
    "criada_em",
    "ultima_confirmacao_em",
    "foto_url",
    "foto_descricao",
}


def _auth(emitir_token, sub) -> dict[str, str]:
    return {"Authorization": f"Bearer {emitir_token(sub)}"}


def _corpo(categoria="escada", chave=None, lon=LON, lat=LAT):
    return {
        "categoria": categoria,
        "lat": lat,
        "lon": lon,
        "chave_idempotencia": str(chave or uuid.uuid4()),
    }


def _jpeg() -> bytes:
    saida = io.BytesIO()
    Image.new("RGB", (40, 30), (10, 20, 30)).save(saida, "JPEG")
    return saida.getvalue()


@pytest.fixture
def autor():
    return uuid.uuid4()


@pytest.fixture
def criada(cliente_api, emitir_token, autor):
    resposta = cliente_api.post("/api/barreiras", json=_corpo(), headers=_auth(emitir_token, autor))
    assert resposta.status_code == 201
    return resposta.json()


def test_cadastro_exige_login(cliente_api):
    resposta = cliente_api.post("/api/barreiras", json=_corpo())
    assert resposta.status_code == 401
    assert resposta.json()["detail"] == MSG_LOGIN


def test_cadastro_devolve_ficha_publica_sem_autor(criada, autor):
    assert set(criada) == CAMPOS_PUBLICOS
    assert criada["status"] == "pendente"
    assert str(autor) not in str(criada)


def test_cadastro_idempotente(cliente_api, emitir_token, autor):
    chave = uuid.uuid4()
    primeira = cliente_api.post(
        "/api/barreiras", json=_corpo(chave=chave), headers=_auth(emitir_token, autor)
    )
    segunda = cliente_api.post(
        "/api/barreiras", json=_corpo(chave=chave), headers=_auth(emitir_token, autor)
    )
    assert (primeira.status_code, segunda.status_code) == (201, 200)
    assert primeira.json()["id"] == segunda.json()["id"]


@pytest.mark.parametrize(
    "corpo",
    [_corpo(categoria="inventada"), {"categoria": "escada", "lat": LAT, "lon": LON}],
    ids=["categoria-fora-da-lista", "sem-chave"],
)
def test_cadastro_invalido_e_422(cliente_api, emitir_token, corpo):
    resposta = cliente_api.post(
        "/api/barreiras", json=corpo, headers=_auth(emitir_token, uuid.uuid4())
    )
    assert resposta.status_code == 422


def test_cadastro_fora_da_area_e_422_em_portugues(cliente_api, emitir_token):
    resposta = cliente_api.post(
        "/api/barreiras",
        json=_corpo(lon=-46.5, lat=-23.5),
        headers=_auth(emitir_token, uuid.uuid4()),
    )
    assert resposta.status_code == 422
    assert resposta.json()["detail"] == ForaDaArea.mensagem


def test_leitura_publica(cliente_api, criada):
    lista = cliente_api.get("/api/barreiras", params={"lat": LAT, "lon": LON, "raio_m": 50})
    assert lista.status_code == 200
    assert criada["id"] in [b["id"] for b in lista.json()]
    uma = cliente_api.get(f"/api/barreiras/{criada['id']}")
    assert uma.status_code == 200
    assert cliente_api.get("/api/barreiras/987654321").status_code == 404


@pytest.mark.parametrize("raio", [5, 501])
def test_raio_fora_dos_limites_e_422(cliente_api, raio):
    resposta = cliente_api.get("/api/barreiras", params={"lat": LAT, "lon": LON, "raio_m": raio})
    assert resposta.status_code == 422


def test_votacao(cliente_api, emitir_token, autor, criada):
    url = f"/api/barreiras/{criada['id']}/voto"
    resposta_autor = cliente_api.put(url, json={"voto": "confirma"}, headers=_auth(emitir_token, autor))
    assert resposta_autor.status_code == 403
    assert resposta_autor.json()["detail"] == AutorNaoVota.mensagem
    assert (
        cliente_api.put(url, json={"voto": "talvez"}, headers=_auth(emitir_token, uuid.uuid4()))
    ).status_code == 422
    for _ in range(2):
        resposta = cliente_api.put(
            url, json={"voto": "confirma"}, headers=_auth(emitir_token, uuid.uuid4())
        )
    assert resposta.status_code == 200
    assert resposta.json()["status"] == "validada"
    assert resposta.json()["votos"]["confirma"] == 2


def test_admin(cliente_api, emitir_token, criar_usuario, criada):
    url = f"/api/admin/barreiras/{criada['id']}/status"
    corpo = {"status": "removida", "motivo": "denúncia de barreira falsa"}
    colaborador = cliente_api.post(url, json=corpo, headers=_auth(emitir_token, uuid.uuid4()))
    assert colaborador.status_code == 403
    assert colaborador.json()["detail"] == MSG_SEM_PERMISSAO

    admin = criar_usuario("admin")
    resposta = cliente_api.post(url, json=corpo, headers=_auth(emitir_token, admin.id))
    assert resposta.status_code == 200
    assert resposta.json()["status"] == "removida"
    assert cliente_api.get(f"/api/barreiras/{criada['id']}").status_code == 404

    eventos = cliente_api.get(
        f"/api/admin/barreiras/{criada['id']}/eventos", headers=_auth(emitir_token, admin.id)
    )
    assert eventos.status_code == 200
    assert [e["tipo"] for e in eventos.json()] == ["criada", "admin"]
    assert eventos.json()[-1]["usuario_id"] == str(admin.id)


def test_motivo_do_admin_obrigatorio(cliente_api, emitir_token, criar_usuario, criada):
    admin = criar_usuario("admin")
    resposta = cliente_api.post(
        f"/api/admin/barreiras/{criada['id']}/status",
        json={"status": "removida", "motivo": "x"},
        headers=_auth(emitir_token, admin.id),
    )
    assert resposta.status_code == 422


def test_foto(cliente_api, emitir_token, autor, criada, monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "https://abc.supabase.co")
    url = f"/api/barreiras/{criada['id']}/foto"
    resposta = cliente_api.post(
        url,
        files={"arquivo": ("foto.jpg", _jpeg(), "image/jpeg")},
        data={"descricao": "Escada de três degraus"},
        headers=_auth(emitir_token, autor),
    )
    assert resposta.status_code == 200
    assert resposta.json()["foto_url"].endswith(".webp")
    texto = cliente_api.post(
        url,
        files={"arquivo": ("a.txt", b"texto", "text/plain")},
        data={"descricao": "Escada de três degraus"},
        headers=_auth(emitir_token, autor),
    )
    assert texto.status_code == 415
    removida = cliente_api.delete(url, headers=_auth(emitir_token, autor))
    assert removida.status_code == 200
    assert removida.json()["foto_url"] is None


def test_foto_sem_storage_e_503(cliente_api, emitir_token, autor, criada):
    cliente_api.app.dependency_overrides[obter_armazenamento] = lambda: None
    resposta = cliente_api.post(
        f"/api/barreiras/{criada['id']}/foto",
        files={"arquivo": ("foto.jpg", _jpeg(), "image/jpeg")},
        data={"descricao": "Escada de três degraus"},
        headers=_auth(emitir_token, autor),
    )
    assert resposta.status_code == 503
    assert resposta.json()["detail"] == StorageIndisponivel.mensagem


def test_cors_libera_put_para_o_frontend(cliente_api):
    resposta = cliente_api.options(
        "/api/barreiras/1/voto",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert resposta.status_code == 200
    assert "PUT" in resposta.headers["access-control-allow-methods"]
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `.venv/Scripts/python.exe -m pytest tests/test_barreiras_api.py -v`
Expected: erro de coleta (`No module named 'app.routers.barreiras'`).

- [ ] **Step 4: Router público e com login**

`backend/app/routers/barreiras.py`:

```python
"""Rotas da camada colaborativa (spec 2026-11-02-colaborativo-design.md, 5.1 e 5.2).
Só validam e traduzem `ErroDominio`; a lógica está em `services/`."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.auth import UsuarioAtual, usuario_atual
from app.db import get_db
from app.schemas.barreira import BarreiraIn, BarreiraOut, VotoIn
from app.services import barreiras, fotos, votacao
from app.services.erros import ErroDominio
from app.services.fotos import TAMANHO_MAX_BYTES, ArmazenamentoFotos

router = APIRouter(prefix="/api", tags=["barreiras"])

MSG_INDISPONIVEL = "Serviço de barreiras indisponível no momento."


def obter_agora() -> datetime:
    return datetime.now(UTC)


def obter_armazenamento(request: Request) -> ArmazenamentoFotos | None:
    """O único armazenamento de fotos do processo, criado em `main.create_app`."""
    return request.app.state.armazenamento_fotos


@contextmanager
def transacao(db: Session) -> Iterator[None]:
    """Commit no sucesso; `ErroDominio` vira HTTP com a mensagem do domínio."""
    try:
        yield
    except ErroDominio as erro:
        db.rollback()
        raise HTTPException(status_code=erro.status_http, detail=str(erro)) from erro
    except OperationalError as erro:
        db.rollback()
        raise HTTPException(status_code=503, detail=MSG_INDISPONIVEL) from erro
    else:
        db.commit()


Db = Annotated[Session, Depends(get_db)]
Agora = Annotated[datetime, Depends(obter_agora)]
Usuario = Annotated[UsuarioAtual, Depends(usuario_atual)]
Armazenamento = Annotated[ArmazenamentoFotos | None, Depends(obter_armazenamento)]


@router.get("/barreiras", response_model=list[BarreiraOut])
def listar(
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    db: Db,
    agora: Agora,
    raio_m: Annotated[int, Query(ge=10, le=500)] = 200,
) -> list[BarreiraOut]:
    with transacao(db):
        return barreiras.listar_proximas(db, lat, lon, raio_m, agora)


@router.get("/barreiras/{barreira_id}", response_model=BarreiraOut)
def obter(barreira_id: int, db: Db, agora: Agora) -> BarreiraOut:
    with transacao(db):
        return barreiras.obter(db, barreira_id, agora)


@router.post("/barreiras", response_model=BarreiraOut, status_code=201)
def criar(
    entrada: BarreiraIn, response: Response, db: Db, agora: Agora, usuario: Usuario
) -> BarreiraOut:
    with transacao(db):
        barreira, criada = barreiras.criar(db, usuario, entrada, agora)
    if not criada:
        response.status_code = 200
    return barreira


@router.put("/barreiras/{barreira_id}/voto", response_model=BarreiraOut)
def votar(
    barreira_id: int, entrada: VotoIn, db: Db, agora: Agora, usuario: Usuario
) -> BarreiraOut:
    with transacao(db):
        return votacao.votar(db, usuario, barreira_id, entrada.voto, agora)


@router.post("/barreiras/{barreira_id}/foto", response_model=BarreiraOut)
def anexar_foto(
    barreira_id: int,
    arquivo: Annotated[UploadFile, File()],
    descricao: Annotated[str, Form()],
    db: Db,
    agora: Agora,
    usuario: Usuario,
    armazenamento: Armazenamento,
) -> BarreiraOut:
    conteudo = arquivo.file.read(TAMANHO_MAX_BYTES + 1)
    with transacao(db):
        return fotos.anexar_foto(
            db, usuario, barreira_id, conteudo, descricao, armazenamento, agora
        )


@router.delete("/barreiras/{barreira_id}/foto", response_model=BarreiraOut)
def remover_foto(
    barreira_id: int, db: Db, agora: Agora, usuario: Usuario, armazenamento: Armazenamento
) -> BarreiraOut:
    with transacao(db):
        return fotos.remover_foto(db, usuario, barreira_id, armazenamento, agora)
```

Nota: `return` dentro do `with transacao(db)` executa o `else: db.commit()` do gerenciador antes de devolver a resposta.

- [ ] **Step 5: Router de admin**

`backend/app/routers/admin.py`:

```python
"""Rotas de admin (spec 2026-11-02-colaborativo-design.md, 5.3)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth import UsuarioAtual, exigir_admin
from app.routers.barreiras import Agora, Db, transacao
from app.schemas.barreira import BarreiraOut, EventoOut, StatusAdminIn
from app.services import barreiras, votacao

router = APIRouter(prefix="/api/admin", tags=["admin"])

Admin = Annotated[UsuarioAtual, Depends(exigir_admin)]


@router.post("/barreiras/{barreira_id}/status", response_model=BarreiraOut)
def mudar_status(
    barreira_id: int, entrada: StatusAdminIn, db: Db, agora: Agora, admin: Admin
) -> BarreiraOut:
    with transacao(db):
        return votacao.mudar_status_admin(
            db, admin, barreira_id, entrada.status, entrada.motivo.strip(), agora
        )


@router.get("/barreiras/{barreira_id}/eventos", response_model=list[EventoOut])
def eventos(barreira_id: int, db: Db, admin: Admin) -> list[EventoOut]:
    with transacao(db):
        return barreiras.listar_eventos(db, barreira_id)
```

- [ ] **Step 6: `main.py`**

Em `backend/app/main.py`:
1. Imports: `from app.routers import admin, barreiras, fontes, geocode, health, rotas` e `from app.services.fotos import criar_armazenamento`.
2. Troque `allow_methods=["GET", "POST"]` por `allow_methods=["GET", "POST", "PUT", "DELETE"]`.
3. Depois de `app.state.config_auth = ...`:

```python
    # None sem SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY: upload de foto responde 503
    app.state.armazenamento_fotos = criar_armazenamento(
        settings.supabase_url, settings.supabase_service_role_key
    )
```

4. Depois de `app.include_router(geocode.router)`:

```python
    app.include_router(barreiras.router)
    app.include_router(admin.router)
```

- [ ] **Step 7: Rodar e ver passar**

Run: `.venv/Scripts/python.exe -m pytest tests/test_barreiras_api.py -v`
Expected: 15 passed (rode `ruff format` nos testes novos antes do lint).

Run: `.venv/Scripts/python.exe -m pytest -q ; .venv/Scripts/python.exe -m ruff check . ; .venv/Scripts/python.exe -m ruff format --check .`
Expected: tudo verde.

- [ ] **Step 8: Render**

Em `render.yaml`, no fim de `envVars`, no mesmo recuo das entradas existentes:

```yaml
      - key: SUPABASE_URL
        value: https://fiyuppcpbcdlnptqaigg.supabase.co
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
```

`SUPABASE_URL` é pública (a mesma que o frontend usa); a chave de serviço fica `sync: false` e é preenchida só no painel do Render.

- [ ] **Step 9: Tipos do frontend**

Suba a API em segundo plano (a partir de `backend/`): `.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000`. Em `frontend/`: `npm run gerar-tipos`, `npm run lint`, `npm test -- --run`, `npm run build`. Pare o uvicorn.
Expected: `types.gen.ts` ganha `/api/barreiras`, `/api/barreiras/{barreira_id}`, `/api/barreiras/{barreira_id}/voto`, `/api/barreiras/{barreira_id}/foto`, as duas rotas de admin e os schemas `BarreiraIn`, `BarreiraOut`, `VotoIn`, `StatusAdminIn`, `EventoOut`; lint, testes e build verdes.

- [ ] **Step 10: Commit (só com autorização do dono)**

```bash
git add backend/pyproject.toml backend/app/routers/barreiras.py backend/app/routers/admin.py backend/app/main.py backend/tests/conftest.py backend/tests/test_barreiras_api.py render.yaml frontend/src/api/types.gen.ts
git commit -m "feat(backend): rotas da camada colaborativa, CORS com PUT/DELETE e tipos regenerados"
```

---

### Task 9: "Cadastra e a rota muda" + documentação

**Files:**
- Test: `backend/tests/test_colaborativo_rota.py`
- Modify: `README.md`, `DATA-LICENSES.md`

**Interfaces:**
- Consumes: fixture `cliente_api`, `emitir_token`, `db_transacional` (Tasks 3 e 8); `barreira_geom.corredor`, `barreira_geom.barreiras_no_corredor`, `barreira_geom.poligonos_para_evitar`.
- Produces: o teste de aceite do Plano 6 e a documentação.

- [ ] **Step 1: Escrever o teste de aceite**

`backend/tests/test_colaborativo_rota.py`:

```python
"""Critério de saída do Plano 6: "usuário cadastra barreira e a rota muda".

Cadastro e votos pela API; o efeito na rota é verificado em
`barreira_geom` (o que o ORS recebe como `avoid_polygons`), sem chamar o ORS.
"""

import uuid

import pytest
from shapely.geometry import LineString

from app.services.barreira_geom import barreiras_no_corredor, corredor, poligonos_para_evitar

pytestmark = pytest.mark.integration

LON, LAT = -46.6350, -23.5900


def _auth(emitir_token, sub):
    return {"Authorization": f"Bearer {emitir_token(sub)}"}


def test_barreira_validada_por_dois_votos_entra_no_avoid_polygons(
    cliente_api, emitir_token, db_transacional
):
    faixa = corredor(LineString([(LON - 0.001, LAT), (LON + 0.001, LAT)]))

    def _nossa(barreira_id):
        return [
            b
            for b in barreiras_no_corredor(db_transacional, faixa)
            if b.origem == "colaborativa" and b.id == barreira_id
        ]

    criada = cliente_api.post(
        "/api/barreiras",
        json={
            "categoria": "escada",
            "lat": LAT,
            "lon": LON,
            "chave_idempotencia": str(uuid.uuid4()),
        },
        headers=_auth(emitir_token, uuid.uuid4()),
    ).json()
    assert _nossa(criada["id"]) == []  # pendente: a rota ainda não desvia

    for _ in range(2):
        voto = cliente_api.put(
            f"/api/barreiras/{criada['id']}/voto",
            json={"voto": "confirma"},
            headers=_auth(emitir_token, uuid.uuid4()),
        )
    assert voto.json()["status"] == "validada"

    nossa = _nossa(criada["id"])
    assert [b.severidade for b in nossa] == ["intransponivel"]
    rota = LineString([(LON - 0.001, LAT), (LON + 0.001, LAT)])
    assert poligonos_para_evitar(nossa, rota) is not None
```

- [ ] **Step 2: Rodar**

Run: `.venv/Scripts/python.exe -m pytest tests/test_colaborativo_rota.py -v`
Expected: 1 passed. (Este teste passa assim que as Tasks 1–8 estão prontas; ele é o aceite, não guia implementação nova. Se falhar, a falha aponta um defeito das tasks anteriores: investigue antes de mudar o teste.)

- [ ] **Step 3: README**

Em `README.md`, depois da seção `## Roteamento`, acrescente:

```markdown
## Geocode

`GET /api/geocode?q=` busca ruas, endereços com número e lugares com nome da área piloto (dados do OSM, sem serviço externo); `GET /api/geocode/reverso?lat=&lon=` devolve o endereço a até 50 m. Os dados vêm da etapa `enderecos` do ETL.

## Camada colaborativa

Login por código de 6 dígitos no e-mail (Supabase Auth); o backend confere o JWT pelo JWKS público do projeto.

- `GET /api/barreiras?lat=&lon=&raio_m=` e `GET /api/barreiras/{id}` — públicas, sem autor nem votantes.
- `POST /api/barreiras` — cadastra (idempotente pela `chave_idempotencia`; 20 por dia por pessoa).
- `PUT /api/barreiras/{id}/voto` — `confirma`, `contesta` ou `resolvida`; um voto por pessoa; o autor não vota.
- `POST`/`DELETE /api/barreiras/{id}/foto` — foto opcional com texto alternativo; reprocessada sem metadados.
- `POST /api/admin/barreiras/{id}/status` e `GET /api/admin/barreiras/{id}/eventos` — só admin.

Intransponível valida com 2 confirmações, dificulta com 1; 2 contestações ou 2 "resolvida" encerram. Pendente expira em 30 dias e validada em 180 dias sem confirmação. Promover admin: `python scripts/promover_admin.py --email <e-mail>` (em `backend/`, contra o Supabase). Gravar expirações: `python scripts/expirar.py`.
```

- [ ] **Step 4: DATA-LICENSES**

Em `DATA-LICENSES.md`, troque a linha das contribuições por:

```markdown
| Contribuições dos usuários | ODbL 1.0 (decisão de 10/09/2026) | Permite devolução futura ao OSM | `barreira_colaborativa`, `confirmacao`, `barreira_evento`, fotos no bucket `fotos-barreiras` |
```

e acrescente, depois da tabela, um parágrafo:

```markdown
A tabela `usuario` guarda só o id do Supabase e o papel (`colaborador`/`admin`); nenhum e-mail é copiado para o banco da aplicação. As respostas públicas não expõem autor nem votantes; as fotos são reprocessadas sem metadados (o GPS da câmera é descartado).
```

- [ ] **Step 5: Verificação final**

Run (em `backend/`): `.venv/Scripts/python.exe -m pytest -q ; .venv/Scripts/python.exe -m ruff check . ; .venv/Scripts/python.exe -m ruff format --check .`
Expected: suíte inteira verde e lint limpo. Anote o total.

- [ ] **Step 6: Commit (só com autorização do dono)**

```bash
git add backend/tests/test_colaborativo_rota.py README.md DATA-LICENSES.md
git commit -m "test(backend): barreira validada por votos muda a rota; docs da camada colaborativa"
```

---

### Task 10: Produção (só com ordem explícita do dono)

Nenhum passo sem o dono mandar.

- [ ] **Step 1:** Configurar SMTP próprio no Supabase Auth (ex.: Resend) e o template do e-mail com o código de 6 dígitos (`{{ .Token }}`).
- [ ] **Step 2:** Criar o bucket público `fotos-barreiras` no Supabase Storage.
- [ ] **Step 2a:** No Supabase Auth, confirmar que o login anônimo está **desligado** (o backend já recusa tokens com `is_anonymous`, mas é a primeira barreira) e que a confirmação de e-mail está ligada. As chaves de assinatura já são ES256 (JWKS conferido em 02/11/2026).
- [ ] **Step 2b:** Agendar `python scripts/expirar.py` uma vez por dia (cron do GitHub Actions com o secret `DATABASE_URL_PROD`, ou cron job do Render). Sem isso, rotas em cache podem seguir desviando de barreiras já vencidas até 6 h a mais.
- [ ] **Step 3:** Preencher `SUPABASE_SERVICE_ROLE_KEY` no painel do Render.
- [ ] **Step 4:** Publicar (merge/deploy aplica as migrations 006, 007 e 008) e rodar o ETL `tudo` em produção (geocode).
- [ ] **Step 5:** `caiorosa2006@gmail.com` entra uma vez pelo app; então, com `DATABASE_URL` de produção só neste comando: `python scripts/promover_admin.py --email caiorosa2006@gmail.com`.

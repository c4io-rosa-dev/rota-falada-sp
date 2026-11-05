# Geocodificação local (Plano 5a) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar `GET /api/geocode` (autocomplete por rua, rua + número e lugares com nome) e `GET /api/geocode/reverso` (endereço mais próximo de um ponto), 100% locais no PostGIS, alimentados por uma nova etapa de ETL `enderecos` a partir do OSM.

**Architecture:** Uma tabela `endereco` (migration 006) com índice GIN trigram em `texto_busca` e GiST em `geom`. A etapa de ETL `enderecos` lê `etl/dados/piloto.osm.pbf` com `osmium`, monta as linhas em Python (funções puras, testáveis sem banco) e carrega com `TRUNCATE` + `INSERT`. No backend, `app/services/geocode.py` faz as consultas SQL; `app/routers/geocode.py` só valida e traduz erros para HTTP. A normalização de texto vive em dois arquivos idênticos (backend e ETL), vigiados por um teste de paridade.

**Tech Stack:** Python 3.12+, FastAPI, SQLAlchemy 2 (`text()`), PostgreSQL/PostGIS + `pg_trgm`, Alembic, osmium-tool, shapely 2, pyproj, pytest.

**Spec:** `docs/superpowers/specs/2026-11-02-geocode-design.md` (aprovado em 02/11/2026). Em caso de dúvida, o spec manda.

## Global Constraints

- Aplicação 100% determinística: nenhuma chamada a IA nem a serviço externo na busca. Sem Photon, sem Nominatim.
- `endereco` só recebe dados do OpenStreetMap (ODbL), com `fonte_id` da linha `fonte_dados.chave = 'osm'`. Nunca copiar atributo do GeoSampa para ela.
- Nenhuma chave em arquivo versionado. **Nunca** exportar `DATABASE_URL_PROD` como `DATABASE_URL` em ambiente local.
- **Commits e pushes só quando o dono do repositório mandar.** Os passos "Commit" trazem a mensagem sugerida; antes de rodar `git commit`, peça autorização. Formato: português, `tipo(escopo): descrição`.
- Código e mensagens de erro em português; identificadores de domínio em português.
- `ruff check` e `ruff format --check` precisam passar no backend (linha de 100 colunas, regras E, F, I, B, UP).
- Todo passo que produz código começa por um teste falhando (TDD).
- Ambiente local: Docker Desktop aberto; banco em `localhost:5433` (`docker compose up -d db` na raiz). O PostgreSQL nativo na 5432 não é do projeto: não mexer.
- No PowerShell deste ambiente, comandos com `rm` ou com o texto `/*` são bloqueados; apague arquivos com `[System.IO.File]::Delete(...)` se precisar.

## Como rodar as coisas (vale para todas as tasks)

- Testes do backend (a partir de `backend/`): `.venv/Scripts/python.exe -m pytest <alvo> -v`
- Migrations do backend (a partir de `backend/`): `.venv/Scripts/python.exe -m alembic upgrade head`
- Lint do backend (a partir de `backend/`): `.venv/Scripts/python.exe -m ruff check . ; .venv/Scripts/python.exe -m ruff format --check .`
- Testes do ETL (a partir da raiz, dentro do container, que já tem osmium e geopandas): `docker compose --profile etl run --rm --entrypoint pytest etl <alvo> -v`. A pasta `etl/` é montada no container, então arquivos novos aparecem sem rebuild. Se a imagem não existir: `docker compose --profile etl build etl`.
- Rodar uma etapa do ETL (a partir da raiz): `docker compose --profile etl run --rm etl <etapa>`

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `backend/app/services/normalizacao.py` | criar | `normalizar()` e `separar_numero()` |
| `etl/etl/normalizacao.py` | criar | cópia byte a byte do arquivo acima |
| `backend/tests/normalizacao_casos.json` | criar | pares entrada → saída de `normalizar` |
| `etl/tests/normalizacao_casos.json` | criar | cópia byte a byte do arquivo acima |
| `backend/tests/test_normalizacao.py` | criar | testes de `normalizar` e `separar_numero` |
| `etl/tests/test_normalizacao.py` | criar | testes de `normalizar` do lado do ETL |
| `backend/tests/test_normalizacao_paridade.py` | criar | os dois módulos e os dois JSON são idênticos |
| `backend/alembic/versions/006_endereco.py` | criar | tabela `endereco`, índices, RLS |
| `backend/tests/test_migracao_endereco.py` | criar | testes da migration |
| `etl/etl/enderecos.py` | criar | etapa de ETL `enderecos` |
| `etl/tests/dados/enderecos_amostra.geojsonseq` | criar | fixture de GeoJSONSeq |
| `etl/tests/test_enderecos.py` | criar | testes das funções puras |
| `etl/etl/cli.py` | modificar | subcomando `enderecos` e posição em `tudo` |
| `etl/tests/test_cli_tudo.py` | modificar | `tudo` com seis etapas |
| `etl/tests/test_qualidade_dados.py` | modificar | qualidade de `endereco` |
| `backend/app/schemas/geocode.py` | criar | `EnderecoOut` |
| `backend/app/services/geocode.py` | criar | `buscar()`, `reverso()`, `ReversoNaoEncontrado` |
| `backend/tests/conftest.py` | modificar | fixtures `db_geocode`, `semear_endereco`, `area_teste`, `deslocar` |
| `backend/tests/test_geocode_busca.py` | criar | testes de `buscar()` |
| `backend/tests/test_geocode_reverso.py` | criar | testes de `reverso()` |
| `backend/app/routers/geocode.py` | criar | rotas HTTP |
| `backend/app/main.py` | modificar | registra o router |
| `backend/tests/test_geocode_api.py` | criar | contrato HTTP |
| `frontend/src/api/types.gen.ts` | regenerar | tipos do OpenAPI |
| `backend/tests/test_geocode_dados_reais.py` | criar | casos reais e latência p95 |
| `etl/README.md`, `docs/README.md` | modificar | documentação da etapa e do plano |

---

### Task 1: Normalização de texto (backend + ETL + paridade)

**Files:**
- Create: `backend/app/services/normalizacao.py`
- Create: `etl/etl/normalizacao.py` (cópia byte a byte)
- Create: `backend/tests/normalizacao_casos.json`
- Create: `etl/tests/normalizacao_casos.json` (cópia byte a byte)
- Test: `backend/tests/test_normalizacao.py`, `etl/tests/test_normalizacao.py`, `backend/tests/test_normalizacao_paridade.py`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `normalizar(texto: str) -> str`: minúsculo, sem acento, só `[a-z0-9]` separados por um espaço, abreviações expandidas. Pode devolver `""`.
  - `separar_numero(texto_normalizado: str) -> tuple[str, str | None]`: `("rua vergueiro", "1000")` ou `(texto, None)`. O número pode ter uma letra no fim (`"1000a"`).
  - `ABREVIACOES: dict[str, str]`.

- [ ] **Step 1: Escrever o arquivo de casos**

`backend/tests/normalizacao_casos.json`:

```json
[
  {"entrada": "Rua Vergueiro", "saida": "rua vergueiro"},
  {"entrada": "R. Vergueiro, 1000", "saida": "rua vergueiro 1000"},
  {"entrada": "Av. Brigadeiro Luís Antônio", "saida": "avenida brigadeiro luis antonio"},
  {"entrada": "AVN. PAULISTA", "saida": "avenida paulista"},
  {"entrada": "Pça. da Árvore", "saida": "praca da arvore"},
  {"entrada": "Al. Santos", "saida": "alameda santos"},
  {"entrada": "Estação Vila Mariana", "saida": "estacao vila mariana"},
  {"entrada": "Est. Vila Mariana", "saida": "est vila mariana"},
  {"entrada": "  FATEC   Ipiranga  ", "saida": "fatec ipiranga"},
  {"entrada": "Rua Dr. Cesário Mota Jr.", "saida": "rua doutor cesario mota jr"},
  {"entrada": "Av. Prof. Abraão de Morais", "saida": "avenida professor abraao de morais"},
  {"entrada": "Rua Cel. Lisboa", "saida": "rua coronel lisboa"},
  {"entrada": "Tv. São Joaquim", "saida": "travessa sao joaquim"},
  {"entrada": "Lgo. São Bento", "saida": "largo sao bento"},
  {"entrada": "Vd. do Chá", "saida": "viaduto do cha"},
  {"entrada": "Rua Sta. Cruz", "saida": "rua santa cruz"},
  {"entrada": "Gen. Jardim", "saida": "general jardim"},
  {"entrada": "Rua 25 de Março", "saida": "rua 25 de marco"},
  {"entrada": "Rua Vergueiro, 1000-A", "saida": "rua vergueiro 1000 a"},
  {"entrada": "Rua Barão de Iguape", "saida": "rua barao de iguape"},
  {"entrada": "!!!", "saida": ""}
]
```

Copie o arquivo, sem alterar nada, para `etl/tests/normalizacao_casos.json`:

```powershell
Copy-Item backend/tests/normalizacao_casos.json etl/tests/normalizacao_casos.json
```

- [ ] **Step 2: Escrever os testes do backend**

`backend/tests/test_normalizacao.py`:

```python
"""Testes de `normalizar` e `separar_numero` (spec 2026-11-02-geocode-design.md, 3.3)."""

import json
from pathlib import Path

import pytest

from app.services.normalizacao import normalizar, separar_numero

_CASOS = json.loads(
    (Path(__file__).parent / "normalizacao_casos.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("caso", _CASOS, ids=[c["entrada"] for c in _CASOS])
def test_normalizar(caso):
    assert normalizar(caso["entrada"]) == caso["saida"]


@pytest.mark.parametrize(
    ("texto", "esperado"),
    [
        ("rua vergueiro 1000", ("rua vergueiro", "1000")),
        ("rua vergueiro 1000a", ("rua vergueiro", "1000a")),
        ("rua vergueiro 1000 a", ("rua vergueiro", "1000a")),
        ("avenida 23 de maio 500", ("avenida 23 de maio", "500")),
        ("rua 25 de marco", ("rua 25 de marco", None)),
        ("rua vergueiro", ("rua vergueiro", None)),
        ("1000", ("1000", None)),
        ("", ("", None)),
    ],
)
def test_separar_numero(texto, esperado):
    assert separar_numero(texto) == esperado
```

- [ ] **Step 3: Rodar e ver falhar**

Run (em `backend/`): `.venv/Scripts/python.exe -m pytest tests/test_normalizacao.py -v`
Expected: erro de coleta `ModuleNotFoundError: No module named 'app.services.normalizacao'`.

- [ ] **Step 4: Implementar**

`backend/app/services/normalizacao.py`:

```python
"""Normalização de texto da busca de endereços (spec 2026-11-02-geocode-design.md, 3.3).

Este arquivo existe em dois lugares com conteúdo IDÊNTICO, byte a byte:
`backend/app/services/normalizacao.py` e `etl/etl/normalizacao.py` (a imagem
Docker do ETL só copia `etl/`). O ETL grava `endereco.texto_busca` com
`normalizar` e o backend normaliza o texto digitado com a mesma função; se as
duas cópias divergirem, a busca deixa de casar.
`backend/tests/test_normalizacao_paridade.py` falha se os arquivos diferirem.
"""

import re
import unicodedata

# Só a palavra inteira é trocada. `est` fica de fora de propósito: é ambíguo
# entre "estrada" e "estação", e sem expansão "est vila mariana" ainda casa
# por prefixo com "estacao vila mariana".
ABREVIACOES: dict[str, str] = {
    "r": "rua",
    "av": "avenida",
    "avn": "avenida",
    "al": "alameda",
    "pca": "praca",
    "pc": "praca",
    "tv": "travessa",
    "trav": "travessa",
    "vd": "viaduto",
    "lgo": "largo",
    "dr": "doutor",
    "prof": "professor",
    "sto": "santo",
    "sta": "santa",
    "cel": "coronel",
    "gal": "general",
    "gen": "general",
}

_NAO_ALFANUMERICO = re.compile(r"[^a-z0-9]+")
_NUMERO_FINAL = re.compile(r"^(.*\S)\s+(\d+)(?:\s?([a-z]))?$")


def normalizar(texto: str) -> str:
    """Minúsculas, sem acento, só letras e dígitos separados por um espaço,
    abreviações de logradouro e de título expandidas."""
    decomposto = unicodedata.normalize("NFKD", texto.lower())
    sem_acento = "".join(c for c in decomposto if not unicodedata.combining(c))
    palavras = _NAO_ALFANUMERICO.sub(" ", sem_acento).split()
    return " ".join(ABREVIACOES.get(palavra, palavra) for palavra in palavras)


def separar_numero(texto_normalizado: str) -> tuple[str, str | None]:
    """Separa o número do fim do texto já normalizado.

    "rua vergueiro 1000" -> ("rua vergueiro", "1000");
    "rua vergueiro 1000 a" -> ("rua vergueiro", "1000a");
    sem número no fim (ou só o número) -> (texto, None).
    """
    casamento = _NUMERO_FINAL.match(texto_normalizado)
    if casamento is None:
        return texto_normalizado, None
    rua, digitos, letra = casamento.groups()
    return rua, digitos + (letra or "")
```

- [ ] **Step 5: Rodar e ver passar**

Run (em `backend/`): `.venv/Scripts/python.exe -m pytest tests/test_normalizacao.py -v`
Expected: 29 passed (21 de `normalizar` + 8 de `separar_numero`).

- [ ] **Step 6: Copiar o módulo para o ETL e escrever o teste do ETL**

```powershell
Copy-Item backend/app/services/normalizacao.py etl/etl/normalizacao.py
```

`etl/tests/test_normalizacao.py`:

```python
"""Mesmos casos de `backend/tests/test_normalizacao.py`, do lado do ETL (o
ETL grava `endereco.texto_busca` com esta função)."""

import json
from pathlib import Path

import pytest

from etl.normalizacao import normalizar

_CASOS = json.loads(
    (Path(__file__).parent / "normalizacao_casos.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("caso", _CASOS, ids=[c["entrada"] for c in _CASOS])
def test_normalizar(caso):
    assert normalizar(caso["entrada"]) == caso["saida"]
```

Run (na raiz): `docker compose --profile etl run --rm --entrypoint pytest etl tests/test_normalizacao.py -v`
Expected: 21 passed.

- [ ] **Step 7: Teste de paridade (falha primeiro)**

`backend/tests/test_normalizacao_paridade.py`:

```python
"""As duas cópias da normalização (backend e ETL) e os dois arquivos de casos
precisam ser idênticos byte a byte: o ETL grava `texto_busca` com uma cópia e
o backend busca com a outra."""

from pathlib import Path

_RAIZ = Path(__file__).resolve().parents[2]


def _bytes(caminho_relativo: str) -> bytes:
    return (_RAIZ / caminho_relativo).read_bytes()


def test_modulos_de_normalizacao_identicos():
    assert _bytes("backend/app/services/normalizacao.py") == _bytes(
        "etl/etl/normalizacao.py"
    ), "etl/etl/normalizacao.py divergiu: copie backend/app/services/normalizacao.py por cima"


def test_casos_de_normalizacao_identicos():
    assert _bytes("backend/tests/normalizacao_casos.json") == _bytes(
        "etl/tests/normalizacao_casos.json"
    ), "etl/tests/normalizacao_casos.json divergiu do arquivo do backend"
```

Para provar que o teste pega divergência: acrescente temporariamente uma linha em branco no fim de `etl/etl/normalizacao.py` e rode:

Run (em `backend/`): `.venv/Scripts/python.exe -m pytest tests/test_normalizacao_paridade.py -v`
Expected: `test_modulos_de_normalizacao_identicos` FAIL.

Desfaça a mudança (`Copy-Item backend/app/services/normalizacao.py etl/etl/normalizacao.py`) e rode de novo.
Expected: 2 passed.

- [ ] **Step 8: Lint**

Run (em `backend/`): `.venv/Scripts/python.exe -m ruff check . ; .venv/Scripts/python.exe -m ruff format --check .`
Expected: sem erros. Se `ruff format` reformatar `normalizacao.py`, copie de novo para o ETL.

- [ ] **Step 9: Commit (só com autorização do dono)**

```bash
git add backend/app/services/normalizacao.py etl/etl/normalizacao.py backend/tests/normalizacao_casos.json etl/tests/normalizacao_casos.json backend/tests/test_normalizacao.py etl/tests/test_normalizacao.py backend/tests/test_normalizacao_paridade.py
git commit -m "feat(geocode): normalização de texto compartilhada entre backend e ETL"
```

---

### Task 2: Migration 006 — tabela `endereco`

**Files:**
- Create: `backend/alembic/versions/006_endereco.py`
- Test: `backend/tests/test_migracao_endereco.py`

**Interfaces:**
- Consumes: `fonte_dados` (001), extensão `pg_trgm` (001).
- Produces: tabela `endereco` com as colunas `id, tipo, rotulo, logradouro, numero, numero_int, categoria, texto_busca, geom, osm_tipo, osm_id, fonte_id, data_referencia`; índices `endereco_texto_busca_trgm_idx` (GIN trigram), `endereco_geom_idx` (GiST), `endereco_logradouro_numero_idx`; RLS ligado.

- [ ] **Step 1: Escrever o teste**

`backend/tests/test_migracao_endereco.py`:

```python
"""Migration 006: tabela `endereco` do geocode local (spec 2026-11-02, 3.1)."""

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


def test_endereco_tem_os_indices_esperados(db):
    nomes = {
        linha[0]
        for linha in db.execute(
            text("SELECT indexname FROM pg_indexes WHERE tablename = 'endereco'")
        )
    }
    assert {
        "endereco_pkey",
        "endereco_texto_busca_trgm_idx",
        "endereco_geom_idx",
        "endereco_logradouro_numero_idx",
    } <= nomes


def test_indice_de_texto_e_gin_trigram(db):
    definicao = db.execute(
        text(
            "SELECT indexdef FROM pg_indexes "
            "WHERE indexname = 'endereco_texto_busca_trgm_idx'"
        )
    ).scalar_one()
    assert "USING gin" in definicao
    assert "gin_trgm_ops" in definicao


def test_endereco_tem_rls_ligado(db):
    ligado = db.execute(
        text("SELECT relrowsecurity FROM pg_class WHERE relname = 'endereco'")
    ).scalar_one()
    assert ligado is True


_INSERIR = text(
    "INSERT INTO endereco (tipo, rotulo, texto_busca, geom, fonte_id, data_referencia) "
    "VALUES (:tipo, :rotulo, :texto_busca, ST_SetSRID(ST_MakePoint(-46.63, -23.59), 4326), "
    "(SELECT id FROM fonte_dados WHERE chave = 'osm'), CURRENT_DATE)"
)


def test_endereco_aceita_linha_valida(db):
    db.execute(
        _INSERIR,
        {"tipo": "endereco", "rotulo": "Rua X, 1 · Lapa", "texto_busca": "rua x 1"},
    )


@pytest.mark.parametrize(
    ("tipo", "rotulo", "texto_busca"),
    [
        ("bairro", "Rua X · Lapa", "rua x"),
        ("endereco", "   ", "rua x"),
        ("endereco", "Rua X · Lapa", ""),
    ],
    ids=["tipo-fora-do-dominio", "rotulo-em-branco", "texto-busca-vazio"],
)
def test_endereco_rejeita_linha_invalida(db, tipo, rotulo, texto_busca):
    with pytest.raises(DBAPIError):
        db.execute(_INSERIR, {"tipo": tipo, "rotulo": rotulo, "texto_busca": texto_busca})
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `backend/`, com `docker compose up -d db` feito na raiz): `.venv/Scripts/python.exe -m pytest tests/test_migracao_endereco.py -v`
Expected: FAIL; as consultas não acham a tabela (`relation "endereco" does not exist` ou `NoResultFound`).

- [ ] **Step 3: Escrever a migration**

`backend/alembic/versions/006_endereco.py`:

```python
"""endereco: geocode local (ruas, endereços numerados e lugares do OSM)

Spec: docs/superpowers/specs/2026-11-02-geocode-design.md, seção 3.1.
Só dados do OpenStreetMap (ODbL). RLS ligado na criação, como as demais
tabelas desde a 005 (só o backend, dono do banco, acessa).

Revision ID: 006_endereco
Revises: 005_rls
Create Date: 2026-11-02
"""

from alembic import op

revision = "006_endereco"
down_revision = "005_rls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE endereco (
          id bigserial PRIMARY KEY,
          tipo text NOT NULL CHECK (tipo IN ('logradouro','endereco','lugar')),
          rotulo text NOT NULL CHECK (length(btrim(rotulo)) > 0),
          logradouro text,
          numero text,
          numero_int integer,
          categoria text,
          texto_busca text NOT NULL CHECK (length(texto_busca) > 0),
          geom geometry(Point, 4326) NOT NULL,
          osm_tipo char(1) CHECK (osm_tipo IN ('n','w','r')),
          osm_id bigint,
          fonte_id integer NOT NULL REFERENCES fonte_dados(id),
          data_referencia date NOT NULL
        );
        CREATE INDEX endereco_texto_busca_trgm_idx
          ON endereco USING GIN (texto_busca gin_trgm_ops);
        CREATE INDEX endereco_geom_idx ON endereco USING GIST (geom);
        CREATE INDEX endereco_logradouro_numero_idx ON endereco (logradouro, numero_int);
        ALTER TABLE endereco ENABLE ROW LEVEL SECURITY;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE endereco")
```

- [ ] **Step 4: Aplicar e ver passar**

Run (em `backend/`): `.venv/Scripts/python.exe -m alembic upgrade head`
Expected: `Running upgrade 005_rls -> 006_endereco`.

Run: `.venv/Scripts/python.exe -m pytest tests/test_migracao_endereco.py -v`
Expected: 7 passed.

- [ ] **Step 5: Ida e volta da migration**

Run: `.venv/Scripts/python.exe -m alembic downgrade 005_rls ; .venv/Scripts/python.exe -m alembic upgrade head`
Expected: as duas sem erro.

- [ ] **Step 6: Commit (só com autorização do dono)**

```bash
git add backend/alembic/versions/006_endereco.py backend/tests/test_migracao_endereco.py
git commit -m "feat(backend): migration 006 cria endereco com índices trigram e espacial"
```

---

### Task 3: ETL `enderecos`, parte 1 — transformação pura

**Files:**
- Create: `etl/etl/enderecos.py` (só as funções puras nesta task)
- Create: `etl/tests/dados/enderecos_amostra.geojsonseq`
- Test: `etl/tests/test_enderecos.py`

**Interfaces:**
- Consumes: `etl.normalizacao.normalizar` (Task 1); `etl.config.AREA_PILOTO`.
- Produces (em `etl/etl/enderecos.py`):
  - `@dataclass(frozen=True) class Registro` com os campos `tipo, rotulo, logradouro, numero, numero_int, categoria, texto_busca, lon, lat, osm_tipo, osm_id`, nessa ordem.
  - `bairro_de(lon: float, lat: float) -> str | None`
  - `numero_inteiro(numero: str | None) -> int | None`
  - `ler_geojsonseq(caminho: Path) -> Iterator[dict]`
  - `registro_de_feature(feature: dict) -> Registro | None`
  - `deduplicar(registros: Iterable[Registro]) -> list[Registro]`
  - `registros_logradouro(linhas: Iterable[tuple[str, str, float, float]]) -> list[Registro]`
  - Constantes `CHAVES_LUGAR`, `RAIO_DEDUPLICACAO_M = 15.0`.

- [ ] **Step 1: Escrever a fixture**

`etl/tests/dados/enderecos_amostra.geojsonseq`: uma feature por linha. A primeira linha começa com o caractere separador de registro (`\x1e`), para provar que a leitura o ignora. Escreva o arquivo com este script, a partir da raiz:

```powershell
@'
import json
from pathlib import Path

features = [
    # 1. endereço na Vila Mariana
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-46.635, -23.59]},
     "properties": {"@type": "node", "@id": 101, "addr:street": "Rua Vergueiro",
                    "addr:housenumber": "3000"}},
    # 2. lugar como polígono, com endereço, no Ipiranga
    {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[
        [-46.6001, -23.5901], [-46.5999, -23.5901], [-46.5999, -23.5899],
        [-46.6001, -23.5899], [-46.6001, -23.5901]]]},
     "properties": {"@type": "way", "@id": 202, "name": "Fatec Ipiranga",
                    "amenity": "college", "addr:street": "Rua Frei João",
                    "addr:housenumber": "59"}},
    # 3. lugar sem endereço, na Lapa
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-46.70, -23.53]},
     "properties": {"@type": "node", "@id": 303, "name": "Estação Lapa",
                    "railway": "station"}},
    # 4. endereço fora da área piloto
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-46.50, -23.50]},
     "properties": {"@type": "node", "@id": 404, "addr:street": "Rua Longe",
                    "addr:housenumber": "1"}},
    # 5. via com nome, sem endereço e sem categoria de lugar
    {"type": "Feature", "geometry": {"type": "LineString", "coordinates": [
        [-46.640, -23.59], [-46.639, -23.59]]},
     "properties": {"@type": "way", "@id": 505, "name": "Rua Qualquer",
                    "highway": "residential"}},
    # 6. duplicata do 1, a ~4 m
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-46.635, -23.59004]},
     "properties": {"@type": "node", "@id": 104, "addr:street": "Rua Vergueiro",
                    "addr:housenumber": "3000"}},
    # 7. ponto na sobreposição Vila Mariana x Ipiranga
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-46.620, -23.59]},
     "properties": {"@type": "node", "@id": 707, "addr:street": "Rua Sorocabanos",
                    "addr:housenumber": "10"}},
    # 8. mesmo texto do 1, a ~200 m: não é duplicata
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-46.635, -23.5918]},
     "properties": {"@type": "node", "@id": 105, "addr:street": "Rua Vergueiro",
                    "addr:housenumber": "3000"}},
    # 9. número sem rua
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-46.635, -23.60]},
     "properties": {"@type": "node", "@id": 909, "addr:housenumber": "12"}},
]
linhas = [json.dumps(f, ensure_ascii=False) for f in features]
linhas[0] = "\x1e" + linhas[0]
Path("etl/tests/dados").mkdir(exist_ok=True)
Path("etl/tests/dados/enderecos_amostra.geojsonseq").write_text(
    "\n".join(linhas) + "\n", encoding="utf-8"
)
'@ | python -
```

- [ ] **Step 2: Escrever os testes**

`etl/tests/test_enderecos.py`:

```python
"""Funções puras da etapa `enderecos` (spec 2026-11-02-geocode-design.md, 3.2).
Rodam sem banco e sem osmium, sobre `tests/dados/enderecos_amostra.geojsonseq`."""

from pathlib import Path

import pytest
from shapely.geometry import Point, shape

from etl.enderecos import (
    Registro,
    bairro_de,
    deduplicar,
    ler_geojsonseq,
    numero_inteiro,
    registro_de_feature,
    registros_logradouro,
)

_AMOSTRA = Path(__file__).parent / "dados" / "enderecos_amostra.geojsonseq"


@pytest.fixture(scope="module")
def features() -> dict[int, dict]:
    return {f["properties"]["@id"]: f for f in ler_geojsonseq(_AMOSTRA)}


def test_ler_geojsonseq_le_todas_as_linhas_e_ignora_separador(features):
    assert sorted(features) == [101, 104, 105, 202, 303, 404, 505, 707, 909]


def test_registro_de_endereco(features):
    registro = registro_de_feature(features[101])
    assert registro == Registro(
        tipo="endereco",
        rotulo="Rua Vergueiro, 3000 · Vila Mariana",
        logradouro="Rua Vergueiro",
        numero="3000",
        numero_int=3000,
        categoria=None,
        texto_busca="rua vergueiro 3000",
        lon=-46.635,
        lat=-23.59,
        osm_tipo="n",
        osm_id=101,
    )


def test_registro_de_lugar_em_poligono_vira_ponto_dentro_dele(features):
    registro = registro_de_feature(features[202])
    assert registro.tipo == "lugar"
    assert registro.rotulo == "Fatec Ipiranga — Rua Frei João, 59 · Ipiranga"
    assert registro.texto_busca == "fatec ipiranga rua frei joao 59"
    assert registro.categoria == "college"
    assert (registro.osm_tipo, registro.osm_id) == ("w", 202)
    poligono = shape(features[202]["geometry"])
    assert poligono.contains(Point(registro.lon, registro.lat))


def test_registro_de_lugar_sem_endereco(features):
    registro = registro_de_feature(features[303])
    assert registro.tipo == "lugar"
    assert registro.rotulo == "Estação Lapa · Lapa"
    assert registro.texto_busca == "estacao lapa"
    assert registro.logradouro is None
    assert registro.numero is None


@pytest.mark.parametrize("osm_id", [404, 505, 909], ids=["fora-da-area", "via-sem-dados", "sem-rua"])
def test_registro_descartado(features, osm_id):
    assert registro_de_feature(features[osm_id]) is None


def test_bairro_na_sobreposicao_e_o_primeiro_da_area_piloto(features):
    assert registro_de_feature(features[707]).rotulo == "Rua Sorocabanos, 10 · Vila Mariana"
    assert bairro_de(-46.620, -23.59) == "Vila Mariana"
    assert bairro_de(-46.60, -23.59) == "Ipiranga"
    assert bairro_de(-46.50, -23.50) is None


def test_deduplicar_remove_mesmo_texto_a_menos_de_15_m_e_mantem_o_menor_osm_id(features):
    registros = [registro_de_feature(features[i]) for i in (105, 101, 104)]
    mantidos = deduplicar(registros)
    assert sorted(r.osm_id for r in mantidos) == [101, 105]


def test_deduplicar_remove_mesmo_objeto_osm_repetido(features):
    registro = registro_de_feature(features[101])
    assert deduplicar([registro, registro]) == [registro]


@pytest.mark.parametrize(
    ("numero", "esperado"),
    [("1000", 1000), ("1000A", 1000), ("1000-A", 1000), ("s/n", None),
     ("1234567890", None), ("", None), (None, None)],
)
def test_numero_inteiro(numero, esperado):
    assert numero_inteiro(numero) == esperado


def test_registros_logradouro():
    registros = registros_logradouro(
        [
            ("Rua Vergueiro", "Vila Mariana", -46.63, -23.58),
            ("   ", "Lapa", -46.70, -23.53),
            ("Rua Fora", "Lapa", -46.50, -23.50),
        ]
    )
    assert registros == [
        Registro(
            tipo="logradouro",
            rotulo="Rua Vergueiro · Vila Mariana",
            logradouro="Rua Vergueiro",
            numero=None,
            numero_int=None,
            categoria=None,
            texto_busca="rua vergueiro",
            lon=-46.63,
            lat=-23.58,
            osm_tipo=None,
            osm_id=None,
        )
    ]
```

- [ ] **Step 3: Rodar e ver falhar**

Run (na raiz): `docker compose --profile etl run --rm --entrypoint pytest etl tests/test_enderecos.py -v`
Expected: erro de coleta `ModuleNotFoundError: No module named 'etl.enderecos'`.

- [ ] **Step 4: Implementar as funções puras**

`etl/etl/enderecos.py`:

```python
"""ETL de endereços e lugares do OSM para `endereco` (spec
docs/superpowers/specs/2026-11-02-geocode-design.md, seção 3).

Lê `dados/piloto.osm.pbf` (gerado pela etapa `osm`), filtra com `osmium
tags-filter`, exporta para GeoJSONSeq com `osmium export` e monta em Python
uma linha por endereço numerado ou lugar com nome dentro da área piloto. As
linhas `logradouro` (uma por nome de via e bairro) vêm de `via_pedestre`, já
carregada pela etapa `osm`. Fonte única: OpenStreetMap (ODbL).
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import shape

from etl.config import AREA_PILOTO
from etl.normalizacao import normalizar

# chaves OSM que fazem de um objeto com `name` um "lugar" buscável
CHAVES_LUGAR = (
    "amenity",
    "railway",
    "public_transport",
    "shop",
    "leisure",
    "tourism",
    "office",
    "healthcare",
)
RAIO_DEDUPLICACAO_M = 15.0
_MAX_DIGITOS_NUMERO = 9  # cabe em `integer`
_DIGITOS_INICIAIS = re.compile(r"\s*(\d+)")
_PARA_31983 = Transformer.from_crs("EPSG:4326", "EPSG:31983", always_xy=True)


@dataclass(frozen=True)
class Registro:
    tipo: str
    rotulo: str
    logradouro: str | None
    numero: str | None
    numero_int: int | None
    categoria: str | None
    texto_busca: str
    lon: float
    lat: float
    osm_tipo: str | None
    osm_id: int | None


def bairro_de(lon: float, lat: float) -> str | None:
    """Nome da área piloto que contém o ponto (borda inclusive). Na
    sobreposição (Vila Mariana x Ipiranga), vence a primeira de `AREA_PILOTO`,
    que é a mesma ordem dos ids de `area_piloto` (migration 002)."""
    for nome, (oeste, sul, leste, norte) in AREA_PILOTO.items():
        if oeste <= lon <= leste and sul <= lat <= norte:
            return nome
    return None


def numero_inteiro(numero: str | None) -> int | None:
    """Parte numérica inicial de `addr:housenumber` ("1000-A" -> 1000)."""
    if not numero:
        return None
    casamento = _DIGITOS_INICIAIS.match(numero)
    if casamento is None or len(casamento.group(1)) > _MAX_DIGITOS_NUMERO:
        return None
    return int(casamento.group(1))


def ler_geojsonseq(caminho: Path) -> Iterator[dict]:
    """Uma feature por linha; tolera o separador de registro (0x1E) do RFC 8142."""
    with caminho.open(encoding="utf-8") as arquivo:
        for linha in arquivo:
            linha = linha.strip().lstrip("\x1e").strip()
            if linha:
                yield json.loads(linha)


def _texto(propriedades: dict, chave: str) -> str | None:
    valor = propriedades.get(chave)
    if valor is None:
        return None
    valor = str(valor).strip()
    return valor or None


def _ref_osm(propriedades: dict) -> tuple[str | None, int | None]:
    tipo = str(propriedades.get("@type", ""))[:1].lower()
    identificador = propriedades.get("@id")
    return (
        tipo if tipo in ("n", "w", "r") else None,
        int(identificador) if identificador is not None else None,
    )


def registro_de_feature(feature: dict) -> Registro | None:
    """Endereço numerado (`addr:street` + `addr:housenumber`) ou lugar
    (`name` + uma das `CHAVES_LUGAR`) dentro da área piloto; senão `None`.
    Polígonos viram um ponto garantidamente dentro deles."""
    geometria = feature.get("geometry")
    if not geometria:
        return None
    geom = shape(geometria)
    if geom.is_empty:
        return None
    ponto = geom if geom.geom_type == "Point" else geom.representative_point()
    bairro = bairro_de(ponto.x, ponto.y)
    if bairro is None:
        return None

    propriedades = feature.get("properties") or {}
    rua = _texto(propriedades, "addr:street")
    numero = _texto(propriedades, "addr:housenumber")
    nome = _texto(propriedades, "name")
    categoria = next(
        (_texto(propriedades, c) for c in CHAVES_LUGAR if _texto(propriedades, c)), None
    )
    endereco = f"{rua}, {numero}" if rua and numero else None

    if nome and categoria:
        tipo = "lugar"
        base = f"{nome} — {endereco}" if endereco else nome
    elif endereco:
        tipo = "endereco"
        base = endereco
        categoria = None
    else:
        return None

    texto_busca = normalizar(base)
    if not texto_busca:
        return None
    osm_tipo, osm_id = _ref_osm(propriedades)
    return Registro(
        tipo=tipo,
        rotulo=f"{base} · {bairro}",
        logradouro=rua,
        numero=numero,
        numero_int=numero_inteiro(numero),
        categoria=categoria,
        texto_busca=texto_busca,
        lon=ponto.x,
        lat=ponto.y,
        osm_tipo=osm_tipo,
        osm_id=osm_id,
    )


def deduplicar(registros: Iterable[Registro]) -> list[Registro]:
    """1) Cada objeto OSM entra uma vez só. 2) Mesmo `tipo` e `texto_busca` a
    menos de `RAIO_DEDUPLICACAO_M`: fica o de menor `osm_id`. Saída em ordem
    estável (tipo, texto_busca, osm_id)."""
    vistos: set[tuple[str | None, int]] = set()
    unicos: list[Registro] = []
    for registro in registros:
        if registro.osm_id is not None:
            chave = (registro.osm_tipo, registro.osm_id)
            if chave in vistos:
                continue
            vistos.add(chave)
        unicos.append(registro)

    grupos: dict[tuple[str, str], list[Registro]] = {}
    for registro in sorted(unicos, key=lambda r: (r.osm_id is None, r.osm_id or 0)):
        grupos.setdefault((registro.tipo, registro.texto_busca), []).append(registro)

    raio2 = RAIO_DEDUPLICACAO_M**2
    mantidos: list[Registro] = []
    for grupo in grupos.values():
        pontos: list[tuple[float, float]] = []
        for registro in grupo:
            x, y = _PARA_31983.transform(registro.lon, registro.lat)
            if any((x - px) ** 2 + (y - py) ** 2 < raio2 for px, py in pontos):
                continue
            pontos.append((x, y))
            mantidos.append(registro)
    return sorted(mantidos, key=lambda r: (r.tipo, r.texto_busca, r.osm_id or 0))


def registros_logradouro(linhas: Iterable[tuple[str, str, float, float]]) -> list[Registro]:
    """Uma linha `logradouro` por (nome, bairro, lon, lat) vindo de
    `SQL_LOGRADOUROS`. Descarta nome vazio e ponto fora da área piloto."""
    resultado: list[Registro] = []
    for nome, bairro, lon, lat in linhas:
        nome = nome.strip()
        texto_busca = normalizar(nome)
        if not texto_busca or bairro_de(lon, lat) is None:
            continue
        resultado.append(
            Registro(
                tipo="logradouro",
                rotulo=f"{nome} · {bairro}",
                logradouro=nome,
                numero=None,
                numero_int=None,
                categoria=None,
                texto_busca=texto_busca,
                lon=lon,
                lat=lat,
                osm_tipo=None,
                osm_id=None,
            )
        )
    return resultado
```

- [ ] **Step 5: Rodar e ver passar**

Run (na raiz): `docker compose --profile etl run --rm --entrypoint pytest etl tests/test_enderecos.py -v`
Expected: 18 passed.

- [ ] **Step 6: Commit (só com autorização do dono)**

```bash
git add etl/etl/enderecos.py etl/tests/test_enderecos.py etl/tests/dados/enderecos_amostra.geojsonseq
git commit -m "etl: transformação de endereços e lugares do OSM para a tabela endereco"
```

---

### Task 4: ETL `enderecos`, parte 2 — execução, CLI e qualidade

**Files:**
- Modify: `etl/etl/enderecos.py` (acrescenta execução e carga)
- Modify: `etl/etl/cli.py`
- Modify: `etl/tests/test_cli_tudo.py`
- Modify: `etl/tests/test_qualidade_dados.py`

**Interfaces:**
- Consumes: funções da Task 3; tabela `endereco` (Task 2); `etl.db.registrar_execucao`, `concluir_execucao`, `fonte_id`.
- Produces: `etl.enderecos.executar(engine) -> dict` (`{"endereco": n, "lugar": n, "logradouro": n}`); subcomando `python -m etl.cli enderecos`; `tudo` na ordem `osm → enderecos → geosampa → sp156 → gtfs → conflacao`.

- [ ] **Step 1: Atualizar o teste do orquestrador (falha primeiro)**

Em `etl/tests/test_cli_tudo.py`:

1. No docstring do módulo, troque "rodar as cinco em sequência (osm, geosampa, sp156, gtfs e, por último, conflacao — Plano 3, Task 3)" por "rodar as seis em sequência (osm, enderecos, geosampa, sp156, gtfs e, por último, conflacao)".
2. Em `test_tudo_roda_as_cinco_fontes_em_ordem_e_devolve_zero`, renomeie para `test_tudo_roda_as_seis_etapas_em_ordem_e_devolve_zero`, troque a tupla do `for` por `("osm", "enderecos", "geosampa", "sp156", "gtfs", "conflacao")` e a lista esperada por:

```python
    assert chamadas == [
        call("osm", "engine-falso"),
        call("enderecos", "engine-falso"),
        call("geosampa", "engine-falso"),
        call("sp156", "engine-falso"),
        call("gtfs", "engine-falso"),
        call("conflacao", "engine-falso"),
    ]
```

3. Em `test_tudo_continua_apos_uma_fonte_falhar_e_devolve_um`, acrescente depois do `monkeypatch.setattr(cli, "_executar_osm", _osm_falha)`:

```python
    monkeypatch.setattr(cli, "_executar_enderecos", _ok("enderecos"))
```

e troque o comentário e a asserção por:

```python
    # as demais etapas rodaram mesmo com o osm falhando
    assert chamadas == ["osm", "enderecos", "geosampa", "sp156", "gtfs", "conflacao"]
```

4. Em `test_tudo_devolve_um_quando_todas_falham`, troque a tupla por `("osm", "enderecos", "geosampa", "sp156", "gtfs")`.

Run (na raiz): `docker compose --profile etl run --rm --entrypoint pytest etl tests/test_cli_tudo.py -v`
Expected: FAIL com `AttributeError: <module 'etl.cli'> has no attribute '_executar_enderecos'`.

- [ ] **Step 2: Ligar a etapa no CLI**

Em `etl/etl/cli.py`:

1. Docstring: troque "`tudo` roda as cinco em sequência\n(osm, geosampa, sp156, gtfs e, por último, conflacao)." por "`tudo` roda as seis em sequência\n(osm, enderecos, geosampa, sp156, gtfs e, por último, conflacao)."
2. `FONTES = ["osm", "enderecos", "geosampa", "sp156", "gtfs", "conflacao", "tudo"]`
3. Depois de `_executar_osm`, acrescente:

```python
def _executar_enderecos(engine) -> dict:
    from etl.enderecos import executar

    return executar(engine)
```

4. Em `_parser()`, depois do `subparsers.add_parser("osm", ...)`:

```python
    subparsers.add_parser(
        "enderecos", help="endereços, lugares e ruas do OSM para o geocode (depende de osm)"
    )
```

e troque o help do `tudo` por `"roda osm, enderecos, geosampa, sp156, gtfs e conflacao em sequência"`.

5. Em `main()`, depois do ramo `osm`:

```python
    elif args.fonte == "enderecos":
        print(_executar_enderecos(_engine_para_tudo()))
```

6. Em `_tudo()`, troque o início do docstring para "Roda osm → enderecos → geosampa → sp156 → gtfs → conflacao em sequência." e a lista `passos` por:

```python
    passos: list[tuple[str, Any]] = [
        ("osm", _executar_osm),
        ("enderecos", _executar_enderecos),
        ("geosampa", _executar_geosampa),
        ("sp156", _executar_sp156),
        ("gtfs", _executar_gtfs),
        ("conflacao", _executar_conflacao_tudo),
    ]
```

Run: `docker compose --profile etl run --rm --entrypoint pytest etl tests/test_cli_tudo.py -v`
Expected: 3 passed (vai passar mesmo antes de `executar` existir, porque o import em `_executar_enderecos` é tardio e os testes trocam a função).

- [ ] **Step 3: Escrever os testes de qualidade de dados (falham até a carga)**

No fim de `etl/tests/test_qualidade_dados.py`:

```python
# --- Endereços: geocode local (Plano 5a) ---------------------------------------


def test_endereco_populado_por_tipo(engine):
    with engine.connect() as conexao:
        totais = dict(
            conexao.execute(text("SELECT tipo, count(*) FROM endereco GROUP BY tipo")).all()
        )
    assert totais.get("endereco", 0) >= 10_000
    assert totais.get("lugar", 0) >= 1_000
    assert totais.get("logradouro", 0) >= 300


def test_endereco_dentro_da_area_piloto(engine):
    consulta = """
        SELECT count(*) FROM endereco e
        WHERE NOT EXISTS (SELECT 1 FROM area_piloto a WHERE ST_Covers(a.geom, e.geom))
    """
    with engine.connect() as conexao:
        assert conexao.execute(text(consulta)).scalar_one() == 0


def test_endereco_so_tem_dados_do_osm(engine):
    consulta = """
        SELECT count(*) FROM endereco e JOIN fonte_dados f ON f.id = e.fonte_id
        WHERE f.chave <> 'osm'
    """
    with engine.connect() as conexao:
        assert conexao.execute(text(consulta)).scalar_one() == 0


def test_endereco_sem_duplicata_a_menos_de_15_m(engine):
    consulta = """
        SELECT count(*) FROM endereco a JOIN endereco b
          ON a.id < b.id AND a.tipo = b.tipo AND a.texto_busca = b.texto_busca
        WHERE a.tipo <> 'logradouro'
          AND ST_DWithin(a.geom::geography, b.geom::geography, 15)
    """
    with engine.connect() as conexao:
        assert conexao.execute(text(consulta)).scalar_one() == 0
```

Run: `docker compose --profile etl run --rm --entrypoint pytest etl tests/test_qualidade_dados.py -k endereco -v`
Expected: `test_endereco_populado_por_tipo` FAIL (tabela vazia); os outros três passam trivialmente.

- [ ] **Step 4: Implementar execução e carga**

Em `etl/etl/enderecos.py`, troque os imports do topo por:

```python
from __future__ import annotations

import json
import re
import subprocess
from collections.abc import Iterable, Iterator
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import shape
from sqlalchemy import Engine, text

from etl.config import AREA_PILOTO, DIR_DADOS
from etl.db import concluir_execucao, fonte_id, registrar_execucao
from etl.normalizacao import normalizar
```

Depois de `_PARA_31983 = ...`, acrescente:

```python
PILOTO_PBF = DIR_DADOS / "piloto.osm.pbf"
ENDERECOS_PBF = DIR_DADOS / "piloto-enderecos.osm.pbf"
ENDERECOS_GEOJSONSEQ = DIR_DADOS / "piloto-enderecos.geojsonseq"

# Uma linha por (nome da via, bairro). Cada trecho pertence ao bairro de menor
# id que contém seu centroide; o ponto fica sobre a via, perto do meio.
SQL_LOGRADOUROS = """
WITH trecho AS (
  SELECT v.nome, v.geom,
         (SELECT a.nome FROM area_piloto a
          WHERE ST_Covers(a.geom, ST_Centroid(v.geom))
          ORDER BY a.id LIMIT 1) AS bairro
  FROM via_pedestre v
  WHERE v.nome IS NOT NULL AND btrim(v.nome) <> ''
), por_rua AS (
  SELECT nome, bairro, ST_Collect(geom) AS geom
  FROM trecho WHERE bairro IS NOT NULL
  GROUP BY nome, bairro
)
SELECT nome, bairro, ST_X(p) AS lon, ST_Y(p) AS lat
FROM (SELECT nome, bairro, ST_ClosestPoint(geom, ST_Centroid(geom)) AS p FROM por_rua) s
ORDER BY nome, bairro
"""

SQL_INSERIR = text(
    """
    INSERT INTO endereco (tipo, rotulo, logradouro, numero, numero_int, categoria,
                          texto_busca, geom, osm_tipo, osm_id, fonte_id, data_referencia)
    VALUES (:tipo, :rotulo, :logradouro, :numero, :numero_int, :categoria, :texto_busca,
            ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), :osm_tipo, :osm_id,
            :fonte_id, :data_referencia)
    """
)
```

No fim do arquivo, acrescente:

```python
def _executar_osmium(*args: str) -> None:
    subprocess.run(["osmium", *args], check=True, capture_output=True, text=True)


def _exportar_geojsonseq() -> Path:
    """Filtra objetos com número ou nome e exporta como GeoJSONSeq, com o tipo
    e o id OSM em `@type`/`@id`. Objetos sem tag não são exportados."""
    _executar_osmium(
        "tags-filter",
        str(PILOTO_PBF),
        "nwr/addr:housenumber",
        "nwr/name",
        "-o",
        str(ENDERECOS_PBF),
        "--overwrite",
    )
    _executar_osmium(
        "export",
        str(ENDERECOS_PBF),
        "-f",
        "geojsonseq",
        "-a",
        "type,id",
        "-x",
        "print_record_separator=false",
        "-o",
        str(ENDERECOS_GEOJSONSEQ),
        "--overwrite",
    )
    return ENDERECOS_GEOJSONSEQ


def carregar(engine: Engine, registros: list[Registro], fid: int, data_ref: date) -> int:
    """Troca todo o conteúdo de `endereco` numa transação só."""
    parametros = [
        {**asdict(r), "fonte_id": fid, "data_referencia": data_ref} for r in registros
    ]
    with engine.begin() as conexao:
        conexao.execute(text("TRUNCATE endereco RESTART IDENTITY"))
        if parametros:
            conexao.execute(SQL_INSERIR, parametros)
    return len(parametros)


def executar(engine: Engine) -> dict:
    """Carrega `endereco` a partir do PBF da área piloto e de `via_pedestre`.
    Depende da etapa `osm` (gera o PBF e carrega `via_pedestre`)."""
    execucao_id = registrar_execucao(engine, "enderecos")
    try:
        if not PILOTO_PBF.exists():
            raise FileNotFoundError(
                f"{PILOTO_PBF} não existe; rode `python -m etl.cli osm` antes de `enderecos`."
            )
        with engine.connect() as conexao:
            data_ref = conexao.execute(
                text("SELECT max(data_referencia) FROM via_pedestre")
            ).scalar_one()
            linhas_vias = [tuple(linha) for linha in conexao.execute(text(SQL_LOGRADOUROS))]
        if data_ref is None:
            raise RuntimeError(
                "via_pedestre está vazia; rode `python -m etl.cli osm` antes de `enderecos`."
            )

        caminho = _exportar_geojsonseq()
        registros = deduplicar(
            r for f in ler_geojsonseq(caminho) if (r := registro_de_feature(f)) is not None
        )
        registros += registros_logradouro(linhas_vias)

        total = carregar(engine, registros, fonte_id(engine, "osm"), data_ref)
        resultado = {
            tipo: sum(1 for r in registros if r.tipo == tipo)
            for tipo in ("endereco", "lugar", "logradouro")
        }
        concluir_execucao(engine, execucao_id, "ok", linhas=total)
        return resultado
    except Exception as exc:
        concluir_execucao(engine, execucao_id, "erro", detalhe=str(exc)[:2000])
        raise
```

Run: `docker compose --profile etl run --rm --entrypoint pytest etl tests/test_enderecos.py tests/test_cli_tudo.py -v`
Expected: 21 passed (os testes da Task 3 continuam verdes com os imports novos).

- [ ] **Step 5: Rodar a etapa contra o banco local**

Pré-requisito: `etl/dados/piloto.osm.pbf` existe e `via_pedestre` está carregada. Se não estiver, rode `docker compose --profile etl run --rm etl osm` antes (~2 min com o PBF do sudeste em cache).

Run (na raiz): `docker compose --profile etl run --rm etl enderecos`
Expected: um dicionário como `{'endereco': <dezenas de milhares>, 'lugar': <milhares>, 'logradouro': <centenas a milhares>}`. Anote os números reais para a Task 8.

Se `osmium export` falhar por opção desconhecida, rode `docker compose --profile etl run --rm --entrypoint osmium etl export --help`, ajuste os argumentos à versão instalada e repita o passo.

- [ ] **Step 6: Qualidade verde**

Run: `docker compose --profile etl run --rm --entrypoint pytest etl tests/test_qualidade_dados.py -k endereco -v`
Expected: 4 passed. Se um limiar de contagem falhar, **não abaixe o limiar sem investigar**: confira se o PBF é o da área piloto e se `registro_de_feature` não está descartando demais (rode `registro_de_feature` sobre as 20 primeiras linhas de `etl/dados/piloto-enderecos.geojsonseq` e veja por quê).

- [ ] **Step 7: Suíte inteira do ETL**

Run: `docker compose --profile etl run --rm --entrypoint pytest etl tests -q`
Expected: tudo verde (os 75 anteriores + os novos).

- [ ] **Step 8: Commit (só com autorização do dono)**

```bash
git add etl/etl/enderecos.py etl/etl/cli.py etl/tests/test_cli_tudo.py etl/tests/test_qualidade_dados.py
git commit -m "etl: etapa enderecos carrega a tabela endereco e entra no tudo depois do osm"
```

---

### Task 5: Backend — `buscar()` (busca por texto)

**Files:**
- Create: `backend/app/schemas/geocode.py`
- Create: `backend/app/services/geocode.py` (só `buscar` nesta task)
- Modify: `backend/tests/conftest.py` (fixtures compartilhadas)
- Test: `backend/tests/test_geocode_busca.py`

**Interfaces:**
- Consumes: `normalizar`, `separar_numero` (Task 1); tabela `endereco` (Task 2).
- Produces:
  - `app.schemas.geocode.EnderecoOut` (Pydantic): `id: int`, `tipo: Literal["logradouro", "endereco", "lugar"]`, `rotulo: str` (min 1), `lat: float`, `lon: float`, `aproximado: bool = False`.
  - `app.services.geocode.buscar(db: Session, q: str, limite: int) -> list[EnderecoOut]`.
  - Fixtures em `backend/tests/conftest.py`: `db_geocode` (sessão com `endereco` esvaziada, sempre revertida), `semear_endereco` (função que insere uma linha e devolve o id), `deslocar` (função `(lon, lat, leste_m, norte_m) -> (lon, lat)`), `area_teste` (insere uma `area_piloto` de teste longe das reais e devolve `(lon, lat)` do centro).

- [ ] **Step 1: Fixtures compartilhadas**

Em `backend/tests/conftest.py`, acrescente `import math` como primeira linha do arquivo (antes de `import pytest`) e, no fim do arquivo:

```python
# --- geocode (Plano 5a) --------------------------------------------------------
# Tudo roda dentro de uma transação revertida no fim: nada é commitado e os
# dados reais de `endereco`/`area_piloto` voltam intactos.

# bem fora das três area_piloto reais (mesmo ponto-base de test_rotas_api.py)
CENTRO_AREA_TESTE = (-45.98351729900837, -24.048988029889923)


@pytest.fixture
def db_geocode():
    from app.db import SessionLocal

    sessao = SessionLocal()
    sessao.execute(text("DELETE FROM endereco"))
    try:
        yield sessao
    finally:
        sessao.rollback()
        sessao.close()


@pytest.fixture
def semear_endereco(db_geocode):
    fid = db_geocode.execute(
        text("SELECT id FROM fonte_dados WHERE chave = 'osm'")
    ).scalar_one()

    def _semear(
        tipo: str,
        rotulo: str,
        texto_busca: str,
        lon: float,
        lat: float,
        logradouro: str | None = None,
        numero: str | None = None,
        numero_int: int | None = None,
    ) -> int:
        return db_geocode.execute(
            text(
                "INSERT INTO endereco (tipo, rotulo, logradouro, numero, numero_int, "
                "texto_busca, geom, fonte_id, data_referencia) VALUES (:tipo, :rotulo, "
                ":logradouro, :numero, :numero_int, :texto_busca, "
                "ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), :fid, CURRENT_DATE) RETURNING id"
            ),
            {
                "tipo": tipo,
                "rotulo": rotulo,
                "logradouro": logradouro,
                "numero": numero,
                "numero_int": numero_int,
                "texto_busca": texto_busca,
                "lon": lon,
                "lat": lat,
                "fid": fid,
            },
        ).scalar_one()

    return _semear


@pytest.fixture
def deslocar():
    def _deslocar(lon: float, lat: float, leste_m: float, norte_m: float) -> tuple[float, float]:
        return (
            lon + leste_m / (111_320.0 * math.cos(math.radians(lat))),
            lat + norte_m / 111_320.0,
        )

    return _deslocar


@pytest.fixture
def area_teste(db_geocode):
    lon, lat = CENTRO_AREA_TESTE
    db_geocode.execute(
        text(
            "INSERT INTO area_piloto (nome, geom) VALUES ('Área de teste do geocode', "
            "ST_MakeEnvelope(:oeste, :sul, :leste, :norte, 4326))"
        ),
        {"oeste": lon - 0.01, "sul": lat - 0.01, "leste": lon + 0.01, "norte": lat + 0.01},
    )
    return lon, lat
```

- [ ] **Step 2: Escrever os testes de busca**

`backend/tests/test_geocode_busca.py`:

```python
"""`buscar()` do geocode local (spec 2026-11-02-geocode-design.md, 4.1).
Linhas sintéticas numa `endereco` esvaziada dentro de transação revertida."""

import pytest

from app.services.geocode import buscar

pytestmark = pytest.mark.integration


@pytest.fixture
def semeado(semear_endereco):
    s = semear_endereco
    s("logradouro", "Rua Vergueiro · Vila Mariana", "rua vergueiro", -46.6350, -23.5900,
      logradouro="Rua Vergueiro")
    s("endereco", "Rua Vergueiro, 3000 · Vila Mariana", "rua vergueiro 3000",
      -46.6351, -23.5901, "Rua Vergueiro", "3000", 3000)
    s("endereco", "Rua Vergueiro, 3010 · Vila Mariana", "rua vergueiro 3010",
      -46.6352, -23.5902, "Rua Vergueiro", "3010", 3010)
    s("endereco", "Rua Vergueiro, 3050 · Vila Mariana", "rua vergueiro 3050",
      -46.6353, -23.5903, "Rua Vergueiro", "3050", 3050)
    s("lugar", "Farmácia Central — Rua Vergueiro, 3000 · Vila Mariana",
      "farmacia central rua vergueiro 3000", -46.6351, -23.5901, "Rua Vergueiro", "3000", 3000)
    s("lugar", "Fatec Ipiranga — Rua Frei João, 59 · Ipiranga",
      "fatec ipiranga rua frei joao 59", -46.6000, -23.5900, "Rua Frei João", "59", 59)
    s("lugar", "Padaria Sol · Lapa", "padaria sol", -46.7000, -23.5300)
    s("lugar", "Padaria Sol · Ipiranga", "padaria sol", -46.6000, -23.5950)


def _rotulos(resultado):
    return [r.rotulo for r in resultado]


def test_numero_exato_traz_endereco_antes_do_lugar(db_geocode, semeado):
    resultado = buscar(db_geocode, "Rua Vergueiro, 3000", 8)
    assert _rotulos(resultado) == [
        "Rua Vergueiro, 3000 · Vila Mariana",
        "Farmácia Central — Rua Vergueiro, 3000 · Vila Mariana",
    ]
    assert all(r.aproximado is False for r in resultado)


def test_numero_com_abreviacao_e_sem_virgula(db_geocode, semeado):
    assert _rotulos(buscar(db_geocode, "r. vergueiro 3000", 8))[0] == (
        "Rua Vergueiro, 3000 · Vila Mariana"
    )


def test_numero_inexistente_devolve_o_mais_proximo_marcado_aproximado(db_geocode, semeado):
    resultado = buscar(db_geocode, "rua vergueiro 3040", 8)
    assert _rotulos(resultado) == ["Rua Vergueiro, 3050 · Vila Mariana"]
    assert resultado[0].aproximado is True


def test_numero_equidistante_desempata_pelo_menor(db_geocode, semeado):
    resultado = buscar(db_geocode, "rua vergueiro 3030", 8)
    assert _rotulos(resultado) == ["Rua Vergueiro, 3010 · Vila Mariana"]
    assert resultado[0].aproximado is True


def test_sem_numero_traz_a_rua_primeiro_e_nenhum_endereco_numerado(db_geocode, semeado):
    resultado = buscar(db_geocode, "rua vergueiro", 8)
    assert resultado[0].rotulo == "Rua Vergueiro · Vila Mariana"
    assert resultado[0].tipo == "logradouro"
    assert "endereco" not in {r.tipo for r in resultado}
    assert "Farmácia Central — Rua Vergueiro, 3000 · Vila Mariana" in _rotulos(resultado)


def test_erro_de_digitacao(db_geocode, semeado):
    assert _rotulos(buscar(db_geocode, "fatek ipiranga", 8))[0] == (
        "Fatec Ipiranga — Rua Frei João, 59 · Ipiranga"
    )


def test_prefixo_curto(db_geocode, semeado):
    assert _rotulos(buscar(db_geocode, "fat", 8))[0] == (
        "Fatec Ipiranga — Rua Frei João, 59 · Ipiranga"
    )


def test_empate_ordena_pelo_rotulo_e_e_estavel(db_geocode, semeado):
    primeira = buscar(db_geocode, "padaria sol", 8)
    assert _rotulos(primeira) == ["Padaria Sol · Ipiranga", "Padaria Sol · Lapa"]
    assert buscar(db_geocode, "padaria sol", 8) == primeira


def test_limite(db_geocode, semeado):
    assert len(buscar(db_geocode, "padaria sol", 1)) == 1


def test_rua_desconhecida_com_numero_nao_inventa_resultado(db_geocode, semeado):
    assert buscar(db_geocode, "rua inexistente 10", 8) == []


def test_sem_resultado(db_geocode, semeado):
    assert buscar(db_geocode, "xyzxyzxyz", 8) == []


def test_texto_que_normaliza_para_vazio(db_geocode, semeado):
    assert buscar(db_geocode, "!!!", 8) == []
```

- [ ] **Step 3: Rodar e ver falhar**

Run (em `backend/`): `.venv/Scripts/python.exe -m pytest tests/test_geocode_busca.py -v`
Expected: erro de coleta `ModuleNotFoundError: No module named 'app.services.geocode'`.

- [ ] **Step 4: Schema**

`backend/app/schemas/geocode.py`:

```python
"""Contrato de `GET /api/geocode` e `GET /api/geocode/reverso`."""

from typing import Literal

from pydantic import BaseModel, Field


class EnderecoOut(BaseModel):
    id: int
    tipo: Literal["logradouro", "endereco", "lugar"]
    # texto exibido e falado pelo leitor de tela; nunca vazio
    rotulo: str = Field(min_length=1)
    lat: float
    lon: float
    # true quando o número digitado não existe e este é o mais próximo da rua
    aproximado: bool = False
```

- [ ] **Step 5: Serviço de busca**

`backend/app/services/geocode.py`:

```python
"""Geocode local no PostGIS (spec docs/superpowers/specs/2026-11-02-geocode-design.md, 4).

Tudo determinístico: mesma entrada, mesma lista, na mesma ordem. Nenhum
serviço externo. `texto_busca` foi gravado pelo ETL com a mesma
`normalizar()` usada aqui.
"""

from __future__ import annotations

import re

from sqlalchemy import text
from sqlalchemy.engine import Row
from sqlalchemy.orm import Session

from app.schemas.geocode import EnderecoOut
from app.services.normalizacao import normalizar, separar_numero

_COLUNAS = "id, tipo, rotulo, ST_Y(geom) AS lat, ST_X(geom) AS lon"
_DIGITOS = re.compile(r"\d+")

# rua das linhas numeradas que melhor casa com a parte da rua digitada
_SQL_RUA = text(
    """
    SELECT logradouro FROM endereco
    WHERE tipo IN ('endereco', 'lugar') AND numero IS NOT NULL AND logradouro IS NOT NULL
      AND :rua <% texto_busca
    ORDER BY word_similarity(:rua, texto_busca) DESC, length(logradouro), logradouro
    LIMIT 1
    """
)

_SQL_NUMERO_EXATO = text(
    f"""
    SELECT {_COLUNAS} FROM endereco
    WHERE logradouro = :logradouro AND tipo IN ('endereco', 'lugar')
      AND regexp_replace(lower(numero), '[^0-9a-z]', '', 'g') = :numero
    ORDER BY CASE tipo WHEN 'endereco' THEN 0 ELSE 1 END, rotulo, id
    LIMIT :limite
    """
)

_SQL_NUMERO_PROXIMO = text(
    f"""
    SELECT {_COLUNAS} FROM endereco
    WHERE logradouro = :logradouro AND tipo IN ('endereco', 'lugar')
      AND numero_int IS NOT NULL
    ORDER BY abs(numero_int - :n), numero_int,
             CASE tipo WHEN 'endereco' THEN 0 ELSE 1 END, id
    LIMIT 1
    """
)

# sem número: só ruas e lugares (endereços numerados inundariam a lista)
_SQL_SEM_NUMERO = text(
    f"""
    SELECT {_COLUNAS} FROM endereco
    WHERE tipo IN ('logradouro', 'lugar')
      AND (:q <% texto_busca OR texto_busca LIKE :prefixo)
    ORDER BY (texto_busca LIKE :prefixo) DESC,
             word_similarity(:q, texto_busca) DESC,
             CASE tipo WHEN 'logradouro' THEN 0 ELSE 1 END,
             rotulo, id
    LIMIT :limite
    """
)


def _saida(linha: Row, aproximado: bool = False) -> EnderecoOut:
    return EnderecoOut(
        id=linha.id,
        tipo=linha.tipo,
        rotulo=linha.rotulo,
        lat=linha.lat,
        lon=linha.lon,
        aproximado=aproximado,
    )


def _buscar_com_numero(db: Session, rua: str, numero: str, limite: int) -> list[EnderecoOut]:
    logradouro = db.execute(_SQL_RUA, {"rua": rua}).scalar_one_or_none()
    if logradouro is None:
        return []
    exatos = db.execute(
        _SQL_NUMERO_EXATO, {"logradouro": logradouro, "numero": numero, "limite": limite}
    ).all()
    if exatos:
        return [_saida(linha) for linha in exatos]
    n = int(_DIGITOS.match(numero).group())
    proximo = db.execute(_SQL_NUMERO_PROXIMO, {"logradouro": logradouro, "n": n}).first()
    return [_saida(proximo, aproximado=True)] if proximo is not None else []


def buscar(db: Session, q: str, limite: int) -> list[EnderecoOut]:
    """Autocomplete: rua + número quando o texto termina em número; senão
    ruas e lugares por trigram/prefixo. Lista vazia quando nada casa."""
    texto = normalizar(q)
    if not texto:
        return []
    rua, numero = separar_numero(texto)
    if numero is not None:
        resultado = _buscar_com_numero(db, rua, numero, limite)
        if resultado:
            return resultado
    linhas = db.execute(
        _SQL_SEM_NUMERO, {"q": texto, "prefixo": f"{texto}%", "limite": limite}
    ).all()
    return [_saida(linha) for linha in linhas]
```

Nota: `texto` só tem `[a-z0-9 ]` (garantido por `normalizar`), então o `LIKE` não precisa escapar `%` nem `_`. O SQLAlchemy escapa os `%` literais de `<%` para o psycopg.

- [ ] **Step 6: Rodar e ver passar**

Run (em `backend/`): `.venv/Scripts/python.exe -m pytest tests/test_geocode_busca.py -v`
Expected: 12 passed.

- [ ] **Step 7: Lint**

Run: `.venv/Scripts/python.exe -m ruff check . ; .venv/Scripts/python.exe -m ruff format --check .`
Expected: sem erros. Se o `ruff format` quiser reformatar a fixture `semeado`, rode `.venv/Scripts/python.exe -m ruff format tests/test_geocode_busca.py` e confira que os testes continuam passando.

- [ ] **Step 8: Commit (só com autorização do dono)**

```bash
git add backend/app/schemas/geocode.py backend/app/services/geocode.py backend/tests/conftest.py backend/tests/test_geocode_busca.py
git commit -m "feat(backend): busca local de endereços por rua, número e lugar"
```

---

### Task 6: Backend — `reverso()` (endereço mais próximo de um ponto)

**Files:**
- Modify: `backend/app/services/geocode.py`
- Test: `backend/tests/test_geocode_reverso.py`

**Interfaces:**
- Consumes: fixtures `db_geocode`, `semear_endereco`, `area_teste`, `deslocar` (Task 5); `EnderecoOut`.
- Produces:
  - `app.services.geocode.reverso(db: Session, lat: float, lon: float) -> EnderecoOut`
  - `class ReversoNaoEncontrado(Exception)`; `str(erro)` é a mensagem para o usuário.
  - Constantes `MSG_FORA_DA_AREA = "Este ponto está fora da área atendida pelo Rota Falada SP."`, `MSG_NADA_POR_PERTO = "Nenhum endereço conhecido a até 50 metros deste ponto."`, `RAIO_REVERSO_M = 50.0`.

- [ ] **Step 1: Escrever os testes**

`backend/tests/test_geocode_reverso.py`:

```python
"""`reverso()` do geocode local (spec 2026-11-02-geocode-design.md, 4.2). Usa
uma `area_piloto` de teste longe das reais, dentro de transação revertida."""

import pytest
from sqlalchemy import text

from app.services.geocode import (
    MSG_FORA_DA_AREA,
    MSG_NADA_POR_PERTO,
    ReversoNaoEncontrado,
    reverso,
)

pytestmark = pytest.mark.integration

NO_A, NO_B = 900_000_101, 900_000_102  # ids sentinela de no_pedestre


def _inserir_via(db, nome: str, lon_a: float, lat_a: float, lon_b: float, lat_b: float):
    fid = db.execute(text("SELECT id FROM fonte_dados WHERE chave = 'osm'")).scalar_one()
    for no, lon, lat in ((NO_A, lon_a, lat_a), (NO_B, lon_b, lat_b)):
        db.execute(
            text(
                "INSERT INTO no_pedestre (id, geom, fonte_id, data_referencia) VALUES "
                "(:id, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), :fid, CURRENT_DATE)"
            ),
            {"id": no, "lon": lon, "lat": lat, "fid": fid},
        )
    db.execute(
        text(
            "INSERT INTO via_pedestre (osmid, source, target, highway, esquema_calcada, nome, "
            "comprimento_m, custo_acessivel, custo_reverso, geom, fonte_id, data_referencia) "
            "VALUES (900000001, :a, :b, 'footway', 'geometria_propria', :nome, 100, 100, 100, "
            "ST_SetSRID(ST_MakeLine(ST_MakePoint(:lon_a, :lat_a), ST_MakePoint(:lon_b, :lat_b)),"
            " 4326), :fid, CURRENT_DATE)"
        ),
        {"a": NO_A, "b": NO_B, "nome": nome, "lon_a": lon_a, "lat_a": lat_a,
         "lon_b": lon_b, "lat_b": lat_b, "fid": fid},
    )


def test_fora_da_area_atendida(db_geocode, area_teste):
    with pytest.raises(ReversoNaoEncontrado) as erro:
        reverso(db_geocode, lat=-25.0, lon=-46.0)
    assert str(erro.value) == MSG_FORA_DA_AREA


def test_devolve_o_endereco_mais_proximo(db_geocode, area_teste, semear_endereco, deslocar):
    lon, lat = area_teste
    semear_endereco("endereco", "Rua Perto, 20 · Teste", "rua perto 20",
                    *deslocar(lon, lat, 20, 0), "Rua Perto", "20", 20)
    semear_endereco("endereco", "Rua Perto, 40 · Teste", "rua perto 40",
                    *deslocar(lon, lat, 40, 0), "Rua Perto", "40", 40)
    resultado = reverso(db_geocode, lat=lat, lon=lon)
    assert resultado.rotulo == "Rua Perto, 20 · Teste"
    assert resultado.tipo == "endereco"


def test_nada_a_50_m(db_geocode, area_teste, semear_endereco, deslocar):
    lon, lat = area_teste
    semear_endereco("endereco", "Rua Longe, 80 · Teste", "rua longe 80",
                    *deslocar(lon, lat, 80, 0), "Rua Longe", "80", 80)
    with pytest.raises(ReversoNaoEncontrado) as erro:
        reverso(db_geocode, lat=lat, lon=lon)
    assert str(erro.value) == MSG_NADA_POR_PERTO


def test_sem_endereco_cai_na_via_nomeada_e_devolve_o_ponto_da_via(
    db_geocode, area_teste, semear_endereco, deslocar
):
    lon, lat = area_teste
    lon_a, lat_via = deslocar(lon, lat, -100, 10)
    lon_b, _ = deslocar(lon, lat, 100, 10)
    _inserir_via(db_geocode, "Rua Sentinela Geocode", lon_a, lat_via, lon_b, lat_via)
    semear_endereco("logradouro", "Rua Sentinela Geocode · Teste", "rua sentinela geocode",
                    lon_a, lat_via, logradouro="Rua Sentinela Geocode")

    resultado = reverso(db_geocode, lat=lat, lon=lon)

    assert resultado.rotulo == "Rua Sentinela Geocode · Teste"
    assert resultado.tipo == "logradouro"
    assert resultado.lat == pytest.approx(lat_via, abs=1e-9)
    assert resultado.lon == pytest.approx(lon, abs=1e-9)


def test_endereco_tem_prioridade_sobre_via_mais_perto(
    db_geocode, area_teste, semear_endereco, deslocar
):
    lon, lat = area_teste
    lon_a, lat_via = deslocar(lon, lat, -100, 5)
    lon_b, _ = deslocar(lon, lat, 100, 5)
    _inserir_via(db_geocode, "Rua Sentinela Geocode", lon_a, lat_via, lon_b, lat_via)
    semear_endereco("logradouro", "Rua Sentinela Geocode · Teste", "rua sentinela geocode",
                    lon_a, lat_via, logradouro="Rua Sentinela Geocode")
    semear_endereco("endereco", "Rua Perto, 30 · Teste", "rua perto 30",
                    *deslocar(lon, lat, 30, 0), "Rua Perto", "30", 30)

    assert reverso(db_geocode, lat=lat, lon=lon).rotulo == "Rua Perto, 30 · Teste"
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `backend/`): `.venv/Scripts/python.exe -m pytest tests/test_geocode_reverso.py -v`
Expected: erro de coleta `ImportError: cannot import name 'MSG_FORA_DA_AREA'`.

- [ ] **Step 3: Implementar**

Em `backend/app/services/geocode.py`, depois de `_DIGITOS = ...`:

```python
RAIO_REVERSO_M = 50.0
# pré-filtro em graus para usar o índice GiST antes do cálculo em metros:
# 0,0006° ≈ 66 m de latitude e ≈ 61 m de longitude a 23,5° S (> RAIO_REVERSO_M)
_GRAUS_PREFILTRO = 0.0006

MSG_FORA_DA_AREA = "Este ponto está fora da área atendida pelo Rota Falada SP."
MSG_NADA_POR_PERTO = "Nenhum endereço conhecido a até 50 metros deste ponto."


class ReversoNaoEncontrado(Exception):
    """Sem endereço para o ponto; a mensagem vai direto para o usuário."""
```

No fim do arquivo:

```python
_SQL_DENTRO_DA_AREA = text(
    """
    SELECT EXISTS (
      SELECT 1 FROM area_piloto
      WHERE ST_Covers(geom, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))
    )
    """
)

_SQL_ENDERECO_PROXIMO = text(
    """
    WITH p AS (SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS g)
    SELECT e.id, e.tipo, e.rotulo, ST_Y(e.geom) AS lat, ST_X(e.geom) AS lon
    FROM endereco e CROSS JOIN p
    WHERE e.tipo = 'endereco'
      AND e.geom && ST_Expand(p.g, :graus)
      AND ST_DWithin(e.geom::geography, p.g::geography, :raio)
    ORDER BY ST_Distance(e.geom::geography, p.g::geography), e.id
    LIMIT 1
    """
)

# via nomeada mais próxima; devolve a linha `logradouro` com esse nome mais
# próxima do usuário, mas com o ponto da via mais próximo dele
_SQL_VIA_PROXIMA = text(
    """
    WITH p AS (SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS g),
    via AS (
      SELECT v.nome, ST_ClosestPoint(v.geom, p.g) AS ponto
      FROM via_pedestre v CROSS JOIN p
      WHERE v.nome IS NOT NULL AND btrim(v.nome) <> ''
        AND v.geom && ST_Expand(p.g, :graus)
        AND ST_DWithin(v.geom::geography, p.g::geography, :raio)
      ORDER BY ST_Distance(v.geom::geography, p.g::geography), v.nome
      LIMIT 1
    )
    SELECT e.id, e.tipo, e.rotulo, ST_Y(via.ponto) AS lat, ST_X(via.ponto) AS lon
    FROM via
    JOIN endereco e ON e.tipo = 'logradouro' AND e.logradouro = via.nome
    CROSS JOIN p
    ORDER BY e.geom <-> p.g, e.id
    LIMIT 1
    """
)


def reverso(db: Session, lat: float, lon: float) -> EnderecoOut:
    """Endereço numerado a até `RAIO_REVERSO_M`; senão a rua mais próxima no
    mesmo raio; senão `ReversoNaoEncontrado`."""
    ponto = {"lat": lat, "lon": lon}
    if not db.execute(_SQL_DENTRO_DA_AREA, ponto).scalar_one():
        raise ReversoNaoEncontrado(MSG_FORA_DA_AREA)
    parametros = {**ponto, "graus": _GRAUS_PREFILTRO, "raio": RAIO_REVERSO_M}
    linha = db.execute(_SQL_ENDERECO_PROXIMO, parametros).first()
    if linha is None:
        linha = db.execute(_SQL_VIA_PROXIMA, parametros).first()
    if linha is None:
        raise ReversoNaoEncontrado(MSG_NADA_POR_PERTO)
    return _saida(linha)
```

- [ ] **Step 4: Rodar e ver passar**

Run (em `backend/`): `.venv/Scripts/python.exe -m pytest tests/test_geocode_reverso.py tests/test_geocode_busca.py -v`
Expected: 17 passed.

- [ ] **Step 5: Lint**

Run: `.venv/Scripts/python.exe -m ruff check . ; .venv/Scripts/python.exe -m ruff format --check .`
Expected: sem erros (rode `ruff format` no arquivo de teste se ele pedir, e repita o pytest).

- [ ] **Step 6: Commit (só com autorização do dono)**

```bash
git add backend/app/services/geocode.py backend/tests/test_geocode_reverso.py
git commit -m "feat(backend): geocodificação reversa com raio de 50 m e queda para a rua"
```

---

### Task 7: Backend — rotas HTTP, contrato e tipos do frontend

**Files:**
- Create: `backend/app/routers/geocode.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_geocode_api.py`
- Regenerate: `frontend/src/api/types.gen.ts`

**Interfaces:**
- Consumes: `buscar`, `reverso`, `ReversoNaoEncontrado`, `MSG_FORA_DA_AREA` (Tasks 5 e 6); `app.db.get_db`.
- Produces: `GET /api/geocode?q=&limite=` → `list[EnderecoOut]`; `GET /api/geocode/reverso?lat=&lon=` → `EnderecoOut`; constantes `CACHE_CONTROL = "public, max-age=86400"`, `MSG_INDISPONIVEL`, `MSG_TAMANHO_Q` em `app.routers.geocode`.

- [ ] **Step 1: Escrever os testes de contrato**

`backend/tests/test_geocode_api.py`:

```python
"""Contrato HTTP do geocode (spec 2026-11-02-geocode-design.md, 4 e 5)."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.db import get_db
from app.main import create_app
from app.routers.geocode import CACHE_CONTROL, MSG_INDISPONIVEL
from app.services.geocode import MSG_FORA_DA_AREA

pytestmark = pytest.mark.integration


@pytest.fixture
def cliente(db_geocode):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db_geocode
    return TestClient(app)


def test_busca_devolve_lista_com_cache(cliente, semear_endereco):
    semear_endereco("lugar", "Fatec Ipiranga · Ipiranga", "fatec ipiranga", -46.60, -23.59)
    resposta = cliente.get("/api/geocode", params={"q": "fatec"})
    assert resposta.status_code == 200
    assert resposta.headers["cache-control"] == CACHE_CONTROL
    corpo = resposta.json()
    assert corpo[0]["rotulo"] == "Fatec Ipiranga · Ipiranga"
    assert set(corpo[0]) == {"id", "tipo", "rotulo", "lat", "lon", "aproximado"}


def test_busca_sem_resultado_e_200_com_lista_vazia(cliente):
    resposta = cliente.get("/api/geocode", params={"q": "xyzxyzxyz"})
    assert resposta.status_code == 200
    assert resposta.json() == []


@pytest.mark.parametrize(
    "params",
    [{"q": "  ab  "}, {"q": "a" * 101}, {"q": "fatec", "limite": 0}, {"q": "fatec", "limite": 11}, {}],
    ids=["q-curto-apos-strip", "q-longo", "limite-zero", "limite-acima-de-10", "sem-q"],
)
def test_busca_invalida_e_422(cliente, params):
    assert cliente.get("/api/geocode", params=params).status_code == 422


def test_reverso_devolve_endereco_com_cache(cliente, area_teste, semear_endereco, deslocar):
    lon, lat = area_teste
    semear_endereco("endereco", "Rua Perto, 20 · Teste", "rua perto 20",
                    *deslocar(lon, lat, 20, 0), "Rua Perto", "20", 20)
    resposta = cliente.get("/api/geocode/reverso", params={"lat": lat, "lon": lon})
    assert resposta.status_code == 200
    assert resposta.headers["cache-control"] == CACHE_CONTROL
    assert resposta.json()["rotulo"] == "Rua Perto, 20 · Teste"


def test_reverso_fora_da_area_e_404_em_portugues(cliente):
    resposta = cliente.get("/api/geocode/reverso", params={"lat": -25.0, "lon": -46.0})
    assert resposta.status_code == 404
    assert resposta.json()["detail"] == MSG_FORA_DA_AREA


@pytest.mark.parametrize(
    "params", [{"lat": 91, "lon": 0}, {"lat": 0, "lon": -181}, {"lat": -23.5}],
    ids=["lat-invalida", "lon-invalida", "sem-lon"],
)
def test_reverso_invalido_e_422(cliente, params):
    assert cliente.get("/api/geocode/reverso", params=params).status_code == 422


class _SessaoSemBanco:
    def execute(self, *args, **kwargs):
        raise OperationalError("SELECT 1", {}, Exception("conexão recusada"))


@pytest.mark.parametrize(
    ("rota", "params"),
    [("/api/geocode", {"q": "fatec"}), ("/api/geocode/reverso", {"lat": -23.59, "lon": -46.6})],
)
def test_banco_fora_do_ar_e_503(rota, params):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: _SessaoSemBanco()
    resposta = TestClient(app).get(rota, params=params)
    assert resposta.status_code == 503
    assert resposta.json()["detail"] == MSG_INDISPONIVEL
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `backend/`): `.venv/Scripts/python.exe -m pytest tests/test_geocode_api.py -v`
Expected: erro de coleta `ModuleNotFoundError: No module named 'app.routers.geocode'`.

- [ ] **Step 3: Router**

`backend/app/routers/geocode.py`:

```python
"""`GET /api/geocode` e `GET /api/geocode/reverso`: validam a entrada e
delegam para `services.geocode`. O router não sabe nada de SQL; só traduz
`ReversoNaoEncontrado` em 404 e banco indisponível em 503."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.geocode import EnderecoOut
from app.services.geocode import ReversoNaoEncontrado, buscar, reverso

router = APIRouter(prefix="/api", tags=["geocode"])

# os dados só mudam quando o ETL roda (semanal)
CACHE_CONTROL = "public, max-age=86400"
MSG_INDISPONIVEL = "Busca de endereços indisponível no momento."
MSG_TAMANHO_Q = "O texto da busca precisa ter de 3 a 100 caracteres."


@router.get("/geocode", response_model=list[EnderecoOut])
def geocode(
    response: Response,
    q: str,
    limite: Annotated[int, Query(ge=1, le=10)] = 8,
    db: Session = Depends(get_db),  # noqa: B008
) -> list[EnderecoOut]:
    texto = q.strip()
    if not 3 <= len(texto) <= 100:
        raise HTTPException(status_code=422, detail=MSG_TAMANHO_Q)
    try:
        resultado = buscar(db, texto, limite)
    except OperationalError as erro:
        raise HTTPException(status_code=503, detail=MSG_INDISPONIVEL) from erro
    response.headers["Cache-Control"] = CACHE_CONTROL
    return resultado


@router.get("/geocode/reverso", response_model=EnderecoOut)
def geocode_reverso(
    response: Response,
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    db: Session = Depends(get_db),  # noqa: B008
) -> EnderecoOut:
    try:
        resultado = reverso(db, lat=lat, lon=lon)
    except ReversoNaoEncontrado as erro:
        raise HTTPException(status_code=404, detail=str(erro)) from erro
    except OperationalError as erro:
        raise HTTPException(status_code=503, detail=MSG_INDISPONIVEL) from erro
    response.headers["Cache-Control"] = CACHE_CONTROL
    return resultado
```

- [ ] **Step 4: Registrar no app**

Em `backend/app/main.py`, troque o import dos routers por:

```python
from app.routers import fontes, geocode, health, rotas
```

e acrescente depois de `app.include_router(rotas.router)`:

```python
    app.include_router(geocode.router)
```

- [ ] **Step 5: Rodar e ver passar**

Run (em `backend/`): `.venv/Scripts/python.exe -m pytest tests/test_geocode_api.py -v`
Expected: 14 passed.

- [ ] **Step 6: Suíte inteira do backend e lint**

Run: `.venv/Scripts/python.exe -m pytest -q ; .venv/Scripts/python.exe -m ruff check . ; .venv/Scripts/python.exe -m ruff format --check .`
Expected: tudo verde (os testes anteriores continuam passando) e lint limpo.

- [ ] **Step 7: Regenerar os tipos do frontend**

Em um terminal, a partir de `backend/`, suba a API (deixe rodando):

```powershell
.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
```

Em outro terminal, a partir de `frontend/`:

```powershell
npm run gerar-tipos
npm run lint
npm test -- --run
npm run build
```

Expected: `frontend/src/api/types.gen.ts` passa a ter `"/api/geocode"`, `"/api/geocode/reverso"` e o schema `EnderecoOut`; lint, testes e build verdes. Pare o uvicorn depois.

- [ ] **Step 8: Teste manual rápido**

Com a API no ar e o banco local carregado pela Task 4, abra `http://localhost:8000/api/geocode?q=fatec` e `http://localhost:8000/docs`. Expected: lista JSON com rótulos legíveis; as duas rotas aparecem na documentação.

- [ ] **Step 9: Commit (só com autorização do dono)**

```bash
git add backend/app/routers/geocode.py backend/app/main.py backend/tests/test_geocode_api.py frontend/src/api/types.gen.ts
git commit -m "feat(backend): GET /api/geocode e /api/geocode/reverso com tipos regenerados"
```

---

### Task 8: Dados reais, latência e documentação

**Files:**
- Test: `backend/tests/test_geocode_dados_reais.py`
- Modify: `etl/README.md`, `docs/README.md`

**Interfaces:**
- Consumes: `buscar`, `reverso` (Tasks 5 e 6); banco local com `enderecos` carregado (Task 4).
- Produces: evidência de que a busca funciona com os dados reais e cabe no orçamento de 300 ms (p95).

- [ ] **Step 1: Escrever os testes com dados reais**

`backend/tests/test_geocode_dados_reais.py`:

```python
"""Geocode contra os dados reais do ETL (pulado no CI, que não roda o ETL).
Orçamento de latência do spec-mãe: geocode p95 ≤ 300 ms."""

import time

import pytest
from sqlalchemy import text

from app.db import SessionLocal
from app.services.geocode import buscar, reverso

pytestmark = [pytest.mark.integration, pytest.mark.dados_reais]


@pytest.fixture(scope="module")
def db():
    sessao = SessionLocal()
    total = sessao.execute(text("SELECT count(*) FROM endereco")).scalar_one()
    if total == 0:
        sessao.close()
        pytest.skip("endereco vazia; rode `docker compose --profile etl run --rm etl enderecos`")
    try:
        yield sessao
    finally:
        sessao.rollback()
        sessao.close()


def test_fatec_ipiranga_e_encontrada(db):
    resultado = buscar(db, "FATEC Ipiranga", 8)
    assert any("fatec" in r.rotulo.lower() for r in resultado), [r.rotulo for r in resultado]


def test_rua_vergueiro_com_numero_traz_um_endereco_da_vergueiro(db):
    resultado = buscar(db, "rua vergueiro 3000", 8)
    assert resultado, "nenhum resultado para 'rua vergueiro 3000'"
    assert resultado[0].tipo in ("endereco", "lugar")
    assert "vergueiro" in resultado[0].rotulo.lower()


def test_reverso_sobre_um_endereco_real_devolve_um_endereco(db):
    lon, lat = db.execute(
        text("SELECT ST_X(geom), ST_Y(geom) FROM endereco WHERE tipo = 'endereco' ORDER BY id LIMIT 1")
    ).one()
    resultado = reverso(db, lat=lat, lon=lon)
    assert resultado.tipo == "endereco"


def test_p95_da_busca_abaixo_de_300_ms(db):
    textos = [
        linha[0]
        for linha in db.execute(
            text("SELECT texto_busca FROM endereco WHERE tipo = 'logradouro' ORDER BY id LIMIT 25")
        )
    ]
    consultas = [t[:5] for t in textos] + [f"{t} 100" for t in textos]
    buscar(db, consultas[0], 8)  # aquece conexão e planos
    tempos = []
    for consulta in consultas:
        inicio = time.perf_counter()
        buscar(db, consulta, 8)
        tempos.append(time.perf_counter() - inicio)
    tempos.sort()
    p95 = tempos[int(0.95 * len(tempos)) - 1]
    assert p95 < 0.300, f"p95 = {p95 * 1000:.0f} ms em {len(tempos)} buscas"
```

- [ ] **Step 2: Rodar**

Run (em `backend/`): `.venv/Scripts/python.exe -m pytest tests/test_geocode_dados_reais.py -v`
Expected: 4 passed.

Se falhar:
- `test_fatec_ipiranga_e_encontrada`: confira se a FATEC existe no OSM dentro do retângulo do Ipiranga (`SELECT rotulo FROM endereco WHERE texto_busca LIKE '%fatec%'`). Se não existir no OSM, registre o fato na monografia e troque o caso por um lugar que exista (por exemplo, uma estação de metrô da área piloto); não altere a lógica de busca para forçar o teste.
- `test_p95_da_busca_abaixo_de_300_ms`: rode `EXPLAIN ANALYZE` da consulta lenta (as de 5 caracteres como `rua a` são as suspeitas, porque `rua` aparece em quase toda linha) e registre o plano antes de mudar qualquer coisa. Não suba o limite de 300 ms sem decisão do dono.

- [ ] **Step 3: Documentar a etapa do ETL**

Em `etl/README.md`, na lista de etapas, acrescente:

```markdown
- `enderecos` (depende de `osm`): lê `dados/piloto.osm.pbf`, separa endereços com número (`addr:street` + `addr:housenumber`) e lugares com nome (`amenity`, `railway`, `public_transport`, `shop`, `leisure`, `tourism`, `office`, `healthcare`) e carrega a tabela `endereco` com eles e com uma linha por rua e bairro, derivada de `via_pedestre`. Alimenta `GET /api/geocode` e `/api/geocode/reverso`. Spec: `docs/superpowers/specs/2026-11-02-geocode-design.md`. Rodar sozinha: `docker compose --profile etl run --rm etl enderecos`.
```

E acrescente ao registro de execuções do README a linha com os números reais da Task 4, Step 5 (data, contagens por tipo, resultado do `pytest tests -q`).

- [ ] **Step 4: Indexar spec e plano**

Em `docs/README.md`, depois do item 0 (roteiro de planos), acrescente:

```markdown
0a. `superpowers/specs/2026-11-02-geocode-design.md` e `superpowers/plans/2026-11-02-plano-05a-geocode.md` — geocode local (busca por rua, número e lugar; reverso a 50 m), a metade backend do Plano 5.
```

- [ ] **Step 5: Verificação final**

Run (em `backend/`): `.venv/Scripts/python.exe -m pytest -q ; .venv/Scripts/python.exe -m ruff check . ; .venv/Scripts/python.exe -m ruff format --check .`
Run (na raiz): `docker compose --profile etl run --rm --entrypoint pytest etl tests -q`
Expected: as duas suítes verdes e lint limpo. Anote os totais de testes.

- [ ] **Step 6: Commit (só com autorização do dono)**

```bash
git add backend/tests/test_geocode_dados_reais.py etl/README.md docs/README.md
git commit -m "test(backend): geocode com dados reais e latência p95; docs da etapa enderecos"
```

---

### Task 9: Produção (só com autorização explícita do dono)

Esta task altera o banco de produção (Supabase) e depende de merge na `main` para o Render publicar. **Não execute nenhum passo sem o dono mandar.**

- [ ] **Step 1:** Abrir PR de `feat/backend` para `main` e esperar o CI verde.
- [ ] **Step 2:** Aplicar a migration 006 em produção, com `DATABASE_URL` apontando para produção **só nesse comando** (a partir de `backend/`). A forma usada até aqui foi via MCP do Supabase (`apply_migration`) com o SQL de `006_endereco.py`, seguida de `UPDATE alembic_version SET version_num = '006_endereco'`; confirme com o dono qual das duas usar.
- [ ] **Step 3:** Rodar a etapa contra produção: `docker compose --profile etl run --rm -e DATABASE_URL=<url de produção> etl enderecos` (~1 min). A URL vem do `.env` como `DATABASE_URL_PROD`; nunca imprima o valor.
- [ ] **Step 4:** Depois do deploy do Render, conferir `https://rota-falada-api.onrender.com/api/geocode?q=fatec` e `.../api/geocode/reverso?lat=-23.5895&lon=-46.6340` (a primeira chamada pode levar até 1 min por causa do cold start).

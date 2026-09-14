# Plano 3 — Conflação OSM × GeoSampa: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ligar cada aresta do grafo de pedestres (OSM, ODbL) ao polígono de calçada do GeoSampa (CC-BY-SA) que a representa, gravando **só chaves e distância** na tabela `conflacao_via_calcada`, com o buffer calibrado empiricamente contra um gabarito e a taxa de cobertura medida e publicada.

**Architecture:** Toda a geometria roda dentro do PostGIS em EPSG:31983 (`ST_DWithin`, `ST_Distance`, `ST_Contains`). O script `etl/etl/conflacao.py` é parametrizado pelo buffer e por um método de desempate; o script `etl/etl/calibracao_conflacao.py` roda a conflação para vários buffers contra o gabarito `etl/gabarito_conflacao.csv` e escreve um relatório Markdown com as métricas. O gate do spec (cobertura ≥ 30% das arestas com atributo métrico) é verificado por um teste.

**Tech Stack:** PostGIS 3.5, SQLAlchemy 2, pandas, pytest. Sem novas dependências.

## Global Constraints

- Tudo dos Planos 1 e 2 continua valendo.
- **`conflacao_via_calcada` guarda apenas `(via_id, calcada_id, distancia_m, confianca, metodo)`.** Nenhuma geometria, nenhum atributo copiado. É a peça que resolve ODbL × CC-BY-SA por modelagem.
- Distâncias e buffers **sempre em EPSG:31983**. Buffer em graus não é metro.
- Uma aresta liga-se a **no máximo um** polígono (o melhor candidato). Um polígono pode servir a várias arestas.
- Nada de IA. O gabarito é dado, não gerado por modelo.

## Estrutura de arquivos

```
backend/alembic/versions/003_conflacao.py
etl/etl/conflacao.py                 executar(engine, buffer_m, metodo) -> dict
etl/etl/calibracao_conflacao.py      python -m etl.calibracao_conflacao  → docs/pesquisa/<data>-calibracao-conflacao.md
etl/gabarito_conflacao.csv           via_osmid;calcada_cd_identificador;origem;observacao
etl/tests/test_conflacao_sql.py      integração: regras de desempate em dados sintéticos
etl/tests/test_qualidade_dados.py    (+ gate de cobertura e regras de licença)
docs/pesquisa/2026-09-XX-calibracao-conflacao.md  (gerado)
```

---

### Task 1: Migration `003_conflacao`

**Files:** `backend/alembic/versions/003_conflacao.py`, `backend/tests/test_migracao_conflacao.py`

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
CREATE INDEX conflacao_calcada_idx ON conflacao_via_calcada (calcada_id);

-- índices métricos funcionais para a conflação e para o Plano 4
CREATE INDEX via_pedestre_geom_31983_idx ON via_pedestre USING GIST (ST_Transform(geom, 31983));
CREATE INDEX calcada_sp_geom_31983_idx ON calcada_sp USING GIST (ST_Transform(geom, 31983));
```

- [ ] Teste de integração: tabela existe; `PRIMARY KEY (via_id)`; `information_schema.columns` de `conflacao_via_calcada` não contém coluna do tipo `geometry` nem nomes com `largura`/`declividade` (`test_licencas_nao_se_misturam` estendido).
- [ ] `alembic upgrade head`; commit `feat(backend): migration da tabela de conflação`.

---

### Task 2: Conflação parametrizada em SQL

**Files:** `etl/etl/conflacao.py`, `etl/etl/cli.py` (subcomando `conflacao --buffer 5 --metodo mesmo_lado`), `etl/tests/test_conflacao_sql.py`

**Interfaces:**
- `etl.conflacao.executar(engine, buffer_m: float = 5.0, metodo: str = 'mesmo_lado', *, so_medir: bool = False) -> dict` com `{'arestas': int, 'ligadas': int, 'cobertura': float, 'distancia_media_m': float, 'por_metodo': dict}`. Com `so_medir=True` não grava, só devolve métricas (usado pela calibração). Grava em `etl_execucao` com fonte `conflacao`.
- Regras, em ordem de prioridade, resolvidas numa única query com `DISTINCT ON (via_id)` e `ORDER BY via_id, prioridade, distancia_m`:
  1. **`contido`** (prioridade 0): `ST_Contains(calcada_31983, via_31983)` ou ≥ 80% do comprimento da aresta dentro do polígono (`ST_Length(ST_Intersection(...)) / ST_Length(via) >= 0.8`). `distancia_m = 0`, `confianca = 1.0`.
  2. **`mesmo_lado`** (prioridade 1): candidatos com `ST_DWithin(via_31983, calcada_31983, buffer_m)`; entre eles, preferir os que ficam do mesmo lado da via que a maioria dos pontos da aresta em relação ao eixo da rua. Implementação prática: se a aresta tem `esquema_calcada = 'geometria_propria'` (é a própria calçada), o candidato mais próximo já é do mesmo lado; se é `atributo_via`/`via_generica` (linha no eixo da rua), **escolher o mais próximo apenas quando o segundo mais próximo estiver a mais de `1.5 × distancia` do primeiro** (empate = ambiguidade entre os dois lados da rua → não liga; contar em `ambiguas`). `confianca = 1 - distancia_m / buffer_m`.
  3. **`mais_proximo`** (prioridade 2): usado só quando `metodo='mais_proximo'` é pedido explicitamente (linha de base para a calibração): sempre o candidato mais próximo dentro do buffer, sem regra de empate.
- Esqueleto da query (o implementador completa):

```sql
WITH v AS (
  SELECT id, esquema_calcada, ST_Transform(geom, 31983) AS g FROM via_pedestre
), c AS (
  SELECT id, ST_Transform(geom, 31983) AS g FROM calcada_sp
), cand AS (
  SELECT v.id AS via_id, c.id AS calcada_id,
         ST_Distance(v.g, c.g) AS distancia_m,
         ST_Length(ST_Intersection(v.g, c.g)) / NULLIF(ST_Length(v.g), 0) AS fracao_dentro,
         v.esquema_calcada
  FROM v JOIN c ON ST_DWithin(v.g, c.g, :buffer)
), ranqueado AS (
  SELECT *, row_number() OVER (PARTITION BY via_id ORDER BY distancia_m) AS pos,
         lead(distancia_m) OVER (PARTITION BY via_id ORDER BY distancia_m) AS distancia_segundo
  FROM cand
)
SELECT via_id, calcada_id, distancia_m,
       CASE WHEN fracao_dentro >= 0.8 THEN 'contido'
            ELSE :metodo END AS metodo,
       CASE WHEN fracao_dentro >= 0.8 THEN 1.0 ELSE 1 - distancia_m / :buffer END AS confianca
FROM ranqueado
WHERE pos = 1
  AND (fracao_dentro >= 0.8
       OR :metodo = 'mais_proximo'
       OR esquema_calcada = 'geometria_propria'
       OR distancia_segundo IS NULL
       OR distancia_segundo > 1.5 * GREATEST(distancia_m, 0.5));
```
- Carga: `DELETE FROM conflacao_via_calcada` + `INSERT ... SELECT` na mesma transação.

- [ ] **Step 1: Teste de integração com dados sintéticos** (`test_conflacao_sql.py`): insere, numa transação revertida ao final, 1 nó par, 3 arestas e 3 polígonos construídos em 31983 e transformados para 4326: (a) aresta dentro de um polígono → `contido`, `confianca=1`; (b) aresta no eixo de uma rua com um polígono a 4 m de cada lado → **não ligada** (ambígua) com `mesmo_lado`, ligada com `mais_proximo`; (c) aresta a 3 m de um polígono e 20 m de outro → `mesmo_lado` liga ao primeiro com `confianca = 1 - 3/5 = 0.4` para buffer 5.
- [ ] **Step 2: Implementar; rodar** `docker compose --profile etl run --rm etl conflacao --buffer 5 --metodo mesmo_lado` e anotar `cobertura` no README do ETL.
- [ ] **Step 3:** commit `etl: conflação OSM x GeoSampa parametrizada por buffer e método`.

---

### Task 3: Gabarito e calibração do buffer

**Files:** `etl/gabarito_conflacao.csv`, `etl/etl/calibracao_conflacao.py`, `docs/pesquisa/2026-09-XX-calibracao-conflacao.md` (gerado; substituir XX pela data real), `etl/README.md`

**Interfaces:**
- Gabarito (`;` como separador, UTF-8): `via_osmid;calcada_cd_identificador;origem;observacao`. `origem` ∈ {`automatico_contido`, `manual_streetview`}. Este plano **gera automaticamente** os casos `automatico_contido`: as 60 arestas com `esquema_calcada='geometria_propria'` cuja geometria está ≥ 95% dentro de exatamente um polígono (verdade inequívoca), estratificadas 20 por recorte da `area_piloto`. As linhas `manual_streetview` (mínimo 40, verificadas no Street View pela equipe) são tarefa humana das semanas 5–6 e ficam registradas como pendência no relatório; o script aceita ambas.
- `python -m etl.calibracao_conflacao --buffers 2 3 5 8 10 15 --saida docs/pesquisa/<data>-calibracao-conflacao.md`: para cada buffer e para os métodos `mesmo_lado` e `mais_proximo`, roda `executar(..., so_medir=True)` e, sobre o gabarito, calcula **acertos** (mesma calçada), **erros** (calçada diferente) e **sem par**. Escreve tabela Markdown, indica o "joelho" (menor buffer a partir do qual os acertos param de crescer mais que 2 pontos percentuais enquanto os erros crescem) e recomenda um buffer.
- Métricas globais por buffer também: cobertura (% de arestas ligadas), distância média, % ambíguas.

- [ ] **Step 1:** gerar `gabarito_conflacao.csv` automático (script auxiliar dentro de `calibracao_conflacao.py --gerar-gabarito`), commitá-lo.
- [ ] **Step 2:** rodar a calibração; ler o relatório; **fixar o buffer recomendado** em `etl/etl/config.py` como `BUFFER_CONFLACAO_M` e o método como `METODO_CONFLACAO = 'mesmo_lado'`; `cli tudo` passa a rodar a conflação com esses valores no final.
- [ ] **Step 3:** rodar a conflação definitiva; commit `etl: gabarito automático, calibração do buffer e valor fixado`.

---

### Task 4: Gate de cobertura e regras de licença nos testes de qualidade

**Files:** `etl/tests/test_qualidade_dados.py`, `README.md` (armadilha: "conflação ambígua não liga; é melhor não dizer largura do que dizer a errada")

- [ ] `test_conflacao_cobertura_minima`: `ligadas / arestas >= 0.30` (o gate do spec). Se falhar, o teste imprime a cobertura real e a instrução do gate: "assumir a camada colaborativa como fonte principal e tratar polígonos do GeoSampa como barreiras" (decisão humana; o teste **falha**, não decide).
- [ ] `test_conflacao_sem_geometria_nem_atributos` (já coberto na Task 1; manter aqui como guarda permanente).
- [ ] `test_conflacao_confianca_coerente`: `contido` ⇒ `confianca = 1` e `distancia_m = 0`; demais ⇒ `distancia_m <= buffer_m`.
- [ ] `test_conflacao_uma_calcada_por_aresta`: `count(*) = count(DISTINCT via_id)`.
- [ ] Commit `test(etl): gate de cobertura da conflação e guardas de licença`.

---

## Self-review

Cobertura do spec: tabela `conflacao_via_calcada` só com chaves e distância ✔; buffer calibrado com gabarito ✔ (parte automática agora, parte manual registrada como pendência humana); gate de 30% ✔; índices em 31983 para o Plano 4 ✔. Nomes usados adiante: `conflacao_via_calcada(via_id, calcada_id, distancia_m, confianca, metodo)`, `BUFFER_CONFLACAO_M`.

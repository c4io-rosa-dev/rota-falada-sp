# Plano 4 — Roteamento acessível: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar `POST /api/rotas`: rota a pé acessível em duas passadas no OpenRouteService (perfil `wheelchair`), desvio de barreiras validadas via `avoid_polygons`, fallback progressivo de exigência declarado na resposta, fallback determinístico em pgRouting, cache no PostGIS, passos enriquecidos com largura/declividade/guia/proveniência, e modo `USE_FIXTURES` para a demonstração sobreviver sem internet.

**Architecture:** Serviços puros e testáveis em `backend/app/services/`: `ors_client` (HTTP + cotas + fixtures), `barreira_geom` (corredor, buffers, teto de polígonos), `pgrouting` (fallback), `enriquecimento` (passos ← via_pedestre ← conflação ← calcada_sp), `rota` (orquestra as passadas e o fallback progressivo, cacheia). O router só valida entrada e chama `rota.calcular`. A chave do ORS vive apenas no servidor. Tudo determinístico.

**Tech Stack:** FastAPI, httpx + respx (testes), Shapely 2 + pyproj (buffers em 31983), SQLAlchemy 2, PostGIS/pgRouting (`pgr_dijkstra`), pytest.

## Global Constraints

- Tudo dos planos anteriores. Sem IA. Sem histórico de trajetos por usuário: `rota_cache` é anônimo.
- **ORS sempre por POST**, endpoint `https://api.openrouteservice.org/v2/directions/wheelchair/geojson`, header `Authorization: <ORS_API_KEY>`. Nunca no frontend.
- **Cotas:** ler `x-ratelimit-remaining` e `x-ratelimit-reset` de toda resposta e expor em `/health`; HTTP **403** = cota diária estourada, **429** = 40/min estourado. Não codificar o número da cota.
- **Limites de forma do ORS:** `avoid_polygons` ≤ 200 km² e ≤ 20 km de extensão; teto de **15 polígonos** por requisição (decisão do spec); rota com avoid areas ≤ 150 km.
- **Severidade** (do spec): `intransponivel` (2 confirmações se colaborativa; oficial das categorias `obstaculo_calcada`, `guia_sem_rebaixamento`, `buraco` conta como intransponível **apenas se aberta há menos de 180 dias**) vira `avoid_polygons`; `dificulta` não bloqueia, vira aviso; `informativo` só exibido; `nao_medido` nunca exibido como acessível.
- **Fallback progressivo** de `maximum_incline`: 3 → 6 → 10 → `any`, começando pelo valor pedido; a resposta declara `nivel_exigencia_atendido`.
- **Corredor** de 50 m ao redor da rota da 1ª passada; buffer de barreira de **8 m** em EPSG:31983 reprojetado para 4326.
- Cache `rota_cache`: chave `sha256(orig arredondada a 5 casas, dest a 5 casas, perfil serializado, hash_barreiras)`, TTL 6 h, coluna `regiao` (o corredor) para invalidação espacial.
- `USE_FIXTURES=true` ou `ORS_API_KEY` ausente ⇒ cliente de fixtures (nunca chama a rede).

## Estrutura de arquivos

```
backend/alembic/versions/004_roteamento.py         rota_cache, barreira_colaborativa (mínima), confirmacao (mínima)
backend/app/schemas/rota.py                        RotaIn, PerfilAcessibilidade, RotaOut, Passo, Aviso, BarreiraResumo
backend/app/services/ors_client.py                 OrsClient, OrsFixtureClient, OrsErro, EstadoCota
backend/app/services/barreira_geom.py              corredor(), poligonos_para_evitar(), hash_barreiras()
backend/app/services/pgrouting.py                  rota_pgrouting()
backend/app/services/enriquecimento.py             enriquecer_passos()
backend/app/services/rota.py                       calcular()
backend/app/services/cache_rota.py                 obter(), guardar(), invalidar_regiao()
backend/app/routers/rotas.py                       POST /api/rotas
backend/app/routers/health.py                      (+ ors_cota_restante, ors_cota_reset)
backend/app/fixtures/ors/*.json                    respostas gravadas (ou sintéticas marcadas)
backend/app/fixtures/README.md
backend/tests/services/test_ors_client.py          respx
backend/tests/services/test_barreira_geom.py       puro
backend/tests/services/test_pgrouting.py           integração
backend/tests/services/test_enriquecimento.py      integração
backend/tests/services/test_rota.py                fixtures + integração
backend/tests/test_rotas_api.py                    contrato
backend/tests/casos_referencia.json                10–15 pares origem/destino no piloto
```

---

### Task 1: Migration `004_roteamento` e schemas Pydantic

**Files:** `backend/alembic/versions/004_roteamento.py`, `backend/app/schemas/rota.py`, `backend/tests/test_migracao_roteamento.py`, `backend/tests/test_schemas_rota.py`

```sql
CREATE TABLE barreira_colaborativa (          -- versão mínima; o Plano 6 acrescenta usuário, foto, eventos
  id bigserial PRIMARY KEY,
  categoria text NOT NULL,
  severidade text NOT NULL CHECK (severidade IN ('intransponivel','dificulta','informativo')),
  descricao text,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','validada','contestada','resolvida','expirada')),
  confirmacoes integer NOT NULL DEFAULT 0,
  geom geometry(Point, 4326) NOT NULL,
  fonte_id integer NOT NULL REFERENCES fonte_dados(id),
  data_referencia date NOT NULL DEFAULT CURRENT_DATE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX barreira_colaborativa_geom_idx ON barreira_colaborativa USING GIST (geom);

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

Schemas (nomes são contrato com o frontend do Plano 5):

```python
Coordenada(lat: float = Field(ge=-90, le=90), lng: float = Field(ge=-180, le=180))
PerfilAcessibilidade(
  inclinacao_max: Literal[3, 6, 10, "any"] = 6,
  guia_max_m: Literal[0.03, 0.06, 0.1, "any"] = 0.06,
  largura_min_m: float = Field(0.9, ge=0.5, le=3),
  evitar_degraus: bool = True,
  velocidade_kmh: float = Field(3.0, ge=0.5, le=6),
)
RotaIn(origem: Coordenada, destino: Coordenada, perfil: PerfilAcessibilidade = PerfilAcessibilidade())
BarreiraResumo(id: int, origem: Literal["oficial","colaborativa"], categoria: str, severidade: str, distancia_m: float, confirmacoes: int | None, data_referencia: date | None)
Passo(ordem: int, instrucao: str, distancia_m: float, duracao_s: float, direcao: str,
      largura_m: float | None, largura_medida: bool, declividade_pct: float | None, declividade_medida: bool,
      guia: Literal["transponivel","nao_transponivel","desconhecida"], is_degrau: bool,
      barreiras_proximas: list[BarreiraResumo], fonte: str, data_referencia: date | None,
      geometria: dict)   # GeoJSON LineString
Aviso(tipo: Literal["exigencia_relaxada","barreira_dificulta","trecho_sem_dados","motor_fallback"], mensagem: str)
RotaOut(passos: list[Passo], distancia_m: float, duracao_s: float, avisos: list[Aviso],
        nivel_exigencia_atendido: Literal[3, 6, 10, "any"], motor: Literal["ors","pgrouting","fixture"],
        fontes: list[str], geometria: dict, cache: bool)
```

- [ ] Testes: migration cria as tabelas; `RotaIn` rejeita `lat=91`; `PerfilAcessibilidade()` tem os defaults do spec; `RotaOut` serializa `date` como ISO.
- [ ] Commit `feat(backend): migration de roteamento e schemas de rota`.

---

### Task 2: Cliente ORS com cotas, erros e fixtures

**Files:** `backend/app/services/ors_client.py`, `backend/app/fixtures/ors/`, `backend/app/fixtures/README.md`, `backend/app/config.py` (+ `ors_base_url`, `ors_timeout_s=15`), `backend/tests/services/test_ors_client.py`

**Interfaces:**
```python
@dataclass
class EstadoCota: restante: int | None; reset_em: datetime | None; atualizado_em: datetime | None
class OrsErro(Exception): codigo: str  # 'sem_rota' | 'cota_diaria' | 'cota_minuto' | 'entrada_invalida' | 'indisponivel'

class OrsClient:
    def __init__(self, chave: str, base_url: str, timeout_s: float, estado: EstadoCota): ...
    def rota(self, coords: list[tuple[float,float]], *, restricoes: dict, evitar_degraus: bool,
             avoid_polygons: dict | None) -> dict:   # GeoJSON FeatureCollection do ORS (1 feature)
        """POST /v2/directions/wheelchair/geojson com body:
        {"coordinates": [[lng,lat],...], "elevation": true, "instructions": true, "language": "pt",
         "extra_info": ["steepness","surface","waytype"], "units": "m",
         "options": {"avoid_features": ["steps"] se evitar_degraus,
                     "profile_params": {"restrictions": restricoes},
                     "avoid_polygons": avoid_polygons (omitir se None)}}
        Atualiza estado.restante/reset_em dos headers x-ratelimit-*.
        Mapeia: 403->cota_diaria, 429->cota_minuto, 404 com error.code 2009/2010 -> sem_rota,
        400/406 -> entrada_invalida, timeout/5xx -> indisponivel."""

class OrsFixtureClient(OrsClient):
    """Mesma interface; lê backend/app/fixtures/ors/<nome>.json escolhendo pelo arredondamento
    das coordenadas de origem/destino (5 casas) + inclinacao; se não houver fixture exata,
    devolve a fixture 'generica' transladada para as coordenadas pedidas (mantém a forma)."""

def criar_cliente(settings) -> OrsClient  # fixtures se settings.use_fixtures ou sem chave
```
- `restricoes` é montado por `rota.py`: `{"maximum_incline": n, "maximum_sloped_kerb": g, "minimum_width": w, "surface_type": "cobblestone:flattened", "smoothness_type": "good"}`; quando `inclinacao_max == "any"` enviar `"any"`.

- [ ] **Step 1: Testes com respx**: monta body correto (inclui `avoid_polygons` só quando dado; `avoid_features` só quando `evitar_degraus`); lê headers de cota; 403→`OrsErro('cota_diaria')`; 429→`cota_minuto`; 404 `{"error":{"code":2009}}`→`sem_rota`; timeout→`indisponivel`; `criar_cliente` sem chave devolve `OrsFixtureClient`.
- [ ] **Step 2: Fixtures.** Se `ORS_API_KEY` estiver no `.env` da raiz (verificar com `python -c` lendo `app.config.settings.ors_api_key is not None`, **sem imprimir a chave**), gravar 4 respostas reais dos casos de referência (Task 6) com um script `backend/scripts/gravar_fixtures_ors.py`. Se **não** estiver, criar fixtures **sintéticas** com a estrutura documentada do ORS (FeatureCollection; `features[0].properties.segments[].steps[]` com `distance, duration, instruction, name, way_points`; `properties.extras.steepness.values` como `[[i0,i1,classe]]`; `properties.summary.distance/duration/ascent/descent`; `geometry.coordinates` 3D) e escrever em `fixtures/README.md`, em negrito, que são sintéticas e devem ser regravadas com chave. Nunca commitar chave.
- [ ] **Step 3:** commit `feat(backend): cliente ORS com cotas, erros mapeados e fixtures`.

---

### Task 3: Geometria de barreiras (corredor, buffers, teto, hash)

**Files:** `backend/app/services/barreira_geom.py`, `backend/tests/services/test_barreira_geom.py` (puro, sem banco) e `backend/tests/services/test_barreira_geom_db.py` (integração)

**Interfaces:**
```python
PROJ_4326_31983 / PROJ_31983_4326  # pyproj Transformer, always_xy=True
def corredor(linha_4326: LineString, largura_m: float = 50.0) -> Polygon    # buffer em 31983, volta em 4326
def barreiras_no_corredor(db, corredor_4326: Polygon) -> list[BarreiraCandidata]
    # UNION de barreira_colaborativa (status='validada' AND confirmacoes>=2 AND severidade='intransponivel')
    #   e barreira_oficial (categoria IN ('obstaculo_calcada','guia_sem_rebaixamento','buraco') AND data_abertura >= CURRENT_DATE - 180 AND (data_finalizacao IS NULL))
    #   e, como 'dificulta', colaborativas validadas com severidade='dificulta' e oficiais das demais categorias
    # ST_Intersects(geom, corredor); devolve id, origem, categoria, severidade, geom, confirmacoes, data_referencia, distancia até a linha
def poligonos_para_evitar(barreiras: list[BarreiraCandidata], linha_4326, teto: int = 15, buffer_m: float = 8.0) -> dict | None
    # só intransponíveis; ordena por (severidade, distância à linha); corta no teto; buffer 8 m em 31983;
    # devolve GeoJSON MultiPolygon em 4326 ou None se vazio; valida extensão <= 20 km e área <= 200 km²
def hash_barreiras(db, corredor_4326) -> str   # sha256 de (count, max(atualizado_em)) das colaborativas + count das oficiais no corredor
```

- [ ] Testes puros: `corredor` de uma linha de 1 km tem área ≈ 1000×100 m² (±10%); `poligonos_para_evitar` com 20 barreiras devolve 15 polígonos; buffer de 8 m produz polígono com "raio" 8 m (±0,2) medido em 31983; None quando não há intransponíveis.
- [ ] Teste de integração: insere uma barreira colaborativa validada e uma oficial antiga (200 dias) numa transação revertida; só a colaborativa vira polígono; `hash_barreiras` muda quando se insere outra.
- [ ] Commit `feat(backend): corredor, buffers e teto de polígonos de barreiras`.

---

### Task 4: Fallback pgRouting

**Files:** `backend/app/services/pgrouting.py`, `backend/tests/services/test_pgrouting.py`

**Interfaces:**
```python
def no_mais_proximo(db, lat, lng, raio_m=300) -> int | None   # no_pedestre por ST_DWithin em 31983, ordenado por distância
def rota_pgrouting(db, origem: Coordenada, destino: Coordenada, *, bbox_margem_m: float = 1500) -> RotaBruta | None
    # pgr_dijkstra('SELECT id, source, target, custo_acessivel AS cost, custo_reverso AS reverse_cost
    #               FROM via_pedestre WHERE geom && ST_Expand(<envelope orig/dest em 4326>, <margem em graus ~ bbox_margem_m>)',
    #              no_origem, no_destino, directed := false)
    # junta as arestas na ordem, monta LineString, soma comprimento_m, marca is_degrau/kerb por aresta
    # devolve None se não há caminho (aresta com custo >= 1e6 no caminho também conta como 'sem rota acessível')
@dataclass class RotaBruta: geometria: LineString; arestas: list[int]; distancia_m: float
```
- Instruções de passo no fallback são geradas por mudança de `nome` da via ("Siga pela Rua X por 120 m") e viradas por ângulo (> 30° esquerda/direita) — determinístico, em `pgrouting.instrucoes(rota_bruta) -> list[PassoBruto]`.

- [ ] Testes de integração (dados reais do piloto): dois nós de Vila Mariana a ~500 m devolvem rota com `distancia_m` entre 400 e 1500 e sem `is_degrau`; origem fora do piloto devolve `None`; após inserir (em transação revertida) `custo_acessivel = 1e6` em todas as arestas de um corte, devolve `None`.
- [ ] Commit `feat(backend): fallback determinístico com pgRouting`.

---

### Task 5: Enriquecimento dos passos

**Files:** `backend/app/services/enriquecimento.py`, `backend/tests/services/test_enriquecimento.py`

**Interfaces:**
```python
def enriquecer_passos(db, passos_brutos: list[PassoBruto], barreiras_dificulta: list[BarreiraCandidata], extras_steepness: list | None) -> tuple[list[Passo], list[Aviso], set[str]]
    # para cada passo (LineString): via_pedestre mais próxima com ST_DWithin 10 m (31983) ao ponto médio
    #   -> kerb_transponivel -> guia; is_degrau; fonte 'osm' + data_referencia
    #   -> conflacao_via_calcada -> calcada_sp -> largura_min_m/largura_medida, declividade_max_pct/declividade_medida
    #   (se conflação ausente: largura_m=None, largura_medida=False, aviso 'trecho_sem_dados' UMA vez por rota)
    # declividade_pct: se extras_steepness do ORS existe, usa a classe do segmento (mapa: -5..5 -> 0,±1..±5 -> 3,6,10,15,>15... ver docs ORS); senão a do GeoSampa
    # barreiras_proximas: 'dificulta'/'informativo' a <= 15 m do passo -> BarreiraResumo + Aviso 'barreira_dificulta' por barreira
    # fontes usadas -> set de chaves de fonte_dados para o rodapé
```
- Regra inegociável: `largura_medida=False` ⇒ `largura_m=None` mesmo que o GeoSampa tenha 0.

- [ ] Testes de integração com um passo sobre uma aresta real conflada (`SELECT ... LIMIT 1 WHERE EXISTS conflação`) → `largura_m` preenchida e `largura_medida=True`; um passo sobre aresta sem conflação → `None` e aviso; aresta com `kerb_transponivel=false` → `guia='nao_transponivel'`.
- [ ] Commit `feat(backend): enriquecimento dos passos com OSM, GeoSampa e barreiras`.

---

### Task 6: Serviço de rota (duas passadas, fallback progressivo, cache) e casos de referência

**Files:** `backend/app/services/rota.py`, `backend/app/services/cache_rota.py`, `backend/tests/services/test_rota.py`, `backend/tests/casos_referencia.json`

**Interfaces:**
```python
def calcular(db, entrada: RotaIn, cliente: OrsClient, agora: datetime) -> RotaOut
```
Algoritmo (fiel ao spec):
1. `chave = cache_rota.chave(entrada, hash_barreiras(db, corredor_provisorio))` onde o corredor provisório é o buffer de 50 m da reta origem→destino; se `cache_rota.obter` devolve algo não expirado → `RotaOut(cache=True)`.
2. Para `nivel` em `[pedido, ...níveis seguintes até "any"]`:
   a. 1ª passada: `cliente.rota(coords, restricoes(nivel), evitar_degraus, None)`; `OrsErro('sem_rota')` → próximo nível; `cota_*`/`indisponivel` → sai do laço e vai para pgRouting.
   b. `corredor` da geometria; `barreiras_no_corredor`; `poligonos_para_evitar`.
   c. Se há polígonos: 2ª passada com `avoid_polygons`; `sem_rota` → próximo nível (registrar aviso).
   d. Sucesso → sai.
3. Se nenhum nível deu rota pelo ORS: `rota_pgrouting`; None → HTTP 404 com mensagem "Não encontramos rota acessível entre esses pontos na área piloto." (levantar `RotaNaoEncontrada`).
4. Passos brutos (do ORS: `segments[0].steps` + fatias de `geometry.coordinates` por `way_points`; do pgRouting: `instrucoes`), `enriquecer_passos`, avisos (`exigencia_relaxada` se `nivel != pedido`, `motor_fallback` se pgRouting), `nivel_exigencia_atendido`, `duracao_s` recalculada com `velocidade_kmh` do perfil (não a do ORS), `fontes` ordenadas.
5. `cache_rota.guardar(chave, RotaOut, regiao=corredor, ttl=6h)`.

`cache_rota`: `chave(entrada, hash_barreiras) -> str`, `obter(db, chave, agora) -> RotaOut | None`, `guardar(db, chave, saida, regiao, agora)`, `invalidar_regiao(db, ponto_4326)` (apaga entradas cuja `regiao` intersecta o ponto; usado pelo Plano 6 ao validar barreira; expor já agora e testar).

`casos_referencia.json`: 10–15 objetos `{ "nome", "origem": {lat,lng}, "destino": {lat,lng}, "recorte", "espera": {"sem_degraus": true, "distancia_max_m": N, "evita_barreira_id": null|int}, "verificado_streetview": false }` escolhidos pelo implementador sobre nós reais de `no_pedestre` (um par por combinação recorte × distância curta/média), incluindo o caso de regressão do spec: **um POI `wheelchair=no` a 5 m de uma calçada NÃO bloqueia a calçada** (inserir barreira `informativo` e verificar que a rota passa e o aviso aparece). `verificado_streetview` fica `false` até a equipe conferir (pendência humana).

- [ ] Testes (`test_rota.py`): com `OrsFixtureClient`: cache miss → `cache=False`, segunda chamada → `cache=True`; fixture que devolve `sem_rota` no nível 3 e rota no 6 → `nivel_exigencia_atendido=6` e aviso `exigencia_relaxada`; cliente que levanta `cota_diaria` → `motor='pgrouting'` e aviso `motor_fallback`; barreira intransponível validada inserida no corredor → 2ª passada é chamada com `avoid_polygons` (verificar com um cliente espião); os casos de referência rodam com pgRouting real e cumprem `espera` (marcados `integration`).
- [ ] Commit `feat(backend): serviço de rota em duas passadas com fallback progressivo, pgRouting e cache`.

---

### Task 7: `POST /api/rotas`, `/health` com cota do ORS, README e frontend types

**Files:** `backend/app/routers/rotas.py`, `backend/app/main.py`, `backend/app/routers/health.py`, `backend/app/schemas/health.py`, `backend/tests/test_rotas_api.py`, `backend/tests/test_health.py`, `README.md`, `frontend/src/api/types.gen.ts` (regenerar)

- [ ] `POST /api/rotas` (`response_model=RotaOut`): 422 para entrada inválida; 404 `{"detail": "..."}` para `RotaNaoEncontrada`; 503 para `OrsErro` de cota **apenas se** o pgRouting também falhar; `cliente = criar_cliente(settings)` via `Depends`.
- [ ] `/health` ganha `ors_cota_restante: int | None`, `ors_cota_reset: datetime | None`, `modo_fixtures: bool`.
- [ ] Teste de contrato: `POST /api/rotas` com um caso de referência (fixtures) devolve 200 e `passos[0]` tem todos os campos de `Passo`; `lat=91` → 422.
- [ ] Regenerar `frontend/src/api/types.gen.ts` com o backend no ar (`npm run gerar-tipos`) e commitar (o Plano 5 depende de `RotaIn`/`RotaOut`).
- [ ] README: seção "Roteamento" (como obter a chave do ORS em `openrouteservice.org/dev/#/signup`, variável `ORS_API_KEY`, `USE_FIXTURES`, como regravar fixtures) e armadilhas: "ORS sempre POST; chaves novas são JWT; `avoid_polygons` é bloqueio binário; `pgr_dijkstra` com `directed := false`".
- [ ] Commit `feat(backend): POST /api/rotas, cota do ORS no /health e tipos regenerados`; push.

---

## Self-review

Cobertura do spec (seção 6 e fluxo da seção 3): duas passadas ✔, corredor 50 m ✔, buffer 8 m em 31983 ✔, teto 15 ✔, sempre POST ✔, severidade graduada ✔ (Task 3), fallback 3→6→10→any declarando nível ✔ (Task 6), cotas por header em `/health` ✔ (Tasks 2, 7), cache com `regiao` ✔, pgRouting como fallback com `custo_acessivel` ✔ (Task 4), enriquecimento por conflação com `largura_medida` ✔ (Task 5), `USE_FIXTURES` ✔, casos de referência com a regressão do POI ✔, `duracao_s` pelo `velocidade_caminhada` do perfil ✔. **Deixado para depois:** `alternative_routes` ranqueadas por barreiras leves (futuro), transporte público (Plano 7), geocode (Plano 5). Nomes de contrato para o Plano 5: `RotaIn`, `RotaOut`, `Passo`, `Aviso`, `POST /api/rotas`.

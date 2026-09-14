# Roteiro de planos de implementação — Rota Falada SP

**Spec de referência:** `docs/superpowers/specs/2026-09-08-rotas-acessiveis-sp-design.md` (aprovado em 13/09/2026, backend Python + FastAPI).

O spec cobre subsistemas que dependem uns dos outros e cujas decisões finas (buffer de conflação, taxa de cobertura, cotas reais do ORS) só se conhecem depois de executar o subsistema anterior. Por isso o trabalho é dividido em oito planos, um por fase do cronograma. Cada plano produz software funcionando e testável sozinho. Só o Plano 1 está escrito agora; os seguintes são escritos quando o anterior termina, com as medições reais em mãos.

## Sequência

| # | Plano | Semanas | Entregável verificável | Gate de saída |
|---|---|---|---|---|
| 1 | **Fundação** (este é o único já escrito: `2026-09-13-plano-01-fundacao.md`) | 1–2 | Monorepo, PostGIS local, FastAPI com `/health` e `/api/fontes`, React acessível com páginas `/`, `/fontes`, `/acessibilidade`, CI verde, gitleaks, deploy ponta a ponta em Render + Supabase + Cloudflare Pages | URL pública respondendo; CI verde; zero violações no axe |
| 2 | ETL das fontes oficiais | 3–4 | Scripts `etl/01_osm`, `02_geosampa`, `03_sp156`, `04_gtfs` carregando a área piloto no PostGIS, com testes de qualidade de dados que falham o build; job agendado no GitHub Actions; `/health` passa a informar `ultimo_etl` | Tabelas `via_pedestre`, `calcada_sp`, `barreira_oficial`, `parada`/`linha` populadas; `test_wfs_nao_truncou` e `test_calcada_sem_zeros_mascarados` verdes |
| 3 | Conflação | 5–6 | Notebook de calibração do buffer com gabarito manual de 50–100 trechos; script `etl/05_conflacao`; tabela `conflacao_via_calcada` só com chaves e distância | Taxa de arestas com atributo métrico medida. **Se < 30%**, muda a estratégia: polígonos do GeoSampa viram barreiras diretas |
| 4 | Roteamento | 7–8 | `POST /api/rotas` com duas passadas no ORS, corredor de 50 m, `avoid_polygons` (teto 15), fallback progressivo 3→6→10→any, `rota_cache`, fallback pgRouting, fixtures gravadas, `USE_FIXTURES` | Rota desviando de barreira real em 10–15 casos de referência verificados no Street View |
| 5 | Frontend da rota | 9–10 | Busca com autocomplete local (`GET /api/geocode`, Photon como fallback), lista de passos canônica, região viva única, foco no h1, mapa Leaflet redundante só na semana 10 | Fluxo completo só por teclado e NVDA; Lighthouse ≥ 95; zero violações críticas |
| 6 | Camada colaborativa | 11–12 | Supabase Auth, `POST /api/barreiras` idempotente, `confirmacao` com voto único, `barreira_evento`, moderação (2 confirmações, contestação, resolvido, expiração), invalidação espacial do cache | Usuário cadastra barreira e a rota muda |
| 7 | SPTrans, voz e offline | 13–14 | Proxy `GET /api/paradas/previsoes` com sessão e cache de 25 s, painel "próximo ônibus acessível", `SpeechSynthesis`, `SpeechRecognition` com consentimento, fila offline em IndexedDB | Reporte offline que sobe sozinho ao reconectar |
| 8 | Endurecimento e entrega | 15–16 | Teste com usuário real, matriz manual de leitores de tela, `limites-e-contingencias.md`, ADRs, ensaio duplo da demo (com e sem serviços externos) | Demo ensaiada; monografia com os números reproduzíveis |

**Ordem de corte se o cronograma apertar** (do spec): (1) SPTrans → (2) SP156 → (3) fallback Photon → (4) reconhecimento de voz. Nunca cortar a camada colaborativa nem a acessibilidade.

## Trilhas para 5 pessoas

- **Trilha Dados/Backend (3 pessoas):** Planos 1 (backend e infra), 2, 3, 4, 6 (API), 7 (proxy SPTrans).
- **Trilha Frontend/Acessibilidade (2 pessoas):** Planos 1 (frontend e CI de a11y), 5, 6 (formulário de cadastro), 7 (voz e offline).
- Os dois grupos convergem nos Planos 1 e 8.

A partir do Plano 2 as trilhas podem correr em paralelo: enquanto Dados faz ETL e conflação (semanas 3–6), Frontend pode antecipar o Plano 5 contra fixtures de rota gravadas, desde que o contrato de `POST /api/rotas` (schema Pydantic) seja fechado na primeira semana do Plano 4 ou antes.

## Convenções válidas para todos os planos

- Commits pequenos e frequentes, em português, no formato `tipo: descrição` (`feat`, `fix`, `docs`, `test`, `chore`, `etl`).
- TDD: teste falhando antes do código, em todo passo que produz código.
- Nenhuma chave em arquivo versionado. `.env` local, variáveis de ambiente no Render, Secrets no GitHub.
- Nomes de domínio em português (`fonte_dados`, `via_pedestre`, `barreira_colaborativa`), identificadores técnicos em inglês quando forem convenção da ferramenta (`source`/`target` do pgRouting).
- Toda tabela espacial carrega `fonte_id`, `data_referencia` e `geom` em SRID 4326; cálculo métrico sempre em EPSG:31983.
- A aplicação é 100% determinística: nenhuma chamada a modelo de IA no backend ou no frontend.

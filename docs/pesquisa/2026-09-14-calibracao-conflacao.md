# Calibração do buffer de conflação OSM x GeoSampa

Gerado em 2026-09-14 pelo `etl/etl/calibracao_conflacao.py` (Plano 3, Task 3).

## Gabarito

- `automatico_contido`: **27** linhas (geradas automaticamente: arestas `geometria_propria` com >= 95% do comprimento dentro de exatamente um polígono do GeoSampa e `osmid` único no grafo — verdade dada, sem buffer nem julgamento humano).
- `manual_streetview`: **0** linhas.

**Pendência para o dono do projeto:** este plano gera só a parte automática do gabarito. As linhas `manual_streetview` (mínimo 40, verificadas no Street View pela equipe humana, semanas 5–6) ainda não existem — a calibração abaixo usa só os `automatico_contido`. `etl.calibracao_conflacao.ler_gabarito`/`avaliar_buffer` já aceitam as duas origens sem mudança de código; basta acrescentar as linhas `manual_streetview` a `etl/gabarito_conflacao.csv` e rodar este script de novo.

## Método `mais_proximo`

| buffer (m) | cobertura | distância média (m) | ambíguas | acertos | erros | sem par | acerto sobre avaliado |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2 | 41.1% | 0.35 | 0 | 24 | 3 | 0 | 88.9% |
| 3 | 50.8% | 0.76 | 0 | 24 | 3 | 0 | 88.9% |
| 5 | 80.0% | 1.97 | 0 | 24 | 3 | 0 | 88.9% |
| 8 | 90.0% | 2.41 | 0 | 24 | 3 | 0 | 88.9% |
| 10 | 91.4% | 2.50 | 0 | 24 | 3 | 0 | 88.9% |
| 15 | 93.1% | 2.68 | 0 | 24 | 3 | 0 | 88.9% |

## Método `mesmo_lado`

| buffer (m) | cobertura | distância média (m) | ambíguas | acertos | erros | sem par | acerto sobre avaliado |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2 | 34.2% | 0.32 | 1734 | 24 | 3 | 0 | 88.9% |
| 3 | 38.7% | 0.60 | 3031 | 24 | 3 | 0 | 88.9% |
| 5 | 43.9% | 1.11 | 9033 | 24 | 3 | 0 | 88.9% |
| 8 | 41.8% | 1.04 | 12078 | 24 | 3 | 0 | 88.9% |
| 10 | 41.9% | 1.10 | 12377 | 24 | 3 | 0 | 88.9% |
| 15 | 42.6% | 1.29 | 12650 | 24 | 3 | 0 | 88.9% |

## Observação: os 3 erros do `'contido'` (não é sensível ao buffer)

Investigados individualmente (14/09/2026): os 3 casos `automatico_contido` que erram fazem isso em **todo** buffer testado, porque a causa não é o buffer — é um polígono do GeoSampa sobreposto a outro no mesmo lugar. Nos três casos, a via está a distância 0 de **duas** calçadas (`ST_Distance = 0` para as duas), e a regra de desempate de `etl/conflacao.py` (`ORDER BY distancia_m, calcada_id`) escolhe a de menor `id`, que nem sempre é a que o gabarito identificou pelo critério mais rigoroso (>= 95% do comprimento contido, ver `FRACAO_MINIMA_GABARITO`). Fora do escopo desta task (mudar o desempate é código da Task 2, já commitado); registrado aqui como achado real para o dono do projeto avaliar — por exemplo, desempatar por maior `fracao_dentro` em vez de menor `calcada_id` quando a distância empatar em zero.

## Joelho da curva de acertos

No método `mesmo_lado`, os acertos **não formaram um joelho** dentro do buffer testado — com o gabarito atual (só `automatico_contido`), essa curva fica praticamente constante em todo buffer: essas linhas testam exclusivamente a regra `'contido'` de `etl/conflacao.py`, que vence a disputa de prioridade **independente do buffer** sempre que a aresta está de fato dentro do polígono. Este critério só vai discriminar buffers de verdade quando as linhas `manual_streetview` (casos ambíguos, verificados no Street View) forem acrescentadas ao gabarito — ver pendência acima.

## Pico de cobertura e buffer recomendado

Enquanto o joelho de acertos não é decisivo, `BUFFER_CONFLACAO_M` é fixado pelo buffer que **maximiza a cobertura** no método `mesmo_lado` — essa curva, ao contrário da de acertos, é sensível ao buffer: a regra de desempate do `'mesmo_lado'` (não liga quando o segundo candidato mais próximo é ambíguo, ver `etl/conflacao.py`) rejeita mais candidatos como empate conforme buffers maiores trazem o lado oposto da rua para dentro do alcance, então a cobertura pode cair depois de um pico. Pico observado em **5 m**.

**Buffer recomendado e fixado: 5 m** (`BUFFER_CONFLACAO_M = 5`, `METODO_CONFLACAO = 'mesmo_lado'` em `etl/etl/config.py`).

# Fixtures do ORS

Respostas do OpenRouteService (perfil `wheelchair`, endpoint
`/v2/directions/wheelchair/geojson`) usadas por `OrsFixtureClient` quando
`USE_FIXTURES=true` ou quando `ORS_API_KEY` não está configurada. O cliente de
fixtures **nunca chama a rede**.

## Como o cliente escolhe o arquivo

`OrsFixtureClient.rota()` monta um nome a partir do arredondamento (5 casas
decimais) das coordenadas de origem/destino e da inclinação máxima pedida:

```
<lat_origem>_<lng_origem>_<lat_destino>_<lng_destino>_<inclinacao_max>.json
```

Se não existir um arquivo com esse nome exato, o cliente usa
`generica.json` e **transladada** (translação linear de longitude/latitude)
até a coordenada de origem pedida, preservando a forma (distâncias
relativas) da rota original — assim qualquer par origem/destino do piloto
sempre recebe uma resposta plausível, mesmo sem fixture específica gravada.

## Estado atual: `generica.json` é **SINTÉTICA**

**`app/fixtures/ors/generica.json` foi escrita à mão para reproduzir
fielmente a estrutura documentada da resposta do ORS (`FeatureCollection`
com `features[0].properties.segments[].steps[]`, `properties.extras`
com `steepness`/`surface`/`waytype`, `properties.summary` e
`geometry.coordinates` 3D com elevação) — ela NÃO veio de uma chamada real
à API do ORS**, porque no momento em que a Tarefa 2 do Plano 4 foi
implementada não havia `ORS_API_KEY` configurada no `.env` da raiz
(verificado com `python -c "from app.config import settings; print(settings.ors_api_key is not None)"`,
que devolveu `False`).

**Antes de usar isso como evidência de que a integração real com o ORS
funciona, regrave as fixtures com uma chave válida.**

### Como regravar com uma chave real

1. Obtenha uma chave gratuita em `openrouteservice.org/dev/#/signup` e
   coloque em `ORS_API_KEY=...` no `.env` da raiz do repositório (nunca
   commitado).
2. Com o venv do backend ativado, rode a partir de `backend/`:
   ```
   python scripts/gravar_fixtures_ors.py
   ```
   O script lê `backend/tests/casos_referencia.json` (Task 6 do Plano 4) se
   já existir e grava no máximo 4 respostas — poucas requisições, respeitando
   o limite de 40/min do ORS (o script já aguarda entre chamadas). Se esse
   arquivo ainda não existir, usa um par de coordenadas do piloto (Vila
   Mariana) embutido no próprio script.
3. Depois de regravar, atualize este README removendo o aviso acima para os
   casos já cobertos por respostas reais.

Nunca commite a chave nem o `.env` da raiz.

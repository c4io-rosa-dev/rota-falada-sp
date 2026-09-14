# ADR 002 — Grafo de pedestres com osmium + osmnx, não `osm2pgsql`

**Data:** 14/09/2026 · **Status:** aceito

## Contexto

O roteamento acessível precisa de um grafo de pedestres com topologia explícita: cada aresta de `via_pedestre` tem que apontar para um `source`/`target` em `no_pedestre`, porque é sobre essas colunas que o pgRouting calcula o caminho mínimo. A ferramenta mais comum para carregar OSM em PostGIS é o `osm2pgsql`, usado por praticamente todo tile server de mapa.

## Decisão

O ETL do OSM (Task 3) recorta o `.osm.pbf` da área piloto com `osmium extract`/`tags-filter`, converte para XML e monta o grafo com `osmnx.graph_from_xml` (que usa NetworkX por baixo), aplicando as regras puras de `osm_regras.py` antes de carregar `no_pedestre`/`via_pedestre` via GeoPandas/`to_postgis`.

## Justificativa

1. `osm2pgsql` carrega vias como uma `LineString` por `way` do OSM, sem dividi-las nos cruzamentos: duas ruas que se cruzam viram duas geometrias que só se tocam por coincidência de coordenada, sem nó compartilhado. O pgRouting precisa que cada aresta tenha `source`/`target` explícitos apontando para o mesmo nó nos cruzamentos, senão o caminho mínimo não atravessa de uma via para outra.
2. `osmnx` resolve exatamente esse problema: constrói um grafo do NetworkX onde cada nó é uma interseção (ou ponta de via) e cada aresta liga dois nós, já simplificando vias colineares sem interseção real (`simplify_graph`) e preservando os atributos que variam (`edge_attrs_differ`) — o mesmo atributo que a Task 3 usa para não perder `kerb`, `surface` etc. na simplificação.
3. O `osm2pgsql` teria exigido reconstruir essa topologia por conta própria (um `ST_Node` + agrupamento por coordenada), reimplementando o que o `osmnx` já faz e testa.

## Consequências

- O ETL passa a depender do `osmnx` (e, por baixo, do NetworkX e do GeoPandas), uma dependência mais pesada que `osm2pgsql`, mas o pacote já está no plano de tecnologia do backend (ver `docs/adr/001-backend-python.md`) para a etapa de conflação.
- A topologia de cruzamentos é garantida pela biblioteca, não por SQL escrito à mão — reduz risco de bug no grafo, mas amarra o pipeline ao formato de grafo do `osmnx` (perder essa dependência exigiria reescrever a Task 3 inteira).
- Não há atualização incremental por diff do OSM no MVP: cada execução do ETL recorta e remonta o grafo do zero a partir do `.osm.pbf` completo baixado da Geofabrik. Atualização incremental (`.osc`) fica fora de escopo deste plano.

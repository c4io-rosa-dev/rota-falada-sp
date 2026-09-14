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

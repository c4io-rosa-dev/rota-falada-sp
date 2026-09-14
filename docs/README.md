# Documentação do projeto

Projeto da disciplina Engenharia de Software II (FATEC, 4º semestre): guia de rotas acessíveis com alertas de barreiras físicas para a cidade de São Paulo.

## Como ler

0. `superpowers/plans/2026-09-13-roteiro-de-planos.md` — sequência dos 8 planos de implementação; `superpowers/plans/2026-09-13-plano-01-fundacao.md` — Plano 1 completo (semanas 1–2).
1. `superpowers/specs/2026-09-08-rotas-acessiveis-sp-design.md` — documento de design (arquitetura, backend, modelo de dados, roteamento, acessibilidade, MVP, cronograma, decisões pendentes). **Comece por aqui.**
2. `pesquisa/2026-09-08-relatorio-apis.md` — relatório consolidado de todas as APIs e fontes investigadas, já com as correções da verificação.
3. `pesquisa/2026-09-08-painel-de-designs.md` — as 3 arquiteturas independentes (MVP-first, usuário-first, dados-first) e as notas dos 2 juízes.
4. `pesquisa/2026-09-08-<tema>.md` — relatórios brutos por tema, cada um com a seção de afirmações refutadas pelo verificador:
   - `overpass` — OpenStreetMap, Overpass API, Geofabrik, licença ODbL
   - `sptrans` — Olho Vivo, GTFS, Metrô/CPTM, Direto dos Trens, ARTESP
   - `roteamento` — OpenRouteService, Valhalla, GraphHopper, OSRM, pgRouting, elevação
   - `dados-sp` — GeoSampa, SP156, SMPED, CET, dados abertos
   - `a11y-web` — WCAG 2.2, eMAG, LBI, Web Speech API, mapas acessíveis, testes
   - `ia-e-infra` — hospedagem gratuita, tiles, IA free tier, auth, storage, CI

## Método

Gerado em 08/09/2026 por um workflow de 18 agentes (6 pesquisadores, 6 verificadores céticos que tentaram refutar cada relatório consultando fontes primárias, 3 arquitetos com lentes diferentes, 2 juízes e 1 sintetizador). Números marcados como "medição própria" foram obtidos por consultas reais a Overpass, GeoSampa WFS e Photon nessa data e são reproduzíveis.

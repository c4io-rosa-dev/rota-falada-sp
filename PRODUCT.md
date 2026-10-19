# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Pessoas que andam a pé em São Paulo e para quem uma escada, uma calçada estreita ou uma guia alta interrompe o trajeto. Três personas documentadas em `docs/superpowers/specs/2026-09-08-rotas-acessiveis-sp-design.md`, seção 2:

- **Marcos, 34, cadeira de rodas manual.** Vai de casa até a estação e quer saber se há degrau no caminho e se o ônibus é acessível. Usa o celular na rua, com uma mão livre.
- **Dona Ivete, 68, baixa visão, usa NVDA.** Ouve a rota, navega só por teclado e digita com zoom de 400%. Nunca vê o mapa.
- **Sr. Antônio, 79, usa andador.** Quer trechos curtos e sem inclinação e reporta calçada quebrada na hora, em poucos toques, às vezes sem sinal.

Segundo público, com o mesmo peso (confirmado pelo dono do projeto em 12/10/2026): a **banca e o professor** da disciplina Engenharia de Software II da FATEC Ipiranga, que avaliam método, evidência e arquitetura. A landing precisa convencer os dois: o usuário final na primeira dobra, a banca nas seções de evidência.

## Product Purpose

Guia de rotas a pé em São Paulo que evita escadas, calçadas estreitas e outras barreiras físicas. A pessoa informa origem e destino e recebe a rota como **lista ordenada de passos em texto**. Cada passo traz distância, direção, largura da calçada, declividade, guia rebaixada, degrau, barreiras próximas e a **fonte e a data** de cada dado. A lista pode ser lida em voz alta.

Sucesso para o usuário: completar o fluxo inteiro (buscar, escolher, ler ou ouvir a rota) só com teclado e leitor de tela, e receber uma rota que de fato desvia de uma barreira real. Sucesso para a disciplina: demonstração ao vivo funcionando com e sem serviços externos, e monografia com números reproduzíveis.

## Positioning

Os quatro diferenciais abaixo foram confirmados pelo dono do projeto em 12/10/2026.

1. **A rota é um texto.** A lista de passos é o produto. O mapa é uma ilustração opcional, ligada à lista; se ele não carregar, o aplicativo continua inteiro. Arquiteturas convencionais partem do mapa e tentam torná-lo acessível depois, o que falha porque canvas e tiles são invisíveis para leitor de tela.
2. **Evidência, não promessa.** Cada trecho declara de onde veio o dado e de quando ele é; quando não há dado, a interface diz que não sabe. Só 1,88% das travessias de São Paulo informam guia rebaixada no OpenStreetMap (medição própria de 08/09/2026), então prometer acessibilidade seria irresponsável com esse público.
3. **100% determinístico.** Nenhuma IA generativa no caminho do usuário. O cálculo é reproduzível e nenhum dado do usuário sai para provedor de IA.
4. **Dados oficiais de São Paulo.** Largura e declividade de calçada medidas pelo GeoSampa e barreiras oficiais do SP156, ligadas à malha de pedestre do OpenStreetMap sem misturar as licenças.

## Operating Context

- Uso na rua, no celular, com uma mão, com sol na tela e às vezes sem sinal. Uso em casa, no desktop, com NVDA, teclado e zoom de 400%.
- Área piloto: Vila Mariana, Lapa e Ipiranga. Fora dela a rota não existe, e o produto precisa dizer isso.
- Fontes carregadas: OpenStreetMap (malha de pedestre), GeoSampa (calçadas com largura e declividade), SP156 (barreiras oficiais), GTFS da SPTrans (paradas e linhas). Roteamento pelo OpenRouteService com perfil `wheelchair`, fallback determinístico em pgRouting e fixtures gravadas para demonstração sem internet.
- Produção de custo zero: Cloudflare Workers (frontend), Render Free (backend, dorme após 15 min e leva cerca de 1 min para acordar), Supabase Free (banco). Aquecer o backend antes de demonstrar faz parte do ritual.
- Ritual acadêmico: entregas em planos numerados de 1 a 8 e apresentação à banca no fim do 2º semestre de 2026.

## Capabilities and Constraints

**Existe hoje:**
- Backend `POST /api/rotas` com passos enriquecidos, avisos (`exigencia_relaxada`, `barreira_dificulta`, `trecho_sem_dados`, `motor_fallback`), nível de exigência atendido, motor usado e geometria GeoJSON por passo e da rota inteira. `GET /api/fontes` com licenças e datas. `GET /health` com estado do banco, último ETL e cota do ORS.
- Frontend no estado do Plano 1 (o redesenho de setembro foi descartado em 12/10/2026): React 19, TypeScript, Vite, react-router 7, CSS puro com variáveis, tema claro e escuro por `prefers-color-scheme`, páginas `/`, `/fontes` e `/acessibilidade`, skip link, foco no `h1`, alvos de 44 px, `prefers-reduced-motion`, `jsx-a11y` strict e `vitest-axe`.
- Tipos TypeScript gerados do OpenAPI em `frontend/src/api/types.gen.ts`.

**Ainda não existe:**
- Tela de busca de rota, autocomplete de endereço (`GET /api/geocode` a construir, Photon como fallback), lista de passos, mapa e região viva única (Plano 5).
- Cadastro colaborativo de barreiras (Plano 6), previsão de ônibus acessível, voz e fila offline (Plano 7).

**Restrições duras:**
- Nenhuma chave de API no frontend. Nenhuma IA generativa em runtime. Nenhum histórico de trajetos por usuário (LGPD).
- Voz é recurso progressivo, nunca a única forma de entrada ou saída.
- O mapa nunca é a única forma de entender a rota. Nenhum dado existe só no mapa.
- Nunca prometer roteamento por transporte público acessível: o GTFS não tem campos de acessibilidade, e a SPTrans só informa se o veículo é acessível.
- Ordem de corte se o cronograma apertar: SPTrans, depois SP156, depois fallback Photon, depois reconhecimento de voz. Acessibilidade e camada colaborativa nunca são cortadas.
- Terminologia do domínio em português: barreira, passo, trecho, calçada, guia rebaixada, fonte, área piloto.
- Imagens geradas por IA podem ser usadas como material de design, nunca como recurso de runtime.

## Brand Commitments

- Nome: **Rota Falada SP**. É o único elemento de marca que existe. Não há logo, paleta nem tipografia oficiais (confirmado em 12/10/2026); tudo isso pode ser criado do zero.
- **Conforto sensorial é obrigatório** (confirmado em 12/10/2026): nada de cores muito saturadas nem animação agressiva, porque o público inclui pessoas com fotossensibilidade e sensibilidade vestibular.
- Atribuições legais obrigatórias, legíveis por leitor de tela: OpenStreetMap (ODbL), GeoSampa/PMSP (CC-BY-SA 4.0), openrouteservice.org by HeiGIT, SPTrans/Olho Vivo.

## Evidence on Hand

- Números reproduzíveis da área piloto em produção (14/09/2026): 25.040 vias de pedestre, 22.422 calçadas do GeoSampa, 11.001 ligações via-calçada. 1,88% das travessias de SP com guia rebaixada no OSM (medição própria, 08/09/2026). Calibração da conflação em `docs/pesquisa/2026-09-14-calibracao-conflacao.md`.
- Rota real disponível para exemplo: `POST /api/rotas` em produção para o caso `vila_mariana_curta_1` de `backend/tests/casos_referencia.json` (Rua Helen Keller até Rua Ouvidor Peleja), 11 passos, motor ORS, com largura medida em parte dos trechos e uma guia não rebaixada.
- Fontes e licenças reais em `GET /api/fontes` e `DATA-LICENSES.md`.
- Base legal e normas: LBI art. 63, WCAG 2.2 AA, eMAG 3.1, ABNT NBR 17225:2025.
- Testes: 133 no backend (guia técnico, 14/09/2026) e 8 no frontend.
- Produção pública: https://rota-falada-sp.caiorosa2006.workers.dev e https://rota-falada-api.onrender.com.

**Ausências que nenhum trabalho futuro pode inventar:** depoimentos de usuários, teste com usuário real (previsto para a semana 15), números de adoção, logo, parcerias com SMPED ou associações, casos de referência verificados no Street View.

## Product Principles

1. **Texto primeiro, mapa depois.** Toda informação da rota existe em texto navegável antes de existir em qualquer pixel de mapa.
2. **Evidência, não promessa.** Cada dado carrega fonte e data; a interface diz "evita", nunca "garante", e diz "não sabemos" quando não sabe.
3. **Funciona no pior cenário.** Sem mapa, sem ORS, sem sinal, sem mouse, sem visão: o fluxo principal continua.
4. **Conforto sensorial é requisito**, não acabamento.
5. **Reproduzível.** Determinístico, com números que a banca pode refazer.

## Accessibility & Inclusion

Padrão exigido: WCAG 2.2 nível AA, com eMAG 3.1 e ABNT NBR 17225:2025 como referências nacionais e a LBI art. 63 como base legal. Critérios de aceite do spec: zero violações críticas ou sérias no axe; todos os fluxos completáveis só com teclado; alvo interativo de pelo menos 44 por 44 px; sem rolagem horizontal a 320 px de largura nem com zoom de 400%; primeiro anúncio de passo na região viva em menos de 2 s; Lighthouse de acessibilidade de pelo menos 95. Matriz manual: NVDA com Firefox, NVDA com Chrome, TalkBack com Chrome, VoiceOver com Safari no iOS. Necessidades a atender: baixa visão com zoom alto, leitor de tela, uso com uma mão no celular, fotossensibilidade e sensibilidade vestibular (respeitar `prefers-reduced-motion`, sem flashes, sem autoplay com movimento intenso).

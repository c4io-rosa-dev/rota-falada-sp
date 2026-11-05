# Design — Frontend dos Planos 5 e 6 (rota, mapa, login, colaboração e moderação)

**Data:** 05/11/2026 · **Planos:** 5 e 6, o que falta · **Branch:** `feat/backend` (ainda não mergeado)
**Specs relacionados:** `2026-09-08-rotas-acessiveis-sp-design.md` (spec-mãe, seções 7 e 8), `2026-11-02-geocode-design.md`, `2026-11-02-colaborativo-design.md`. **Design system vinculante:** `DESIGN.md`.
**Plano de implementação:** `docs/superpowers/plans/2026-11-05-plano-05b-06b-frontend.md`.

## 1. Objetivo

Entregar a tela `/rota` real e a camada colaborativa no navegador. A pessoa escolhe origem e destino por autocomplete ou GPS, recebe a rota como lista de passos com fonte e data, abre o mapa se quiser, entra com código de 6 dígitos, registra barreira em 3 toques, vota, e a moderação decide com motivo auditado.

Critérios de saída:
- **Plano 5:** fluxo completo só por teclado e NVDA; Lighthouse de acessibilidade de pelo menos 95; zero violações críticas no axe.
- **Plano 6:** "usuário cadastra barreira e a rota muda", com NVDA e zoom de 400%.

Já decidido pelo dono e fora de discussão aqui: login só por código de 6 dígitos no e-mail; sem Photon nem geocodificação externa; categorias em lista fechada de 10, com severidade derivada; foto sempre opcional; admin decide na hora, com motivo auditado; regras de moderação do spec colaborativo.

## 2. Como este desenho foi verificado

O código de lógica e contrato deste spec foi escrito e executado num protótipo fora do repositório (scratchpad, 05/11/2026), para o plano não carregar suposição. Os resultados são medições, não estimativas:

| Verificação | Resultado |
|---|---|
| Vitest, estado final | 32 arquivos, 289 testes passando (linha de base: 13 arquivos, 47 testes) |
| Vitest, fim do bloco do Plano 5 | 22 arquivos, 164 testes passando |
| Playwright com axe, Chrome real | 21 cenários (14 no fim do Plano 5): teclado, axe em cada estado nos dois temas, 320 px, 1280 a 400%, alvos de 44 px, foco depois de cada troca de bloco, recarga com a sessão real, geolocalização, servidor dormindo, Leaflet real em StrictMode, CSP real |
| Lighthouse 12.8.2, acessibilidade | 100 em `/`, `/rota`, `/fontes`, `/acessibilidade`, `/barreiras`, `/barreiras/nova`, `/entrar` |
| `tsc -b` e ESLint (`jsx-a11y` strict) | sem erros |
| Bundle em gzip | entrada 75,6 KB (antes: 88,9 KB); Leaflet 43,4 KB; auth-js 22,4 KB; `Rota` 6,1 KB |
| Backend | `ruff` e geração do OpenAPI passam; **os testes novos só foram coletados, nunca executados**, porque o Docker estava desligado e eles exigem PostGIS |

O E2E achou um defeito real que o jsdom não pegaria: escolher endereço por teclado em `EscolhaLocal` não chegava ao formulário. A correção (`aoEscolher` em `useBuscaEndereco`) já está no plano.

A revisão adversarial de 05/11/2026 achou 41 pontos, em boa parte foco que caía no `body`, mensagens mudas e textos que prometiam mais do que o produto faz. Os procedentes foram corrigidos no protótipo com teste antes do código, e as medições acima são as de depois. As mudanças de desenho estão em D27 a D29 e nas seções abaixo.

**Não verificado, porque só é possível rodando de verdade:** fala real do NVDA; resposta do Render adormecido a um `fetch` real; `_headers` no fallback de SPA do Workers; contraste do filtro sobre tile real; login contra o Supabase de verdade; rotas contra backend real com PostGIS. Ver seções 14 e 16.

## 3. Decisões

| # | Decisão | Motivo |
|---|---|---|
| D1 | **URL sempre `/rota`; a busca fica em `sessionStorage`** (`rf-busca`). Fechar a aba apaga; "Limpar busca" apaga; rota com mais de 6 h cai e os pontos ficam. A rota é gravada com o pedido e os rótulos que a geraram (`rotaDe`), porque os campos podem já ser outros | Recarregar e descartar a aba restauram sem rede ("funciona no pior cenário"). Query string e fragmento gravariam o endereço de casa em log e histórico. `localStorage` seria histórico de trajetos |
| D2 | **Uma só espera pelo servidor:** `GET /health` antes de qualquer chamada, com limiar de 4 s, tentativas a cada 5 s, teto de 120 s e reconferência depois de 10 min sem contato. A cada tentativa reavalia `navigator.onLine`. Servidor dormindo sem CORS e falta de sinal chegam iguais (`TypeError`), então o texto nunca afirma a causa | `/health` é simples, sem preflight. O pedido de verdade só sai com o servidor acordado e nunca é repetido automaticamente, o que elimina a discussão de idempotência por rota |
| D3 | **O aviso de espera só aparece para quem está esperando** (`useEsperaServidor(ativo)`); o aquecimento ao abrir a página é silencioso | "Nada se move sem ação": um aviso surgindo sozinho empurraria o conteúdo |
| D4 | **Combobox editável ARIA 1.2 com lista em fluxo**, debounce de 800 ms, Enter busca na hora, Enter nunca envia sem escolha | Lista em fluxo resolve 320 px, zoom de 400% e foco coberto de uma vez. 800 ms vem do spec-mãe, por causa do eco do NVDA |
| D5 | **Seleção obrigatória:** texto livre nunca vira rota | O `POST` precisa de coordenadas, e adivinhar levaria a pessoa ao lugar errado sem aviso |
| D6 | **Foco no fim do cálculo:** se o foco está de onde o envio partiu, seja "Calcular rota" ou o campo do Enter (ou caiu no `body` porque "Cancelar" sumiu), vai para o h2 do resultado; se a pessoa saiu dali ou voltou a editar, fica onde está e a região anuncia. Nunca os dois | A 400% e no celular com teclado aberto o resultado está fora da vista, e o foco o traz. Foco e anúncio juntos se sobrepõem no NVDA |
| D7 | **Mapa por botão, com aviso de IP, Leaflet puro em chunk próprio** | Poupa 42 KB e tiles de quem nunca abre. O OSM recebe o IP só depois da ação |
| D8 | **`role="img"` sem nada focável dentro; "Ver o passo N no mapa" substitui marcador focável** | `role="img"` e marcador focável geram `nested-interactive` no axe. O texto dirige o mapa, e isso cobre o WCAG 2.5.7 |
| D9 | **Nenhuma animação no mapa, em nenhuma preferência:** `zoomAnimation`, `fadeAnimation`, `markerZoomAnimation` e `inertia` desligados; `animate: false` em tudo; nunca `flyTo`. Roda do mouse desligada; toque sem arrastar nem pinçar | "Um só movimento" fica garantido sem consultar `prefers-reduced-motion`. A pinça amplia a página (WCAG 1.4.4) |
| D10 | **Tiles do OSM** (`tile.openstreetmap.org`), trocáveis por `VITE_TILE_URL` | Único provedor sem chave nem conta. CARTO, Stadia e MapTiler exigem conta |
| D11 | **`@supabase/auth-js` em import dinâmico**, sessão em `localStorage` (`rf-sessao`), sem `supabase-js` | Refresh token é de uso único e reuso revoga a sessão: é a parte que não se escreve à mão. 24,8 KB contra 58,9 KB do `supabase-js` |
| D12 | **Só a publishable key vai ao bundle**, com a guarda `sb_publishable_` em `auth/config.ts` | Ela identifica o projeto e não dá permissão. Chave secreta colada por engano desliga o login em vez de vazar |
| D13 | **Sem as variáveis `VITE_SUPABASE_*`, a biblioteca nem é importada**, "Entrar" some, e rota e leituras seguem | Ambiente sem login continua útil |
| D14 | **Campo único de código**, `inputmode="numeric"`, `autocomplete="one-time-code"`, sem `maxLength`, sem envio automático | Seis caixas fazem o NVDA anunciar seis campos e quebram ao colar (WCAG 3.3.8). `maxLength` cortaria "123 456". Envio ao sexto dígito viola 3.2.2 |
| D15 | **Portão de login na própria página** (`PortaoLogin`), sem modal nem redirecionamento; o login vem no fim, ao confirmar. Ao concluir, a ação é refeita com o que está na tela agora (`montarArgs`), não com o que estava ao abrir o portão | Rascunho, chave de idempotência e arquivo da foto continuam na memória. Ninguém digita e-mail antes de saber se vale a pena. Quem corrige o texto enquanto espera o e-mail não pode ver a versão antiga publicada, e a auditoria não aceita correção |
| D16 | **401 renova e repete uma vez;** se falhar, abre o portão e refaz a ação. Um único `comSessao`, em escrita e em leitura com token. Falha de rede ao renovar é `rede`, não "deslogado" | O 401 sai antes de qualquer gravação (`auth.py`), então repetir é seguro |
| D17 | **Cadastro em uma página, sem assistente** | Trocar de etapa ao tocar numa opção viola 3.2.2 e confunde o NVDA, que seleciona rádio ao andar com as setas |
| D18 | **Chave de idempotência salva antes do `fetch`, nova só se a pessoa editar.** Chegar a `/barreiras/nova` com outro ponto é editar. O `location.state` é consumido na chegada | Editar e reusar a chave faria o servidor devolver a barreira antiga, ignorando a correção. O state sobrevive à recarga e passaria por cima de "Trocar o local" |
| D19 | **O papel da conta vem de `GET /api/eu`, e o link do painel fica só em `/conta`** | Um link surgindo no menu depois de um minuto moveria o layout sozinho |
| D20 | **Proteção de rota é apresentação; quem decide é o backend** | `exigir_admin` já existe. Conta comum em `/admin` vê o 403 como frase |
| D21 | **LGPD testada:** só `api/colaboracao.ts` anexa token; `GET /api/geocode*` e `POST /api/rotas` nunca levam `Authorization` | É o que impede ligar trajeto a conta |
| D22 | **`document.title` no resultado é "Rota calculada", sem nome de rua** | Não gravar trajeto no histórico do navegador |
| D23 | **Mudar campo depois do resultado não recalcula** (WCAG 3.2.2): a tela mostra e anuncia uma vez "Esta rota é da busca anterior. Calcule de novo.", e o h2 passa a "Rota da busca anterior". Ficha e mapa leem os rótulos da busca, nunca os campos vivos | Derivado por comparação do pedido atual com o pedido da rota, sem flag no estado. O aviso é a única salvaguarda de 3.2.2 aqui, então precisa chegar a quem usa leitor de tela |
| D24 | **Páginas sob demanda com `React.lazy`, exceto `Inicio`; `ErroDePagina` trata página que não carregou**, sem afirmar a causa, com foco no h1 e título novo na aba. Os mapas usam `import()` à mão, com falha local | O Workers devolve `index.html` com 200 para arquivo inexistente, e o `import()` rejeita depois de um deploy; sem sinal, o sintoma é o mesmo. Uma falha em "Escolher no mapa" não pode derrubar o cadastro, que tem outros dois caminhos |
| D25 | **CSS por página** em `estilos/rota.css` e `estilos/colaborar.css`; `index.css` só recebe a nota de contraste e `.carregando-pagina` | Reduz a entrada e os conflitos |
| D26 | **CSP em `public/_headers`** com `script-src 'self'` | A sessão passa a morar em `localStorage`, então XSS seria o risco principal |
| D27 | **O foco nunca cai no `body`.** Cada elemento que some ao ser acionado tem destino: o campo preenchido, o botão de origem, o título da seção ou uma frase com `tabIndex=-1` que diz o resultado. `PortaoLogin` exige `refRetorno`. Se o foco não caiu, porque a pessoa saiu dali, ele fica e a região anuncia | WCAG 2.4.3. No cadastro em 3 toques, o segundo toque sempre derrubava o foco |
| D28 | **Foco ou anúncio, decidido por `focarOuAnunciar`.** Com o foco já no campo (Enter), focar de novo não faz o leitor falar, então a região anuncia. A mensagem vai ao DOM antes do foco (`flushSync`) | WCAG 3.3.1 e 4.1.3. Sem isso, o erro de login depois de Enter ficava mudo |
| D29 | **`aria-current` em "Ver o passo N no mapa", nunca `aria-pressed`;** cada pressão enquadra e fala de novo | Não é alternância: quem moveu o mapa precisa enquadrar de novo, e pressionar de novo não pode ficar mudo |

## 4. Conflitos entre os desenhos e como foram resolvidos

Três especialistas desenharam partes independentes. Cada conflito foi resolvido assim:

| # | Conflito | Resolução | Por quê |
|---|---|---|---|
| R1 | `react-leaflet` v5 (rota e mapa; spec-mãe) contra Leaflet puro (engenharia) | **Leaflet puro.** Desvio do spec-mãe registrado aqui | `MapContainer` só repassa `className`, `id` e `style`, então `role` e `aria-label` já iam em `getContainer()`. O mapa só exibe, e um `useEffect` com `map.remove()` resolve. Testado em StrictMode no E2E |
| R2 | Atribuição sobre o mapa contra abaixo dele | **`figcaption` sobreposta no canto**, fora do `role="img"` | É o que a política de tiles pede, e o link continua legível por leitor de tela. Passou no axe e a 320 px |
| R3 | Rota em `sessionStorage` (rota e mapa) contra contexto em memória (login) | **`sessionStorage`** | Cobre o pedido da colaboração (ida e volta a `/barreiras`) e sobrevive ao celular descartar a aba, que a memória não cobre. Continua sendo só da aba |
| R4 | `api/despertar.ts`, `api/servidor.ts`, retentativa dentro do `pedir` ou no `/health` | **Só `api/servidor.ts`, e só no `/health`** (D2) | Um único mecanismo. Com o servidor acordado, um `TypeError` no `POST` é falha, não sono, e repetir não ajuda |
| R5 | Tetos: 60 s, 90 s, 150 s para o cálculo | **120 s de espera mais o teto da operação:** rota 60 s, foto 60 s, demais 30 s; login 30 s, porque o `auth-js` não tem teto próprio | Separa "servidor dormindo" de "operação lenta", que o desenho original misturava |
| R6 | Estados `acordando` e `calculando` no reducer da rota, com estágios | **Reducer só com `calculando { lento }`; "acordando" vem de `useEstadoServidor`** | Um estado só por fato. Serve a todas as telas, não só à rota |
| R7 | `ErroApi` com três formatos | **`ErroApi(tipo, mensagem, status?, campos?)`** com os 11 tipos do desenho de engenharia | É o único que distingue todos os casos sem a tela olhar status |
| R8 | `ProvedorSessao` em `api/` contra `SessaoProvider` em `auth/`; chave `rota-falada-sessao` contra `rf-sessao` | **`auth/SessaoProvider.tsx` e `rf-sessao`** | Junta o que é de login. A chave segue o prefixo das outras |
| R9 | Reconhecer "fora da área": "não comparo string" contra constante `FORA_DA_AREA` | **Os dois, por tela.** Na rota, 404 usa o `detail` sem comparar. Na barreira, compara com a constante em `dados/localizacao.ts`, porque "nada a 50 m" pode registrar e "fora da área" não | Os testes do backend fixam a mensagem, e o 422 do `POST` segura se a comparação falhar um dia |
| R10 | `POST /api/rotas` com banco fora vira 500 sem CORS: tratar no backend ou no cliente | **No cliente; `OperationalError` no backend fica de fora** | Não é indispensável: a mensagem de rede é neutra ("Não conseguimos falar com o servidor"), e `/health` com `banco: indisponivel` já barra o caso comum. Fica em limitações |
| R11 | Dois links por passo (barreiras perto e registrar) contra o custo de Tab | **Um link por passo:** "Barreiras perto do passo N"; a página leva a "Registrar barreira neste ponto" | Dois links dariam 22 paradas de Tab numa rota de 11 passos, o mesmo argumento que derrubou o marcador focável |
| R12 | Mapa à esquerda fixo (sticky) com a tabela ao lado contra tabela em largura total | **Ficha e mapa lado a lado a partir de 1024 px; tabela em largura total abaixo** | Mantém o `subgrid` da tabela gravada sem sobrescrever oito seletores. "Ver o passo N" leva o foco à legenda quando o mapa está fora da vista |
| R13 | Escolher ponto com `role="application"` e teclado próprio no mapa contra botões externos | **`role="img"` e botões reais de 44 px** (mover, aproximar, afastar, marcar). Clique no mapa centraliza | `role="application"` desliga o modo de navegação do NVDA e contraria a restrição dura. Os botões já fazem tudo |
| R14 | Clique na sugestão por `onPointerDown` | **`onMouseDown` com `preventDefault` e `onClick`** | `pointerdown` escolheria a opção quando o Marcos só queria rolar a lista no toque |
| R15 | `Fonte` e `Data` do passo: backend novo ou regra no frontend | **Regra no frontend agora** ("OpenStreetMap; largura: GeoSampa", "12/10/2026 (trecho no OSM)"); backend fica como decisão do dono | Restrição de só adicionar backend indispensável |
| R16 | `useAcao` separado contra `useAcaoComLogin` | **Só `useAcaoComLogin`** (protege contra envio duplo) e `useConsulta` | Toda escrita da aplicação exige login |
| R17 | TalkBack e VoiceOver no gate do Plano 5 ou no Plano 8 | **NVDA com Firefox e Chrome no gate; TalkBack e VoiceOver no Plano 8** | É o que o roteiro de planos diz. O risco de `aria-activedescendant` no VoiceOver fica anotado |
| R18 | Endereço em cada linha da fila do admin | **Fora da fila; aparece na decisão** | A fila é lista de links, e seriam 50 chamadas ao reverso. Em `/barreiras` fica, com teto de 20 |
| R19 | `GET /api/admin/barreiras/{id}`: indispensável (login) ou desnecessário (engenharia) | **Entra.** | Sem ele, recarregar `/admin/barreiras/:id` numa barreira removida daria 404 |
| R20 | Defeito de motivo em branco: "só backend indispensável" | **Corrige.** | Não é backend novo: é o contrato já aprovado (spec colaborativo, 5.3) e uma decisão do dono (motivo auditado) |

## 5. Achados que mudam o que se supunha

| Achado | Evidência | Consequência |
|---|---|---|
| O primeiro contato com o backend dormindo é o autocomplete, não o `POST` | Fluxo da tela | A espera mora em `api/servidor.ts`, não no cálculo |
| O 503 de rota traz o texto do 404 | `services/rota.py`, `routers/rotas.py:51` | `calcularRota` troca a mensagem. Nunca exibir esse `detail` |
| `lng` em `Coordenada`, `lon` em `EnderecoOut`; `inclinacao_max` é número; `perfil` é exigido inteiro no tipo gerado | `schemas/rota.py`, `types.gen.ts` | `montarPedido` em `rotaEstado.ts`, com teste |
| Intransponível só bloqueia com `confirmacoes >= 2`, mesmo `validada` | `barreira_geom.py:99` | **Defeito.** Admin valida e a rota não muda, contrariando D3 do spec colaborativo. Corrigido no plano |
| `min_length` do motivo vem antes do `strip` | `schemas/barreira.py:72`, `routers/admin.py:25` | **Defeito.** `"   "` grava motivo vazio. Corrigido no plano |
| Voto posterior recalcula o status decidido pelo admin | `moderacao.py:69-71`, `votacao.py:110` | Segue a regra 6.2 literal. Ver decisão do dono 3 |
| Admin não apaga foto de barreira já removida | `fotos.py:_verificar` | O painel orienta a remover a foto antes |
| `barreiras_proximas` só traz `dificulta` a até 15 m, sem coordenadas | `enriquecimento.py`, `schemas/rota.py:26-33` | Lista vazia não vira "sem barreiras"; barreira da rota não vai ao mapa |
| O aviso `barreira_dificulta` traz o slug cru e repete o tipo | `enriquecimento.py:259`, `Inicio.tsx:189` | `textosDeAviso` gera o texto de `barreiras_proximas`; a chave é a posição |
| Instrução do pgRouting tem outro formato, e pode ser vazia | `pgrouting.py:217-222`, `rota.py:224` | `separarInstrucao` e `textoInstrucao` |
| `declividade_pct` sob ORS representa uma classe, não medição | `enriquecimento.py:60-79` | "cerca de 3%" |
| `fonte` do passo é a da via, mesmo com largura do GeoSampa | `enriquecimento.py:183-202` | R15 |
| `BarreiraOut` não traz distância nem endereço; `POST` de cadastro não dá 403 nem 409 | `schemas/barreira.py:49-63`, `barreiras.py` | `distanciaDirecao` no cliente; tabela de erros própria |
| Nome de botão repetia "Planejar rota" no menu e no CTA | `App.tsx`, testes | Os testes passam a procurar dentro de `main` |
| Autenticação nos modelos de e-mail | Documentação do Supabase; `magic_link.go` | Conta nova recebe o modelo de confirmação: os **dois** modelos precisam de `{{ .Token }}` (seção 16) |
| O pgRouting não lê barreira registrada | `pgrouting.py:97-113` usa só `custo_acessivel`, gravado pelo ETL; `rota.py:323-324` filtra só `dificulta` | Sob o fallback, uma intransponível confirmada não muda a rota nem aparece nos passos. A ficha diz isso (`textoSobreARota`). Ver decisão do dono 12 |
| Refresh que falha por rede devolve `session: null` com `error`, e a sessão continua salva | `GoTrueClient.ts:3081-3109` | `AuthRetryableFetchError` vira `ErroApi('rede')`, nunca "deslogado" |
| `scope: 'local'` remove a sessão antes de chamar a rede | `GoTrueClient.ts`, `_signOut` | Sair só depende da biblioteca ter carregado; se não carregou, o cliente apaga `rf-sessao` |

## 6. Arquitetura

```
frontend/src/
  a11y/foco.ts           focoPerdido, focarOuAnunciar
  api/base.ts            apiUrl, ErroApi, TipoErro, mensagens, ehCancelamento
  api/servidor.ts        garantirAcordado, aquecerServidor, useEstadoServidor
  api/http.ts            pedir<T>(): único ponto de saída para a API
  api/client.ts          listarFontes, buscarEnderecos, enderecoDoPonto, calcularRota (sem token)
  api/colaboracao.ts     barreiras, voto, foto, /api/eu e admin (único módulo com token)
  api/useConsulta.ts     leitura com cancelamento, sem refetch automático
  auth/                  config, cliente (import dinâmico), erros, comSessao, useSessao,
                         SessaoProvider, LinkConta, useAcaoComLogin
  dados/                 passo, categorias, rotaGeo, sessaoRota, localizacao, barreira, rascunho
  componentes/           useEsperaServidor, ErroDePagina, campoEstado, useBuscaEndereco,
                         CampoEndereco, BotaoMinhaLocalizacao, TabelaPassos, FichaRota,
                         BarreirasDoPasso, ResultadoRota, FluxoCodigo, PortaoLogin, EscolhaLocal,
                         Votacao, FotoBarreira
  componentes/mapa/      opcoesMapa, MapaRota (casca), MapaLeaflet e PontoNoMapa (chunk), mapa.css
  pages/                 Rota, rotaEstado, NaoEncontrada, Entrar, Conta, Barreiras, NovaBarreira,
                         Barreira, admin/Fila, admin/Decisao
  estilos/               rota.css, colaborar.css
```

Reaproveitamento: `Inicio.tsx` passa a usar `TabelaPassos` e `FichaRota`, extraídos dele. `Elevacao` não entra em `/rota`: é composição de dobra, com h1 em torre e uma segunda `<ol>`, e o leitor de tela ouviria a rota duas vezes. `Passarela` entra na legenda do mapa, em `<ol start={n}>` de um item. `BotaoOuvir` entra com `rotulo="Ouvir a rota"` e `key` da rota.

## 7. Tela `/rota`

### 7.1 Estados

Dois reducers puros: `componentes/campoEstado.ts` (`reduzirCampo`) e `pages/rotaEstado.ts` (`reduzirRota`). O campo e o cálculo mudam de forma independente.

```ts
type EstadoCampo = vazio | digitando{texto} | buscando{texto}
  | lista{texto, opcoes, ativo, aberta} | sem_resultado{texto} | erro{texto, mensagem}
  | escolhido{escolha, via: 'lista'|'gps'|'restauro'}
type EstadoRota = ocioso | calculando{busca, lento}
  | resultado{busca, rota, calculadaEm, restaurada} | sem_rota{busca, detalhe} | indisponivel{busca, mensagem}
// busca = { pedido, origem, destino }: o que gerou a rota, com os rótulos daquele momento
```

| Estado | Gatilho | Visível | Região viva | Foco |
|---|---|---|---|---|
| Ocioso | Montagem | Formulário e torre "Área piloto" | Nada | h1 só em troca de rota |
| Buscando | Debounce ou Enter | "Buscando…" ou o texto de espera do servidor | Só o texto de espera, uma vez por estágio | Campo |
| Lista | Resposta com itens | Listbox em fluxo | "2 endereços para Origem. Seta para baixo para escolher." (throttle de 3 s; instrução só na primeira vez; com 8 itens, "Os 8 primeiros endereços") | Campo |
| Fora da área, digitação | `[]` | `Não encontramos "x" na área piloto (Vila Mariana, Lapa e Ipiranga). Confira a grafia; fora dessa área o Rota Falada SP ainda não atende.` | Mesmo texto | Campo |
| Fora da área, GPS | 404 do reverso | `detail` da API e "Digite o endereço." | Mesmo texto | Botão |
| Escolhido | Seleção | Valor preenchido; se aproximado, a nota | "Origem: {rotulo}." | Campo |
| Erro de envio | "Escolha um endereço da lista." ou ponto repetido | Erro ligado ao campo; some ao digitar nele, e o retorno da busca volta a aparecer | Só se o foco já estava no campo (Enter) | Campo (D28) |
| Calculando | Envio válido | Texto de espera, "Calculando a rota…" ou, aos 15 s, "Ainda calculando; o serviço de rotas está lento." e "Cancelar". "Calcular rota" com `aria-disabled` | "Calculando a rota."; aos 15 s, uma vez, o texto de lentidão, salvo se o de espera do servidor estiver valendo | Mantido |
| Resultado | 200 com passos | Seção de resultado | Só se o foco não for ao h2 (D6) | h2 (D6) |
| Busca anterior | Campo muda depois do resultado | Aviso; h2 "Rota da busca anterior"; ficha e mapa seguem com a busca que gerou a rota | "Esta rota é da busca anterior. Calcule de novo.", uma vez | Mantido |
| Sem rota | 404 ou zero passos | h2 "Não encontramos rota", `detail` e "Tente outro ponto ou desmarque Evitar degraus; isso pode incluir degraus no caminho." | Idem | h2 |
| Indisponível | 503, rede ou tempo | h2 "Não foi possível calcular agora", mensagem própria e "Tentar de novo", que leva o foco a "Calcular rota" durante o novo cálculo | Idem | h2 |
| Cancelado | "Cancelar" | Formulário | "Cálculo cancelado." | "Calcular rota" |

Restaurar a sessão nunca move o foco nem anuncia, e usa `rotaDe`: se os campos gravados forem outros, o aviso aparece. Sem nome de rua no `document.title` (D22).

### 7.2 Teclas do autocomplete

| Tecla | Lista fechada | Lista aberta |
|---|---|---|
| Seta baixo / cima | Abre se há opções; vai para a primeira / última | Próxima / anterior, com volta |
| Alt+baixo / Alt+cima | Abre sem mover / nada | Nada / fecha |
| Enter | `escolhido`: envia o formulário, e o foco vai ao resultado (D6). No celular, `enterKeyHint` passa de `search` a `go`. 3 ou mais caracteres: busca **agora**. Menos: `preventDefault` e anúncio "Digite ao menos 3 letras." | Opção ativa: escolhe. Sem ativa: ativa a primeira, sem escolher às cegas |
| Esc | Nada | Fecha e mantém o texto |
| Caractere e edição | Edição normal, invalida a busca | Idem |
| Tab | Sai | Fecha sem selecionar |

Dois desvios do APG, ambos a favor de quem digita devagar: Esc não apaga o texto, e Enter nunca envia sem escolha. `compositionstart` e `compositionend` suspendem o debounce. Cada tecla aborta a requisição anterior. Geocode sem cabeçalho customizado, para continuar sem preflight.

Campo aproximado (`aproximado: true`): a opção diz "número aproximado: o mais próximo do que você digitou"; nunca é escolhido sozinho; depois de escolhido, o retorno diz "Este é o número mais próximo que conhecemos, não o que você digitou. Confira."

### 7.3 "Usar minha localização"

Só na origem. O pedido de permissão ocorre no clique, e a região diz "Buscando sua localização.", porque o GPS pode levar 15 s. `aria-disabled` tem guarda no handler. Se o texto do campo mudar durante a espera, ou o componente sair da tela, o pedido é abortado e o resultado descartado: o texto de espera diz que nada se perde. Parâmetros: `enableHighAccuracy: true`, `timeout: 15000`, `maximumAge: 60000`. Coordenadas arredondadas a 4 casas antes do `GET`. A rota parte do `lat`/`lon` devolvido pelo reverso, porque é o endereço anunciado.

| Situação | Comportamento |
|---|---|
| Precisão de até 100 m | Preenche e anuncia "Origem: {rotulo}. Confira se é onde você está." |
| Precisão pior | Não preenche sozinho: "Achamos {rotulo}, mas a margem é de cerca de {n} m." e "Usar este endereço", que some e leva o foco ao campo preenchido |
| Código 1 | "O navegador não autorizou a localização. Digite o endereço; a rota funciona igual." |
| Código 2 ou 3 | "Não conseguimos sua localização agora. Digite o endereço." |
| 404 do reverso | `detail` e "Digite o endereço." |
| Sem `navigator.geolocation` | Uma frase no lugar do botão |

100 m é escolha de projeto (duas vezes o raio do reverso). Ajustar depois do teste em campo.

### 7.4 Mapeamento de `RotaOut`

| Campo | Onde | Texto |
|---|---|---|
| `passos[]` | `TabelaPassos`, `<ol id="lista-passos">` | Uma `<li id="passo-N">` por passo; vazio é `sem_rota` |
| `distancia_m`, `duracao_s` | h2 | "200,0 m em 2 passos, cerca de 4 minutos a pé, 1 aviso" |
| `avisos[]` | Ficha | `mensagem`, salvo `barreira_dificulta`, gerado de `barreiras_proximas` |
| `nivel_exigencia_atendido` | Ficha | "Pedida: até 6%. Atendida: até 6%." |
| `motor` | Ficha | `ors`: "openrouteservice.org by HeiGIT"; `pgrouting`: "roteamento local (pgRouting)"; `fixture`: "rota gravada para demonstração, não calculada agora" |
| `fontes[]` | Ficha | Nomes e link para `/fontes`; `colaborativo` vira "colaboradores" |
| `cache` | Ficha | "Reaproveitada de um cálculo das últimas 6 horas" |
| `geometria` | Só o mapa | Inválida ou `{}`: sem botão de mapa |
| `is_degrau` | Campo Degrau e aviso | A interface lista os passos com degrau mesmo com a opção marcada: o pgRouting não recebe `evitar_degraus`, embora o custo do ETL já bloqueie `highway=steps` |
| `instrucao` | Texto 600 | Vazia vira "Siga o trecho" |
| `largura_m` | Campo Largura | `largura_medida` falso é "sem dado" |
| `declividade_pct` | Campo Declividade | "cerca de 3%" |
| `fonte`, `data_referencia` | Campos | R15 |
| `barreiras_proximas[]` | `BarreirasDoPasso` | "Buraco, a 12 m. Dificulta a passagem, não bloqueia a rota. 1 confirmação. Fonte: colaboradores, 03/11/2026." Em colaborativa, "Ver e votar" em bloco próprio, com 44 px e nome contextual. Lista vazia não diz nada |
| `direcao`, `duracao_s` do passo | Não exibidos | Já estão em `instrucao` e no total |

Frase fixa na ficha, conforme o motor (`textoSobreARota`), porque só o ORS desvia de barreira registrada:

| Motor | Frase |
|---|---|
| `ors` | "Rota sugerida com os dados disponíveis. Ela evita as barreiras confirmadas que bloqueiam a passagem e avisa das que só dificultam. Relatos ainda sem confirmação não mudam a rota, e não sabemos o que não foi registrado." |
| `pgrouting` | "Rota sugerida pelo roteamento local de reserva. Ele evita as escadas da base de ruas, mas não desvia das barreiras registradas, e as que bloqueiam a passagem podem não aparecer nos passos. Confira as barreiras perto de cada passo. Não sabemos o que não foi registrado." |
| `fixture` | "Rota gravada para demonstração. Ela não muda com as barreiras registradas, e não sabemos o que não foi registrado." |

### 7.5 Mapa

- Casca `MapaRota`, botão "Mostrar mapa" com `aria-pressed`, verdadeiro só com o mapa aberto de verdade, e descrição visível: "Mostrar o mapa baixa imagens do OpenStreetMap, que recebe o endereço IP do seu aparelho e a região vista. A lista de passos já traz tudo."
- `import()` à mão, porque `React.lazy` guarda a rejeição e "Tentar de novo" precisa de nova tentativa.
- Contêiner com `role="img"` e `aria-label="Mapa ilustrativo da rota de {origem} até {destino}, {distância} em {n} passos. Tudo o que ele mostra está na lista de passos desta página."`. Nada focável dentro.
- Só com o mapa aberto de verdade, cada passo ganha "Ver o passo N no mapa" (`aria-current`, D29): enquadra, pinta de óxido, atualiza a legenda e anuncia "Mapa no passo N.". Se a legenda estiver fora da vista, o foco vai para ela, que se chama "Mapa no passo N", e não há anúncio. Pressionar de novo faz tudo de novo. "Voltar ao passo N na lista" é link.
- A leitura em voz alta só troca o destaque, nunca move o mapa.
- Controles próprios de 44 px: Aproximar, Afastar, Rota inteira. Limites com `aria-disabled`.
- Abrir anuncia "Abrindo o mapa." e, ao terminar, "Mapa aberto.". Falhas: chunk que não carrega dá "Não foi possível abrir o mapa. A lista de passos está completa." e "Tentar de novo", e o mapa não fica marcado como aberto; 3 `tileerror` ou nenhum `load` em 8 s dão "O fundo do mapa não carregou. A linha da rota e a lista continuam." e `redraw()` por clique. Nos dois casos "Tentar de novo" some e leva o foco a "Mostrar mapa".
- Linha: casing `--placa` 8 px, linha `--tinta` 4 px; ativo `--oxido` 6 px. Marcadores `DivIcon` com pictogramas `origem` e `destino`, contorno de 2 px em tinta. Tiles em `grayscale(1) contrast(.9)` e, no escuro, `grayscale(1) invert(1) brightness(.85) contrast(.85)`. Fatores de partida, a ajustar contra captura real.

## 8. Login

### 8.1 Fluxo

`FluxoCodigo`, em dois passos. **E-mail:** `type="email"`, botão "Receber código", dica "Seu e-mail serve só para contar um voto por pessoa. Suas rotas não ficam ligadas à sua conta." **Código:** o foco vai para o campo, com a dica "Enviamos para x@y. Confira também o spam. Use sempre o código mais recente." e as ações "Reenviar código" e "Trocar e-mail". `{ email, enviadoEm, reenvios }` fica em `sessionStorage` (`rf-login`), nunca o código.

Reenvio sem contador: `aria-disabled` até liberar, com um único `setTimeout` para o botão não mentir depois de liberado. A frase "Você pode pedir outro código a partir das 14:32." aparece desde o início e vira "Você já pode pedir outro código." no mesmo lugar, sem empurrar nada; pressionar antes da hora anuncia a frase. Depois de 3 reenvios, "Confira o spam ou tente mais tarde."

Enviar e confirmar mostram e anunciam "Enviando o código" e "Confirmando o código": em `/entrar` não há "Cancelar", e o silêncio pareceria quebrado.

| Código do Supabase | Mensagem |
|---|---|
| Validação local | "O código tem 6 dígitos; você digitou 4." |
| `otp_expired` | "Código incorreto ou vencido. Confira os dígitos ou peça outro." |
| `over_email_send_rate_limit`, `over_request_rate_limit` | "Muitos pedidos agora. Tente em alguns minutos. O que você escreveu continua aqui." |
| `email_address_not_authorized` | "Este e-mail ainda não pode receber código: o envio está em fase de teste." |
| `email_address_invalid`, `validation_failed` | "Confira o e-mail digitado." |
| `signup_disabled`, `otp_disabled` | "O login está desligado no momento." |
| Falha de rede | "Não conseguimos falar com o serviço de login. Tente de novo." |
| 30 s sem resposta | "O serviço de login demorou demais. Confira o sinal e tente de novo." |
| Biblioteca que não carrega (a falha não fica guardada) | "Não conseguimos abrir o login. Confira o sinal e tente de novo; se continuar, recarregue a página." |

### 8.2 Rotas e proteção

| Rota | Conteúdo | Sem login |
|---|---|---|
| `/entrar?volta=` | `FluxoCodigo`; `volta` só aceita caminho interno, conferido pela origem depois que o navegador normaliza (barra invertida, tab) | É a própria página |
| `/conta` | E-mail, que é local e aparece mesmo com a API fora; espera do servidor; erro com "Tentar de novo"; 401 sem renovação abre o portão; aviso de privacidade; "Sair"; link do painel se admin, por último, para não empurrar nada | Vai para `/entrar` com `replace` |
| `/barreiras` | Barreiras perto de um ponto | Público |
| `/barreiras/nova` | Cadastro | Público; portão ao confirmar |
| `/barreiras/:id` | Ficha, votos, foto | Público; portão ao votar |
| `/admin` e `/admin/barreiras/:id` | Fila e decisão | Portão na própria página |
| `*` | Página não encontrada | Pública |

O menu ganha "Planejar rota", "Barreiras" e "Entrar" ou "Conta". A decisão entre "Entrar" e "Conta" lê só a presença de `rf-sessao`, sem carregar a biblioteca.

### 8.3 Regra de erro para todo o Plano 6

Não existe `role="alert"`. Erro de campo: texto com pictograma `alerta`, id próprio, `aria-invalid`, `aria-describedby` e foco no campo, sem anúncio. Se o foco não muda, usa `useAnuncio()`; `focarOuAnunciar` decide (D28). Vale inclusive para arquivo inválido, porque o foco já está no campo quando o seletor fecha. Assim o leitor não fala duas vezes. Óxido não marca erro (`DESIGN.md`, Óxido de Estado): o sinal é borda de 2 px em tinta e pictograma.

## 9. Barreiras

### 9.1 Cadastro em 3 toques

Página no layout de `/rota`. **Toque 1:** `fieldset` com as 10 categorias, tipadas por `Record<Categoria, …>`; severidade não aparece. **Toque 2:** `EscolhaLocal`, com três caminhos equivalentes. Escolher por qualquer caminho tira o campo da tela: o foco vai a "Local marcado", que lê o local, sem anúncio; "Trocar o local" leva à busca. **Toque 3:** "Registrar barreira". Descrição visível e opcional, até 500 caracteres. A foto vem depois da criação, porque o endpoint precisa do id. A permissão do GPS e o login da primeira vez são toques a mais, fora do nosso controle.

`EscolhaLocal`:
- **GPS:** a barreira usa a coordenada do GPS, não a do endereço devolvido, que pode estar a até 50 m. Precisão pior que 100 m avisa, sem bloquear. "Fora da área" recusa; "nada a 50 m" permite registrar no ponto. Sem conexão para o reverso (rede, tempo ou 5xx), o ponto fica no rascunho, com "Ponto guardado. Não conseguimos confirmar o endereço agora.": quem reporta na hora, às vezes sem sinal, não perde a coordenada. Não é a fila offline do Plano 7: o envio continua exigindo rede, e o 422 do `POST` segura o que for de fora. Mesmas guardas de 7.3: anuncia a busca, bloqueia a segunda pressão e descarta o resultado se a pessoa digitou, escolheu ou saiu.
- **Busca:** o mesmo autocomplete. `tipo === 'logradouro'` avisa "O ponto fica perto do meio da rua. Se puder, digite o número ou marque no mapa."; `aproximado` avisa.
- **Mapa:** `PontoNoMapa`, com mira no centro e botões Norte, Sul, Leste, Oeste, Aproximar, Afastar e "Marcar o centro do mapa", com o mesmo aviso de IP de D7. Os botões de mover anunciam, com throttle ("Mapa movido para norte."). Nunca marcador arrastável. O ponto sempre vira texto: "Local marcado: perto de Rua X". Chunk que falha fica nesta seção, com "Tentar de novo", sem derrubar o cadastro; fundo que não carrega diz "O fundo do mapa não carregou. Use a localização ou digite o endereço."

| Resposta do `POST` | Comportamento |
|---|---|
| 201 | Vai à ficha: h1 "Barreira registrada" com foco, e o efeito em texto |
| 200 | Mesmo destino, com "Esta barreira já estava registrada." |
| 401 | Renova; se falhar, portão |
| 422 com `detail` texto | Mensagem do backend, ligada a "Trocar o local", que recebe o foco |
| 422 com `detail` lista | "Confira os dados informados." |
| 429 | Mensagem do backend; rascunho mantido |
| 503, rede, tempo | "Não conseguimos enviar agora. O rascunho fica só nesta aba: se você a fechar, ele se perde."; pressionar de novo usa a mesma chave |

Sem local, "Diga onde está a barreira." fica ligado ao campo de busca. Editar com o portão aberto vale: o `POST` sai com o que está na tela, e com chave nova (D15, D18). Textos: o cadastro diz que o registro fica público, "sem seu nome nem e-mail; a moderação vê só um código da conta, para auditoria". O efeito não diz "outra pessoa confirma", porque intransponível exige 2: diz "com as confirmações necessárias".

### 9.2 Barreiras por perto e ficha

`/barreiras`: `EscolhaLocal` e raio de 200 m, com "Ver até 500 m" se houver menos de 5; esse botão e "Tentar de novo" somem e levam o foco ao título da lista. O ponto fica em `location.state`, nunca na URL, e vai e volta pela ficha ("Ver outras barreiras"). Trocar raio ou local não anuncia nem mostra o resultado anterior: `useConsulta` só entrega dados da chave atual. `<ol>` sem caixa, com régua de 1 px. A lista só aparece com os endereços prontos, até 20 itens, para nada pular de lugar; reverso que falha cai só na distância. Lista vazia: "Nenhuma barreira registrada a até 200 m. Isso não quer dizer que não haja."

| Status | Texto | Efeito declarado |
|---|---|---|
| `pendente` | Aguardando confirmação | "Ainda não muda a rota. Falta 1 confirmação." |
| `validada` + intransponível | Confirmada | "A rota evita este ponto." A ficha acrescenta a exceção: "a rota de reserva, usada quando o serviço principal cai, ainda não considera este registro." |
| `validada` + dificulta | Confirmada | "A rota avisa, mas pode passar por aqui." |
| `validada` + informativo | Informativa | "Não muda a rota." |
| `contestada` | Contestada | "Pessoas disseram que não existe. A rota não considera. Votação encerrada." |
| `resolvida` | Resolvida | "Foi consertada, segundo quem votou. Votação encerrada." |
| `expirada` | Expirada | "Ninguém confirmou no prazo. A rota não considera. Votação encerrada." |

Quando os dados chegam, a ficha anuncia categoria, status e efeito uma vez: o h1 já focado muda de texto sem fala. Endereço: "Buscando o endereço…" na carga, "Endereço indisponível agora." na falha e "Sem endereço conhecido a até 50 m." só no 404. Fonte na ficha: "relato de colaboradores, não verificado pela Prefeitura", com a data. Datas com hora usam `America/Sao_Paulo`, porque `formatarData` corta a string e mostraria o dia seguinte à noite.

### 9.3 Votação

Três placas neutras com `aria-pressed`: Confirmo, Não existe, Já resolvida, cada uma ligada à própria explicação. Rodapé: "Seu voto conta uma vez. Votar de novo troca o voto. Quem usa o site não vê quem votou; a moderação vê um código da conta, nunca o e-mail, para auditoria." O foco fica no botão, e o anúncio é "Voto registrado. Agora são 2 confirmações. {efeito}". O voto que encerra a votação tira os botões da tela: o foco vai à frase de status e efeito, sem anúncio. Status encerrado: nenhum botão, só a frase. Barreira informativa nasce validada e nunca entra na rota, então a explicação diz "Isto é só informação: não muda a rota.", nunca um limiar. `aria-pressed` vale só na sessão, porque a resposta não diz qual foi o seu voto (D9 do spec colaborativo).

**Autor:** em `PUT /voto`, o único 403 é de autor, então não se compara texto. A interface mostra "Você cadastrou esta barreira; quem vota são outras pessoas.", com o foco nessa frase, e guarda o id em `localStorage` (`rf:minhas:<conta>`). "Sair" apaga `rf:minhas:*` e o rascunho, sem depender de a conta ter carregado, e o `recemCriada` é consumido na chegada à ficha: outra conta, voltando pelo histórico, não herda a autoria. É só conveniência; o servidor decide. Descartado: `eh_autor` em `BarreiraOut`, que contraria D9 e faria uma resposta pública variar por conta.

Outros erros: 404 dá "Esta barreira não está mais disponível."; 409 dá a mensagem do backend e relê a ficha, mesmo depois de um voto aceito, porque a consulta é a única fonte da ficha; 401 abre o portão e refaz o voto.

### 9.4 Foto

`FotoBarreira`, na ficha, para quem está em `rf:minhas`, acabou de criar ou é admin. `<input type="file">` nativo, sem `capture` e sem zona de arrastar. Antes de enviar: até 5 MB e JPEG, PNG ou WebP; 40 megapixels ficam para o servidor. Prévia com `URL.createObjectURL`, revogada ao desmontar. Texto alternativo obrigatório, de 5 a 300 caracteres. Erros de arquivo e de descrição ficam ligados ao próprio campo (seção 8.3). "Remover foto" some com o sucesso, e o foco vai à frase "Foto removida." Aviso: "Removemos a localização gravada na foto. Evite rostos e placas de carro; não há borramento automático." 503 dá "Envio de foto indisponível. Sua barreira já está registrada." Multipart sem `Content-Type` à mão.

### 9.5 Ligação com a rota

Em `/rota`, cada passo com geometria válida tem "Barreiras perto do passo N", que abre `/barreiras` com o meio do passo em `location.state`. É o que mostra pendentes sem uma chamada por passo. Barreira colaborativa no passo tem "Ver e votar"; oficial não tem link, porque os ids colidem entre as duas tabelas. A volta restaura a rota da sessão, sem `POST`.

## 10. Painel de admin

Link só em `/conta` (D19) e "Moderar esta barreira" na ficha, para admin. `/admin`: filtros são links com `?status=` e `aria-current`, o padrão é `pendente`, o anúncio diz a contagem, e "Carregar mais" leva o foco ao primeiro item do lote novo, a cada lote; se não houver mais, à frase "Não há mais barreiras." Leituras com token passam por `comSessao`: 401 sem renovação abre o portão, também em "Carregar mais" e na auditoria.

`/admin/barreiras/:id`: ficha completa, inclusive de removida; rádios com os 6 status e o significado de cada um; motivo de 3 a 300 caracteres após `trim`; "Registrar decisão", sem confirmação dupla; o foco fica no botão; anúncio "Status alterado para {status}. Auditoria atualizada." Foto: "Remover foto" fica disponível só enquanto não está removida, com a orientação de remover antes.

Auditoria: `<ol>` cronológica, texto determinístico de `textoEvento()`. Autor como "conta 3f2a91b0", porque um UUID lido em voz alta não serve a ninguém; `null` vira "sistema". O e-mail nunca aparece. É por isso que as telas públicas não dizem que "ninguém vê": a moderação vê esse código, estável entre barreiras.

## 11. Bundle

| Chunk | Medido em gzip | Teto |
|---|---|---|
| Entrada (React, router, shell, `Inicio`) | 75,6 KB (87,5 KB no fim do Plano 5) | 95 KB |
| Leaflet | 43,4 KB | 50 KB |
| `auth-js` | 22,4 KB | 50 KB |
| Demais, por arquivo | até 14 KB | 50 KB |

`scripts/orcamento-bundle.mjs` compara no CI, e falha se `leaflet-container` aparecer na entrada.

## 12. Contrato: o que muda no backend

Só o indispensável:

| Item | Veredito | Forma |
|---|---|---|
| `GET /api/admin/barreiras?status=&limite=50&antes_de=` | Indispensável: `GET /api/barreiras` exige ponto e esconde removidas, e restaurar exige achar o id | `list[BarreiraOut]`, id decrescente, compara com o status **efetivo**. 401, 403, 422, 503 |
| `GET /api/admin/barreiras/{id}` | Indispensável (R19) | `BarreiraOut`, inclusive removida |
| `GET /api/eu` | Contornável, recomendado (decisão do dono 2) | `{"papel": "colaborador" \| "admin"}`, sem id nem e-mail |
| `barreira_geom.py:99` | Defeito: remover `AND confirmacoes >= 2` | `validada` já carrega o limiar |
| `StatusAdminIn.motivo` | Defeito: `StringConstraints(strip_whitespace=True, min_length=3, max_length=300)` | |

Rejeitados: checar área em `POST /api/rotas` (a interface só obtém pontos da área), trocar o texto do 503, `eh_autor`, endpoint de "meu voto", `Literal` em `BarreiraOut.categoria`, handler de `OperationalError` (R10).

Conferido sem banco: CORS já cobre `PUT` e `DELETE`, com multipart sem `Content-Type` à mão. `CORS_ORIGINS` em produção é verificação do dono.

## 13. Erros e espera

| Situação | Tipo | Mensagem |
|---|---|---|
| Offline | `rede` | "Sem conexão com a internet. Confira o sinal e tente de novo." |
| `TypeError` | `rede` | "Não conseguimos falar com o servidor. Confira sua conexão e tente de novo." |
| Teto da operação | `tempo` | "Demorou demais. Tente de novo." |
| Teto de 120 s sem resposta do `/health` | `indisponivel` | "O servidor não respondeu. Confira o sinal e tente de novo em alguns minutos." |
| Sinal perdido durante a espera | `rede` | A mensagem de offline, acima: `navigator.onLine` é reavaliado a cada tentativa |
| Cancelado por quem chamou | nenhum | Engolido pelos hooks |
| 401 | `sessao` | Renova e repete uma vez; depois, portão |
| 403, 404, 409, 413, 415, 429 | correspondente | `detail` do backend |
| 422 texto | `validacao` | O `detail` |
| 422 lista | `validacao` | "Confira os dados informados." e `campos`; nunca o `msg` em inglês |
| 503 ou 5xx com JSON | `indisponivel` | `detail`, exceto em `/api/rotas`: "O serviço de rotas não respondeu agora. Isso não quer dizer que a rota não existe." |
| 5xx sem JSON, 200 com HTML | `indisponivel` | "O serviço não respondeu agora. Tente de novo em alguns minutos." |

Espera do Render, por `useEsperaServidor`: aos 4 s, "Ainda sem resposta. O servidor gratuito pode estar acordando, o que leva cerca de 1 minuto, ou o sinal pode estar fraco. Você pode continuar preenchendo; nada se perde."; aos 40 s, "Continuamos tentando. O pedido sai assim que o servidor responder." Sem spinner, barra nem contador. Cada estágio é anunciado uma vez. `/rota`, `/barreiras`, `/barreiras/nova`, ficha e conta aquecem o servidor ao montar; o início não.

**Região viva:** `Anunciar` passa a `(mensagem, { chave?, intervaloMs? })`. Com chave, no máximo um anúncio por intervalo, e vale o último. Um anúncio sem chave cancela os pendentes, e `useCancelarAnuncio()` cancela uma chave: a contagem de endereços não pode ser falada depois de a pessoa escolher, digitar ou sair. A região não lê o texto do passo (`DESIGN.md` prevalece sobre o spec-mãe). A deriva em `Fontes.tsx` sai neste plano, e `regiaoUnica.test.ts` varre o código e falha se outro `aria-live`, `role="status"` ou `role="alert"` aparecer.

## 14. Testes e gates

### 14.1 Automáticos

- **jsdom (vitest, testing-library, vitest-axe):** reducers, textos, sessão com armazenamento que lança, tradução de erros, espera do servidor com timers falsos, tabela de teclas, debounce, abort, composição, foco e anúncio do cálculo, mapa simulado, login com `auth/cliente` simulado, idempotência, LGPD (sem `Authorization` em rota e geocode), região única e ausência de "garante" e `flyTo` no código.
- **Navegador real (`frontend/e2e/`, Playwright, `@axe-core/playwright`):** build de produção com API e Supabase simulados por `page.route`; tiles interceptados, porque a política do OSM proíbe bots navegando. Cenários: E1 teclado; E2 axe por estado nos dois temas, zero críticas e sérias; E3 320 px e 1280 a 400%, inclusive Enter no campo com o resultado à vista; E4 alvos de 44 px, contando todo link que não está dentro de frase; E5 geolocalização concedida, negada e fora da área; E6 servidor dormindo; E7 Leaflet real em StrictMode, nada focável dentro; CSP real aplicada ao documento.
- **Lighthouse:** `scripts/gate-lighthouse.mjs`, nota de pelo menos 95. Ele só vê o estado inicial; o axe cobre os outros.
- **Backend:** `tests/test_eu_api.py` e `tests/test_admin_fila_api.py`, com PostGIS.

### 14.2 Gate do Plano 5

1. Vitest, `tsc -b`, ESLint, orçamento, E2E e Lighthouse, todos passando.
2. **Manual, NVDA com Firefox e com Chrome:** buscar, escolher, calcular e ouvir só por teclado, confirmando a fala de cada linha da seção 7.1. Registrar em `DESIGN.md`.
3. Zoom real de 400% no navegador.
4. Contra backend real com `USE_FIXTURES`: a resposta real passa pelo contrato.

### 14.3 Gate do Plano 6

Cadastrar uma escada só por teclado, validar por dois votos e por admin, recalcular e ver a rota mudar, com NVDA e zoom de 400%. Exige PostGIS local e um projeto Supabase com login configurado.

## 15. Fora de escopo

Plano 7 (SPTrans, voz nova, fila offline) e Plano 8. Qualquer ação em produção. VLibras: é script de terceiro e reabre o risco de XSS sobre a sessão, então precisa entrar na CSP de forma consciente. PMTiles próprio. Edição da barreira pelo autor. Link compartilhável de rota (decisão do dono 8).

## 16. Passos de produção, só com ordem do dono

Somados à seção 10 do spec colaborativo:

1. Merge de `feat/backend` e deploy; `alembic upgrade head` e ETL `tudo`, se ainda não feitos.
2. Supabase Auth: `{{ .Token }}` nos modelos **Magic Link e confirmação de cadastro**, código de 6 dígitos, SMTP próprio (sem ele, só membros da organização recebem código).
3. Conferir que o projeto assina em ES256: se não, todo token dá 401 (`auth.py`), e `/api/eu` revela isso no primeiro login.
4. Desligar a Data API e testar login e fotos em seguida. A documentação fala só dos endpoints REST gerados; é preciso conferir.
5. Definir `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` no build do Cloudflare.
6. Conferir `CORS_ORIGINS` no Render.
7. Depois do primeiro deploy, `curl -I https://rota-falada-sp.caiorosa2006.workers.dev/rota`: a documentação do Cloudflare não diz se `_headers` vale para o fallback de SPA. Se o host do Supabase ou da API mudar, atualizar `_headers`.
8. Com o Render dormindo, um `fetch` real a partir do site, para calibrar a espera.
9. Promover o admin, como no spec colaborativo.

## 17. Limitações conhecidas

- `POST /api/rotas` com banco fora vira 500 sem CORS; o navegador vê erro de rede, e a tela diz que não conseguiu falar com o servidor (R10).
- Sob o pgRouting, barreira registrada não muda a rota, e a intransponível não aparece nos passos (decisão do dono 12). A ficha da rota e a da barreira dizem isso.
- O rascunho vive só na aba, em `sessionStorage`. A fila offline é do Plano 7; a tela diz isso quando o envio falha.
- `flushSync` põe a mensagem no DOM antes do foco, mas a fala real do NVDA só se confirma no gate manual.
- `Fonte` e `Data` do passo são derivadas (R15): a data do GeoSampa não aparece no passo, só em `/fontes`.
- `aria-pressed` do voto vale só na sessão.
- Autor em outro aparelho descobre que é autor pelo 403, na primeira tentativa.
- Foto de barreira já removida não sai pelo painel (`fotos.py`).
- Enquanto a votação está aberta, um voto pode recalcular a decisão do admin (decisão do dono 3). A tela de decisão diz isso.
- Sessão em `localStorage` dura até "Sair"; prazo máximo de sessão é recurso do plano Pro do Supabase.
- Sem SLA nos tiles do OSM: se cair na banca, a lista segue inteira. Vale incluir no ritual abrir o mapa antes.
- Plano 7 não pode cachear esses tiles: a política do OSM proíbe pré-carga e offline.

## 18. Decisões que só o dono pode tomar

O plano segue a recomendação de cada uma até ordem em contrário; nenhuma bloqueia o início.

1. **Texto da restrição de chaves** (`PRODUCT.md:54` e spec-mãe, linha 340). Lidas ao pé da letra, proíbem a publishable key. **Recomendo reescrever** para "Nenhuma chave secreta no frontend. A publishable key do Supabase é pública e usada só no login." A alternativa é proxy no FastAPI: o código por e-mail passaria a depender do Render acordar, e o refresh token passaria pelo nosso servidor.
2. **`GET /api/eu`, embora contornável** (sondar a fila e ler 200 ou 403). **Recomendo aceitar:** custa cerca de 7 linhas, evita 403 como controle de fluxo e revela logo no login se o backend aceita o token.
3. **Voto depois da decisão do admin.** Hoje, um único voto abaixo do limiar devolve a `pendente` o que o admin validou. O spec colaborativo não tratou desse encontro entre D3 e a regra 6.2. **Recomendo:** depois da decisão do admin, só 2 contestações ou 2 "resolvida" mudam o status, sem migration. O plano não implementa isso e a tela avisa. Na mesma linha: tratei como consequência de D3, e não como decisão nova, que validar pelo admin faça a rota desviar mesmo com menos de 2 votos. Diga se discorda.
4. **Fonte e data por campo do passo.** **Recomendo acrescentar** `fonte_largura`, `data_largura` e `fonte_declividade` opcionais em `Passo`, depois desta entrega, porque a banca vai olhar exatamente isso. O plano entrega a regra derivada.
5. **Log de acesso em produção.** O `uvicorn` grava `lat`, `lon` e o texto buscado na query, junto com o IP (`render.yaml:9`). **Recomendo `--no-access-log`** e `private` no `Cache-Control` do reverso. O custo é perder esse log para diagnóstico. Sem isso, a tela só pode dizer "usa o GPS uma vez, quando você aciona", como já está.
6. **Mapa por botão e tiles do OSM, com aviso de IP.** O provedor recebe o IP e a região vista, só depois do clique, sem SLA, e a banca precisa de um clique a mais. **Recomendo aceitar.**
7. **Trocar "marcadores focáveis" do spec-mãe (linha 262) por "Ver o passo N no mapa".** O spec aprovado pede algo incompatível com `role="img"`, e o axe confirma. **Recomendo aceitar** e corrigir o spec-mãe.
8. **Link compartilhável de rota.** **Recomendo não fazer agora.** Se a banca pedir, entra como ação explícita, com coordenadas no fragmento e aviso de que o link contém o trajeto.
9. **Licença do que a pessoa publica.** O spec-mãe deixa ODbL em aberto e não trata de fotos. **Recomendo ODbL para os dados e uma licença aberta à parte para fotos**, porque ODbL é licença de base de dados. O aviso do cadastro hoje só diz que fica público.
10. **Exclusão de conta (LGPD).** Não há como a pessoa apagar a própria conta. **Recomendo informar em `/conta` um e-mail de contato e atender à mão durante o projeto.** Falta você definir o endereço e se a barreira fica sem autor depois da exclusão.
11. **Passos de produção da seção 16**, cada um só com sua ordem. Sem SMTP próprio, a demonstração com outra conta não funciona.
12. **pgRouting não lê barreira registrada.** Se o OpenRouteService cair ou estourar a cota, uma intransponível confirmada não muda a rota nem aparece nos passos, e o critério "a rota muda" falha na banca. O plano não mexe no backend: a ficha diz isso. **Recomendo corrigir depois desta entrega**, excluindo do `pgr_dijkstra` as arestas a até 15 m de intransponível confirmada e devolvendo essas barreiras em aviso. Até lá, confira o ORS antes da banca.
13. **Código da conta na auditoria.** "conta 3f2a91b0" é estável entre barreiras, então a moderação consegue ligar os votos e cadastros de uma conta, cada um com localização. Segue D9 do spec colaborativo, e as telas agora dizem isso. **Recomendo manter**, porque é o que permite achar abuso, e citar na política de privacidade junto com a decisão 10.

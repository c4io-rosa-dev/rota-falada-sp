---
name: Rota Falada SP
description: Rotas a pé em São Paulo descritas como texto, desenhadas em concreto limpo da escola paulista.
colors:
  concreto: "#d2d4cf"
  torre: "#c3c6c0"
  placa: "#e6e7e2"
  vao: "#dfe0db"
  junta: "#8a8f8a"
  junta-forte: "#5d625e"
  aresta: "#8a8f8a"
  tinta: "#1c1f1d"
  tinta-2: "#3a3f3b"
  oxido: "#9a3f2c"
  sobre-oxido: "#f3f3ef"
  faixa: "#1c1f1d"
  faixa-tinta: "#d2d4cf"
  faixa-oxido: "#d27a62"
  foco: "#1c1f1d"
  foco-faixa: "#e6e7e3"
  concreto-noturno: "#1f2220"
  torre-noturna: "#2a2e2b"
  placa-noturna: "#282b29"
  vao-noturno: "#2e322f"
  junta-noturna: "#3a3e3b"
  junta-forte-noturna: "#7f8580"
  aresta-noturna: "#5b605c"
  tinta-noturna: "#e6e7e3"
  tinta-2-noturna: "#b8bcb7"
  oxido-noturno: "#cf6e55"
  sobre-oxido-noturno: "#141615"
  faixa-noturna: "#141615"
  faixa-tinta-noturna: "#e6e7e3"
  faixa-oxido-noturno: "#cf6e55"
  foco-noturno: "#e6e7e3"
typography:
  display:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 0.9rem + 3.4vw, 4.5rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "0.02em"
    fontVariation: "'wdth' 125"
  headline:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "clamp(1.375rem, 1rem + 1.6vw, 2rem)"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "0.03em"
    fontVariation: "'wdth' 125"
  title:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "0.03em"
    fontVariation: "'wdth' 125"
  body:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "'tnum' 1"
  label:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.55
    letterSpacing: "0.04em"
    fontFeature: "'tnum' 1"
rounded:
  vivo: "0"
spacing:
  e-1: "0.5rem"
  e-2: "1rem"
  e-3: "1.5rem"
  e-4: "2.5rem"
  e-5: "4rem"
  e-6: "7rem"
  calha: "clamp(1rem, 3vw, 2.5rem)"
  largura-max: "90rem"
components:
  placa-acao:
    backgroundColor: "{colors.placa}"
    textColor: "{colors.tinta}"
    typography: "{typography.title}"
    rounded: "{rounded.vivo}"
    padding: "0.5rem 1.25rem"
    height: "56px"
  placa-acao-hover:
    backgroundColor: "{colors.oxido}"
    textColor: "{colors.sobre-oxido}"
  placa-neutra:
    backgroundColor: "{colors.placa}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.vivo}"
    padding: "0.5rem 1rem"
    height: "44px"
  placa-neutra-hover:
    backgroundColor: "{colors.vao}"
  placa-desabilitada:
    backgroundColor: "{colors.vao}"
    textColor: "{colors.tinta-2}"
  campo:
    backgroundColor: "{colors.vao}"
    textColor: "{colors.tinta}"
    typography: "{typography.body}"
    rounded: "{rounded.vivo}"
    padding: "0.5rem 0.75rem"
    height: "48px"
  opcao:
    backgroundColor: "{colors.vao}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.vivo}"
    padding: "0.5rem 0.75rem"
    height: "48px"
  faixa:
    backgroundColor: "{colors.faixa}"
    textColor: "{colors.faixa-tinta}"
    typography: "{typography.label}"
  torre:
    backgroundColor: "{colors.torre}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.vivo}"
    padding: "1.25rem"
  janela:
    backgroundColor: "{colors.placa}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.vivo}"
    padding: "2.5rem 2rem"
  passarela-vao:
    backgroundColor: "{colors.vao}"
    textColor: "{colors.tinta}"
    typography: "{typography.title}"
    padding: "0.5rem 1rem"
    height: "2.75rem"
  numero-ativo:
    backgroundColor: "{colors.oxido}"
    textColor: "{colors.sobre-oxido}"
---

# Design System: Rota Falada SP

## Overview

**Creative North Star: "Concreto limpo da escola paulista"**

A rota é a passarela entre dois prédios. A interface é uma elevação de arquitetura brutalista paulista (as passarelas do SESC Pompeia de Lina Bo Bardi) reduzida ao essencial: planos lisos de concreto, juntas de 1 px e muito espaço. Duas torres lisas ladeiam os vãos de cada passo; cada vão mostra só o número, o nome da rua em letreiro e a distância, e a cota técnica completa vive numa tabela gravada mais abaixo. O vermelho-óxido aparece apenas na placa de ação e no estado ativo. Tudo é CSS ou SVG autoral; nenhuma imagem raster é entregue.

A revisão minimalista de 13/10/2026 ("poluída, informações muito juntas") definiu o caráter: o espaço separa os blocos antes de qualquer moldura; onde ainda há moldura, ela é uma junta de 1 px. Letreiros grandes, expandidos e em caixa-alta carregam os nomes; a leitura é em largura normal, com algarismos tabulares. O conforto sensorial é compromisso do produto: nenhuma cor saturada em área grande, um único momento de movimento, nada se move sem ação do usuário.

O sistema recusa o arranjo padrão da categoria (mapa em tela cheia como herói, caixa de busca sobreposta, três cartões com ícone), cartões genéricos arredondados, sombra, relevo de texto, gradiente em texto e ornamento de fachada (grades, janelas escuras decorativas, platibandas).

**Key Characteristics:**
- Uma família (Archivo variável), quatro tamanhos e três pesos (400, 600, 800).
- Canto vivo em tudo (raio 0); pictogramas em grade 24 com traço único de 2 px.
- Profundidade só por troca de material e junta; nenhuma sombra.
- Óxido só na placa de ação e no estado ativo ou selecionado; nunca texto, nunca área grande.
- Espaço generoso: 7rem antes de cada título de seção, 26 px entre vãos na elevação.
- Alvos de 44 px (placa de ação 56 px, campo e opção 48 px), sem rolagem horizontal a 320 px.
- Claro e escuro completos via `prefers-color-scheme`, com contrastes calculados e anotados no topo de `frontend/src/index.css`.

## Colors

Paleta de concreto cinza-esverdeado quase monocromática, com um único acento de vermelho-óxido apagado.

### Primary
- **Vermelho-óxido** (`oxido`; noturno `oxido-noturno`): caixilho de 2 px da placa de ação e o fundo dela em hover; guarda-corpo do vão em leitura; caixa do número do passo ativo (na elevação e na tabela); borda da opção marcada e miolo do rádio e da caixa marcados; seleção de texto e cursor de digitação. 5,07:1 contra o vão no claro, 3,73:1 no escuro (só usos não textuais, mínimo 3:1).
- **Sobre-óxido** (`sobre-oxido`): o único texto sobre óxido (placa de ação em hover, número ativo, visto da caixa), 6,05:1.
- **Óxido da faixa** (`faixa-oxido`): só a marca de página atual na navegação escura (5,30:1).

### Neutral
- **Concreto aparente** (`concreto`): chão da página, com a marca de tábua de fôrma quase sumida (SVG em data URI, no máximo 1,04:1 contra a base). É a única superfície texturizada.
- **Concreto de torre** (`torre`): plano liso das torres e do poço de circulação.
- **Laje lisa** (`placa`): janelas, lajes, ficha, folhas de leitura, formulário, placas. Onde o texto corrido mora.
- **Vão** (`vao`): tabuleiro das passarelas, campos, opções, aviso do formulário, hover.
- **Junta** (`junta`): juntas de 1 px entre e em volta dos blocos; guarda-corpo em repouso (2 px).
- **Junta forte** (`junta-forte`): borda de campo e de placa neutra, traço de cobertura de 2 px das torres, a junta contínua que liga os vãos, linha de chão, sublinhado de link.
- **Aresta** (`aresta`; noturna `aresta-noturna`): contorno de 1 px das torres e do poço contra o chão (2,20:1 claro, 2,50:1 escuro, onde a torre sozinha daria 1,16).
- **Tinta** (`tinta`) e **tinta secundária** (`tinta-2`): todo o texto e todos os pictogramas. Tinta-2 para números de passo em repouso, distâncias, dicas, perfis, legendas e rótulos de coluna.
- **Faixa** (`faixa`, `faixa-tinta`): cabeçalho e rodapé em concreto escuro; links da faixa sublinhados na própria cor do texto.
- **Foco** (`foco`, `foco-faixa`): anel de 3 px com afastamento de 3 px; dentro da faixa o anel é claro.

O modo escuro troca cada papel pelo seu par `-noturno`/`-noturna` no frontmatter; a textura do chão escurece sobre preto e continua quase sumida (1,035:1).

### Named Rules
**The Óxido de Estado Rule.** Óxido só na placa de ação e no que está ativo ou selecionado agora (vão em leitura, número ativo, opção marcada, página atual). Nunca como cor de texto, nunca como fundo de área grande, nunca como moldura decorativa.

**The Pictograma em Tinta Rule.** Pictogramas herdam tinta ou tinta-2 pela cor do texto. Óxido não colore pictograma.

**The Chão Quase Liso Rule.** Só o chão leva a textura de fôrma, e ela fica abaixo de 1,05:1. Torres, janelas, lajes e vãos são lisos; texto corrido nunca fica direto no chão.

## Typography

**Display Font:** Archivo Variable (com Archivo, system-ui, sans-serif), auto-hospedada via `@fontsource-variable/archivo/wdth.css`, eixos de largura 62 a 125 e peso.
**Body Font:** a mesma Archivo Variable, largura 100.

**Character:** uma família em dois registros: o letreiro gravado (largura 125, 800, caixa-alta) e a leitura (largura 100, 400/600, tabular). A diferença vem da largura e do peso, nunca de uma segunda fonte.

### Hierarchy
A escala tem quatro tamanhos e nada fora dela.
- **Display** (`--t-4`; 800, largura 125, 0.95, 0.02em, caixa-alta): só o h1 de cada página.
- **Headline** (`--t-3`; 800, largura 125, 1.1, 0.03em, caixa-alta): títulos de seção, o nome da rua gravado em cada torre (origem e destino, o mesmo tamanho), h1 das folhas de leitura, numerais das lajes e da tabela de passos.
- **Title** (`--t-2` em 800, largura 125, caixa-alta): nome da rua em cada vão, h3 das lajes e personas, h2 das folhas e da janela de aviso, texto da placa de ação.
- **Body** (`--t-2` em 400, 1.55; 600 para ênfase): texto corrido, até 34 a 68ch conforme o contêiner; instrução de cada passo em 600.
- **Label** (`--t-1`): navegação (600, 0.02em), número do vão (600), legendas, dicas, perfil de persona (600), proveniência, nota da banca, texto da placa neutra em letreiro, e os rótulos de coluna e de campo da tabela (600, 0.04em, caixa-alta).

### Named Rules
**The Quatro Tamanhos Rule.** Todo `font-size` usa `--t-1` a `--t-4`, e todo peso é 400, 600 ou 800. Hierarquia nova sai de peso, largura ou espaço, não de um tamanho novo.

**The Medida Tabular Rule.** Toda medida (distância, declividade, largura, data, número de passo) usa algarismos tabulares; o `:root` já liga `tabular-nums`.

**The Letreiro Rule.** Caixa-alta expandida é para nomes próprios e títulos gravados. Caixa-alta pequena só para rótulos de dados em tabela, nunca acima de um título.

## Layout

Página em pilha vertical com cabeçalho e rodapé em faixa escura de largura total; conteúdo limitado a `largura-max` com a calha fluida `calha`. Um único ritmo de espaço em seis passos (`e-1` 0,5rem a `e-6` 7rem), com mais ar acima do título que abaixo: toda seção da landing abre com `e-6` antes do h2 (`e-5` a 560 px ou menos) e o h2 fica a `e-4` do conteúdo.

- **Elevação (dobra do início):** grade de três colunas (origem 15fr, vãos 23fr, destino 10fr), altura `min(100svh − 3.75rem, 52.5rem)`, sobre uma linha de chão de 2 px em junta forte. A torre de origem estica do topo ao chão com título e ações no alto e o nome da rua de origem gravado embaixo; a do destino, mais baixa, assenta no chão. Os vãos alternam: o ímpar encosta na torre de origem (recuo de 22% à direita) e o par chega ao poço de circulação que sobe junto à torre do destino (recuo de 22% à esquerda). Uma única junta vertical de 2 px em junta forte corre atrás dos vãos e os liga; entre vãos, 26 px.
- **Como funciona:** três lajes 3fr/6fr/3fr que descem em degraus (`e-4`, `e-5`), atravessadas por uma linha de 2 px em junta forte.
- **Para quem é:** três colunas de texto sem caixa, separadas por espaço `e-4` e junta vertical de 1 px; a nota da banca segue embaixo em label tinta-2.
- **Exemplo de rota:** h2 fora da ficha; ficha fixa (sticky) 6fr ao lado da tabela 18fr. A partir de 1200 px, um cabeçalho de colunas único e as 11 linhas compartilham as mesmas colunas por `subgrid`, e os rótulos por linha saem da vista mas continuam para o leitor de tela; abaixo disso cada campo mostra o próprio rótulo.
- **/rota:** cabeça em largura total, formulário 7fr e torre anexo 5fr. **/fontes e /acessibilidade:** folha lisa de até 48rem.
- **≤ 1023 px:** coluna única; as passarelas viram patamares empilhados em largura total, sem recuo alternado, ligados pela mesma junta contínua; o poço some; lajes e personas empilham (personas separadas por junta horizontal); a ficha deixa de ser fixa. **≤ 560 px:** paddings menores, tabela com dados em 2 colunas, opções em 1. **≤ 400 px:** placa em largura 112 e nome da rua no vão em largura 100. **≤ 360 px:** nome da rua no vão em largura 75 e tracking 0; dados em uma coluna.

## Elevation & Depth

Sem sombra alguma: nem `box-shadow`, nem `text-shadow`, nem relevo. A profundidade vem da troca de material (chão com fôrma quase sumida, torre lisa mais escura, laje lisa mais clara) e de juntas: aresta de 1 px nas torres, traço de cobertura de 2 px em junta forte no topo de torres e poço, junta de 1 px em volta de janelas, lajes, ficha, folha e formulário, e réguas de 1 px entre linhas da tabela.

### Named Rules
**The Espaço Antes da Moldura Rule.** Separe primeiro com espaço; se precisar de mais, use uma junta de 1 px. Nada de caixas dentro de caixas: amostras, falas e placas gravadas dentro de uma laje ficam sobre a laje, abertas por uma junta de 1 px.

**The Um Só Movimento Rule.** Há um único momento de movimento: o guarda-corpo do vão em leitura passa de junta a óxido pleno em 200 ms ease-out; com `prefers-reduced-motion` a troca é instantânea. Nenhuma entrada animada, nada se move sem ação do usuário.

## Shapes

Canto vivo absoluto (`rounded.vivo`) em placas, campos, rádios, caixas, janelas, lajes e torres. As formas são retângulos lisos e linhas de 1 ou 2 px; não há diagonais, hachuras, grades nem recortes decorativos. Pictogramas: grade 24, traço único de 2 px, `butt` e `miter`. O rádio marcado é um quadrado óxido dentro do caixilho; a caixa marcada é uma laje óxido com o visto desenhado em traço 2.

## Components

### Placa (botões e links de ação)
Laje lisa de canto vivo com letreiro e pictograma à direita; vira link ou botão.
- **Ação:** caixilho de 2 px em óxido, 56 px, texto em title; hover inverte para fundo óxido com sobre-óxido. Uma por contexto ("Planejar rota", "Calcular rota"). É o único caixilho óxido do sistema.
- **Neutra:** borda de 1 px em junta forte, 44 px, letreiro em label; hover troca para o vão com borda em tinta.
- **Pressionada (`aria-pressed`):** vão com borda em tinta.
- **Desabilitada (`disabled` ou `aria-disabled`):** borda tracejada em junta forte, vão, tinta-2, cursor bloqueado. "Calcular rota" usa `aria-disabled` com `aria-describedby` apontando para o aviso, e o envio é bloqueado no handler.
- **Ouvir o exemplo:** rótulo fixo com `aria-pressed`; só o pictograma troca (ouvir/parar). Sem suporte de voz, vira uma frase em tinta-2 dizendo que a rota continua em texto.

### Inputs / Fields
- **Campo:** vão, borda de 1 px em junta forte, 48 px, canto vivo; hover leva a borda a tinta; cursor óxido. Rótulo em 600, dica em label tinta-2 ligada por `aria-describedby`.
- **Opção (rádio e caixa):** a linha inteira é o alvo, 48 px, vão com junta de 1 px; controle nativo trocado por quadrado de 1.25rem com borda de 2 px. Marcada: borda da linha em óxido.
- **Aviso do formulário:** vem antes do primeiro campo; pictograma em tinta-2 e texto em 600 numa faixa de vão sem borda.

### Navigation
Faixa escura de largura total: marca (pictograma de duas torres e passarela, 28 px) com "ROTA FALADA SP" em letreiro à esquerda; menu em label 600 à direita, alvos de 44 px, sem sublinhado em repouso. Página atual: borda inferior de 2 px em óxido da faixa. O rodapé usa a mesma faixa, sem borda.

### Torre e Janela (signature)
Plano liso de concreto de torre com aresta de 1 px e traço de cobertura de 2 px em junta forte; uma ou duas janelas de laje lisa com junta de 1 px emolduram o conteúdo real. Sem grade, sem janela escura, sem platibanda. A torre de origem leva o nome da rua de partida gravado na parede em headline; a do destino, o nome da rua de chegada no mesmo tamanho, a distância total e, uma única vez na página, a proveniência (fonte e data) sob uma junta de 1 px.

### Passarela (signature)
Um passo da rota como vão: tabuleiro em vão com guarda-corpo de 2 px em cima e junta de 1 px embaixo; dentro, só o número (label 600, tinta-2), o nome da rua em title e a distância em tinta-2 alinhada à direita. **Ativo** (`aria-current="step"`): guarda-corpo em óxido pleno e número invertido (fundo óxido, sobre-óxido), dois sinais que não dependem só da cor. A cota técnica completa não entra no vão; fica na tabela gravada.

### Tabela gravada de passos
Lista ordenada sem caixa, aberta por régua de 1 px em junta forte e com régua de 1 px em junta entre linhas. Cada linha: numeral em headline tinta-2, instrução em body 600 e os sete campos (distância, largura, declividade, guia, degrau, fonte, data) num `dl`; guia não rebaixada em 600. Passo em leitura: numeral invertido em óxido, em sincronia com o vão.

### Região viva única
Uma só região `role="status"` educada e atômica, montada no App; componentes anunciam por um hook. Anuncia estados ("Lendo a rota em voz alta.", "Leitura interrompida."), nunca o texto do passo, para não duplicar a voz.

## Do's and Don'ts

### Do:
- **Do** separar blocos primeiro com espaço do ritmo `e-1` a `e-6`; só então com junta de 1 px.
- **Do** abrir toda seção da landing com `e-6` (7rem) antes do h2.
- **Do** pôr todo texto corrido sobre `placa`, `vao`, `torre` ou `faixa`, nunca direto no chão texturizado.
- **Do** dar a cada estado ativo um segundo sinal além do óxido (número invertido).
- **Do** manter alvos de 44 px no mínimo, 56 px na placa de ação, 48 px em campo e opção.
- **Do** desenhar pictogramas novos na grade 24, traço 2, canto vivo, em `currentColor`.
- **Do** anotar o contraste de toda cor nova no cabeçalho de `index.css`, nos dois modos.
- **Do** anunciar mudanças só pela região viva única.

### Don't:
- **Don't** usar óxido como cor de texto, fundo de área grande ou moldura decorativa.
- **Don't** usar `box-shadow`, `text-shadow`, relevo ou gradiente em texto.
- **Don't** arredondar cantos.
- **Don't** pôr caixa dentro de laje ou janela, nem moldura mais grossa que 2 px.
- **Don't** reintroduzir grades, janelas escuras decorativas, platibandas ou textura acima de 1,05:1.
- **Don't** pôr a cota técnica completa dentro do vão da elevação.
- **Don't** criar um quinto tamanho de fonte ou um quarto peso.
- **Don't** usar glifo unicode ou emoji como ícone; ícone é pictograma SVG autoral.
- **Don't** pôr rótulos em caixa-alta (kickers) acima de títulos.
- **Don't** animar entradas nem mover nada sem ação do usuário; o único movimento é o guarda-corpo, 200 ms ease-out.
- **Don't** criar outro `aria-live`, `role="status"` ou `role="alert"` fora da região viva única.

## Registro da entrega

- Revisão minimalista de 13/10/2026 (pedido do dono), disposição final: ship. Capturas do estado atual em `.impeccable/review/` (desktop-dobra-light, desktop-light, desktop escuro, desktop-ativo-light, mobile-light, mobile-320, rota-desktop-light, rota-mobile-light).
- Nenhum raster é entregue: toda imagem é CSS ou SVG autoral, então não há proveniência de raster a registrar.
- Lighthouse depois desta revisão (build de produção, 13/10/2026, desempenho/acessibilidade/boas práticas/SEO): `/` celular 99/100/100/100, desktop 99/100/100/100; `/rota` celular 99/100/100/100.
- Pendências abertas: a ficha fixa (sticky) deixa espaço nas capturas estáticas de página inteira (fica fixa num navegador real); voz real pt-BR não verificada; a variante `fachada` da Torre é usada só em teste; `Fontes.tsx` mantém `role="alert"` e `role="status"` próprios ao lado da região viva única (deriva antiga, fora do escopo); `frontend/public/icons.svg` e `frontend/src/assets/hero.png` são sobras do esqueleto Vite sem referência (`icons.svg` é copiado para o build); os pictogramas `guia-rebaixada`, `guia-alta`, `largura`, `rampa` e `degrau` ficaram sem uso.

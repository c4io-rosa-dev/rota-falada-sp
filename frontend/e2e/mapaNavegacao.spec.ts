import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import {
  ATRIBUICAO_MAPA,
  MAPA_FALHOU,
  MAPA_SEM_WEBGL,
  ROTULO_MAPA_FIM,
  ROTULO_MAPA_GIRADO,
  ROTULO_MAPA_INCLINADO,
  ROTULO_MAPA_NORTE,
  SETA_PELA_ROTA,
} from '../src/componentes/navegacao/textosNavegacao'
import { alvosDe44, focoNaoCaiu, semRolagemHorizontal, semViolacoes, umaRegiaoViva } from './apoio'
import { bloquearTerceiros, servirMapaFalso } from './apoioMapa'
import { abrirNavegacao, registrarPedidos } from './apoioNavegacao'

/**
 * Mapa da navegação guiada (spec do mapa, seção 13). O arquivo de tiles vem da fixture escrita
 * em código (src/test/pmtilesFalso.ts) por context.route, que pega também o Web Worker do
 * MapLibre; qualquer outra origem é abortada e registrada. As asserções olham DOM e estado,
 * nunca pixels. O WebGL roda no SwiftShader (software), sem GPU.
 */
test.use({
  viewport: { width: 320, height: 720 },
  launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
})

const SIMULACAO = '/rota/navegar?simular=reto&ritmo=20'
/** Número com cara de coordenada da área (latitude -23/-24, longitude -46) numa URL. */
const COORDENADA = [/-2[34]\.\d{3,}/, /-46\.\d{3,}/]

const regiao = (page: Page) => page.getByRole('status')
/** O mesmo botão: "Mostrar o mapa" fechado, "Esconder o mapa" aberto (ação, sem aria-pressed). */
const mostrar = (page: Page) => page.getByRole('button', { name: /^(Mostrar|Esconder) o mapa$/ })
const girar = (page: Page) => page.getByRole('button', { name: 'Girar o mapa com a rota' })
const inclinar = (page: Page) => page.getByRole('button', { name: 'Vista inclinada' })
const telaCheia = (page: Page) => page.getByRole('button', { name: 'Mapa em tela cheia' })
const sairDaTelaCheia = (page: Page) => page.getByRole('button', { name: 'Sair da tela cheia' })
const conteiner = (page: Page) => page.locator('.nav-tela')
const figura = (page: Page) => page.locator('figure.mapa-nav')
const tela = (page: Page) => page.locator('figure.mapa-nav [role=img]')
/** O contêiner do MapLibre, com os sinais que o motor escreve (data-estilo, data-rumo, data-centro). */
const motor = (page: Page) => page.locator('.mapa-nav__motor')

async function conferir(page: Page, estado: string) {
  await semViolacoes(page, estado)
  await alvosDe44(page, estado)
  await semRolagemHorizontal(page, estado)
  await umaRegiaoViva(page)
  await focoNaoCaiu(page, estado)
}

/** Rota em L calculada em /rota, depois a demonstração (posição simulada) até o passo 1. */
async function comecarSimulacao(page: Page) {
  await abrirNavegacao(page)
  await page.goto(SIMULACAO)
  await expect(page.getByText('Modo demonstração: a posição é simulada, não é a sua.')).toBeVisible()
  await page.getByRole('button', { name: 'Começar' }).click()
  await expect(regiao(page)).toContainText('Passo 1 de 5.')
}

/** Abre pelo botão e espera o motor existir (data-fase="pronto"). */
async function abrirMapa(page: Page) {
  await mostrar(page).click()
  await expect(mostrar(page)).toHaveAccessibleName('Esconder o mapa')
  await expect(figura(page)).toHaveAttribute('data-fase', 'pronto', { timeout: 20_000 })
}

/**
 * O estilo desenhou de verdade (style.load e um idle) e nenhum erro do MapLibre fora de tile
 * aconteceu: sem isto, um estilo quebrado deixaria o mapa em branco com data-fase="pronto".
 */
async function estiloCarregado(page: Page) {
  await expect(motor(page)).toHaveAttribute('data-estilo', 'carregado', { timeout: 20_000 })
  await expect(motor(page)).not.toHaveAttribute('data-erros-mapa', /.*/)
}

/** Erros da página (mensagens de erro e exceções não tratadas), para os casos de tema e movimento. */
function errosDaPagina(page: Page): string[] {
  const erros: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') erros.push(m.text())
  })
  page.on('pageerror', (e) => erros.push(e.message))
  return erros
}

async function prepararRede(context: BrowserContext, status404 = false) {
  const mapa = await servirMapaFalso(context, { status404 })
  const terceiros = await bloquearTerceiros(context)
  return { mapa, terceiros }
}

test.describe('mapa da navegação guiada', () => {
  test('1. começa fechado e nada é pedido a /mapa/', async ({ page, context }) => {
    const { mapa, terceiros } = await prepararRede(context)
    await comecarSimulacao(page)
    await expect(mostrar(page)).toBeVisible()
    await expect(mostrar(page)).toHaveAccessibleName('Mostrar o mapa')
    await expect(mostrar(page)).not.toHaveAttribute('aria-pressed')
    await expect(girar(page)).toHaveCount(0)
    await expect(figura(page)).toHaveCount(0)
    // algumas leituras da simulação passam com o mapa fechado
    await expect(regiao(page)).toContainText('Em 50 metros, vire à direita', { timeout: 15_000 })
    expect(mapa.pedidos).toEqual([])
    // nem o chunk do motor (MapLibre) é baixado
    expect(terceiros.todos.filter((u) => /MotorMapaNavegacao|maplibre/.test(u))).toEqual([])
    expect(terceiros.externos).toEqual([])
  })

  test('2. abrir: canvas dentro do role=img, atribuição fora, verificações sem roubar o foco', async ({ page, context }) => {
    await prepararRede(context)
    await comecarSimulacao(page)
    await mostrar(page).focus()
    await abrirMapa(page)
    // abrir não move o foco
    await expect(mostrar(page)).toBeFocused()
    await expect(tela(page)).toHaveAttribute('aria-label', ROTULO_MAPA_NORTE + ROTULO_MAPA_FIM)
    await expect(tela(page).locator('canvas')).toHaveCount(1)
    // nada focável dentro do mapa
    const focaveis = await tela(page).evaluate(
      (el) => el.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])').length,
    )
    expect(focaveis).toBe(0)
    const atribuicao = figura(page).locator('figcaption')
    await expect(atribuicao).toContainText(ATRIBUICAO_MAPA)
    // abre em outra aba: um toque sem querer não encerra a navegação
    const osm = atribuicao.getByRole('link', { name: 'OpenStreetMap (abre em outra aba)' })
    await expect(osm).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright')
    await expect(osm).toHaveAttribute('target', '_blank')
    expect(await atribuicao.evaluate((el) => el.closest('[role=img]') === null)).toBe(true)
    await expect(figura(page)).toHaveAttribute('data-camera', 'seguir')
    await estiloCarregado(page)
    await conferir(page, 'mapa aberto')
  })

  test('3. girar começa desligado, muda o rótulo, vale na aba e não passa para um contexto novo', async ({ page, context, browser }) => {
    await prepararRede(context)
    await comecarSimulacao(page)
    await abrirMapa(page)
    await expect(girar(page)).toHaveAttribute('aria-pressed', 'false')
    // o estado também escrito à vista, fora do nome (que não muda)
    await expect(girar(page)).toHaveText('Girar o mapa com a rota: desligado')
    await girar(page).click()
    await expect(girar(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(girar(page)).toHaveText('Girar o mapa com a rota: ligado')
    await expect(tela(page)).toHaveAttribute('aria-label', ROTULO_MAPA_GIRADO + ROTULO_MAPA_FIM)

    // recarregar a mesma aba: as duas escolhas continuam; o mapa abre sozinho e o foco fica no h2
    await page.reload()
    await page.getByRole('button', { name: 'Começar' }).click()
    await expect(regiao(page)).toContainText('Passo 1 de 5.')
    await expect(mostrar(page)).toHaveAccessibleName('Esconder o mapa')
    await expect(girar(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(tela(page)).toHaveAttribute('aria-label', ROTULO_MAPA_GIRADO + ROTULO_MAPA_FIM)
    await expect(figura(page)).toHaveAttribute('data-fase', 'pronto', { timeout: 20_000 })
    await expect(page.getByRole('heading', { level: 2 })).toBeFocused()

    // um contexto novo (outra "aba" sem a sessão): fechado e sem girar
    const outro = await browser.newContext({ baseURL: 'http://localhost:4173', viewport: { width: 320, height: 720 } })
    try {
      await prepararRede(outro)
      const nova = await outro.newPage()
      await comecarSimulacao(nova)
      await expect(mostrar(nova)).toHaveAccessibleName('Mostrar o mapa')
      await expect(figura(nova)).toHaveCount(0)
      await mostrar(nova).click()
      await expect(girar(nova)).toHaveAttribute('aria-pressed', 'false')
      await expect(tela(nova)).toHaveAttribute('aria-label', ROTULO_MAPA_NORTE + ROTULO_MAPA_FIM)
    } finally {
      await outro.close()
    }
  })

  test('4 e 5. até a chegada, girando: só /mapa/ do próprio site, com Range, sem coordenada; na chegada o mapa some', async ({
    page,
    context,
  }) => {
    const { mapa, terceiros } = await prepararRede(context)
    const pedidos = registrarPedidos(page)
    await comecarSimulacao(page)
    const antes = pedidos.length
    // daqui em diante: a navegação em andamento (a URL da própria página de demonstração fica antes)
    const inicio = terceiros.todos.length
    await abrirMapa(page)
    await estiloCarregado(page)
    // a câmera segue a pessoa: o centro real do mapa (data-centro, só no build de E2E) muda
    const centro = await motor(page).getAttribute('data-centro')
    await expect.poll(() => motor(page).getAttribute('data-centro'), { timeout: 15_000 }).not.toBe(centro)
    await girar(page).click()
    await expect(girar(page)).toHaveAttribute('aria-pressed', 'true')
    // a rota gira o mapa de verdade (o rumo que o MapLibre tem, não o da cena)
    await expect(motor(page)).not.toHaveAttribute('data-rumo', '0', { timeout: 15_000 })
    await expect(page.locator('.mapa-nav__norte')).toBeVisible()
    // desligar volta o mapa ao norte, e ligar de novo gira outra vez
    await girar(page).click()
    await expect(motor(page)).toHaveAttribute('data-rumo', '0')
    await expect(page.locator('.mapa-nav__norte')).toBeHidden()
    await girar(page).click()
    await expect(motor(page)).not.toHaveAttribute('data-rumo', '0', { timeout: 15_000 })

    const chegada = page.getByRole('heading', { level: 2, name: 'Você chegou ao destino' })
    await expect(chegada).toBeFocused({ timeout: 45_000 })

    // 5. na chegada o mapa some e o foco fica no h2
    await expect(figura(page)).toHaveCount(0)
    await expect(mostrar(page)).toHaveCount(0)
    await expect(chegada).toBeFocused()

    // 4. privacidade de rede
    expect(terceiros.externos).toEqual([])
    expect(pedidos.slice(antes).map((r) => r.url())).toEqual([])
    const doArquivo = mapa.pedidos.filter((p) => p.caminho.startsWith('/mapa/rota-falada-sp-'))
    expect(doArquivo.length).toBeGreaterThanOrEqual(1)
    expect(doArquivo.filter((p) => p.range !== null).length).toBeGreaterThanOrEqual(1)
    expect(mapa.pedidos.map((p) => p.caminho)).toEqual(mapa.pedidos.map(() => '/mapa/rota-falada-sp-20261109.pmtiles'))
    const urls = terceiros.todos.slice(inicio)
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.filter((u) => new URL(u).search !== '')).toEqual([])
    const comCoordenada = urls.filter((u) => {
      const texto = `${u} ${decodeURIComponent(u)}`
      return COORDENADA.some((re) => re.test(texto))
    })
    expect(comCoordenada).toEqual([])
  })

  test('6. passo a passo: o mapa continua, enquadrando o passo', async ({ page, context }) => {
    await prepararRede(context)
    await abrirNavegacao(page)
    await page.getByRole('button', { name: 'Seguir passo a passo, sem localização' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Passo 1 de 5' })).toBeFocused()
    await abrirMapa(page)
    await expect(figura(page)).toHaveAttribute('data-camera', 'enquadrar')
    await page.getByRole('button', { name: 'Próximo passo' }).click()
    await expect(regiao(page)).toContainText('Passo 2 de 5.')
    await expect(figura(page)).toBeVisible()
    await expect(figura(page)).toHaveAttribute('data-camera', 'enquadrar')
    await conferir(page, 'passo a passo com mapa')
  })

  test('7. sem WebGL: texto próprio, sem "Tentar de novo", e a navegação segue', async ({ page, context }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      // @ts-expect-error -- sobrecargas do getContext: aqui só importa devolver null ao WebGL
      HTMLCanvasElement.prototype.getContext = function (tipo: string, ...resto: unknown[]) {
        if (tipo === 'webgl' || tipo === 'webgl2' || tipo === 'experimental-webgl') return null
        return (original as (...a: unknown[]) => unknown).call(this, tipo, ...resto)
      }
    })
    const { mapa } = await prepararRede(context)
    await comecarSimulacao(page)
    await mostrar(page).click()
    await expect(figura(page)).toHaveAttribute('data-fase', 'sem_webgl')
    await expect(figura(page).getByText(MAPA_SEM_WEBGL)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toHaveCount(0)
    await expect(girar(page)).toHaveCount(0)
    await expect(figura(page).locator('[role=img]')).toHaveCount(0)
    // o painel e a voz seguem
    await expect(regiao(page)).toContainText('Em 50 metros, vire à direita', { timeout: 15_000 })
    expect(mapa.pedidos).toEqual([])
    await umaRegiaoViva(page)
  })

  test('10. aberto, o mapa fica abaixo dos controles: Recalcular e Pausar vêm antes dele na tela e no Tab', async ({
    page,
    context,
  }) => {
    await prepararRede(context)
    await comecarSimulacao(page)
    await abrirMapa(page)
    await estiloCarregado(page)
    const fundo = async (nome: string) => {
      const caixa = (await page.getByRole('button', { name: nome }).boundingBox())!
      return caixa.y + caixa.height
    }
    // o mapa vem inteiro depois dos controles: aberto, não se põe entre o painel e eles
    const topoDoMapa = (await page.locator('.mapa-nav__bloco').boundingBox())!.y
    expect(await fundo('Pausar')).toBeLessThanOrEqual(topoDoMapa)
    expect(await fundo('Recalcular')).toBeLessThanOrEqual(topoDoMapa)
    // na ordem do documento (leitura e Tab), os controles vêm antes do botão do mapa (aberto, "Esconder o mapa")
    const ordem = await page.evaluate(() => {
      const botoes = [...document.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '')
      return {
        pausar: botoes.indexOf('Pausar'),
        recalcular: botoes.indexOf('Recalcular'),
        mapa: botoes.findIndex((t) => /^(Mostrar|Esconder) o mapa$/.test(t)),
      }
    })
    expect(Math.min(ordem.recalcular, ordem.pausar, ordem.mapa)).toBeGreaterThanOrEqual(0)
    expect(ordem.recalcular).toBeLessThan(ordem.mapa)
    expect(ordem.pausar).toBeLessThan(ordem.mapa)
  })

  test('8. arquivo 404: "O mapa não carregou" com "Tentar de novo", sem violações', async ({ page, context }) => {
    const { mapa } = await prepararRede(context, true)
    await comecarSimulacao(page)
    await mostrar(page).click()
    await expect(figura(page)).toHaveAttribute('data-fase', 'falhou', { timeout: 20_000 })
    await expect(figura(page).getByText(MAPA_FALHOU)).toBeVisible()
    const tentar = page.getByRole('button', { name: 'Tentar de novo' })
    await expect(tentar).toBeVisible()
    expect(mapa.pedidos.length).toBeGreaterThanOrEqual(1)
    await conferir(page, 'mapa 404')
    // nova tentativa: o foco vai ao "Mostrar o mapa" e o arquivo continua faltando
    await tentar.click()
    await expect(mostrar(page)).toBeFocused()
    await expect(figura(page)).toHaveAttribute('data-fase', 'falhou', { timeout: 20_000 })
  })
})

/* ---------- emenda de 10/11/2026 da spec do mapa (seção 19) ---------- */

test.describe('vista inclinada com prédios', () => {
  test('11. começa desligada; ligar inclina o mapa de verdade (45°), mostra os prédios, muda o rótulo e vale na aba', async ({ page, context }) => {
    const erros = errosDaPagina(page)
    await prepararRede(context)
    await comecarSimulacao(page)
    await expect(inclinar(page)).toHaveCount(0) // mapa fechado: a opção nem existe
    await abrirMapa(page)
    await estiloCarregado(page)
    await expect(inclinar(page)).toHaveAttribute('aria-pressed', 'false')
    await expect(inclinar(page)).toHaveText('Vista inclinada: desligado')
    await expect(motor(page)).toHaveAttribute('data-inclinacao', '0')
    await expect(motor(page)).toHaveAttribute('data-predios', 'nao')

    await inclinar(page).click()
    await expect(inclinar(page)).toBeFocused()
    await expect(inclinar(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(inclinar(page)).toHaveText('Vista inclinada: ligado')
    await expect(motor(page)).toHaveAttribute('data-inclinacao', '45', { timeout: 15_000 })
    await expect(motor(page)).toHaveAttribute('data-predios', 'sim')
    await expect(tela(page)).toHaveAttribute('aria-label', ROTULO_MAPA_NORTE + ROTULO_MAPA_INCLINADO + ROTULO_MAPA_FIM)
    // o estilo com a camada de volume desenha sem nenhum erro do MapLibre
    await estiloCarregado(page)
    await conferir(page, 'vista inclinada')

    // junto com o giro
    await girar(page).click()
    await expect(motor(page)).not.toHaveAttribute('data-rumo', '0', { timeout: 15_000 })
    await expect(motor(page)).toHaveAttribute('data-inclinacao', '45')
    await estiloCarregado(page)

    // recarregar a mesma aba: a escolha continua
    await page.reload()
    await page.getByRole('button', { name: 'Começar' }).click()
    await expect(inclinar(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(motor(page)).toHaveAttribute('data-inclinacao', '45', { timeout: 20_000 })

    // desligar volta a ver de cima e esconde os prédios
    await inclinar(page).click()
    await expect(motor(page)).toHaveAttribute('data-inclinacao', '0', { timeout: 15_000 })
    await expect(motor(page)).toHaveAttribute('data-predios', 'nao')
    expect(erros).toEqual([])
  })

  test('12. no passo a passo o mapa fica de cima, mesmo com a vista inclinada ligada', async ({ page, context }) => {
    await prepararRede(context)
    await abrirNavegacao(page)
    await page.getByRole('button', { name: 'Seguir passo a passo, sem localização' }).click()
    await abrirMapa(page)
    await inclinar(page).click()
    await expect(inclinar(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(figura(page)).toHaveAttribute('data-camera', 'enquadrar')
    await expect(motor(page)).toHaveAttribute('data-inclinacao', '0')
    await estiloCarregado(page)
  })
})

test.describe('vista inclinada no alto contraste do Windows', () => {
  test('13. inclina, mas sem nenhum prédio em volume; a tela cheia mantém alvos e uma região viva', async ({ page, context }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    const erros = errosDaPagina(page)
    await prepararRede(context)
    await comecarSimulacao(page)
    await abrirMapa(page)
    await inclinar(page).click()
    await expect(motor(page)).toHaveAttribute('data-inclinacao', '45', { timeout: 15_000 })
    await expect(motor(page)).toHaveAttribute('data-predios', 'nao')
    await estiloCarregado(page)
    await telaCheia(page).click()
    await expect(sairDaTelaCheia(page)).toBeFocused()
    await alvosDe44(page, 'tela cheia no alto contraste')
    await semRolagemHorizontal(page, 'tela cheia no alto contraste')
    await umaRegiaoViva(page)
    expect(erros).toEqual([])
  })
})

test.describe('vista inclinada com movimento reduzido', () => {
  test.use({ reducedMotion: 'reduce' })

  test('14. a troca é um salto: inclina e volta sem erro', async ({ page, context }) => {
    const erros = errosDaPagina(page)
    await prepararRede(context)
    await comecarSimulacao(page)
    await abrirMapa(page)
    await inclinar(page).click()
    await expect(motor(page)).toHaveAttribute('data-inclinacao', '45', { timeout: 15_000 })
    await estiloCarregado(page)
    await inclinar(page).click()
    await expect(motor(page)).toHaveAttribute('data-inclinacao', '0', { timeout: 15_000 })
    expect(erros).toEqual([])
  })
})

test.describe('mapa em tela cheia', () => {
  /** Nada do cartão nem da faixa de baixo é cortado: o que não cabe rola, por dentro ou na tela inteira. */
  async function nadaCortado(page: Page, contexto: string) {
    const problemas = await page.evaluate(() => {
      const cheia = document.querySelector<HTMLElement>('.nav-tela--cheia')
      if (!cheia) return ['sem tela cheia']
      const achados: string[] = []
      const rola = (el: HTMLElement) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)
      // o contêiner rola quando o conteúdo não cabe; a faixa de baixo rola por dentro ou cresce inteira
      if (!rola(cheia)) achados.push('o contêiner não rola')
      const base = cheia.querySelector<HTMLElement>(':scope > .nav-tela__base')!
      if (!rola(base) && base.scrollHeight > base.clientHeight + 1) achados.push('a faixa de baixo corta o próprio conteúdo')
      // nenhum texto do cartão é cortado por uma caixa de altura fixa ou com overflow escondido
      const painel = cheia.querySelector<HTMLElement>(':scope > .painel')!
      if (painel.scrollHeight > painel.clientHeight + 1) achados.push('o cartão corta o próprio conteúdo')
      for (const el of cheia.querySelectorAll<HTMLElement>('.painel *, .nav-tela__base p, .nav-tela__base button')) {
        const css = getComputedStyle(el)
        if (css.overflow === 'hidden' || css.textOverflow === 'ellipsis' || css.whiteSpace === 'nowrap') {
          if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) achados.push('cortado: ' + el.className)
        }
        if (el.scrollWidth > cheia.clientWidth + 1) achados.push('mais largo que a tela: ' + el.className)
      }
      if (cheia.scrollWidth > cheia.clientWidth + 1) achados.push('rolagem horizontal na tela cheia')
      return achados
    })
    expect(problemas, contexto).toEqual([])
  }

  test('15. liga, ocupa a tela com o cartão em cima, o mapa no meio e os controles embaixo; sai pelo botão e pelo Esc', async ({ page, context }) => {
    const erros = errosDaPagina(page)
    await prepararRede(context)
    await comecarSimulacao(page)
    await abrirMapa(page)
    await estiloCarregado(page)
    await expect(telaCheia(page)).toHaveAttribute('aria-pressed', 'false')
    await expect(telaCheia(page)).toHaveText('Mapa em tela cheia: desligado')
    await expect(sairDaTelaCheia(page)).toHaveCount(0)

    await telaCheia(page).click()
    // o foco vai para a saída, que fica sempre à vista
    await expect(sairDaTelaCheia(page)).toBeFocused()
    await expect(sairDaTelaCheia(page)).toBeInViewport()
    await expect(telaCheia(page)).toHaveAttribute('aria-pressed', 'true')
    expect(await conteiner(page).boundingBox()).toEqual({ x: 0, y: 0, width: 320, height: 720 })

    // três faixas, de cima para baixo: cartão, mapa, controles
    const caixa = async (seletor: string) => (await page.locator(seletor).first().boundingBox())!
    const cartao = await caixa('.nav-tela--cheia > .painel')
    const mapa = await caixa('.nav-tela--cheia .mapa-nav__tela')
    const base = await caixa('.nav-tela--cheia > .nav-tela__base')
    expect(cartao.y).toBe(0)
    expect(cartao.y + cartao.height).toBeLessThanOrEqual(mapa.y + 1)
    expect(mapa.y + mapa.height).toBeLessThanOrEqual(base.y + 1)
    expect(base.y + base.height).toBeLessThanOrEqual(720 + 1)
    expect(mapa.height).toBeGreaterThanOrEqual(128)
    // o cartão não cobre o mapa, e o mapa continua desenhando do tamanho novo
    await expect(tela(page).locator('canvas')).toBeVisible()
    await estiloCarregado(page)
    await expect(page.getByRole('heading', { level: 2, name: /^Passo \d de 5$/ })).toBeInViewport()
    await expect(page.locator('.navegar__falta')).toContainText(/até o destino\. Passo \d de 5\./)

    // o resto da página fica inerte e a página de trás não rola; a região viva continua anunciando
    expect(await page.evaluate(() => document.querySelector('header')?.hasAttribute('inert'))).toBe(true)
    expect(await page.evaluate(() => document.querySelector('[role=status]')?.closest('[inert]') === null)).toBe(true)
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe('hidden')
    await expect(regiao(page)).toContainText('Em 50 metros, vire à direita', { timeout: 15_000 })

    // tudo continua alcançável pelo teclado, e o que recebe o foco fica à vista, não atrás do botão de sair
    for (const nome of ['Repetir', 'Recalcular', 'Pausar', 'Encerrar', 'Esconder o mapa', 'Girar o mapa com a rota', 'Vista inclinada', 'Mapa em tela cheia']) {
      const botao = page.getByRole('button', { name: nome, exact: true })
      await botao.focus()
      await expect(botao).toBeFocused()
      await expect(botao).toBeInViewport()
      const sair = (await sairDaTelaCheia(page).boundingBox())!
      const alvo = (await botao.boundingBox())!
      expect(alvo.y, nome + ' atrás do botão de sair').toBeGreaterThanOrEqual(sair.y + sair.height - 1)
    }
    // a ordem do Tab é a do documento: sair, controles, opções do mapa
    const ordem = await page.evaluate(() => [...document.querySelectorAll('.nav-tela--cheia button')].map((b) => b.textContent?.trim() ?? ''))
    expect(ordem[0]).toBe('Sair da tela cheia')
    expect(ordem.indexOf('Repetir')).toBeLessThan(ordem.indexOf('Encerrar'))
    expect(ordem.indexOf('Encerrar')).toBeLessThan(ordem.indexOf('Esconder o mapa'))
    await nadaCortado(page, 'tela cheia a 320 px')
    await conferir(page, 'tela cheia')

    // Esc sai e o foco fica na alternância
    await page.keyboard.press('Escape')
    await expect(conteiner(page)).not.toHaveClass(/nav-tela--cheia/)
    await expect(telaCheia(page)).toBeFocused()
    await expect(telaCheia(page)).toHaveAttribute('aria-pressed', 'false')
    expect(await page.locator('[inert]').count()).toBe(0)
    await expect(figura(page)).toHaveAttribute('data-fase', 'pronto')

    // de novo, agora saindo pelo botão
    await telaCheia(page).click()
    await sairDaTelaCheia(page).click()
    await expect(telaCheia(page)).toBeFocused()
    await expect(conteiner(page)).not.toHaveClass(/nav-tela--cheia/)
    await conferir(page, 'depois da tela cheia')
    expect(erros).toEqual([])
  })

  test('16. texto ampliado a 200% e tela baixa: o cartão cresce, o mapa encolhe e nada é cortado', async ({ page, context }) => {
    await prepararRede(context)
    await comecarSimulacao(page)
    await abrirMapa(page)
    await telaCheia(page).click()
    await expect(sairDaTelaCheia(page)).toBeFocused()
    // 320 x 360 px: o mesmo que 640 x 720 com 200% de zoom do navegador (reflow, WCAG 1.4.10)
    await page.setViewportSize({ width: 320, height: 360 })
    await nadaCortado(page, 'tela cheia a 320 x 360')
    await semRolagemHorizontal(page, 'tela cheia a 320 x 360')
    // e com o texto a 200% (WCAG 1.4.4), por cima disso
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%'
    })
    await nadaCortado(page, 'tela cheia com texto a 200%')
    // o mapa não some: encolhe até o mínimo
    const mapa = (await page.locator('.nav-tela--cheia .mapa-nav__tela').boundingBox())!
    expect(mapa.height).toBeGreaterThanOrEqual(128)
    // o título do cartão, o que falta e a saída continuam alcançáveis rolando
    for (const alvo of [page.getByRole('heading', { level: 2 }), page.locator('.navegar__falta'), sairDaTelaCheia(page), page.getByRole('button', { name: 'Encerrar' })]) {
      await alvo.scrollIntoViewIfNeeded()
      await expect(alvo).toBeInViewport()
    }
    await alvosDe44(page, 'tela cheia com texto a 200%')
    await page.keyboard.press('Escape')
    await expect(conteiner(page)).not.toHaveClass(/nav-tela--cheia/)
  })

  test('17. a preferência vale na aba, e na chegada a página volta ao normal', async ({ page, context }) => {
    await prepararRede(context)
    await comecarSimulacao(page)
    await abrirMapa(page)
    await telaCheia(page).click()
    await page.reload()
    await page.getByRole('button', { name: 'Começar' }).click()
    await expect(conteiner(page)).toHaveClass(/nav-tela--cheia/)
    await expect(page.getByRole('heading', { level: 2 })).toBeFocused()
    const chegada = page.getByRole('heading', { level: 2, name: 'Você chegou ao destino' })
    await expect(chegada).toBeFocused({ timeout: 45_000 })
    await expect(conteiner(page)).not.toHaveClass(/nav-tela--cheia/)
    expect(await page.locator('[inert]').count()).toBe(0)
    await conferir(page, 'chegada depois da tela cheia')
  })
})

test.describe('seta da pessoa', () => {
  test('18. sem bússola (computador) e sem rumo do GPS, a dica diz que a seta segue o sentido da rota', async ({ page, context }) => {
    const erros = errosDaPagina(page)
    await prepararRede(context)
    await comecarSimulacao(page)
    await abrirMapa(page)
    await estiloCarregado(page)
    const dica = page.locator('.mapa-nav__seta')
    await expect(dica).toHaveAttribute('data-fonte-seta', 'rota', { timeout: 15_000 })
    await expect(dica).toHaveText(SETA_PELA_ROTA)
    await expect(dica).toBeVisible()
    // texto parado: fora de qualquer região viva
    expect(await dica.evaluate((el) => el.closest('[aria-live], [role=status]') === null)).toBe(true)
    // a direção nunca vai para o DOM do mapa: só os sinais sem posição (e o centro, só no build de E2E)
    const atributos = await motor(page).evaluate((el) => Object.keys((el as HTMLElement).dataset).sort())
    expect(atributos).toEqual(['centro', 'estilo', 'inclinacao', 'predios', 'rumo'])
    await estiloCarregado(page)
    expect(erros).toEqual([])
  })
})

test.describe('mapa da navegação no tema escuro', () => {
  test.use({ colorScheme: 'dark' })

  test('9a. abre e gira sem erro', async ({ page, context }) => {
    const erros = errosDaPagina(page)
    await prepararRede(context)
    await comecarSimulacao(page)
    await abrirMapa(page)
    await girar(page).click()
    await expect(regiao(page)).toContainText('Em 50 metros, vire à direita', { timeout: 15_000 })
    await expect(figura(page)).toBeVisible()
    await expect(figura(page)).toHaveAttribute('data-fase', 'pronto')
    await estiloCarregado(page)
    await conferir(page, 'mapa no escuro')
    expect(erros).toEqual([])
  })
})

test.describe('mapa da navegação no alto contraste do Windows', () => {
  test('9b. abre e gira sem erro (sem axe: ele mede as cores do autor)', async ({ page, context }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    const erros = errosDaPagina(page)
    await prepararRede(context)
    await comecarSimulacao(page)
    await abrirMapa(page)
    await girar(page).click()
    await expect(regiao(page)).toContainText('Em 50 metros, vire à direita', { timeout: 15_000 })
    await expect(figura(page)).toBeVisible()
    await expect(figura(page)).toHaveAttribute('data-fase', 'pronto')
    await estiloCarregado(page)
    await alvosDe44(page, 'mapa no alto contraste')
    await semRolagemHorizontal(page, 'mapa no alto contraste')
    await umaRegiaoViva(page)
    expect(erros).toEqual([])
  })
})

test.describe('mapa da navegação com movimento reduzido', () => {
  test.use({ reducedMotion: 'reduce' })

  test('9c. abre e gira sem erro, sem transição na agulha', async ({ page, context }) => {
    const erros = errosDaPagina(page)
    await prepararRede(context)
    await comecarSimulacao(page)
    await abrirMapa(page)
    await girar(page).click()
    await expect(page.locator('.mapa-nav__norte')).toBeVisible()
    const transicao = await page.locator('.mapa-nav__agulha').evaluate((el) => getComputedStyle(el).transitionDuration)
    expect(transicao.split(',').every((t) => parseFloat(t) === 0)).toBe(true)
    await expect(regiao(page)).toContainText('Em 50 metros, vire à direita', { timeout: 15_000 })
    await expect(figura(page)).toBeVisible()
    await expect(figura(page)).toHaveAttribute('data-fase', 'pronto')
    await estiloCarregado(page)
    // o mapa gira mesmo sem animação (o giro vai no próprio jumpTo)
    await expect(motor(page)).not.toHaveAttribute('data-rumo', '0', { timeout: 15_000 })
    expect(erros).toEqual([])
  })
})

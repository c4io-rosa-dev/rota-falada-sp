import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import {
  ATRIBUICAO_MAPA,
  MAPA_FALHOU,
  MAPA_SEM_WEBGL,
  ROTULO_MAPA_FIM,
  ROTULO_MAPA_GIRADO,
  ROTULO_MAPA_NORTE,
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
const mostrar = (page: Page) => page.getByRole('button', { name: 'Mostrar o mapa' })
const girar = (page: Page) => page.getByRole('button', { name: 'Girar o mapa com a rota' })
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
  await expect(mostrar(page)).toHaveAttribute('aria-pressed', 'true')
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
    await expect(mostrar(page)).toHaveAttribute('aria-pressed', 'false')
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
    await girar(page).click()
    await expect(girar(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(tela(page)).toHaveAttribute('aria-label', ROTULO_MAPA_GIRADO + ROTULO_MAPA_FIM)

    // recarregar a mesma aba: as duas escolhas continuam; o mapa abre sozinho e o foco fica no h2
    await page.reload()
    await page.getByRole('button', { name: 'Começar' }).click()
    await expect(regiao(page)).toContainText('Passo 1 de 5.')
    await expect(mostrar(page)).toHaveAttribute('aria-pressed', 'true')
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
      await expect(mostrar(nova)).toHaveAttribute('aria-pressed', 'false')
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
    // na ordem do documento (leitura e Tab), os controles vêm antes de "Mostrar o mapa"
    const ordem = await page.evaluate(() => {
      const botoes = [...document.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '')
      return { pausar: botoes.indexOf('Pausar'), recalcular: botoes.indexOf('Recalcular'), mapa: botoes.indexOf('Mostrar o mapa') }
    })
    expect(Math.min(ordem.recalcular, ordem.pausar)).toBeGreaterThanOrEqual(0)
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

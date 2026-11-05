import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, type Route } from '@playwright/test'

export const API = 'http://localhost:8000'

export const A = { id: 1, tipo: 'endereco', rotulo: 'Rua Helen Keller, 100 · Vila Mariana', lat: -23.59, lon: -46.635, aproximado: false }
export const B = { id: 2, tipo: 'endereco', rotulo: 'Rua Ouvidor Peleja, 200 · Vila Mariana', lat: -23.595, lon: -46.64, aproximado: false }

const LINHA = {
  type: 'LineString',
  coordinates: [
    [-46.635, -23.59],
    [-46.637, -23.592],
    [-46.64, -23.595],
  ],
}

export const ROTA = {
  passos: [1, 2, 3].map((ordem) => ({
    ordem,
    instrucao: `Vire à direita em direção a Rua ${ordem}`,
    distancia_m: 100,
    duracao_s: 120,
    direcao: 'siga',
    largura_m: ordem === 2 ? null : 1.67,
    largura_medida: ordem !== 2,
    declividade_pct: 3,
    declividade_medida: true,
    guia: ordem === 3 ? 'nao_transponivel' : 'transponivel',
    is_degrau: false,
    barreiras_proximas: [],
    fonte: 'osm',
    data_referencia: '2026-10-12',
    geometria: LINHA,
  })),
  distancia_m: 300,
  duracao_s: 360,
  avisos: [{ tipo: 'trecho_sem_dados', mensagem: 'Um ou mais trechos da rota não têm calçada conflada do GeoSampa.' }],
  nivel_exigencia_atendido: 6,
  motor: 'ors',
  fontes: ['osm', 'geosampa'],
  geometria: LINHA,
  cache: false,
}

export const BARREIRA = {
  id: 5,
  categoria: 'escada',
  severidade: 'intransponivel',
  status: 'pendente',
  votos: { confirma: 1, contesta: 0, resolvida: 0 },
  descricao: 'Três degraus na entrada',
  lat: -23.59,
  lon: -46.635,
  criada_em: '2026-11-03T12:00:00+00:00',
  ultima_confirmacao_em: null,
  foto_url: null,
  foto_descricao: null,
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }

function json(route: Route, corpo: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(corpo) })
}

type Rotas = Record<string, (route: Route) => unknown>

/** API simulada. Tile não sai para a rede: a política do OSM proíbe bots navegando. */
export async function simular(page: Page, extras: Rotas = {}) {
  const tabela: Rotas = {
    'GET /health': (r) => json(r, { status: 'ok', banco: 'ok' }),
    'GET /api/geocode': (r) => json(r, [A, B]),
    'GET /api/geocode/reverso': (r) => json(r, A),
    'POST /api/rotas': (r) => json(r, ROTA),
    'GET /api/fontes': (r) => json(r, []),
    'GET /api/barreiras': (r) => json(r, [BARREIRA]),
    'GET /api/barreiras/5': (r) => json(r, BARREIRA),
    ...extras,
  }
  await page.route(`${API}/**`, (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: CORS })
    const chave = `${req.method()} ${new URL(req.url()).pathname}`
    const f = tabela[chave]
    if (!f) throw new Error(`rota não prevista: ${chave}`)
    return f(route)
  })
  // PNG de 1x1: basta para o Leaflet carregar sem sair para a rede
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: png }))
}

export { json }

/** Zero críticas e sérias, conforme PRODUCT.md. */
export async function semViolacoes(page: Page, contexto: string) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  const graves = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')
  expect(graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), contexto).toEqual([])
}

export async function semRolagemHorizontal(page: Page, contexto: string) {
  const excede = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(excede, `${contexto}: rolagem horizontal`).toBeLessThanOrEqual(0)
}

/** Interativos com pelo menos 44 px. Só link com texto em volta é exceção do WCAG 2.5.8; o resto conta. */
export async function alvosDe44(page: Page, contexto: string) {
  const pequenos = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, a, input:not([type=radio]):not([type=checkbox]):not([type=file]), .opcao')]
      .filter((el) => {
        if (el.matches('.skip-link')) return false
        if (el.matches('a:not(.alvo):not(.placa)')) {
          const emVolta = [...(el.parentElement?.childNodes ?? [])].filter((n) => n !== el).map((n) => n.textContent ?? '').join('').trim()
          if (emVolta) return false
        }
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.height < 43.5
      })
      .map((el) => `${el.tagName} "${el.textContent?.trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().height)}px`),
  )
  expect(pequenos, `${contexto}: alvos menores que 44 px`).toEqual([])
}

/** O elemento focado saiu da tela sem levar o foco a lugar nenhum (WCAG 2.4.3). */
export async function focoNaoCaiu(page: Page, contexto: string) {
  const noBody = await page.evaluate(() => document.activeElement === null || document.activeElement === document.body)
  expect(noBody, `${contexto}: o foco caiu no body`).toBe(false)
}

export async function umaRegiaoViva(page: Page) {
  await expect(page.locator('[aria-live],[role=status],[role=alert]')).toHaveCount(1)
}

/** Fluxo só por teclado até a rota aparecer. */
export async function escolherPorTeclado(page: Page) {
  await page.getByRole('combobox', { name: 'Origem' }).focus()
  await page.keyboard.type('rua')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('option').first()).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('combobox', { name: 'Origem' })).toHaveValue(A.rotulo)
  await page.getByRole('combobox', { name: 'Destino' }).focus()
  await page.keyboard.type('rua')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('option').first()).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('combobox', { name: 'Destino' })).toHaveValue(B.rotulo)
}

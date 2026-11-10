import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { escolherPorTeclado, json, simular } from './apoio'
import { bloquearTerceiros, servirMapaFalso } from './apoioMapa'
import { abrirNavegacao, PONTOS, posicao, ROTA_NAVEGAVEL } from './apoioNavegacao'

/**
 * O `vite preview` não lê public/_headers. Aqui a política de verdade é aplicada ao documento,
 * trocando só os hosts de produção pelos simulados, para ver se Leaflet e o resto convivem com ela.
 */
// WebGL em software (SwiftShader) para o mapa da navegação chegar a "pronto". Fica no topo porque
// launchOptions pede um navegador próprio; para os outros casos daqui não muda nada.
test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } })

function politica(): string {
  const linha = readFileSync('public/_headers', 'utf-8')
    .split('\n')
    .find((l) => l.includes('Content-Security-Policy'))!
  return linha
    .replace('Content-Security-Policy:', '')
    .trim()
    .replace('https://rota-falada-api.onrender.com', 'http://localhost:8000')
    .replaceAll('https://fiyuppcpbcdlnptqaigg.supabase.co', 'https://teste.supabase.co')
}

test('a CSP não bloqueia /rota nem o mapa', async ({ page }) => {
  const bloqueios: string[] = []
  page.on('console', (m) => {
    if (m.text().includes('Content Security Policy')) bloqueios.push(m.text())
  })
  await simular(page)
  await page.route('http://localhost:4173/rota', async (route) => {
    const resposta = await route.fetch()
    await route.fulfill({ response: resposta, headers: { ...resposta.headers(), 'content-security-policy': politica() } })
  })
  await page.goto('/rota')
  await escolherPorTeclado(page)
  await page.getByRole('button', { name: 'Calcular rota' }).click()
  await page.getByRole('button', { name: 'Mostrar mapa' }).click()
  await expect(page.getByRole('img', { name: /Mapa ilustrativo/ })).toBeVisible()
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeAttached()
  expect(bloqueios).toEqual([])
})

test('a CSP não bloqueia /rota/navegar, nem a simulação carregada sob demanda', async ({ page, context }) => {
  const bloqueios: string[] = []
  page.on('console', (m) => {
    if (m.text().includes('Content Security Policy')) bloqueios.push(m.text())
  })
  await simular(page, { 'POST /api/rotas': (r) => json(r, ROTA_NAVEGAVEL) })
  await page.route(/http:\/\/localhost:4173\/rota(\/navegar)?(\?.*)?$/, async (route) => {
    const resposta = await route.fetch()
    await route.fulfill({ response: resposta, headers: { ...resposta.headers(), 'content-security-policy': politica() } })
  })
  await context.grantPermissions(['geolocation'])
  await posicao(context, PONTOS.A)
  await page.goto('/rota')
  await escolherPorTeclado(page)
  await page.getByRole('button', { name: 'Calcular rota' }).click()
  // a rota vai para a sessão só quando o resultado chega
  await expect(page.getByRole('heading', { level: 2, name: /Rota encontrada/ })).toBeVisible()
  await page.goto('/rota/navegar')
  await page.getByRole('button', { name: 'Começar' }).click()
  await expect(page.getByRole('status')).toContainText('Passo 1 de 5.')
  await page.goto('/rota/navegar?simular=reto&ritmo=20')
  await expect(page.getByText('Modo demonstração: a posição é simulada, não é a sua.')).toBeVisible()
  await page.getByRole('button', { name: 'Começar' }).click()
  await expect(page.getByRole('status')).toContainText('Modo demonstração')
  expect(bloqueios).toEqual([])
})

test.describe('mapa da navegação sob a CSP real', () => {
  test('MapLibre, o worker dele, o PMTiles e a letra passam sem violação', async ({ page, context }) => {
    const bloqueios: string[] = []
    page.on('console', (m) => {
      if (m.text().includes('Content Security Policy')) bloqueios.push(m.text())
    })
    // o evento chega mesmo quando o console não diz nada (e vale para o documento todo)
    await page.addInitScript(() => {
      const w = window as unknown as { __violacoes: string[] }
      w.__violacoes = []
      document.addEventListener('securitypolicyviolation', (e) => w.__violacoes.push(`${e.violatedDirective} ${e.blockedURI}`))
    })
    await servirMapaFalso(context)
    const terceiros = await bloquearTerceiros(context)
    // como o _headers (/*) em produção: os scripts também recebem a CSP, inclusive o do Web Worker do
    // MapLibre (um worker roda sob a CSP da própria resposta). context.route pega o pedido do worker.
    await context.route(/http:\/\/localhost:4173\/assets\/[^?]+\.m?js$/, async (route) => {
      const resposta = await route.fetch()
      await route.fulfill({ response: resposta, headers: { ...resposta.headers(), 'content-security-policy': politica() } })
    })
    const pedidosDeLetra: string[] = []
    context.on('request', (r) => {
      if (r.resourceType() === 'fetch' && /\/assets\/archivo-latin-wght-normal-[^/]+\.woff2$/.test(r.url())) pedidosDeLetra.push(r.url())
    })
    await page.route(/http:\/\/localhost:4173\/rota\/navegar(\?.*)?$/, async (route) => {
      const resposta = await route.fetch()
      await route.fulfill({ response: resposta, headers: { ...resposta.headers(), 'content-security-policy': politica() } })
    })
    await abrirNavegacao(page)
    await page.goto('/rota/navegar?simular=reto&ritmo=20')
    await page.getByRole('button', { name: 'Começar' }).click()
    await expect(page.getByRole('status')).toContainText('Passo 1 de 5.')
    await page.getByRole('button', { name: 'Mostrar o mapa' }).click()
    await expect(page.locator('figure.mapa-nav')).toHaveAttribute('data-fase', 'pronto', { timeout: 20_000 })
    await page.getByRole('button', { name: 'Girar o mapa com a rota' }).click()
    // algumas leituras com o mapa desenhando (tiles, worker, fontes)
    await expect(page.getByRole('status')).toContainText('Em 50 metros, vire à direita', { timeout: 15_000 })
    await expect(page.locator('figure.mapa-nav')).toHaveAttribute('data-fase', 'pronto')
    // o estilo desenhou de verdade (não só o cabeçalho do arquivo respondeu) e nada falhou em silêncio
    const motor = page.locator('.mapa-nav__motor')
    await expect(motor).toHaveAttribute('data-estilo', 'carregado', { timeout: 20_000 })
    await expect(motor).not.toHaveAttribute('data-erros-mapa', /.*/)
    // a letra: o rótulo das ruas da fixture fez o MapLibre baixar o Archivo local (fetch, connect-src)
    // e registrá-lo como FontFace (font-src)
    await expect
      .poll(() => page.evaluate(() => [...document.fonts].some((f) => f.family.includes('maplibre-gl-font-face-') && f.status === 'loaded')), {
        timeout: 20_000,
      })
      .toBe(true)
    expect(pedidosDeLetra.length).toBeGreaterThanOrEqual(1)
    expect(await page.evaluate(() => (window as unknown as { __violacoes: string[] }).__violacoes)).toEqual([])
    expect(bloqueios).toEqual([])
    expect(terceiros.externos).toEqual([])
  })
})

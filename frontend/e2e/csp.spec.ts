import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { escolherPorTeclado, json, simular } from './apoio'
import { PONTOS, posicao, ROTA_NAVEGAVEL } from './apoioNavegacao'

/**
 * O `vite preview` não lê public/_headers. Aqui a política de verdade é aplicada ao documento,
 * trocando só os hosts de produção pelos simulados, para ver se Leaflet e o resto convivem com ela.
 */
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

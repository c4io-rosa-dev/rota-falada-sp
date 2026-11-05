import { expect, test, type Page, type Route } from '@playwright/test'
import { alvosDe44, BARREIRA, escolherPorTeclado, focoNaoCaiu, json, ROTA, semRolagemHorizontal, semViolacoes, simular, umaRegiaoViva } from './apoio'

const SUPABASE = 'https://teste.supabase.co'
const CONTA = '3f2a91b0-1111-2222-3333-444455556666'

function jwt(): string {
  const parte = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const agora = Math.floor(Date.now() / 1000)
  return `${parte({ alg: 'ES256', typ: 'JWT' })}.${parte({ sub: CONTA, email: 'pessoa@exemplo.org', aud: 'authenticated', exp: agora + 3600, iat: agora })}.assinatura`
}

function sessao() {
  return {
    access_token: jwt(),
    refresh_token: 'r1',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: CONTA, aud: 'authenticated', email: 'pessoa@exemplo.org', app_metadata: {}, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' },
  }
}

/** Supabase Auth simulado; o build de E2E usa estas variáveis (package.json, build:e2e). */
async function simularAuth(page: Page) {
  await page.route(`${SUPABASE}/auth/v1/**`, (route: Route) => {
    const url = new URL(route.request().url())
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors })
    if (url.pathname.endsWith('/otp')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{}' })
    if (url.pathname.endsWith('/verify')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(sessao()) })
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{}' })
  })
}

async function verificarTela(page: Page, contexto: string) {
  await semViolacoes(page, contexto)
  await umaRegiaoViva(page)
  await semRolagemHorizontal(page, contexto)
  await alvosDe44(page, contexto)
}

test('cadastro em 3 toques só por teclado, com login no fim e a mesma chave', async ({ page }) => {
  const corpos: { chave_idempotencia: string; categoria: string }[] = []
  await simular(page, {
    'GET /api/eu': (r) => json(r, { papel: 'colaborador' }),
    'POST /api/barreiras': (r) => {
      corpos.push(r.request().postDataJSON())
      return json(r, BARREIRA, 201)
    },
  })
  await simularAuth(page)
  await page.goto('/barreiras/nova')
  await verificarTela(page, 'cadastro vazio')

  await page.getByRole('radio', { name: /^Escada/ }).focus()
  await page.keyboard.press('Space')
  await page.getByRole('combobox', { name: 'Endereço' }).focus()
  await page.keyboard.type('rua')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('option').first()).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  // o combobox sai da tela: o foco vai ao local marcado, e dali se chega ao envio só com Tab
  await expect(page.locator('.escolha-local__escolhido p').first()).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Trocar o local' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('textbox', { name: 'Descrição (opcional)' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Registrar barreira' })).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page.getByRole('heading', { level: 2, name: 'Entre para continuar' })).toBeFocused()
  await verificarTela(page, 'portão de login')
  expect(corpos).toHaveLength(0)

  await page.getByRole('textbox', { name: 'E-mail' }).fill('pessoa@exemplo.org')
  await page.keyboard.press('Enter')
  const codigo = page.getByRole('textbox', { name: 'Código de 6 dígitos' })
  await expect(codigo).toBeFocused()
  await verificarTela(page, 'código')
  await page.keyboard.type('123 456')
  await page.keyboard.press('Enter')

  await expect(page.getByRole('heading', { level: 1, name: 'Barreira registrada' })).toBeFocused()
  expect(corpos).toHaveLength(1)
  expect(corpos[0].categoria).toBe('escada')
  await verificarTela(page, 'barreira registrada')
  await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Conta' })).toBeVisible()
})

test('ver barreiras e votar', async ({ page }) => {
  await simular(page, {
    'GET /api/eu': (r) => json(r, { papel: 'colaborador' }),
    'PUT /api/barreiras/5/voto': (r) => json(r, { ...BARREIRA, status: 'validada', votos: { confirma: 2, contesta: 0, resolvida: 0 } }),
  })
  await simularAuth(page)
  await page.goto('/entrar')
  await page.getByRole('textbox', { name: 'E-mail' }).fill('pessoa@exemplo.org')
  await page.getByRole('button', { name: 'Receber código' }).click()
  await page.getByRole('textbox', { name: 'Código de 6 dígitos' }).fill('123456')
  await page.getByRole('button', { name: 'Confirmar código' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Sua conta' })).toBeVisible()
  await verificarTela(page, 'conta')

  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Barreiras' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Barreiras por perto' })).toBeFocused()
  await page.getByRole('combobox', { name: 'Endereço' }).fill('rua')
  await page.keyboard.press('Enter')
  await page.getByRole('option').first().click()
  await focoNaoCaiu(page, 'local escolhido')
  await page.getByRole('link', { name: /Ver e votar: Escada/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Escada' })).toBeFocused()
  await verificarTela(page, 'ficha')
  const confirmo = page.getByRole('button', { name: 'Confirmo' })
  await confirmo.click()
  await expect(confirmo).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('status')).toContainText('Voto registrado. Agora são 2 confirmações.')
})

test('painel de admin: fila, decisão com motivo e auditoria', async ({ page }) => {
  const eventos: Record<string, unknown>[] = [{ id: 1, barreira_id: 5, usuario_id: CONTA, tipo: 'criada', de_status: null, para_status: 'pendente', detalhe: {}, criado_em: '2026-11-03T12:00:00+00:00' }]
  await simular(page, {
    'GET /api/eu': (r) => json(r, { papel: 'admin' }),
    'GET /api/admin/barreiras': (r) => json(r, [{ ...BARREIRA, status: 'removida' }]),
    'GET /api/admin/barreiras/5': (r) => json(r, { ...BARREIRA, status: 'removida' }),
    'GET /api/admin/barreiras/5/eventos': (r) => json(r, eventos),
    'POST /api/admin/barreiras/5/status': (r) => {
      eventos.push({ ...eventos[0], id: 2, tipo: 'admin', de_status: 'removida', para_status: 'pendente', detalhe: { motivo: 'Denúncia improcedente' } })
      return json(r, BARREIRA)
    },
  })
  await simularAuth(page)
  await page.goto('/entrar?volta=/admin?status=removida')
  await page.getByRole('textbox', { name: 'E-mail' }).fill('pessoa@exemplo.org')
  await page.getByRole('button', { name: 'Receber código' }).click()
  await page.getByRole('textbox', { name: 'Código de 6 dígitos' }).fill('123456')
  await page.getByRole('button', { name: 'Confirmar código' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Moderação' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Nº 5, Escada' })).toBeVisible()
  await verificarTela(page, 'fila')
  await page.getByRole('link', { name: 'Nº 5, Escada' }).click()
  await expect(page.getByText(/criada por conta 3f2a91b0/)).toBeVisible()
  await verificarTela(page, 'decisão')
  await page.getByRole('radio', { name: /^Aguardando confirmação/ }).check()
  await page.getByRole('textbox', { name: 'Motivo' }).fill('Denúncia improcedente')
  await page.getByRole('button', { name: 'Registrar decisão' }).click()
  await expect(page.getByText(/Motivo: Denúncia improcedente/)).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Auditoria atualizada.')
})

test('reflow do cadastro a 320 px com o mapa de escolher ponto', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await simular(page)
  await page.goto('/barreiras/nova')
  await page.getByRole('button', { name: 'Escolher no mapa' }).click()
  const mapa = page.getByRole('img', { name: /Mapa para escolher um ponto/ })
  await expect(mapa).toBeVisible()
  await expect(mapa.locator('a, button, [tabindex]:not([tabindex="-1"])')).toHaveCount(0)
  await verificarTela(page, 'mapa de escolher')
  await expect(page.getByRole('button', { name: 'Escolher no mapa' })).toHaveAttribute('aria-describedby', /.+/)
  await page.getByRole('button', { name: 'Norte' }).click()
  await expect(page.getByRole('status')).toContainText('Mapa movido para norte.')
  await page.getByRole('button', { name: 'Marcar o centro do mapa' }).click()
  await expect(page.locator('.escolha-local__escolhido p').first()).toBeFocused()
  await page.getByRole('button', { name: 'Trocar o local' }).click()
  await expect(page.getByRole('combobox', { name: 'Endereço' })).toBeFocused()
})

test('mapa de escolher ponto: fundo que não carrega avisa e aponta os outros caminhos', async ({ page }) => {
  await simular(page)
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort())
  await page.goto('/barreiras/nova')
  await page.getByRole('button', { name: 'Escolher no mapa' }).click()
  await expect(page.getByText('O fundo do mapa não carregou. Use a localização ou digite o endereço.')).toBeVisible({ timeout: 12_000 })
  await page.getByRole('button', { name: 'Tentar de novo' }).click()
  await expect(page.getByRole('button', { name: 'Marcar o centro do mapa' })).toBeFocused()
})

test('o portão dentro da ficha abre por junta, sem caixa dentro de caixa; cancelar devolve o foco', async ({ page }) => {
  await simular(page)
  await page.goto('/barreiras/5')
  const confirmo = page.getByRole('button', { name: 'Confirmo' })
  await confirmo.click()
  await expect(page.getByRole('heading', { level: 2, name: 'Entre para continuar' })).toBeFocused()
  const estilo = await page.locator('.portao').evaluate((el) => {
    const c = getComputedStyle(el)
    return { fundo: c.backgroundColor, esquerda: c.borderLeftWidth, topo: c.borderTopWidth }
  })
  expect(estilo).toEqual({ fundo: 'rgba(0, 0, 0, 0)', esquerda: '0px', topo: '1px' })
  await verificarTela(page, 'portão na ficha')
  await page.getByRole('button', { name: 'Cancelar' }).click()
  await expect(confirmo).toBeFocused()
})

test('"Ver e votar" do passo é um alvo de 44 px', async ({ page }) => {
  const barreira = { id: 5, origem: 'colaborativa', categoria: 'buraco', severidade: 'dificulta', distancia_m: 12, confirmacoes: 1, data_referencia: '2026-11-03' }
  await simular(page, { 'POST /api/rotas': (r) => json(r, { ...ROTA, passos: [{ ...ROTA.passos[0], barreiras_proximas: [barreira] }] }) })
  await page.goto('/rota')
  await escolherPorTeclado(page)
  await page.getByRole('button', { name: 'Calcular rota' }).click()
  await expect(page.getByRole('link', { name: 'Ver e votar: Buraco, a 12 m' })).toBeVisible()
  await alvosDe44(page, 'barreira no passo')
})

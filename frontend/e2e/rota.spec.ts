import { expect, test } from '@playwright/test'
import { alvosDe44, B, escolherPorTeclado, focoNaoCaiu, json, ROTA, semRolagemHorizontal, semViolacoes, simular, umaRegiaoViva } from './apoio'

for (const esquema of ['light', 'dark'] as const) {
  test.describe(`tema ${esquema}`, () => {
    test.use({ colorScheme: esquema })

    test('E1 e E2: fluxo só por teclado, axe em cada estado', async ({ page }) => {
      await simular(page)
      await page.goto('/rota')
      await semViolacoes(page, 'vazio')
      await umaRegiaoViva(page)

      await page.getByRole('combobox', { name: 'Origem' }).focus()
      await page.keyboard.type('rua')
      await page.keyboard.press('Enter')
      await expect(page.getByRole('option').first()).toBeVisible()
      await semViolacoes(page, 'lista aberta')
      await page.keyboard.press('Escape')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')

      await page.keyboard.press('Tab') // Usar minha localização
      await page.getByRole('combobox', { name: 'Destino' }).focus()
      await page.keyboard.type('rua')
      await page.keyboard.press('Enter')
      await expect(page.getByRole('option').first()).toBeVisible()
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')

      await page.getByRole('button', { name: 'Calcular rota' }).focus()
      await page.keyboard.press('Enter')
      const titulo = page.getByRole('heading', { level: 2, name: /Rota encontrada/ })
      await expect(titulo).toBeFocused()
      await expect(page.getByRole('list', { name: 'Os 3 passos da rota' }).getByRole('listitem')).toHaveCount(3)
      await semViolacoes(page, 'resultado')
      await umaRegiaoViva(page)
    })

    test('E7: mapa real em StrictMode, nada focável dentro do role=img', async ({ page }) => {
      await simular(page)
      await page.goto('/rota')
      await escolherPorTeclado(page)
      await page.getByRole('button', { name: 'Calcular rota' }).click()
      await page.getByRole('button', { name: 'Mostrar mapa' }).click()
      const mapa = page.getByRole('img', { name: /Mapa ilustrativo da rota/ })
      await expect(mapa).toBeVisible()
      await expect(mapa.locator('a, button, [tabindex]:not([tabindex="-1"])')).toHaveCount(0)
      await expect(mapa).not.toHaveAttribute('tabindex', '0')
      await expect(page.getByRole('link', { name: 'OpenStreetMap' })).toBeVisible()
      await page.getByRole('button', { name: 'Ver o passo 2 no mapa' }).click()
      // a legenda diz o passo: ou a região anuncia, ou o foco vai a ela. Nunca os dois.
      const legenda = page.getByRole('list', { name: 'Mapa no passo 2' })
      await expect(legenda).toBeVisible()
      await focoNaoCaiu(page, 'ver o passo')
      await expect
        .poll(async () => (await legenda.evaluate((el) => el === document.activeElement)) !== ((await page.getByRole('status').textContent()) === 'Mapa no passo 2.'))
        .toBe(true)
      await page.getByRole('button', { name: 'Aproximar' }).click()
      await page.getByRole('button', { name: 'Rota inteira' }).click()
      await semViolacoes(page, 'mapa aberto')
      await umaRegiaoViva(page)
    })
  })
}

test.describe('reflow e alvos', () => {
  for (const [nome, viewport] of [
    ['celular de 320 px', { width: 320, height: 640 }],
    ['1280 a 400%', { width: 320, height: 256 }],
  ] as const) {
    test(`E3 e E4: ${nome}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await simular(page)
      await page.goto('/rota')
      await semRolagemHorizontal(page, 'vazio')
      await alvosDe44(page, 'vazio')
      await escolherPorTeclado(page)
      await semRolagemHorizontal(page, 'escolhido')
      await page.getByRole('button', { name: 'Calcular rota' }).click()
      await expect(page.getByRole('heading', { level: 2, name: /Rota encontrada/ })).toBeFocused()
      await semRolagemHorizontal(page, 'resultado')
      await alvosDe44(page, 'resultado')
      await page.getByRole('button', { name: 'Mostrar mapa' }).click()
      await expect(page.getByRole('img', { name: /Mapa ilustrativo/ })).toBeVisible()
      await semRolagemHorizontal(page, 'mapa')
      await alvosDe44(page, 'mapa')
    })
  }
})

test('E3: Enter no campo a 320 por 256 traz o resultado à vista', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 256 })
  await simular(page)
  await page.goto('/rota')
  await escolherPorTeclado(page)
  await expect(page.getByRole('combobox', { name: 'Destino' })).toBeFocused()
  await page.keyboard.press('Enter')
  const titulo = page.getByRole('heading', { level: 2, name: /Rota encontrada/ })
  await expect(titulo).toBeFocused()
  await expect(titulo).toBeInViewport()
})

test('recarregar depois de trocar o destino avisa, e a ficha segue com a rota antiga', async ({ page }) => {
  await simular(page)
  await page.goto('/rota')
  await escolherPorTeclado(page)
  await page.getByRole('button', { name: 'Calcular rota' }).click()
  await expect(page.getByRole('heading', { level: 2, name: /Rota encontrada/ })).toBeFocused()
  await page.getByRole('combobox', { name: 'Destino' }).fill('rua')
  await expect(page.getByRole('heading', { level: 2, name: /Rota da busca anterior/ })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Esta rota é da busca anterior.')
  await page.reload()
  await expect(page.getByText('Esta rota é da busca anterior. Calcule de novo.')).toBeVisible()
  await expect(page.locator('.ficha__dados')).toContainText(B.rotulo)
})

test.describe('geolocalização', () => {
  test.use({ geolocation: { latitude: -23.5901, longitude: -46.6352, accuracy: 20 }, permissions: ['geolocation'] })

  test('E5: concedida preenche a origem e anuncia', async ({ page }) => {
    await simular(page)
    await page.goto('/rota')
    await page.getByRole('button', { name: 'Usar minha localização' }).click()
    await expect(page.getByRole('combobox', { name: 'Origem' })).toHaveValue(/Rua Helen Keller/)
    await expect(page.getByRole('status')).toContainText('Confira se é onde você está.')
  })

  test('E5: fora da área mostra o texto do backend', async ({ page }) => {
    await simular(page, {
      'GET /api/geocode/reverso': (r) => json(r, { detail: 'Este ponto está fora da área atendida pelo Rota Falada SP.' }, 404),
    })
    await page.goto('/rota')
    await page.getByRole('button', { name: 'Usar minha localização' }).click()
    await expect(page.getByText('Este ponto está fora da área atendida pelo Rota Falada SP. Digite o endereço.')).toBeVisible()
  })
})

test('E5: localização negada orienta a digitar', async ({ page, context }) => {
  await context.clearPermissions()
  await simular(page)
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, erro) => erro?.({ code: 1 } as GeolocationPositionError)
  })
  await page.goto('/rota')
  await page.getByRole('button', { name: 'Usar minha localização' }).click()
  await expect(page.getByText(/não autorizou a localização/)).toBeVisible()
})

test('E6: servidor dormindo: aviso aparece com a espera, um anúncio, e a rota sai', async ({ page }) => {
  let acordado = false
  await simular(page, {
    'GET /health': async (r) => {
      if (acordado) return json(r, { status: 'ok', banco: 'ok' })
      await new Promise((f) => setTimeout(f, 6000))
      acordado = true
      return r.fulfill({ status: 502, contentType: 'text/html', body: '<html>' })
    },
  })
  await page.goto('/rota')
  await page.getByRole('combobox', { name: 'Origem' }).focus()
  await page.keyboard.type('rua')
  await page.keyboard.press('Enter')
  await expect(page.locator('#origem-retorno')).toContainText('leva cerca de 1 minuto', { timeout: 15_000 })
  await expect(page.getByRole('status')).toContainText('leva cerca de 1 minuto')
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 20_000 })
  await umaRegiaoViva(page)
})

test('fim a fim: 404 e 503 falam a verdade', async ({ page }) => {
  let vez = 0
  await simular(page, {
    'POST /api/rotas': (r) =>
      ++vez === 1
        ? json(r, { detail: 'Não encontramos rota acessível entre esses pontos.' }, 404)
        : vez === 2
          ? json(r, { detail: 'Não encontramos rota acessível entre esses pontos.' }, 503)
          : json(r, ROTA),
  })
  await page.goto('/rota')
  await escolherPorTeclado(page)
  await page.getByRole('button', { name: 'Calcular rota' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Não encontramos rota' })).toBeFocused()
  await semViolacoes(page, 'sem rota')
  await page.getByRole('button', { name: 'Calcular rota' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Não foi possível calcular agora' })).toBeFocused()
  await expect(page.getByText(/Isso não quer dizer que a rota não existe/)).toBeVisible()
  await semViolacoes(page, 'indisponível')
  await page.getByRole('button', { name: 'Tentar de novo' }).click()
  await expect(page.getByRole('heading', { level: 2, name: /Rota encontrada/ })).toBeFocused()
})

import { expect, test, type Page, type Route } from '@playwright/test'
import { alvosDe44, BARREIRA, escolherPorTeclado, focoNaoCaiu, json, semRolagemHorizontal, simular } from './apoio'

const SUPABASE = 'https://teste.supabase.co'
const CONTA = '3f2a91b0-1111-2222-3333-444455556666'
const EMAIL_LONGO = 'maria.aparecida.dos.santos.oliveira@gmail.com'
const LINK_LONGO = `https://www.google.com/maps/place/Rua+Helen+Keller+100+Vila+Mariana+Sao+Paulo+SP+${'x'.repeat(40)}`

function jwt(email: string): string {
  const parte = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const agora = Math.floor(Date.now() / 1000)
  return `${parte({ alg: 'ES256', typ: 'JWT' })}.${parte({ sub: CONTA, email, aud: 'authenticated', exp: agora + 3600, iat: agora })}.assinatura`
}

/** Já logada: a sessão fica em `rf-sessao`, como depois do código. */
async function logar(page: Page, { email = 'pessoa@exemplo.org', minhas = [] as number[] } = {}) {
  await page.route(`${SUPABASE}/auth/v1/**`, (route: Route) =>
    route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
      contentType: 'application/json',
      body: '{}',
    }),
  )
  const agora = Math.floor(Date.now() / 1000)
  const sessao = {
    access_token: jwt(email),
    refresh_token: 'r1',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: agora + 3600,
    user: { id: CONTA, aud: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' },
  }
  await page.addInitScript(
    ([s, conta, ids]) => {
      localStorage.setItem('rf-sessao', s as string)
      localStorage.setItem(`rf:minhas:${conta}`, ids as string)
    },
    [JSON.stringify(sessao), CONTA, JSON.stringify(minhas)],
  )
}

const EU = { 'GET /api/eu': (r: Route) => json(r, { papel: 'colaborador' }) }
const EU_ADMIN = { 'GET /api/eu': (r: Route) => json(r, { papel: 'admin' }) }

test.describe('reflow a 320 px', () => {
  for (const largura of [320, 344, 360, 375, 390]) {
    test(`ficha com a seção de foto, de quem cadastrou, a ${largura} px`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 640 })
      await simular(page, EU)
      await logar(page, { minhas: [5] })
      await page.goto('/barreiras/5')
      await expect(page.getByRole('heading', { level: 2, name: 'Foto (opcional)' })).toBeVisible()
      await semRolagemHorizontal(page, `ficha do autor a ${largura}`)
    })
  }

  test('ficha de quem modera', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await simular(page, EU_ADMIN)
    await logar(page)
    await page.goto('/barreiras/5')
    await expect(page.getByRole('heading', { level: 2, name: 'Foto (opcional)' })).toBeVisible()
    await semRolagemHorizontal(page, 'ficha do admin')
    await alvosDe44(page, 'ficha do admin')
  })

  test('fila com lista, e sem permissão', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    let permitido = true
    await simular(page, {
      ...EU_ADMIN,
      'GET /api/admin/barreiras': (r) => (permitido ? json(r, [BARREIRA]) : json(r, { detail: 'Você não tem permissão para esta ação.' }, 403)),
    })
    await logar(page)
    await page.goto('/admin')
    await expect(page.getByRole('link', { name: 'Nº 5, Escada' })).toBeVisible()
    await semRolagemHorizontal(page, 'fila')
    permitido = false
    await page.reload()
    await expect(page.getByText('Esta área é só para a equipe de moderação.').first()).toBeVisible()
    await semRolagemHorizontal(page, 'fila sem permissão')
  })

  test('e-mail comum de 45 caracteres no passo do código', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await simular(page, EU)
    await page.route(`${SUPABASE}/auth/v1/**`, (route) =>
      route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, contentType: 'application/json', body: '{}' }),
    )
    await page.goto('/entrar')
    await page.getByRole('textbox', { name: 'E-mail' }).fill(EMAIL_LONGO)
    await page.getByRole('button', { name: 'Receber código' }).click()
    await expect(page.getByRole('textbox', { name: 'Código de 6 dígitos' })).toBeVisible()
    await semRolagemHorizontal(page, 'passo do código')
  })

  test('/conta com o mesmo e-mail', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await simular(page, EU)
    await logar(page, { email: EMAIL_LONGO })
    await page.goto('/conta')
    await expect(page.getByText(`E-mail: ${EMAIL_LONGO}`)).toBeVisible()
    await semRolagemHorizontal(page, '/conta')
  })

  test('descrição de barreira com um link colado, para todo visitante e na moderação', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    const comLink = { ...BARREIRA, descricao: LINK_LONGO }
    await simular(page, {
      ...EU_ADMIN,
      'GET /api/barreiras/5': (r) => json(r, comLink),
      'GET /api/admin/barreiras/5': (r) => json(r, comLink),
      'GET /api/admin/barreiras/5/eventos': (r) =>
        json(r, [{ id: 1, barreira_id: 5, usuario_id: CONTA, tipo: 'admin', de_status: 'pendente', para_status: 'validada', detalhe: { motivo: LINK_LONGO }, criado_em: '2026-11-03T12:00:00+00:00' }]),
    })
    await page.goto('/barreiras/5')
    await expect(page.getByText(LINK_LONGO)).toBeVisible()
    await semRolagemHorizontal(page, 'ficha com link')
    await logar(page)
    await page.goto('/admin/barreiras/5')
    await expect(page.getByText(LINK_LONGO).first()).toBeVisible()
    await semRolagemHorizontal(page, 'decisão com link')
  })

  test('link colado no campo de endereço', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await simular(page, { 'GET /api/geocode': (r) => json(r, []) })
    await page.goto('/rota')
    await page.getByRole('combobox', { name: 'Origem' }).fill('https://www.google.com/maps/place/Rua+Helen+Keller')
    await page.keyboard.press('Enter')
    await expect(page.locator('#origem-retorno')).toContainText('Não encontramos')
    await semRolagemHorizontal(page, 'retorno do campo')
  })
})

test.describe('nada se move sem ação', () => {
  test('"Sair" não sobe quando a conta termina de carregar', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    let soltar: () => void = () => {}
    const pronto = new Promise<void>((r) => (soltar = r))
    await simular(page, {
      'GET /api/eu': async (r) => {
        await pronto
        return json(r, { papel: 'colaborador' })
      },
    })
    await logar(page)
    await page.goto('/conta')
    const sair = page.getByRole('button', { name: 'Sair' })
    await expect(page.getByText('Carregando os dados da conta…')).toBeVisible()
    const antes = (await sair.boundingBox())!.y
    soltar()
    await expect(page.getByText('Carregando os dados da conta…')).toHaveCount(0)
    expect((await sair.boundingBox())!.y).toBe(antes)
  })

  test('os botões de voto não descem quando o endereço chega', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    let soltar: () => void = () => {}
    const pronto = new Promise<void>((r) => (soltar = r))
    await simular(page, {
      'GET /api/geocode/reverso': async (r) => {
        await pronto
        return json(r, { id: 1, tipo: 'endereco', rotulo: 'Rua Doutor Fulano de Tal da Silva Sauro e Companhia, 100 · Vila Mariana', lat: -23.59, lon: -46.635, aproximado: false })
      },
    })
    await page.goto('/barreiras/5')
    await expect(page.getByText('Buscando o endereço…')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Confirmo' })).toHaveCount(0)
    soltar()
    const confirmo = page.getByRole('button', { name: 'Confirmo' })
    await expect(confirmo).toBeVisible()
    const y = (await confirmo.boundingBox())!.y
    await page.waitForTimeout(300)
    expect((await confirmo.boundingBox())!.y).toBe(y)
  })

  test('a frase do reenvio troca sem empurrar "Cancelar"', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await page.clock.install()
    await simular(page)
    await page.route(`${SUPABASE}/auth/v1/**`, (route) =>
      route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, contentType: 'application/json', body: '{}' }),
    )
    await page.goto('/barreiras/5')
    await page.getByRole('button', { name: 'Confirmo' }).click()
    await page.getByRole('textbox', { name: 'E-mail' }).fill('p@e.org')
    await page.getByRole('button', { name: 'Receber código' }).click()
    await expect(page.getByText(/Você pode pedir outro código a partir das/)).toBeVisible()
    const cancelar = page.getByRole('button', { name: 'Cancelar' })
    const antes = (await cancelar.boundingBox())!.y
    await page.clock.fastForward(61_000)
    await expect(page.getByText('Você já pode pedir outro código.')).toBeVisible()
    expect((await cancelar.boundingBox())!.y).toBe(antes)
  })
})

test.describe('sistema visual', () => {
  test('o botão de arquivo é uma placa de canto vivo, da paleta', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 800 })
    await simular(page, EU)
    await logar(page, { minhas: [5] })
    await page.goto('/barreiras/5')
    const estilo = await page.getByLabel('Arquivo da foto').evaluate((el) => {
      const b = getComputedStyle(el, '::file-selector-button')
      const raiz = getComputedStyle(document.documentElement)
      const cor = (nome: string) => {
        const sonda = document.createElement('i')
        sonda.style.color = raiz.getPropertyValue(nome)
        document.body.append(sonda)
        const c = getComputedStyle(sonda).color
        sonda.remove()
        return c
      }
      return { aparencia: b.appearance, raio: b.borderTopLeftRadius, fundo: b.backgroundColor, cor: b.color, placa: cor('--placa'), tinta: cor('--tinta'), borda: b.borderTopStyle, altura: parseFloat(b.minHeight) }
    })
    expect(estilo.aparencia).toBe('none')
    expect(estilo.raio).toBe('0px')
    expect(estilo.borda).toBe('solid')
    expect(estilo.fundo).toBe(estilo.placa)
    expect(estilo.cor).toBe(estilo.tinta)
    expect(estilo.altura).toBeGreaterThanOrEqual(44)
  })

  test('nenhuma faixa de laje sem junta acima do portão do cadastro', async ({ page }) => {
    await simular(page)
    await page.goto('/barreiras/nova', {})
    await page.getByRole('radio', { name: /^Escada/ }).check()
    await page.getByRole('combobox', { name: 'Endereço' }).fill('rua')
    await page.keyboard.press('Enter')
    await page.getByRole('option').first().click()
    await page.getByRole('button', { name: 'Registrar barreira' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Entre para continuar' })).toBeVisible()
    const fundo = await page.locator('.colaborar__portao').evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(fundo).toBe('rgba(0, 0, 0, 0)')
  })

  test('o portão de "Carregar mais" não vira caixa dentro de caixa', async ({ page }) => {
    let vez = 0
    await simular(page, {
      ...EU_ADMIN,
      'GET /api/admin/barreiras': (r) =>
        ++vez === 1 ? json(r, Array.from({ length: 50 }, (_, i) => ({ ...BARREIRA, id: 100 - i }))) : json(r, { detail: 'Faça login para continuar.' }, 401),
    })
    await logar(page)
    await page.goto('/admin')
    await page.getByRole('button', { name: 'Carregar mais' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Sua sessão terminou' })).toBeVisible()
    const estilo = await page.locator('.colaborar__lista .portao').evaluate((el) => {
      const c = getComputedStyle(el)
      return { fundo: c.backgroundColor, esquerda: c.borderLeftWidth, topo: c.borderTopWidth }
    })
    expect(estilo).toEqual({ fundo: 'rgba(0, 0, 0, 0)', esquerda: '0px', topo: '1px' })
  })

  test('o erro de /admin fica no alinhamento e no ritmo da tela', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await simular(page, { ...EU_ADMIN, 'GET /api/admin/barreiras': (r) => json(r, { detail: 'Sem permissão.' }, 403) })
    await logar(page)
    await page.goto('/admin')
    const caixa = page.locator('main').getByText('Esta área é só para a equipe de moderação.')
    await expect(caixa).toBeVisible()
    const h1 = (await page.getByRole('heading', { level: 1, name: 'Moderação' }).boundingBox())!
    const box = (await caixa.boundingBox())!
    expect(box.x).toBe(h1.x)
    expect(box.y - (h1.y + h1.height)).toBeLessThanOrEqual(64)
  })

  test('links de ação alinham com o texto da coluna', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await simular(page)
    await page.goto('/barreiras')
    await page.getByRole('combobox', { name: 'Endereço' }).fill('rua')
    await page.keyboard.press('Enter')
    await page.getByRole('option').first().click()
    const link = page.getByRole('link', { name: /Ver e votar/ })
    await expect(link).toBeVisible()
    const inicioDoTexto = (l: typeof link) =>
      l.evaluate((el) => {
        const r = document.createRange()
        r.selectNodeContents(el)
        return r.getBoundingClientRect().x
      })
    const textoDoItem = page.getByRole('heading', { level: 3, name: 'Escada' })
    expect(await inicioDoTexto(link)).toBe((await textoDoItem.boundingBox())!.x)
    await alvosDe44(page, 'lista de barreiras')
  })
})

test.describe('foco, alvos e fundo do mapa no navegador real', () => {
  test('a página não encontrada tem alvo de 44 px', async ({ page }) => {
    await simular(page)
    await page.goto('/nao-existe')
    await expect(page.getByRole('link', { name: 'Planejar uma rota' })).toBeVisible()
    await alvosDe44(page, '404')
  })

  test('"Licenças" e "Voltar ao passo N na lista"', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 256 })
    await simular(page)
    await page.goto('/rota')
    await escolherPorTeclado(page)
    await page.getByRole('button', { name: 'Calcular rota' }).click()
    await expect(page.getByRole('link', { name: 'Licenças', exact: true })).toBeVisible()
    await alvosDe44(page, 'resultado')
    await page.getByRole('button', { name: 'Mostrar mapa' }).click()
    await page.getByRole('button', { name: 'Ver o passo 2 no mapa' }).click()
    await page.getByRole('link', { name: 'Voltar ao passo 2 na lista' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#passo-2')).toBeFocused()
    await focoNaoCaiu(page, 'voltar ao passo')
  })

  test('o fundo que falha de novo depois de "Tentar de novo" avisa de novo', async ({ page }) => {
    await simular(page)
    await page.route('https://tile.openstreetmap.org/**', (route) => route.abort())
    await page.goto('/barreiras/nova')
    await page.getByRole('button', { name: 'Escolher no mapa' }).click()
    const aviso = page.getByText('O fundo do mapa não carregou. Use a localização ou digite o endereço.').first()
    await expect(aviso).toBeVisible({ timeout: 12_000 })
    await page.getByRole('button', { name: 'Tentar de novo' }).click()
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible({ timeout: 12_000 })
    await expect(aviso).toBeVisible()
  })
})

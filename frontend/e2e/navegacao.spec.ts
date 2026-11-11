import { expect, test, type Page } from '@playwright/test'
import { alvosDe44, B, focoNaoCaiu, semRolagemHorizontal, semViolacoes, umaRegiaoViva } from './apoio'
import { abrirNavegacao, aoLongo, deslocar, PONTOS, posicao, registrarPedidos } from './apoioNavegacao'

const regiao = (page: Page) => page.getByRole('status')

async function conferir(page: Page, estado: string) {
  await semViolacoes(page, estado)
  await alvosDe44(page, estado)
  await semRolagemHorizontal(page, estado)
  await umaRegiaoViva(page)
  await focoNaoCaiu(page, estado)
}

test.describe('navegação guiada', () => {
  test.use({ viewport: { width: 320, height: 720 } })

  test('do Começar à chegada, com as frases na região e as verificações em cada estado', async ({ page, context }) => {
    await context.grantPermissions(['geolocation'])
    await posicao(context, PONTOS.A)
    const pedidos = registrarPedidos(page)
    await abrirNavegacao(page)
    const antes = pedidos.length
    await conferir(page, 'preparo')

    await page.getByRole('button', { name: 'Começar' }).click()
    await expect(page.getByRole('heading', { level: 2, name: /Procurando sua posição|Passo 1 de 5/ })).toBeVisible()
    await expect(regiao(page)).toContainText('Passo 1 de 5. Siga para leste em direção a Alameda Jaú. 120 metros.')
    await expect(page.getByRole('heading', { level: 2, name: 'Passo 1 de 5' })).toBeVisible()
    await conferir(page, 'navegando')

    // todas as frases da rota em L, até o destino (204 m cai no passo 3, de 8 m, para a entrada dele sair)
    const frases: [number, string][] = [
      [70, 'Em 50 metros, vire à direita em direção a Rua Augusta.'],
      [100, 'Logo à frente, vire à direita.'],
      [130, 'Passo 2 de 5, Rua Augusta. Siga por 80 metros.'],
      [190, 'Logo à frente, vire à esquerda. Logo depois, vire à direita.'],
      [
        204,
        'Passo 3 de 5, Rua Peixoto Gomide. Siga por 8 metros. Depois, vire à direita em direção a Alameda Santos. No próximo trecho: degrau, guia sem rebaixamento.',
      ],
      [210, 'Passo 5 de 5, Alameda Santos. Siga por 100 metros. Atenção: degrau. Guia sem rebaixamento.'],
      [260, 'Em 50 metros, o destino.'],
      [290, 'Logo à frente, o destino.'],
    ]
    const marcas = [...Array.from({ length: 20 }, (_, i) => (i + 1) * 10), 204, ...Array.from({ length: 10 }, (_, i) => 210 + i * 10)]
    for (const m of marcas) {
      await posicao(context, aoLongo(m))
      const frase = frases.find(([em]) => em === m)
      if (frase) await expect(regiao(page)).toContainText(frase[1])
      else await page.waitForTimeout(50)
    }
    await posicao(context, PONTOS.E)

    const chegada = page.getByRole('heading', { level: 2, name: 'Você chegou ao destino' })
    await expect(chegada).toBeFocused()
    await expect(page.getByText('A posição pode errar alguns metros; confira pelo entorno.')).toBeVisible()
    await expect(chegada).toHaveAccessibleDescription('A posição pode errar alguns metros; confira pelo entorno.')
    // foco ou anúncio: a chegada vai pelo foco. A região escreve depois de uma pausa (PAUSA_MS,
    // 100 ms): espera mais que isso, senão a asserção negativa passaria antes do anúncio indevido.
    await page.waitForTimeout(300)
    await expect(regiao(page)).not.toContainText('Você chegou ao destino')
    await conferir(page, 'chegou')
    // nada foi para fora do site durante a navegação: nem API, nem tiles, nem qualquer outra origem
    expect(pedidos.slice(antes).map((r) => r.url())).toEqual([])
  })

  test('desvio por tempo com page.clock e Recalcular: só a origem muda, em 4 casas', async ({ page, context }) => {
    await page.clock.install()
    await context.grantPermissions(['geolocation'])
    await posicao(context, PONTOS.A)
    const pedidos = registrarPedidos(page)
    await abrirNavegacao(page)
    const original = pedidos.find((r) => r.method() === 'POST')!.postDataJSON()
    const antes = pedidos.length

    await page.getByRole('button', { name: 'Começar' }).click()
    await expect(regiao(page)).toContainText('Passo 1 de 5.')
    await posicao(context, aoLongo(20))
    await page.waitForTimeout(100)
    // duas leituras a 40 m da linha e o relógio anda 10 s: o desvio é confirmado pelo tempo
    // (um pico isolado não basta: o relógio pede duas leituras boas fora)
    await posicao(context, deslocar(aoLongo(30), 39, 0))
    await page.waitForTimeout(100)
    const fora = deslocar(aoLongo(30), 40, 0)
    await posicao(context, fora)
    await page.waitForTimeout(100)
    await page.clock.fastForward(10_000)
    await expect(regiao(page)).toContainText('Você saiu da rota, a cerca de 40 metros dela.')
    const recalcular = page.getByRole('button', { name: 'Recalcular' })
    await expect(recalcular).toHaveClass(/placa--acao/)
    await expect(page.getByText('Fora da rota')).toBeVisible()
    await conferir(page, 'fora da rota')
    expect(pedidos.slice(antes)).toHaveLength(0)

    // uma leitura nova (a do tempo ficou velha) e o pedido
    const agora = deslocar(fora, 1.234, 0)
    await posicao(context, agora)
    await page.waitForTimeout(100)
    await recalcular.click()
    await expect(regiao(page)).toContainText('Nova rota calculada: 310 metros, em 5 passos.')
    const novos = pedidos.slice(antes)
    expect(novos.map((r) => `${r.method()} ${new URL(r.url()).pathname}`)).toEqual(['POST /api/rotas'])
    const corpo = novos[0].postDataJSON()
    expect(corpo.destino).toEqual(original.destino)
    expect(corpo.perfil).toEqual(original.perfil)
    expect(corpo.origem).toEqual({ lat: Math.round(agora[0] * 1e4) / 1e4, lng: Math.round(agora[1] * 1e4) / 1e4 })
    for (const v of [corpo.origem.lat, corpo.origem.lng]) expect(String(v).split('.')[1].length).toBeLessThanOrEqual(4)
  })

  test('Pausar e passo a passo passam nas verificações', async ({ page, context }) => {
    await context.grantPermissions(['geolocation'])
    await posicao(context, PONTOS.A)
    await abrirNavegacao(page)
    await page.getByRole('button', { name: 'Começar' }).click()
    await expect(regiao(page)).toContainText('Passo 1 de 5.')
    const pausar = page.getByRole('button', { name: 'Pausar' })
    await pausar.click()
    await expect(pausar).toHaveAttribute('aria-pressed', 'true')
    await expect(regiao(page)).toContainText('Navegação pausada. A localização está desligada.')
    await conferir(page, 'pausada')
    await pausar.click()
    await expect(regiao(page)).toContainText('Navegação retomada.')

    await page.getByRole('button', { name: 'Encerrar' }).click()
    await expect(page.getByText('Encerrar a navegação?')).toBeFocused()
    await conferir(page, 'pergunta de encerrar')
    await page.getByRole('button', { name: 'Continuar navegando' }).click()
    await expect(page.getByRole('button', { name: 'Encerrar' })).toBeFocused()

    await page.goto('/rota/navegar')
    await page.getByRole('button', { name: 'Seguir passo a passo, sem localização' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Passo 1 de 5' })).toBeFocused()
    await page.getByRole('button', { name: 'Próximo passo' }).click()
    await expect(regiao(page)).toContainText('Passo 2 de 5. Vire à direita em direção a Rua Augusta. 80 metros.')
    await conferir(page, 'passo a passo')
  })

  test('permissão negada: mensagem com foco, sem anúncio', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.geolocation.watchPosition = (_ok, erro) => {
        setTimeout(() => erro?.({ code: 1, message: '' } as GeolocationPositionError), 0)
        return 1
      }
    })
    await abrirNavegacao(page)
    await page.getByRole('button', { name: 'Começar' }).click()
    const msg = page.getByText(/^O navegador não autorizou a localização\. Sem ela não dá para acompanhar o caminho\./)
    await expect(msg).toBeFocused()
    await page.waitForTimeout(200)
    await expect(regiao(page)).toHaveText('')
    await conferir(page, 'sem permissão')
    await expect(page.getByRole('list', { name: 'Para liberar a localização:' })).toContainText('No iPhone')
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Seguir passo a passo' })).toBeVisible()
  })

  test('sinal fraco (precisão 45) e sem sinal com page.clock: falas e linha de estado', async ({ page, context }) => {
    await page.clock.install()
    await context.grantPermissions(['geolocation'])
    await posicao(context, PONTOS.A)
    await abrirNavegacao(page)
    await page.getByRole('button', { name: 'Começar' }).click()
    await expect(regiao(page)).toContainText('Passo 1 de 5.')

    // leituras com precisão 45 m por 10 s: sinal fraco
    await posicao(context, aoLongo(5), 45)
    await page.waitForTimeout(100)
    await page.clock.fastForward(10_500)
    await expect(regiao(page)).toContainText('Sinal de localização fraco. A posição pode errar alguns metros. Pare e confira antes de virar.')
    await expect(page.getByText('Sinal fraco, a posição pode errar')).toBeVisible()
    await expect(page.getByText(/^em cerca de \d+ m$/)).toBeVisible()
    await conferir(page, 'sinal fraco')

    // nenhuma leitura por 15 s: sem sinal
    await page.clock.fastForward(15_500)
    await expect(regiao(page)).toContainText('Sem sinal de localização. Siga a descrição do passo atual e confira a tela.')
    await expect(page.getByText('Sem sinal de localização', { exact: true })).toBeVisible()

    // uma leitura boa: o sinal volta
    await posicao(context, aoLongo(8))
    await expect(regiao(page)).toContainText('Sinal de localização de volta.')
    await expect(page.getByText('Na rota')).toBeVisible()
  })

  test('?simular=reto mostra a faixa, fala em modo demonstração e nunca chama watchPosition', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __vigias: number }
      w.__vigias = 0
      const original = navigator.geolocation.watchPosition.bind(navigator.geolocation)
      navigator.geolocation.watchPosition = (...args: Parameters<Geolocation['watchPosition']>) => {
        w.__vigias++
        return original(...args)
      }
    })
    await abrirNavegacao(page)
    await page.goto('/rota/navegar?simular=reto&ritmo=20')
    await expect(page.getByText('Modo demonstração: a posição é simulada, não é a sua.')).toBeVisible()
    await page.getByRole('button', { name: 'Começar' }).click()
    await expect(regiao(page)).toContainText('Modo demonstração: a posição é simulada, não é a sua. Passo 1 de 5.')
    await conferir(page, 'simulação')
    expect(await page.evaluate(() => (window as unknown as { __vigias: number }).__vigias)).toBe(0)
  })

  test('Encerrar volta para /rota com o foco no h1 e a rota original', async ({ page, context }) => {
    await context.grantPermissions(['geolocation'])
    await posicao(context, PONTOS.A)
    await abrirNavegacao(page)
    await page.getByRole('button', { name: 'Começar' }).click()
    await expect(regiao(page)).toContainText('Passo 1 de 5.')
    await page.getByRole('button', { name: 'Encerrar' }).click()
    await page.getByRole('button', { name: 'Sim, encerrar' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Planejar rota' })).toBeFocused()
    await expect(page.getByRole('heading', { level: 2, name: /Rota encontrada/ })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Os 5 passos da rota' }).getByRole('listitem')).toHaveCount(5)
    await expect(page.getByRole('combobox', { name: 'Destino' })).toHaveValue(B.rotulo)
    await focoNaoCaiu(page, 'volta para /rota')
  })
})

test.describe('navegação guiada no alto contraste do Windows', () => {
  test.use({ viewport: { width: 320, height: 720 } })

  test('a ação principal (Recalcular fora da rota) e o botão pressionado (Pausar) têm sinais distintos', async ({ page, context }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await context.grantPermissions(['geolocation'])
    await posicao(context, PONTOS.A)
    await abrirNavegacao(page)
    await page.getByRole('button', { name: 'Começar' }).click()
    await expect(regiao(page)).toContainText('Passo 1 de 5.')
    for (let i = 0; i < 3; i++) {
      await posicao(context, deslocar(PONTOS.A, 60 + i, 0))
      await page.waitForTimeout(100)
    }
    const recalcular = page.getByRole('button', { name: 'Recalcular' })
    await expect(recalcular).toHaveClass(/placa--acao/)
    const estilo = (nome: string) =>
      page.getByRole('button', { name: nome }).evaluate((el) => {
        const s = getComputedStyle(el)
        return { borda: s.borderTopStyle, largura: s.borderTopWidth, contorno: s.outlineStyle }
      })
    // a ação: borda dupla e grossa, sem o contorno Highlight do pressionado
    expect(await estilo('Recalcular')).toEqual({ borda: 'double', largura: '4px', contorno: 'none' })
    // clique de mouse não liga :focus-visible: o contorno que sobra é o do aria-pressed
    await page.getByRole('button', { name: 'Pausar' }).click()
    // o pressionado: contorno sólido (Highlight), sem a borda dupla
    const pausar = await estilo('Pausar')
    expect(pausar.contorno).toBe('solid')
    expect(pausar.borda).not.toBe('double')
    // sem axe aqui: com forced-colors emulado ele mede o contraste com as cores do autor, não as do
    // sistema (o contraste nos temas claro e escuro é conferido nos outros testes)
    await alvosDe44(page, 'alto contraste')
    await semRolagemHorizontal(page, 'alto contraste')
    await umaRegiaoViva(page)
  })
})

test.describe('navegação guiada no tema escuro', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 320, height: 720 } })

  test('preparo, navegando e fora da rota sem violações', async ({ page, context }) => {
    await context.grantPermissions(['geolocation'])
    await posicao(context, PONTOS.A)
    await abrirNavegacao(page)
    await conferir(page, 'preparo (escuro)')
    await page.getByRole('button', { name: 'Começar' }).click()
    await expect(regiao(page)).toContainText('Passo 1 de 5.')
    await conferir(page, 'navegando (escuro)')
    for (let i = 0; i < 3; i++) {
      await posicao(context, deslocar(PONTOS.A, 60 + i, 0))
      await page.waitForTimeout(100)
    }
    await expect(page.getByRole('button', { name: 'Recalcular' })).toHaveClass(/placa--acao/)
    await conferir(page, 'fora da rota (escuro)')
  })
})

/**
 * Emenda de 10/11/2026 da spec do mapa (seção 19), na página de verdade: pictograma da manobra,
 * distância que falta, vista inclinada, mapa em tela cheia e seta da pessoa (bússola → caminhada
 * → rota → nenhuma). O motor do mapa é um falso que registra as chamadas.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { axe } from 'vitest-axe'
import type { RotaIn } from '../api/client'
import FONTE_APOIO from '../componentes/mapa/apoioMapaAberto.ts?raw'
import FONTE_BUSSOLA from '../componentes/mapa/useBussola.ts?raw'
import FONTE_TELA_CHEIA from '../componentes/navegacao/useTelaCheia.ts?raw'
import {
  BUSSOLA_NEGADA,
  DICA_GIRAR_MAPA,
  DICA_GIRAR_PELA_INCLINADA,
  DICA_INCLINAR_MAPA,
  DICA_TELA_CHEIA,
  DICA_USAR_BUSSOLA,
  ROTULO_MAPA_FIM,
  ROTULO_MAPA_GIRADO,
  ROTULO_MAPA_INCLINADO,
  ROTULO_MAPA_NORTE,
  SETA_PELA_BUSSOLA,
  SETA_PELA_CAMINHADA,
  SETA_PELA_ROTA,
  SETA_SEM_DIRECAO,
} from '../componentes/navegacao/textosNavegacao'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { deslocar } from '../dados/navegacao/regua'
import { montarTrajeto, pontoAoLongo } from '../dados/navegacao/trajeto'
import { CHAVE_CHEIA, CHAVE_INCLINADA, gravarPreferenciaMapa } from '../dados/preferenciaMapa'
import type { PontoLatLng } from '../dados/rotaGeo'
import { gravarSessaoRota, PERFIL_FORM_PADRAO } from '../dados/sessaoRota'
import { Navegar } from '../pages/Navegar'
import { PONTOS_L, REGUA_L, ROTA_L } from './fixturasNavegacao'
// o apoio do mapa aberto chega por import() junto com o motor: já carregado aqui, o import() do teste não espera a transformação
import '../componentes/mapa/apoioMapaAberto'

type MotorFalso = Record<'atualizar' | 'apontar' | 'trocarTema' | 'destruir', ReturnType<typeof vi.fn>>
const mapa = vi.hoisted(() => ({ motores: [] as MotorFalso[] }))
vi.mock('../componentes/mapa/MotorMapaNavegacao', () => ({
  ErroMotorMapa: class extends Error {},
  criarMotor: () => {
    const motor = { atualizar: vi.fn(), apontar: vi.fn(), trocarTema: vi.fn(), destruir: vi.fn() }
    mapa.motores.push(motor)
    return Promise.resolve(motor)
  },
}))

const PEDIDO: RotaIn = {
  origem: { lat: -23.5617, lng: -46.656 },
  destino: { lat: -23.5636, lng: -46.6547 },
  perfil: { inclinacao_max: 6, guia_max_m: 0.06, largura_min_m: 0.9, evitar_degraus: true, velocidade_kmh: 3 },
}
const TRAJETO = montarTrajeto(ROTA_L)!
const ao = (m: number): PontoLatLng => pontoAoLongo(TRAJETO, m)

function gravarRota() {
  gravarSessaoRota({
    versao: 1,
    origem: null,
    destino: null,
    perfil: PERFIL_FORM_PADRAO,
    rota: ROTA_L,
    rotaDe: { pedido: PEDIDO, origem: 'Rua A', destino: 'Rua B' },
    calculadaEm: new Date().toISOString(),
  })
}

/** A página dentro de uma casca parecida com a do app: cabeçalho, conteúdo, rodapé e a região viva única. */
function renderizar() {
  return render(
    <MemoryRouter initialEntries={['/rota/navegar']}>
      <RegiaoViva>
        <header>
          <a href="/">Rota Falada SP</a>
        </header>
        <main>
          <Routes>
            <Route path="/rota" element={<h1>Planejar rota</h1>} />
            <Route path="/rota/navegar" element={<Navegar />} />
          </Routes>
        </main>
        <footer>
          <a href="/fontes">Fontes</a>
        </footer>
      </RegiaoViva>
    </MemoryRouter>,
  )
}

type Extras = { heading?: number | null; speed?: number | null }

function instalarGps() {
  const vigias: { ok: PositionCallback }[] = []
  const watchPosition = vi.fn((ok: PositionCallback) => {
    vigias.push({ ok })
    return vigias.length
  })
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition, clearWatch: vi.fn(), getCurrentPosition: vi.fn() } })
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  const enviar = (p: PontoLatLng, extras: Extras = {}) =>
    act(() =>
      vigias.at(-1)!.ok({ coords: { latitude: p[0], longitude: p[1], accuracy: 8, ...extras }, timestamp: Date.now() } as GeolocationPosition),
    )
  return { enviar }
}

function instalarTela() {
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request: vi.fn(async () => Object.assign(new EventTarget(), { release: vi.fn(async () => {}) })) },
  })
}

/** Navegador com o evento de orientação; com `permissao`, como o iPhone (pede num toque). */
function instalarOrientacao(permissao?: () => Promise<string>) {
  class EventoFalso {}
  if (permissao) (EventoFalso as unknown as { requestPermission: () => Promise<string> }).requestPermission = permissao
  vi.stubGlobal('DeviceOrientationEvent', EventoFalso)
}

function orientar(tipo: 'deviceorientationabsolute' | 'deviceorientation', campos: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(Object.assign(new Event(tipo), campos))
  })
}

const botao = (nome: string | RegExp) => screen.getByRole('button', { name: nome })
const semBotao = (nome: string | RegExp) => screen.queryByRole('button', { name: nome })
const motor = () => mapa.motores.at(-1)!
const tela = () => document.querySelector<HTMLElement>('.nav-tela')!
const textoSeta = () => document.querySelector<HTMLElement>('.mapa-nav__seta')!

/** Começa, encaixa em A e abre o mapa. */
async function comMapaAberto(user: ReturnType<typeof userEvent.setup>, gps: ReturnType<typeof instalarGps>) {
  await user.click(await screen.findByRole('button', { name: 'Começar' }))
  await gps.enviar(PONTOS_L.A)
  await gps.enviar(ao(10))
  await user.click(botao('Mostrar o mapa'))
  await waitFor(() => expect(document.querySelector('figure.mapa-nav')).toHaveAttribute('data-fase', 'pronto'))
  await waitFor(() => expect(motor().atualizar).toHaveBeenCalled())
}

beforeEach(() => {
  mapa.motores.length = 0
  gravarRota()
  instalarTela()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const chave of ['geolocation', 'wakeLock'] as const) delete (navigator as unknown as Record<string, unknown>)[chave]
  delete (window as unknown as Record<string, unknown>).isSecureContext
  document.documentElement.className = ''
})

describe('nível 1: pictograma da manobra e distância que falta', () => {
  it('o painel mostra o desenho da próxima manobra ao lado da ação, decorativo', async () => {
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await user.click(await screen.findByRole('button', { name: 'Começar' }))
    await gps.enviar(PONTOS_L.A)
    await gps.enviar(ao(20))
    const painel = screen.getByRole('region', { name: 'Passo 1 de 5' })
    const manobra = painel.querySelector('.painel__manobra')!
    expect(within(manobra as HTMLElement).getByText('Vire à direita')).toBeInTheDocument()
    const desenho = manobra.querySelector('svg')!
    expect(desenho).toHaveAttribute('data-pictograma', 'vire-direita')
    // a forma reforça; o texto é a informação: o desenho fica fora da árvore de acessibilidade
    expect(desenho).toHaveAttribute('aria-hidden', 'true')
    expect(within(painel).queryByRole('img')).toBeNull()
  })

  it('perto do fim, o desenho é o do destino', async () => {
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await user.click(await screen.findByRole('button', { name: 'Começar' }))
    await gps.enviar(PONTOS_L.A)
    for (let m = 10; m <= 230; m += 10) await gps.enviar(ao(m))
    const painel = screen.getByRole('region', { name: 'Passo 5 de 5' })
    expect(within(painel).getByText('Siga até o destino')).toBeInTheDocument()
    expect(painel.querySelector('.painel__manobra svg')).toHaveAttribute('data-pictograma', 'destino')
  })

  it('junto dos controles: quanto falta até o destino e o passo, sem tempo, sem anunciar a cada leitura', async () => {
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await user.click(await screen.findByRole('button', { name: 'Começar' }))
    expect(document.querySelector('.navegar__falta')).toBeNull() // procurando: ainda não há passo
    await gps.enviar(PONTOS_L.A)
    await gps.enviar(ao(20))
    const resumo = document.querySelector('.navegar__falta')!
    expect(resumo).toHaveTextContent(/^Faltam \d+ m até o destino\. Passo 1 de 5\.$/)
    expect(resumo.textContent).not.toMatch(/min|hora/i)
    // fica antes dos controles e fora de qualquer região viva
    const repetir = botao('Repetir')
    expect(resumo.compareDocumentPosition(repetir) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(resumo.closest('[aria-live], [role="status"]')).toBeNull()
    // muda na tela a cada leitura, e o que falta nunca vai para a região viva
    const antes = resumo.textContent
    for (let m = 30; m <= 60; m += 10) await gps.enviar(ao(m))
    expect(resumo.textContent).not.toBe(antes)
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 150))
    })
    expect(screen.getByRole('status').textContent).not.toMatch(/Faltam|até o destino\. Passo/)
  })

  it('fora da rota a distância some e fica só o passo', async () => {
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await user.click(await screen.findByRole('button', { name: 'Começar' }))
    await gps.enviar(PONTOS_L.A)
    await gps.enviar(ao(20))
    const fora = deslocar(REGUA_L, ao(30), 40, 0)
    for (let i = 0; i < 3; i++) await gps.enviar(deslocar(REGUA_L, fora, 0, i * 5))
    await screen.findByText('Fora da rota')
    expect(document.querySelector('.navegar__falta')).toHaveTextContent(/^Passo 1 de 5\.$/)
  })
})

describe('nível 2: vista inclinada', () => {
  it('existe, é opcional e começa desligada; ligar avisa o motor, muda o rótulo da figura e vale só na aba', async () => {
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await user.click(await screen.findByRole('button', { name: 'Começar' }))
    await gps.enviar(PONTOS_L.A)
    // com o mapa fechado a opção nem aparece
    expect(semBotao('Vista inclinada')).toBeNull()
    await comMapaAbertoDepoisDeComecar(user)
    const inclinar = botao('Vista inclinada')
    expect(inclinar).toHaveAttribute('aria-pressed', 'false')
    expect(inclinar).toHaveTextContent(/^Vista inclinada: desligado$/)
    expect(inclinar).toHaveAccessibleDescription(DICA_INCLINAR_MAPA)
    expect(motor().atualizar.mock.calls.at(-1)![2]).toBe(false)
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', ROTULO_MAPA_NORTE + ROTULO_MAPA_FIM)

    await user.click(inclinar)
    // nome fixo + aria-pressed + estado escrito à vista, fora do nome
    expect(botao('Vista inclinada')).toHaveAttribute('aria-pressed', 'true')
    expect(botao('Vista inclinada')).toHaveTextContent(/^Vista inclinada: ligado$/)
    expect(botao('Vista inclinada')).toHaveFocus()
    expect(motor().atualizar.mock.calls.at(-1)![2]).toBe(true)
    // inclinada, o mapa sempre gira com a rota: com o norte fixo, quem anda para o sul veria o que ficou para trás
    expect(motor().atualizar.mock.calls.at(-1)![1]).toBe(true)
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', ROTULO_MAPA_GIRADO + ROTULO_MAPA_INCLINADO + ROTULO_MAPA_FIM)
    expect(sessionStorage.getItem(CHAVE_INCLINADA)).toBe('1')
    expect(localStorage.length).toBe(0)

    // o "Girar" mostra ligado, não desliga e diz por quê; a escolha guardada dele não muda
    const girar = botao('Girar o mapa com a rota')
    expect(girar).toHaveAttribute('aria-pressed', 'true')
    expect(girar).toHaveAttribute('aria-disabled', 'true')
    expect(girar).toHaveTextContent(/: ligado$/)
    expect(girar).toHaveAccessibleDescription(DICA_GIRAR_PELA_INCLINADA)
    await user.click(girar)
    expect(botao('Girar o mapa com a rota')).toHaveAttribute('aria-pressed', 'true')
    expect(motor().atualizar.mock.calls.at(-1)![1]).toBe(true)

    await user.click(botao('Vista inclinada'))
    expect(motor().atualizar.mock.calls.at(-1)![2]).toBe(false)
    expect(motor().atualizar.mock.calls.at(-1)![1]).toBe(false)
    expect(botao('Girar o mapa com a rota')).toHaveAttribute('aria-pressed', 'false')
    expect(botao('Girar o mapa com a rota')).not.toHaveAttribute('aria-disabled')
    expect(botao('Girar o mapa com a rota')).toHaveAccessibleDescription(DICA_GIRAR_MAPA)
    expect(sessionStorage.getItem(CHAVE_INCLINADA)).toBe('0')
  })

  it('a escolha guardada na aba volta ligada', async () => {
    gravarPreferenciaMapa('aberto', true)
    gravarPreferenciaMapa('inclinada', true)
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await user.click(await screen.findByRole('button', { name: 'Começar' }))
    await gps.enviar(PONTOS_L.A)
    expect(await screen.findByRole('button', { name: 'Vista inclinada' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(motor().atualizar).toHaveBeenCalled())
    expect(motor().atualizar.mock.calls.at(-1)![2]).toBe(true)
  })
})

/** Abre o mapa numa navegação que já começou. */
async function comMapaAbertoDepoisDeComecar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(botao('Mostrar o mapa'))
  await waitFor(() => expect(document.querySelector('figure.mapa-nav')).toHaveAttribute('data-fase', 'pronto'))
  await waitFor(() => expect(motor().atualizar).toHaveBeenCalled())
}

describe('mapa em tela cheia', () => {
  it('começa desligada e só existe com o mapa aberto', async () => {
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await user.click(await screen.findByRole('button', { name: 'Começar' }))
    await gps.enviar(PONTOS_L.A)
    expect(semBotao('Mapa em tela cheia')).toBeNull()
    expect(tela()).not.toHaveClass('nav-tela--cheia')
    await comMapaAbertoDepoisDeComecar(user)
    const alternar = botao('Mapa em tela cheia')
    expect(alternar).toHaveAttribute('aria-pressed', 'false')
    expect(alternar).toHaveTextContent(/^Mapa em tela cheia: desligado$/)
    expect(alternar).toHaveAccessibleDescription(DICA_TELA_CHEIA)
    expect(semBotao('Sair da tela cheia')).toBeNull()
    expect(tela()).not.toHaveClass('nav-tela--cheia')
    expect(document.documentElement).not.toHaveClass('com-tela-cheia')
  })

  it('ligar: o contêiner vira tela cheia, o foco vai para "Sair da tela cheia" e a ordem do DOM não muda', async () => {
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await comMapaAberto(user, gps)
    const ordemAntes = Array.from(tela().querySelectorAll('h2, button, a, figure')).map((n) => n.textContent)

    await user.click(botao('Mapa em tela cheia'))
    expect(tela()).toHaveClass('nav-tela--cheia')
    expect(document.documentElement).toHaveClass('com-tela-cheia')
    expect(botao('Mapa em tela cheia')).toHaveAttribute('aria-pressed', 'true')
    expect(botao('Mapa em tela cheia')).toHaveTextContent(/^Mapa em tela cheia: ligado$/)
    expect(sessionStorage.getItem(CHAVE_CHEIA)).toBe('1')
    const sair = botao('Sair da tela cheia')
    expect(sair).toHaveFocus()

    // a mesma ordem de antes, só com o botão de sair a mais, logo depois do painel
    const ordemDepois = Array.from(tela().querySelectorAll('h2, button, a, figure')).map((n) => n.textContent)
    expect(ordemDepois.filter((t) => t !== 'Sair da tela cheia').map((t) => t?.replace(': ligado', ': desligado'))).toEqual(ordemAntes)
    expect(ordemDepois[1]).toBe('Sair da tela cheia')
    // painel → controles → opções do mapa → figura
    const painel = screen.getByRole('region', { name: /^Passo \d de 5$/ })
    const figura = document.querySelector('figure.mapa-nav')!
    const depois = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(depois(painel, sair)).toBe(true)
    expect(depois(sair, botao('Repetir'))).toBe(true)
    expect(depois(botao('Encerrar'), botao('Esconder o mapa'))).toBe(true)
    expect(depois(botao('Mapa em tela cheia'), figura)).toBe(true)
    // tudo continua dentro do contêiner: nada do conteúdo foi tirado da tela
    for (const el of [painel, figura, botao('Repetir'), botao('Recalcular'), botao('Pausar'), botao('Encerrar'), botao('Vista inclinada')]) {
      expect(tela()).toContainElement(el as HTMLElement)
    }
    expect(document.querySelector('.navegar__falta')).toBeInTheDocument()
  })

  it('em tela cheia o resto da página fica inerte, menos a região viva, que continua anunciando', async () => {
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await comMapaAberto(user, gps)
    await user.click(botao('Mapa em tela cheia'))
    expect(document.querySelector('header')).toHaveAttribute('inert')
    expect(document.querySelector('footer')).toHaveAttribute('inert')
    expect(screen.getByText('Navegação guiada', { selector: 'h1' })).toHaveAttribute('inert')
    const regiao = document.querySelector('[data-regiao-viva]')!
    expect(regiao).not.toHaveAttribute('inert')
    expect(regiao.closest('[inert]')).toBeNull()
    expect(tela().closest('[inert]')).toBeNull()
    // a navegação segue anunciando em tela cheia
    for (let m = 20; m <= 80; m += 10) await gps.enviar(ao(m))
    await waitFor(() => expect(regiao).toHaveTextContent(/Em 50 metros, vire à direita/))
  })

  it('Esc sai, o foco fica na alternância e a página volta ao normal', async () => {
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await comMapaAberto(user, gps)
    await user.click(botao('Mapa em tela cheia'))
    await user.keyboard('{Escape}')
    expect(tela()).not.toHaveClass('nav-tela--cheia')
    expect(document.documentElement).not.toHaveClass('com-tela-cheia')
    expect(document.querySelectorAll('[inert]')).toHaveLength(0)
    expect(semBotao('Sair da tela cheia')).toBeNull()
    expect(botao('Mapa em tela cheia')).toHaveAttribute('aria-pressed', 'false')
    expect(botao('Mapa em tela cheia')).toHaveFocus()
    expect(sessionStorage.getItem(CHAVE_CHEIA)).toBe('0')
    // fora da tela cheia o Esc não faz nada
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(sessionStorage.getItem(CHAVE_CHEIA)).toBe('0')
  })

  it('o botão "Sair da tela cheia" sai e devolve o foco à alternância; a própria alternância também sai', async () => {
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await comMapaAberto(user, gps)
    await user.click(botao('Mapa em tela cheia'))
    await user.click(botao('Sair da tela cheia'))
    expect(tela()).not.toHaveClass('nav-tela--cheia')
    expect(botao('Mapa em tela cheia')).toHaveFocus()

    await user.click(botao('Mapa em tela cheia'))
    expect(tela()).toHaveClass('nav-tela--cheia')
    await user.click(botao('Mapa em tela cheia'))
    expect(tela()).not.toHaveClass('nav-tela--cheia')
    expect(botao('Mapa em tela cheia')).toHaveFocus()
    expect(document.querySelectorAll('[inert]')).toHaveLength(0)
  })

  it('o motor do mapa não é recriado ao entrar nem ao sair', async () => {
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await comMapaAberto(user, gps)
    await user.click(botao('Mapa em tela cheia'))
    await user.keyboard('{Escape}')
    expect(mapa.motores).toHaveLength(1)
    expect(motor().destruir).not.toHaveBeenCalled()
  })

  it('esconder o mapa sai da tela cheia, e reabrir não toma a tela sozinho', async () => {
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await comMapaAberto(user, gps)
    await user.click(botao('Mapa em tela cheia'))
    await user.click(botao('Esconder o mapa'))
    expect(tela()).not.toHaveClass('nav-tela--cheia')
    expect(document.querySelectorAll('[inert]')).toHaveLength(0)
    expect(sessionStorage.getItem(CHAVE_CHEIA)).toBe('0')
    await user.click(botao('Mostrar o mapa'))
    await waitFor(() => expect(document.querySelector('figure.mapa-nav')).toHaveAttribute('data-fase', 'pronto'))
    expect(tela()).not.toHaveClass('nav-tela--cheia')
  })

  it('na chegada o mapa some e a página volta ao normal, com o foco no título da chegada', async () => {
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await comMapaAberto(user, gps)
    await user.click(botao('Mapa em tela cheia'))
    for (let m = 20; m <= TRAJETO.totalM; m += 10) await gps.enviar(ao(m))
    await gps.enviar(PONTOS_L.E)
    const h2 = await screen.findByRole('heading', { level: 2, name: 'Você chegou ao destino' })
    await waitFor(() => expect(h2).toHaveFocus())
    expect(tela()).not.toHaveClass('nav-tela--cheia')
    expect(document.documentElement).not.toHaveClass('com-tela-cheia')
    expect(document.querySelectorAll('[inert]')).toHaveLength(0)
  })

  it('preferência vinda da aba: entra em tela cheia ao começar, sem tirar o foco do painel', async () => {
    gravarPreferenciaMapa('aberto', true)
    gravarPreferenciaMapa('cheia', true)
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await user.click(await screen.findByRole('button', { name: 'Começar' }))
    await gps.enviar(PONTOS_L.A)
    expect(tela()).toHaveClass('nav-tela--cheia')
    expect(botao('Sair da tela cheia')).not.toHaveFocus()
    expect(screen.getByRole('heading', { level: 2 })).toHaveFocus()
  })

  it('axe sem violações em tela cheia', async () => {
    const gps = instalarGps()
    const user = userEvent.setup()
    const { container } = renderizar()
    await comMapaAberto(user, gps)
    await user.click(botao('Mapa em tela cheia'))
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('seta da pessoa: bússola → caminhada → rota → nenhuma', () => {
  const ultimaSeta = () => motor().apontar.mock.calls.at(-1)![0] as number | null

  it('sem bússola e sem rumo do GPS: o sentido da rota, com a dica à vista', async () => {
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await comMapaAberto(user, gps)
    // ROTA_L começa para o leste
    expect(ultimaSeta()).toBeCloseTo(90, 0)
    expect(textoSeta()).toHaveTextContent(SETA_PELA_ROTA)
    expect(textoSeta()).toHaveAttribute('data-fonte-seta', 'rota')
    // texto parado: fora de região viva
    expect(textoSeta().closest('[aria-live], [role="status"]')).toBeNull()
  })

  it('GPS com rumo e velocidade de caminhada: o sentido da caminhada; parado, volta para a rota', async () => {
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await comMapaAberto(user, gps)
    await gps.enviar(ao(20), { heading: 75, speed: 1.2 })
    expect(ultimaSeta()).toBe(75)
    expect(textoSeta()).toHaveTextContent(SETA_PELA_CAMINHADA)
    // parado, o aparelho manda heading NaN ou nulo e velocidade zero
    await gps.enviar(ao(21), { heading: Number.NaN, speed: 0 })
    expect(ultimaSeta()).toBeCloseTo(90, 0)
    expect(textoSeta()).toHaveTextContent(SETA_PELA_ROTA)
    await gps.enviar(ao(22), { heading: 75, speed: 0.2 })
    expect(textoSeta()).toHaveTextContent(SETA_PELA_ROTA)
  })

  it('Android: a bússola (deviceorientationabsolute) vence o GPS e a rota', async () => {
    instalarOrientacao()
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await comMapaAberto(user, gps)
    expect(semBotao('Usar a bússola na seta')).toBeNull() // no Android não há pedido
    orientar('deviceorientationabsolute', { absolute: true, alpha: 150, beta: 30, gamma: 0 })
    expect(ultimaSeta()).toBeCloseTo(210, 3)
    expect(textoSeta()).toHaveTextContent(SETA_PELA_BUSSOLA)
    await gps.enviar(ao(20), { heading: 75, speed: 1.2 })
    expect(textoSeta()).toHaveTextContent(SETA_PELA_BUSSOLA)
    expect(ultimaSeta()).toBeCloseTo(210, 3)
  })

  it('evento relativo ou sem alpha não é bússola: a seta continua pela rota', async () => {
    instalarOrientacao()
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await comMapaAberto(user, gps)
    orientar('deviceorientation', { absolute: false, alpha: 150, beta: 30, gamma: 0 })
    orientar('deviceorientationabsolute', { absolute: true, alpha: null, beta: null, gamma: null })
    expect(textoSeta()).toHaveTextContent(SETA_PELA_ROTA)
    expect(ultimaSeta()).toBeCloseTo(90, 0)
  })

  it('a seta muda no máximo a cada 250 ms e só com 5° ou mais; a média suaviza o salto', async () => {
    instalarOrientacao()
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await comMapaAberto(user, gps)
    const agora = vi.spyOn(Date, 'now')
    let t = Date.now() + 10_000
    agora.mockImplementation(() => t)
    orientar('deviceorientationabsolute', { absolute: true, alpha: 0, beta: 0, gamma: 0 })
    expect(ultimaSeta()).toBeCloseTo(0, 3)
    // 100 ms depois, virou 90°: cedo demais para mexer a seta
    t += 100
    orientar('deviceorientationabsolute', { absolute: true, alpha: 270, beta: 0, gamma: 0 })
    expect(ultimaSeta()).toBeCloseTo(0, 3)
    // passados os 250 ms, a seta anda, mas suavizada: ainda não chegou aos 90°
    t += 200
    orientar('deviceorientationabsolute', { absolute: true, alpha: 270, beta: 0, gamma: 0 })
    const primeira = ultimaSeta()!
    expect(primeira).toBeGreaterThan(5)
    expect(primeira).toBeLessThan(90)
    // continuando virado para o leste, a média chega lá
    for (let i = 0; i < 40; i++) {
      t += 300
      orientar('deviceorientationabsolute', { absolute: true, alpha: 270, beta: 0, gamma: 0 })
    }
    const assentada = ultimaSeta()!
    expect(assentada).toBeGreaterThan(85)
    expect(assentada).toBeLessThanOrEqual(90)
    // tremor de 1° não mexe a seta, nem depois de muito tempo
    t += 5000
    orientar('deviceorientationabsolute', { absolute: true, alpha: 269, beta: 0, gamma: 0 })
    expect(ultimaSeta()).toBe(assentada)
  })

  it('bússola que para de mandar leitura por mais de 3 s cai para a caminhada ou a rota', async () => {
    instalarOrientacao()
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await comMapaAberto(user, gps)
    const agora = vi.spyOn(Date, 'now')
    let t = Date.now() + 10_000
    agora.mockImplementation(() => t)
    orientar('deviceorientationabsolute', { absolute: true, alpha: 150, beta: 30, gamma: 0 })
    expect(textoSeta()).toHaveTextContent(SETA_PELA_BUSSOLA)
    t += 3500
    await gps.enviar(ao(30))
    expect(textoSeta()).toHaveTextContent(SETA_PELA_ROTA)
    expect(ultimaSeta()).toBeCloseTo(90, 0)
  })

  it('fora da rota e sem nenhuma fonte: anel sem seta, e a dica diz isso', async () => {
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await comMapaAberto(user, gps)
    const fora = deslocar(REGUA_L, ao(30), 40, 0)
    for (let i = 0; i < 3; i++) await gps.enviar(deslocar(REGUA_L, fora, 0, i * 5))
    await screen.findByText('Fora da rota')
    expect(ultimaSeta()).toBeNull()
    expect(textoSeta()).toHaveTextContent(SETA_SEM_DIRECAO)
    expect(textoSeta()).toHaveAttribute('data-fonte-seta', 'nenhuma')
    // fora da rota, a caminhada ainda vale
    await gps.enviar(deslocar(REGUA_L, fora, 0, 20), { heading: 300, speed: 1 })
    expect(ultimaSeta()).toBe(300)
    expect(textoSeta()).toHaveTextContent(SETA_PELA_CAMINHADA)
  })

  it('iPhone: a bússola só é pedida no toque; autorizada, o botão some e o foco vai para o texto da seta', async () => {
    // como o iPhone: fora de um toque o pedido é recusado sem mostrar nada; no toque, a pessoa autoriza
    let chamadas = 0
    const pedir = vi.fn(() => (++chamadas === 1 ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve('granted')))
    instalarOrientacao(pedir)
    const ouvir = vi.spyOn(window, 'addEventListener')
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await comMapaAberto(user, gps)
    // só a tentativa silenciosa, uma vez, recusada: o botão fica e ninguém escuta o sensor
    expect(pedir).toHaveBeenCalledTimes(1)
    await gps.enviar(ao(20))
    expect(pedir).toHaveBeenCalledTimes(1)
    expect(ouvir.mock.calls.filter((c) => String(c[0]).startsWith('deviceorientation'))).toEqual([])
    const usar = botao('Usar a bússola na seta')
    expect(usar).toHaveAccessibleDescription(DICA_USAR_BUSSOLA)
    expect(textoSeta()).toHaveTextContent(SETA_PELA_ROTA)

    await user.click(usar)
    expect(pedir).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(semBotao('Usar a bússola na seta')).toBeNull())
    expect(textoSeta()).toHaveFocus()
    orientar('deviceorientation', { webkitCompassHeading: 123, webkitCompassAccuracy: 15, alpha: 5, beta: 40, gamma: 0 })
    expect(ultimaSeta()).toBeCloseTo(123, 3)
    expect(textoSeta()).toHaveTextContent(SETA_PELA_BUSSOLA)
    // sem calibração (precisão negativa) a leitura não entra
    orientar('deviceorientation', { webkitCompassHeading: 300, webkitCompassAccuracy: -1 })
    expect(ultimaSeta()).toBeCloseTo(123, 3)
  })

  it('navegador que autoriza sem toque: a bússola liga sozinha, sem botão', async () => {
    const pedir = vi.fn(() => Promise.resolve('granted'))
    instalarOrientacao(pedir)
    const gps = instalarGps()
    const user = userEvent.setup()
    renderizar()
    await comMapaAberto(user, gps)
    await waitFor(() => expect(semBotao('Usar a bússola na seta')).toBeNull())
    expect(pedir).toHaveBeenCalledTimes(1)
    // o foco não é mexido: ninguém tocou em nada
    expect(textoSeta()).not.toHaveFocus()
    orientar('deviceorientationabsolute', { absolute: true, alpha: 150, beta: 30, gamma: 0 })
    expect(textoSeta()).toHaveTextContent(SETA_PELA_BUSSOLA)
  })

  it('iPhone: permissão negada (ou erro) diz isso à vista e a seta segue pelas outras fontes', async () => {
    for (const resposta of [() => Promise.resolve('denied'), () => Promise.reject(new Error('sem gesto'))]) {
      mapa.motores.length = 0
      instalarOrientacao(resposta)
      const gps = instalarGps()
      const user = userEvent.setup()
      renderizar()
      await comMapaAberto(user, gps)
      await user.click(botao('Usar a bússola na seta'))
      await waitFor(() => expect(textoSeta()).toHaveTextContent(BUSSOLA_NEGADA))
      expect(semBotao('Usar a bússola na seta')).toBeNull()
      expect(textoSeta()).toHaveTextContent(SETA_PELA_ROTA)
      expect(textoSeta()).toHaveFocus()
      cleanup()
      sessionStorage.clear()
      gravarRota()
    }
  })

  it('os sensores só são ouvidos com o mapa aberto: fechar e desmontar tiram os ouvintes', async () => {
    instalarOrientacao()
    const ouvir = vi.spyOn(window, 'addEventListener')
    const parar = vi.spyOn(window, 'removeEventListener')
    const sensores = (espiao: typeof ouvir | typeof parar) => espiao.mock.calls.map((c) => String(c[0])).filter((t) => t.startsWith('deviceorientation'))
    const gps = instalarGps()
    const user = userEvent.setup()
    const { unmount } = renderizar()
    await user.click(await screen.findByRole('button', { name: 'Começar' }))
    await gps.enviar(PONTOS_L.A)
    expect(sensores(ouvir)).toEqual([])
    await comMapaAbertoDepoisDeComecar(user)
    expect(sensores(ouvir).sort()).toEqual(['deviceorientation', 'deviceorientationabsolute'])
    await user.click(botao('Esconder o mapa'))
    expect(sensores(parar).sort()).toEqual(['deviceorientation', 'deviceorientationabsolute'])
    // com o mapa fechado, um evento do sensor não chega a lugar nenhum
    const chamadas = motor().apontar.mock.calls.length
    orientar('deviceorientationabsolute', { absolute: true, alpha: 10, beta: 0, gamma: 0 })
    expect(motor().apontar.mock.calls.length).toBe(chamadas)
    unmount()
  })

  it('a direção não vai para o DOM, para a aba nem para a URL', async () => {
    instalarOrientacao()
    const gps = instalarGps()
    const user = userEvent.setup()
    const { container } = renderizar()
    await comMapaAberto(user, gps)
    orientar('deviceorientationabsolute', { absolute: true, alpha: 222.5, beta: 10, gamma: 0 })
    expect(ultimaSeta()).toBeCloseTo(137.5, 3)
    expect(container.innerHTML).not.toMatch(/137|222/)
    const guardado = Object.keys(sessionStorage).map((k) => `${k}=${sessionStorage.getItem(k)}`).join(';')
    expect(guardado).not.toMatch(/137|222/)
    expect(localStorage.length).toBe(0)
    expect(window.location.href).not.toMatch(/137|222/)
  })

  it('no passo a passo não há pessoa no mapa: nem seta, nem dica', async () => {
    instalarGps()
    const user = userEvent.setup()
    renderizar()
    await user.click(await screen.findByRole('button', { name: 'Seguir passo a passo, sem localização' }))
    await user.click(botao('Mostrar o mapa'))
    await waitFor(() => expect(document.querySelector('figure.mapa-nav')).toHaveAttribute('data-fase', 'pronto'))
    expect(document.querySelector('.mapa-nav__seta')).toBeNull()
    expect(motor().apontar.mock.calls.every((c) => c[0] === null)).toBe(true)
    // o resumo do passo a passo
    expect(document.querySelector('.navegar__falta')).toHaveTextContent('Do começo deste passo até o destino: 310 m. Passo 1 de 5.')
  })
})

describe('guardas do código: bússola e tela cheia', () => {
  it('lê o código de verdade', () => {
    expect(FONTE_BUSSOLA).toContain('export function useBussola')
    expect(FONTE_APOIO).toContain('export function ouvirBussola')
    expect(FONTE_TELA_CHEIA).toContain('export function useTelaCheia')
  })

  it('a bússola não é gravada, registrada nem enviada', () => {
    for (const fonte of [FONTE_BUSSOLA, FONTE_APOIO]) {
      expect(fonte).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|console\.|\bfetch\(|sendBeacon|XMLHttpRequest|WebSocket/)
      expect(fonte).not.toMatch(/dataset|setAttribute|history\.|location\./)
    }
    // a página não importa a escuta de forma estática: ela só baixa com o mapa aberto
    expect(FONTE_BUSSOLA).not.toMatch(/^import\s+(?!type\b)[^'"]*from\s+['"]\.\/apoioMapaAberto['"]/m)
  })

  it('a tela cheia é CSS dentro da página: sem Fullscreen API', () => {
    expect(FONTE_TELA_CHEIA).not.toMatch(/requestFullscreen|webkitRequestFullscreen|exitFullscreen/)
  })
})

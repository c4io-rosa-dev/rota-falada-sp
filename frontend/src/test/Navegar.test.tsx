import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { axe } from 'vitest-axe'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'
import type { RotaIn, RotaOut } from '../api/client'
import { BotaoOuvir } from '../componentes/BotaoOuvir'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { FORA_DA_AREA } from '../dados/localizacao'
import { falaDoPasso, falasDaRota } from '../dados/narrador'
import { FALAS_FIXAS } from '../dados/navegacao/falasNavegacao'
import { deslocar } from '../dados/navegacao/regua'
import { montarTrajeto, pontoAoLongo } from '../dados/navegacao/trajeto'
import { CHAVE_ABERTO, CHAVE_GIRAR, gravarPreferenciaMapa, lerPreferenciasMapa } from '../dados/preferenciaMapa'
import type { PontoLatLng } from '../dados/rotaGeo'
import { gravarSessaoRota, PERFIL_FORM_PADRAO } from '../dados/sessaoRota'
import { Navegar } from '../pages/Navegar'
import { apiFalsa, erroApi } from './apiFalsa'
import { PONTOS_L, REGUA_L, ROTA_L, ROTA_SEM_GEOMETRIA } from './fixturasNavegacao'
// o apoio do mapa aberto chega por import() junto com o motor: já carregado aqui, o import() do teste não espera a transformação
import '../componentes/mapa/apoioMapaAberto'

/* o motor do mapa (MapLibre) não roda no jsdom: um falso registra cada motor criado */
const mapa = vi.hoisted(() => ({ motores: [] as { atualizar: ReturnType<typeof vi.fn>; destruir: ReturnType<typeof vi.fn> }[] }))
vi.mock('../componentes/mapa/MotorMapaNavegacao', () => ({
  ErroMotorMapa: class extends Error {},
  criarMotor: () => {
    const motor = { atualizar: vi.fn(), apontar: vi.fn(), trocarTema: vi.fn(), destruir: vi.fn() }
    mapa.motores.push(motor)
    return Promise.resolve(motor)
  },
}))
/* as preferências de verdade, com espiões em volta (a página lê e grava por elas) */
vi.mock('../dados/preferenciaMapa', async (original) => {
  const m = await original<typeof import('../dados/preferenciaMapa')>()
  return { ...m, lerPreferenciasMapa: vi.fn(m.lerPreferenciasMapa), gravarPreferenciaMapa: vi.fn(m.gravarPreferenciaMapa) }
})

const PEDIDO: RotaIn = {
  origem: { lat: -23.5617, lng: -46.656 },
  destino: { lat: -23.5636, lng: -46.6547 },
  perfil: { inclinacao_max: 6, guia_max_m: 0.06, largura_min_m: 0.9, evitar_degraus: true, velocidade_kmh: 3 },
}
const TRAJETO = montarTrajeto(ROTA_L)!

function gravarRota(rota: RotaOut = ROTA_L) {
  gravarSessaoRota({
    versao: 1,
    origem: null,
    destino: null,
    perfil: PERFIL_FORM_PADRAO,
    rota,
    rotaDe: { pedido: PEDIDO, origem: 'Rua A', destino: 'Rua B' },
    calculadaEm: new Date().toISOString(),
  })
}

function Antes() {
  const h1 = usePaginaAcessivel('Antes')
  return (
    <>
      <h1 ref={h1} tabIndex={-1}>
        Antes
      </h1>
      <Link to="/rota/navegar">Ir para a navegação</Link>
    </>
  )
}

function Rota() {
  const h1 = usePaginaAcessivel('Planejar rota')
  return (
    <h1 ref={h1} tabIndex={-1}>
      Planejar rota
    </h1>
  )
}

function renderizar(caminho = '/rota/navegar', op: { estrito?: boolean } = {}) {
  const arvore = (
    <MemoryRouter initialEntries={[caminho]}>
      <RegiaoViva>
        <Routes>
          <Route path="/antes" element={<Antes />} />
          <Route path="/rota" element={<Rota />} />
          <Route path="/rota/navegar" element={<Navegar />} />
        </Routes>
      </RegiaoViva>
    </MemoryRouter>
  )
  return render(op.estrito ? <StrictMode>{arvore}</StrictMode> : arvore)
}

type Ordem = string[]

function instalarGps(ordem: Ordem = []) {
  const vigias: { ok: PositionCallback; erro: PositionErrorCallback }[] = []
  const watchPosition = vi.fn((ok: PositionCallback, erro: PositionErrorCallback) => {
    ordem.push('watchPosition')
    vigias.push({ ok, erro })
    return vigias.length
  })
  const clearWatch = vi.fn()
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition, clearWatch, getCurrentPosition: vi.fn() } })
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  const enviar = (p: PontoLatLng, precisao = 8) =>
    act(() => vigias.at(-1)!.ok({ coords: { latitude: p[0], longitude: p[1], accuracy: precisao }, timestamp: Date.now() } as GeolocationPosition))
  const errar = (code: number) => act(() => vigias.at(-1)!.erro({ code, message: '' } as GeolocationPositionError))
  return { watchPosition, clearWatch, enviar, errar }
}

class SentinelaFalsa extends EventTarget {
  release = vi.fn(async () => {})
  liberarPeloSistema() {
    this.dispatchEvent(new Event('release'))
  }
}

function instalarTela(ordem: Ordem = [], aceita = true) {
  const sentinelas: SentinelaFalsa[] = []
  const request = vi.fn(async () => {
    if (!aceita) throw new Error('negado')
    const s = new SentinelaFalsa()
    sentinelas.push(s)
    return s
  })
  const pedir = vi.fn(() => {
    ordem.push('wakeLock.request')
    return request()
  })
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: pedir } })
  return { pedir, sentinelas }
}

class FalaFalsa {
  text: string
  lang = ''
  voice: unknown = null
  constructor(texto: string) {
    this.text = texto
  }
}

function instalarVoz(ordem: Ordem = [], local = true) {
  const faladas: string[] = []
  const sintese = {
    speak: vi.fn((f: FalaFalsa) => {
      ordem.push('speak')
      faladas.push(f.text)
    }),
    cancel: vi.fn(() => {
      ordem.push('cancel')
    }),
    getVoices: vi.fn(() => [{ lang: 'pt-BR', name: 'Voz local', localService: local }]),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal('speechSynthesis', sintese)
  vi.stubGlobal('SpeechSynthesisUtterance', FalaFalsa)
  return { sintese, faladas }
}

const regiao = () => screen.getByRole('status')
const ao = (m: number): PontoLatLng => pontoAoLongo(TRAJETO, m)

async function comecar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Começar' }))
}

/** Anda pela rota de 10 em 10 m até o fim. */
async function andarAteOFim(enviar: (p: PontoLatLng) => Promise<void> | void, de = 0) {
  for (let m = de; m <= TRAJETO.totalM; m += 10) await enviar(ao(m))
  await enviar(PONTOS_L.E)
}

afterEach(() => {
  // desmonta antes de tirar os falsos do navigator: o desmonte para o GPS e a tela
  cleanup()
  vi.unstubAllGlobals()
  for (const chave of ['geolocation', 'wakeLock'] as const) delete (navigator as unknown as Record<string, unknown>)[chave]
  delete (window as unknown as Record<string, unknown>).isSecureContext
})

describe('página /rota/navegar: entrada', () => {
  it('foco no h1 ao chegar e título sem nome de rua', async () => {
    gravarRota()
    instalarGps()
    const user = userEvent.setup()
    renderizar('/antes')
    await user.click(screen.getByRole('link', { name: 'Ir para a navegação' }))
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Navegação guiada' })
    await waitFor(() => expect(h1).toHaveFocus())
    expect(document.title).toBe('Navegação guiada · Rota Falada SP')
  })

  it('sem rota na sessão: mensagem e link para calcular', async () => {
    renderizar()
    expect(await screen.findByText('Nenhuma rota para navegar. Calcule uma rota primeiro.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Calcular uma rota' })).toHaveAttribute('href', '/rota')
    expect(screen.queryByRole('button', { name: 'Começar' })).toBeNull()
  })

  it('rota sem desenho: indisponível, com passo a passo', async () => {
    gravarRota(ROTA_SEM_GEOMETRIA)
    instalarGps()
    renderizar()
    expect(
      await screen.findByText(
        'Esta rota não tem o desenho do caminho, então não dá para acompanhar pela localização. Você pode seguir passo a passo.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Seguir passo a passo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Começar' })).toBeNull()
  })

  it('sem geolocalização (ou fora de HTTPS): mensagem e passo a passo', async () => {
    gravarRota()
    renderizar()
    expect(await screen.findByText('Este navegador não informa a sua posição. Você pode seguir passo a passo.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Seguir passo a passo' })).toBeInTheDocument()
  })
})

describe('preparo', () => {
  it('resumo, avisos "Antes de sair", voz desligada por padrão e Começar', async () => {
    gravarRota()
    instalarGps()
    instalarVoz()
    renderizar()
    expect(await screen.findByText(/^308 m em 5 passos, cerca de 6 minutos a pé, /)).toBeInTheDocument()
    const lista = screen.getByRole('list', { name: 'Antes de sair' })
    expect(within(lista).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'A posição pode errar alguns metros. Pare para olhar a tela antes de virar.',
      'O app não vê carros, semáforos nem obras.',
      'Com a tela apagada ou o celular bloqueado, as instruções param.',
      'Sua posição, a direção e o trajeto ficam só neste aparelho e não são guardados. A posição atual só sai do aparelho quando você toca em Recalcular: vai arredondada (cerca de 11 m) ao nosso servidor e ao serviço de rotas que ele usa, e a nova rota fica guardada sem identificação por até 6 horas.',
      'Se você abrir o mapa, o aparelho pede ao site o desenho da região em volta. O site não registra esses pedidos, mas eles passam pela Cloudflare, que hospeda o site.',
      'Rotas recalculadas não ficam salvas neste aparelho: ao recarregar a página, volta a rota original.',
    ])
    const voz = screen.getByRole('button', { name: 'Voz do app' })
    expect(voz).toHaveAttribute('aria-pressed', 'false')
    expect(voz).toHaveAccessibleDescription('Use se não tiver leitor de tela ligado, para não ouvir tudo duas vezes.')
    await userEvent.click(voz)
    expect(screen.getByRole('button', { name: 'Voz do app' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Começar' })).toHaveClass('placa--acao')
    expect(screen.getByRole('button', { name: 'Seguir passo a passo, sem localização' })).toBeInTheDocument()
  })

  it('sem voz pt-BR local, a alternância some e uma frase explica', async () => {
    gravarRota()
    instalarGps()
    instalarVoz([], false)
    renderizar()
    expect(await screen.findByText('A voz do app não está disponível neste aparelho. Use o leitor de tela ou leia a tela.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Voz do app' })).toBeNull()
  })
})

describe('começar e acompanhar', () => {
  it('Começar chama, sem esperar, falar, wakeLock.request e watchPosition, nesta ordem', async () => {
    gravarRota()
    const ordem: Ordem = []
    instalarGps(ordem)
    instalarTela(ordem)
    const { faladas } = instalarVoz(ordem)
    const user = userEvent.setup()
    renderizar()
    await user.click(await screen.findByRole('button', { name: 'Voz do app' }))
    await comecar(user)
    // "Navegação iniciada." é urgente: cancel antes do speak, tudo antes do GPS
    expect(ordem).toEqual(['cancel', 'speak', 'wakeLock.request', 'watchPosition'])
    expect(faladas).toEqual(['Navegação iniciada.'])
    const h2 = screen.getByRole('heading', { level: 2, name: 'Procurando sua posição' })
    await waitFor(() => expect(h2).toHaveFocus())
  })

  it('voz desligada: Começar não fala, e a primeira leitura vai para a região', async () => {
    gravarRota()
    const gps = instalarGps()
    instalarTela()
    const { sintese } = instalarVoz()
    const user = userEvent.setup()
    renderizar()
    await comecar(user)
    await gps.enviar(PONTOS_L.A)
    expect(sintese.speak).not.toHaveBeenCalled()
    await waitFor(() => expect(regiao()).toHaveTextContent(/^Passo 1 de 5\. Siga para leste em direção a Alameda Jaú\. 120 metros\./))
    const painel = screen.getByRole('region', { name: 'Passo 1 de 5' })
    expect(within(painel).getByText('Vire à direita')).toBeInTheDocument()
    expect(within(painel).getByText('Rua Augusta')).toBeInTheDocument()
    expect(within(painel).getByText('em 120 m')).toBeInTheDocument()
    expect(within(painel).getByText('Na rota')).toBeInTheDocument()
  })

  it('o painel não é região viva e mostra "Neste trecho" com pictograma e texto', async () => {
    gravarRota()
    const gps = instalarGps()
    instalarTela()
    const user = userEvent.setup()
    renderizar()
    await comecar(user)
    await gps.enviar(PONTOS_L.A)
    for (let m = 10; m <= 230; m += 10) await gps.enviar(ao(m))
    const painel = screen.getByRole('region', { name: 'Passo 5 de 5' })
    expect(painel).not.toHaveAttribute('aria-live')
    expect(within(painel).getByText('Siga até o destino')).toBeInTheDocument()
    const trecho = within(painel).getByRole('list', { name: 'Neste trecho:' })
    const itens = within(trecho).getAllByRole('listitem')
    expect(itens.map((li) => li.textContent)).toEqual(['Degrau', 'Guia sem rebaixamento'])
    expect(itens[0].querySelector('[data-pictograma="degrau"]')).not.toBeNull()
    expect(itens[1].querySelector('[data-pictograma="alerta"]')).not.toBeNull()
  })

  it('fora da rota, o painel diz isso em destaque e o que fazer, sem a manobra antiga; ao voltar, a manobra volta', async () => {
    gravarRota()
    const gps = instalarGps()
    instalarTela()
    const user = userEvent.setup()
    renderizar()
    await comecar(user)
    await gps.enviar(PONTOS_L.A)
    await gps.enviar(ao(20))
    const painel = () => screen.getByRole('region', { name: /^Passo \d de 5$/ })
    expect(within(painel()).getByText('Vire à direita')).toBeInTheDocument()

    const fora = deslocar(REGUA_L, ao(30), 40, 0)
    for (let i = 0; i < 3; i++) await gps.enviar(deslocar(REGUA_L, fora, 0, i * 5))
    await waitFor(() => expect(regiao()).toHaveTextContent(/Você saiu da rota/))
    // o lugar da manobra (a letra maior do painel) passa a dizer o estado; a manobra e a distância até ela somem
    expect(painel().querySelector('.painel__acao')).toHaveTextContent(/^Fora da rota$/)
    expect(within(painel()).getByText('Volte para a rota ou toque em Recalcular.')).toBeInTheDocument()
    expect(within(painel()).getByText('a cerca de 40 m da rota')).toBeInTheDocument()
    expect(within(painel()).queryByText('Vire à direita')).toBeNull()
    expect(within(painel()).queryByText('Rua Augusta')).toBeNull()
    expect(within(painel()).queryByText(/^em /)).toBeNull()
    // o estado aparece uma vez só, e a linha de baixo não diz "Na rota"
    expect(within(painel()).getAllByText('Fora da rota')).toHaveLength(1)
    expect(within(painel()).queryByText('Na rota')).toBeNull()

    await gps.enviar(ao(40))
    await waitFor(() => expect(regiao()).toHaveTextContent(/Você voltou para a rota/))
    expect(within(painel()).getByText('Vire à direita')).toBeInTheDocument()
    expect(within(painel()).getByText('em 80 m')).toBeInTheDocument()
    expect(within(painel()).getByText('Na rota')).toBeInTheDocument()
    expect(within(painel()).queryByText('Fora da rota')).toBeNull()
    expect(within(painel()).queryByText('Volte para a rota ou toque em Recalcular.')).toBeNull()
  })

  it('com sinal fraco, a distância diz "cerca de"', async () => {
    gravarRota()
    const gps = instalarGps()
    instalarTela()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderizar()
      await comecar(user)
      await gps.enviar(PONTOS_L.A)
      await gps.enviar(ao(10), 45)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_500)
      })
      await gps.enviar(ao(10), 45)
      expect(screen.getByText(/^em cerca de \d+ m$/)).toBeInTheDocument()
      expect(screen.getByText('Sinal fraco, a posição pode errar')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('permissão negada: foco na mensagem e nenhum anúncio', async () => {
    gravarRota()
    const gps = instalarGps()
    instalarTela()
    const user = userEvent.setup()
    renderizar()
    await comecar(user)
    await gps.errar(1)
    const msg = screen.getByText(
      'O navegador não autorizou a localização. Sem ela não dá para acompanhar o caminho. Enquanto isso, você pode seguir passo a passo.',
    )
    await waitFor(() => expect(msg).toHaveFocus())
    expect(msg).toHaveAttribute('tabindex', '-1')
    await new Promise((r) => setTimeout(r, 150))
    expect(regiao()).toHaveTextContent('')
    expect(gps.clearWatch).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Seguir passo a passo' })).toBeInTheDocument()
    // como liberar, no iPhone e no Android, e o que fazer depois
    const liberar = screen.getByRole('list', { name: 'Para liberar a localização:' })
    const itens = within(liberar).getAllByRole('listitem').map((li) => li.textContent)
    expect(itens[0]).toMatch(/^No iPhone: /)
    expect(itens[0]).toContain('Sites do Safari')
    expect(itens[1]).toMatch(/^No Android, no Chrome: /)
    expect(itens[2]).toBe('Depois de liberar, toque em Tentar de novo. Se não funcionar, recarregue a página.')
  })

  it('permissão negada: "Tentar de novo" pede a localização outra vez, no gesto', async () => {
    gravarRota()
    const gps = instalarGps()
    instalarTela()
    const user = userEvent.setup()
    renderizar()
    await comecar(user)
    await gps.errar(1)
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(gps.watchPosition).toHaveBeenCalledTimes(2)
    const h2 = screen.getByRole('heading', { level: 2, name: 'Procurando sua posição' })
    await waitFor(() => expect(h2).toHaveFocus())
    await gps.enviar(PONTOS_L.A)
    await waitFor(() => expect(regiao()).toHaveTextContent(/^Passo 1 de 5\./))
  })

  it('chegada: foco no h2, sem anúncio, GPS parado e link de volta', async () => {
    gravarRota()
    const gps = instalarGps()
    instalarTela()
    const user = userEvent.setup()
    renderizar()
    await comecar(user)
    await andarAteOFim(gps.enviar)
    const h2 = screen.getByRole('heading', { level: 2, name: 'Você chegou ao destino' })
    await waitFor(() => expect(h2).toHaveFocus())
    expect(screen.getByText('A posição pode errar alguns metros; confira pelo entorno.')).toBeInTheDocument()
    // o leitor de tela lê a ressalva junto com o título focado (a região não anuncia)
    expect(h2).toHaveAccessibleDescription('A posição pode errar alguns metros; confira pelo entorno.')
    expect(screen.getByRole('link', { name: 'Voltar para a rota' })).toHaveAttribute('href', '/rota')
    expect(gps.clearWatch).toHaveBeenCalledTimes(1)
    await new Promise((r) => setTimeout(r, 150))
    expect(regiao()).not.toHaveTextContent('Você chegou ao destino')
  })
})

describe('controles', () => {
  async function navegando() {
    gravarRota()
    const gps = instalarGps()
    const tela = instalarTela()
    const user = userEvent.setup()
    const r = renderizar()
    await comecar(user)
    await gps.enviar(PONTOS_L.A)
    return { gps, tela, user, ...r }
  }

  it('ordem fixa: Repetir, Recalcular, Pausar e Encerrar, num grupo', async () => {
    await navegando()
    const grupo = screen.getByRole('group', { name: 'Controles da navegação' })
    expect(within(grupo).getAllByRole('button').map((b) => b.textContent)).toEqual(['Repetir', 'Recalcular', 'Pausar', 'Encerrar'])
  })

  it('Repetir fala a situação', async () => {
    const { user } = await navegando()
    await user.click(screen.getByRole('button', { name: 'Repetir' }))
    await waitFor(() =>
      expect(regiao()).toHaveTextContent('Passo 1 de 5, Alameda Jaú. Faltam 120 metros. Depois, vire à direita em direção a Rua Augusta.'),
    )
  })

  it('Encerrar pergunta na linha; "Continuar navegando" devolve o foco; "Sim, encerrar" vai para /rota', async () => {
    const { user, gps } = await navegando()
    const encerrar = screen.getByRole('button', { name: 'Encerrar' })
    await user.click(encerrar)
    const pergunta = screen.getByText('Encerrar a navegação?')
    expect(pergunta).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Continuar navegando' }))
    expect(screen.queryByText('Encerrar a navegação?')).toBeNull()
    expect(screen.getByRole('button', { name: 'Encerrar' })).toHaveFocus()
    expect(gps.clearWatch).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Encerrar' }))
    await user.click(screen.getByRole('button', { name: 'Sim, encerrar' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Planejar rota' })).toBeInTheDocument()
    expect(gps.clearWatch).toHaveBeenCalledTimes(1)
    // nada gravado: a sessão continua com a rota original e sem passo de retorno
    expect(JSON.parse(sessionStorage.getItem('rf-busca')!).rota.passos).toHaveLength(5)
    expect(sessionStorage.getItem('rf-voltar-passo')).toBeNull()
  })

  it('Pausar: aria-pressed, GPS e tela soltos, e retomar religa tudo', async () => {
    const { user, gps, tela } = await navegando()
    const pausar = screen.getByRole('button', { name: 'Pausar' })
    expect(pausar).toHaveAttribute('aria-pressed', 'false')
    await user.click(pausar)
    expect(screen.getByRole('button', { name: 'Pausar' })).toHaveAttribute('aria-pressed', 'true')
    expect(gps.clearWatch).toHaveBeenCalledTimes(1)
    expect(tela.sentinelas[0].release).toHaveBeenCalled()
    await waitFor(() => expect(regiao()).toHaveTextContent('Navegação pausada. A localização está desligada.'))
    expect(screen.getByText('Pausada')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pausar' }))
    expect(screen.getByRole('button', { name: 'Pausar' })).toHaveAttribute('aria-pressed', 'false')
    expect(gps.watchPosition).toHaveBeenCalledTimes(2)
    expect(tela.pedir).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(regiao()).toHaveTextContent('Navegação retomada.'))
  })

  it('ao retomar com leitura imediata, "Navegação retomada." e a situação saem juntas, sem uma apagar a outra', async () => {
    const { user, gps } = await navegando()
    await user.click(screen.getByRole('button', { name: 'Pausar' }))
    await user.click(screen.getByRole('button', { name: 'Pausar' }))
    await gps.enviar(PONTOS_L.A)
    await waitFor(() => expect(regiao()).toHaveTextContent('Navegação retomada. Passo 1 de 5, Alameda Jaú. Faltam 120 metros.'))
  })

  it('Recalcular vira ação só fora da rota, sem mudar de lugar, e manda só a origem em 4 casas', async () => {
    const { user, gps } = await navegando()
    const api = apiFalsa({ 'POST /api/rotas': Response.json(ROTA_L) })
    const grupo = screen.getByRole('group', { name: 'Controles da navegação' })
    expect(screen.getByRole('button', { name: 'Recalcular' })).not.toHaveClass('placa--acao')
    const longe = deslocar(REGUA_L, PONTOS_L.A, 40.12345, 10)
    for (let i = 0; i < 3; i++) await gps.enviar(deslocar(REGUA_L, longe, i, 0))
    await waitFor(() => expect(regiao()).toHaveTextContent(/Você saiu da rota/))
    const recalcular = screen.getByRole('button', { name: 'Recalcular' })
    expect(recalcular).toHaveClass('placa--acao')
    expect(within(grupo).getAllByRole('button')[1]).toBe(recalcular)
    expect(screen.getByText('Fora da rota')).toBeInTheDocument()
    expect(api.falso).not.toHaveBeenCalled()

    await user.click(recalcular)
    await waitFor(() => expect(api.de('POST /api/rotas')).toHaveLength(1))
    const corpo = JSON.parse(api.de('POST /api/rotas')[0].init.body as string) as RotaIn
    expect(corpo.destino).toEqual(PEDIDO.destino)
    expect(corpo.perfil).toEqual(PEDIDO.perfil)
    for (const v of [corpo.origem.lat, corpo.origem.lng]) expect(String(v).split('.')[1].length).toBeLessThanOrEqual(4)
    await waitFor(() => expect(regiao()).toHaveTextContent(/Nova rota calculada: 310 metros, em 5 passos\./))
    // a rota nova vive só na memória da página
    expect(JSON.parse(sessionStorage.getItem('rf-busca')!).rotaDe.pedido.origem).toEqual(PEDIDO.origem)
  })

  it('Recalcular com aria-disabled tem guarda no clique', async () => {
    const { user, gps } = await navegando()
    let liberar: (r: Response) => void = () => {}
    const api = apiFalsa({ 'POST /api/rotas': () => new Promise<Response>((f) => (liberar = f)) })
    await gps.enviar(ao(5))
    await user.click(screen.getByRole('button', { name: 'Recalcular' }))
    await waitFor(() => expect(api.de('POST /api/rotas')).toHaveLength(1))
    const recalcular = screen.getByRole('button', { name: 'Recalcular' })
    expect(recalcular).toHaveAttribute('aria-disabled', 'true')
    expect(recalcular).not.toBeDisabled()
    await user.click(recalcular)
    expect(api.de('POST /api/rotas')).toHaveLength(1)
    await act(async () => liberar(Response.json(ROTA_L)))
  })

  it('Detalhes do trecho abre a ficha do passo atual com aria-expanded e deixa o foco no botão', async () => {
    const { user } = await navegando()
    const botao = screen.getByRole('button', { name: 'Detalhes do trecho' })
    expect(botao).toHaveAttribute('aria-expanded', 'false')
    await user.click(botao)
    expect(botao).toHaveAttribute('aria-expanded', 'true')
    expect(botao).toHaveFocus()
    const ficha = document.getElementById(botao.getAttribute('aria-controls')!)!
    expect(ficha).toHaveTextContent('Largura')
    expect(ficha).toHaveTextContent('1,5 m')
    expect(ficha).toHaveTextContent('Inclinação')
    expect(ficha).toHaveTextContent('3% (GeoSampa)')
    expect(ficha).toHaveTextContent('Guia')
    expect(ficha).toHaveTextContent('rebaixada')
    expect(ficha).toHaveTextContent('Degrau')
    expect(ficha).toHaveTextContent('Fonte')
    expect(ficha).toHaveTextContent('OpenStreetMap')
    expect(ficha).toHaveTextContent('12/10/2026')
    await user.click(botao)
    expect(botao).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('voz, tela e visibilidade', () => {
  it('com a voz do app ligada, instruções vão para a voz e só estados vão para a região', async () => {
    gravarRota()
    const gps = instalarGps()
    instalarTela()
    const { faladas, sintese } = instalarVoz()
    const user = userEvent.setup()
    renderizar()
    await user.click(await screen.findByRole('button', { name: 'Voz do app' }))
    await comecar(user)
    await gps.enviar(PONTOS_L.A)
    expect(faladas.at(-1)).toMatch(/^Passo 1 de 5\./)
    await user.click(screen.getByRole('button', { name: 'Repetir' }))
    expect(faladas.at(-1)).toMatch(/^Passo 1 de 5, Alameda Jaú\. Faltam/)
    // urgente: cancela antes de falar
    expect(sintese.cancel).toHaveBeenCalled()
    await new Promise((r) => setTimeout(r, 150))
    expect(regiao()).not.toHaveTextContent('Passo 1 de 5')
    await user.click(screen.getByRole('button', { name: 'Pausar' }))
    await waitFor(() => expect(regiao()).toHaveTextContent('Navegação pausada. A localização está desligada.'))
    expect(faladas.some((t) => t.startsWith('Navegação pausada'))).toBe(false)
  })

  it('tela ligada recusada: aviso na região e na linha de estado', async () => {
    gravarRota()
    instalarGps()
    instalarTela([], false)
    const user = userEvent.setup()
    renderizar()
    await comecar(user)
    await waitFor(() => expect(regiao()).toHaveTextContent('A tela pode apagar sozinha. Com a tela apagada, as instruções param.'))
    expect(screen.getByText('A tela pode apagar')).toBeInTheDocument()
  })

  it('tela liberada pelo sistema também avisa', async () => {
    gravarRota()
    const gps = instalarGps()
    const tela = instalarTela()
    const user = userEvent.setup()
    renderizar()
    await comecar(user)
    await gps.enviar(PONTOS_L.A)
    await waitFor(() => expect(tela.sentinelas).toHaveLength(1))
    act(() => tela.sentinelas[0].liberarPeloSistema())
    await waitFor(() => expect(regiao()).toHaveTextContent('A tela pode apagar sozinha.'))
  })

  it('pedido de tela ligada que falha com a aba já oculta não anuncia nada', async () => {
    gravarRota()
    instalarGps()
    let recusar: (e: Error) => void = () => {}
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: vi.fn(() => new Promise((_ok, erro) => (recusar = erro))) },
    })
    const user = userEvent.setup()
    renderizar()
    await comecar(user)
    const visibilidade = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => recusar(new Error('NotAllowedError')))
    await new Promise((r) => setTimeout(r, 150))
    expect(regiao()).not.toHaveTextContent('A tela pode apagar')
    expect(screen.queryByText('A tela pode apagar')).toBeNull()
    visibilidade.mockRestore()
  })

  it('aba oculta pausa sem falar; ao voltar, religa GPS e tela e diz "Navegação retomada."', async () => {
    gravarRota()
    const gps = instalarGps()
    const tela = instalarTela()
    const user = userEvent.setup()
    renderizar()
    await comecar(user)
    await gps.enviar(PONTOS_L.A)
    const visibilidade = vi.spyOn(document, 'visibilityState', 'get')
    visibilidade.mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(gps.clearWatch).toHaveBeenCalledTimes(1)
    visibilidade.mockReturnValue('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(gps.watchPosition).toHaveBeenCalledTimes(2)
    expect(tela.pedir).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(regiao()).toHaveTextContent('Navegação retomada.'))
    visibilidade.mockRestore()
  })

  it('StrictMode: um único watchPosition ativo e clearWatch no desmonte', async () => {
    gravarRota()
    const gps = instalarGps()
    instalarTela()
    const user = userEvent.setup()
    const { unmount } = renderizar('/rota/navegar', { estrito: true })
    await comecar(user)
    expect(gps.watchPosition).toHaveBeenCalledTimes(1)
    expect(gps.clearWatch).not.toHaveBeenCalled()
    unmount()
    expect(gps.clearWatch).toHaveBeenCalledTimes(1)
  })
})

describe('passo a passo', () => {
  it('Anterior, Próximo, Repetir e Encerrar falam o passo inteiro; o último diz a chegada', async () => {
    gravarRota()
    instalarGps()
    const user = userEvent.setup()
    renderizar()
    await user.click(await screen.findByRole('button', { name: 'Seguir passo a passo, sem localização' }))
    const h2 = screen.getByRole('heading', { level: 2, name: 'Passo 1 de 5' })
    await waitFor(() => expect(h2).toHaveFocus())
    // o foco cai num título que só diz "Passo 1 de 5": a instrução inteira vai para a região
    await waitFor(() => expect(regiao()).toHaveTextContent(falaDoPasso(ROTA_L.passos[0], 5, 6)))
    const grupo = screen.getByRole('group', { name: 'Controles da navegação' })
    expect(within(grupo).getAllByRole('button').map((b) => b.textContent)).toEqual(['Passo anterior', 'Próximo passo', 'Repetir', 'Encerrar'])
    const anterior = screen.getByRole('button', { name: 'Passo anterior' })
    expect(anterior).toHaveAttribute('aria-disabled', 'true')
    await user.click(anterior)
    expect(screen.getByRole('heading', { level: 2, name: 'Passo 1 de 5' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Próximo passo' }))
    await waitFor(() => expect(regiao()).toHaveTextContent(falaDoPasso(ROTA_L.passos[1], 5, 6)))
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: 'Próximo passo' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Passo 5 de 5' })).toBeInTheDocument()
    await waitFor(() => expect(regiao()).toHaveTextContent(/Você chegou ao destino\.$/))
    expect(screen.getByRole('button', { name: 'Próximo passo' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('depois da permissão negada, o passo a passo continua disponível', async () => {
    gravarRota()
    const gps = instalarGps()
    instalarTela()
    const user = userEvent.setup()
    renderizar()
    await comecar(user)
    await gps.errar(1)
    await user.click(screen.getByRole('button', { name: 'Seguir passo a passo' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Passo 1 de 5' })).toBeInTheDocument()
  })
})

describe('acessibilidade automática', () => {
  it('vitest-axe nos 8 estados e uma única região viva', async () => {
    gravarRota()
    const gps = instalarGps()
    instalarTela()
    instalarVoz()
    const user = userEvent.setup()
    const { container, unmount } = renderizar()
    const conferir = async (estado: string) => {
      expect(await axe(container), estado).toHaveNoViolations()
      expect(document.querySelectorAll('[aria-live],[role=status],[role=alert]'), estado).toHaveLength(1)
    }
    await screen.findByRole('button', { name: 'Começar' })
    await conferir('preparo')
    await comecar(user)
    await conferir('procurando')
    await gps.enviar(PONTOS_L.A)
    await conferir('navegando')
    const longe = deslocar(REGUA_L, PONTOS_L.A, 60, 0)
    for (let i = 0; i < 3; i++) await gps.enviar(deslocar(REGUA_L, longe, i, 0))
    await screen.findByText('Fora da rota')
    await conferir('fora da rota')
    await user.click(screen.getByRole('button', { name: 'Pausar' }))
    await conferir('pausada')
    await user.click(screen.getByRole('button', { name: 'Pausar' }))
    await andarAteOFim(gps.enviar)
    await screen.findByRole('heading', { level: 2, name: 'Você chegou ao destino' })
    await conferir('chegou')
    unmount()

    const segundo = renderizar()
    await user.click(await screen.findByRole('button', { name: 'Seguir passo a passo, sem localização' }))
    expect(await axe(segundo.container), 'passo a passo').toHaveNoViolations()
    segundo.unmount()

    const terceiro = renderizar()
    await comecar(user)
    await gps.errar(1)
    expect(await axe(terceiro.container), 'sem permissão').toHaveNoViolations()
  })
})

/** Começa a navegar com uma leitura em A; devolve o GPS falso e o usuário. */
async function navegandoEmA(op: { voz?: boolean } = {}) {
  gravarRota()
  const gps = instalarGps()
  const tela = instalarTela()
  const ordem: Ordem = []
  const voz = instalarVoz(ordem)
  const user = userEvent.setup()
  const r = renderizar()
  if (op.voz) await user.click(await screen.findByRole('button', { name: 'Voz do app' }))
  await comecar(user)
  await gps.enviar(PONTOS_L.A)
  return { gps, tela, user, ordem, ...voz, ...r }
}

describe('passo a passo: a tela e a voz dizem a mesma distância', () => {
  it('o passo degenerado (0 m) mostra "1 m" e a voz diz "1 metro"; os outros, o metro arredondado da voz', async () => {
    gravarRota()
    instalarGps()
    const user = userEvent.setup()
    renderizar()
    await user.click(await screen.findByRole('button', { name: 'Seguir passo a passo, sem localização' }))
    expect(within(screen.getByRole('region', { name: 'Passo 1 de 5' })).getByText('120 m')).toBeInTheDocument()
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: 'Próximo passo' }))
    const painel = screen.getByRole('region', { name: 'Passo 4 de 5' })
    expect(within(painel).getByText('1 m')).toBeInTheDocument()
    expect(within(painel).queryByText('0 m')).toBeNull()
    const fala = falaDoPasso(ROTA_L.passos[3], 5, 6)
    expect(fala).toContain('1 metro')
    await waitFor(() => expect(regiao()).toHaveTextContent(fala))
  })
})

describe('Recalcular indisponível diz o motivo', () => {
  it('pausada: "Disponível depois de retomar."; calculando: "Calculando nova rota."', async () => {
    const { user, gps } = await navegandoEmA()
    await user.click(screen.getByRole('button', { name: 'Pausar' }))
    const pausado = screen.getByRole('button', { name: 'Recalcular' })
    expect(pausado).toHaveAttribute('aria-disabled', 'true')
    expect(pausado).toHaveAccessibleDescription('Disponível depois de retomar.')
    await user.click(screen.getByRole('button', { name: 'Pausar' }))
    expect(screen.getByRole('button', { name: 'Recalcular' })).not.toHaveAttribute('aria-disabled')
    expect(screen.getByRole('button', { name: 'Recalcular' })).not.toHaveAccessibleDescription()

    let liberar: (r: Response) => void = () => {}
    apiFalsa({ 'POST /api/rotas': () => new Promise<Response>((f) => (liberar = f)) })
    await gps.enviar(ao(5))
    await user.click(screen.getByRole('button', { name: 'Recalcular' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Recalcular' })).toHaveAccessibleDescription('Calculando nova rota.'))
    await act(async () => liberar(Response.json(ROTA_L)))
  })

  it('procurando, antes de qualquer leitura: "Ainda procurando sua posição."', async () => {
    gravarRota()
    instalarGps()
    instalarTela()
    const user = userEvent.setup()
    renderizar()
    await comecar(user)
    await user.click(screen.getByRole('button', { name: 'Recalcular' }))
    await waitFor(() => expect(regiao()).toHaveTextContent('Ainda procurando sua posição. Espere para pedir uma nova rota.'))
  })
})

describe('sem desenho ou sem localização: os avisos de rua continuam', () => {
  it.each([
    ['rota sem desenho', ROTA_SEM_GEOMETRIA, true],
    ['navegador sem localização', ROTA_L, false],
  ] as const)('%s: a lista "Antes de sair" com os avisos que valem sem GPS', async (_nome, rota, comGps) => {
    gravarRota(rota)
    if (comGps) instalarGps()
    const { container } = renderizar()
    const lista = await screen.findByRole('list', { name: 'Antes de sair' })
    expect(within(lista).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'O app não vê carros, semáforos nem obras.',
      'Pare para olhar a tela antes de virar.',
    ])
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('procurando sem conseguir a posição', () => {
  afterEach(() => vi.useRealTimers())

  it('depois de 20 s sem leitura, avisa uma vez, mostra o aviso no painel e oferece o passo a passo', async () => {
    gravarRota()
    instalarGps()
    instalarTela()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { container } = renderizar()
    await comecar(user)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_500)
    })
    const aviso =
      'Ainda não conseguimos a sua posição. Confira se a localização do aparelho está ligada. Você também pode seguir passo a passo.'
    await waitFor(() => expect(regiao()).toHaveTextContent(aviso))
    const painel = screen.getByRole('region', { name: 'Procurando sua posição' })
    expect(within(painel).getByText(aviso)).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
    await user.click(screen.getByRole('button', { name: 'Seguir passo a passo' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Passo 1 de 5' })).toBeInTheDocument()
  })

  it('com localização aproximada, o painel diz como ativar a localização exata', async () => {
    gravarRota()
    const gps = instalarGps()
    instalarTela()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderizar()
    await comecar(user)
    await gps.enviar(PONTOS_L.A, 1500)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_500)
    })
    const painel = screen.getByRole('region', { name: 'Procurando sua posição' })
    expect(within(painel).getByText(/^A localização deste aparelho está aproximada/)).toHaveTextContent('Localização Exata')
  })
})

describe('a voz do app é calada ao pausar, ocultar, encerrar e desmontar (spec 8)', () => {
  it('chegada com a voz ligada: a frase sai inteira, sem nenhum cancel depois dela', async () => {
    const { gps, faladas, ordem } = await navegandoEmA({ voz: true })
    await andarAteOFim(gps.enviar)
    await screen.findByRole('heading', { level: 2, name: 'Você chegou ao destino' })
    expect(faladas.at(-1)).toBe(FALAS_FIXAS.chegada.texto)
    expect(ordem.lastIndexOf('cancel')).toBeLessThan(ordem.lastIndexOf('speak'))
  })

  it('Pausar cala a voz uma vez', async () => {
    const { user, sintese } = await navegandoEmA({ voz: true })
    sintese.cancel.mockClear()
    await user.click(screen.getByRole('button', { name: 'Pausar' }))
    expect(sintese.cancel).toHaveBeenCalledTimes(1)
  })

  it('aba oculta cala a voz uma vez', async () => {
    const { sintese } = await navegandoEmA({ voz: true })
    sintese.cancel.mockClear()
    const visibilidade = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(sintese.cancel).toHaveBeenCalledTimes(1)
    visibilidade.mockRestore()
  })

  it('"Sim, encerrar" cala a voz uma vez, sem repetir no desmonte da página', async () => {
    const { user, sintese } = await navegandoEmA({ voz: true })
    await user.click(screen.getByRole('button', { name: 'Encerrar' }))
    sintese.cancel.mockClear()
    await user.click(screen.getByRole('button', { name: 'Sim, encerrar' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Planejar rota' })).toBeInTheDocument()
    expect(sintese.cancel).toHaveBeenCalledTimes(1)
  })

  it('desmontar cala a voz uma vez', async () => {
    const { sintese, unmount } = await navegandoEmA({ voz: true })
    sintese.cancel.mockClear()
    unmount()
    expect(sintese.cancel).toHaveBeenCalledTimes(1)
  })
})

describe('adaptador: recálculo que falha, vozes que chegam depois e uma leitura por vez', () => {
  it.each([
    [422, FORA_DA_AREA, 'Daqui não conseguimos calcular rota: este ponto está fora da área atendida. A rota anterior continua valendo.'],
    [404, 'Nenhuma rota acessível encontrada entre esses pontos.', 'Não encontramos rota acessível a partir daqui. A rota anterior continua valendo.'],
    [503, 'Serviço de rotas indisponível.', 'Não foi possível calcular uma nova rota agora. A rota anterior continua valendo.'],
  ])('HTTP %i no Recalcular: diz o motivo e a rota anterior continua', async (status, detalhe, frase) => {
    const { user } = await navegandoEmA()
    const api = apiFalsa({ 'POST /api/rotas': erroApi(status, detalhe) })
    await user.click(screen.getByRole('button', { name: 'Recalcular' }))
    await waitFor(() => expect(regiao()).toHaveTextContent(frase))
    expect(api.de('POST /api/rotas')).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Passo 1 de 5' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recalcular' })).not.toHaveAttribute('aria-disabled')
  })

  it('vozes que chegam depois (Chrome): "Voz do app" aparece no voiceschanged', async () => {
    gravarRota()
    instalarGps()
    let vozes: unknown[] = []
    const ouvintes = new Set<() => void>()
    vi.stubGlobal('speechSynthesis', {
      speak: vi.fn(),
      cancel: vi.fn(),
      getVoices: () => vozes,
      addEventListener: (_tipo: string, cb: () => void) => ouvintes.add(cb),
      removeEventListener: (_tipo: string, cb: () => void) => ouvintes.delete(cb),
    })
    vi.stubGlobal('SpeechSynthesisUtterance', FalaFalsa)
    renderizar()
    expect(await screen.findByText('A voz do app não está disponível neste aparelho. Use o leitor de tela ou leia a tela.')).toBeInTheDocument()
    vozes = [{ lang: 'pt-BR', name: 'Voz local', localService: true }]
    act(() => ouvintes.forEach((cb) => cb()))
    expect(screen.getByRole('button', { name: 'Voz do app' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('Começar para o "Ouvir a rota" que estava tocando (uma leitura por vez)', async () => {
    gravarRota()
    instalarGps()
    instalarTela()
    instalarVoz()
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/rota/navegar']}>
        <RegiaoViva>
          <Routes>
            <Route
              path="/rota/navegar"
              element={
                <>
                  <BotaoOuvir falas={falasDaRota(ROTA_L, 6)} rotulo="Ouvir a rota" />
                  <Navegar />
                </>
              }
            />
          </Routes>
        </RegiaoViva>
      </MemoryRouter>,
    )
    await user.click(await screen.findByRole('button', { name: 'Ouvir a rota' }))
    expect(screen.getByRole('button', { name: 'Ouvir a rota' })).toHaveAttribute('aria-pressed', 'true')
    await comecar(user)
    expect(screen.getByRole('button', { name: 'Ouvir a rota' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('simulação: só com a variável de build e um cenário válido', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('com a variável desligada, ?simular=reto segue o fluxo normal, com o GPS de verdade', async () => {
    vi.stubEnv('VITE_PERMITIR_SIMULACAO', '')
    gravarRota()
    const gps = instalarGps()
    instalarTela()
    const user = userEvent.setup()
    renderizar('/rota/navegar?simular=reto')
    await comecar(user)
    expect(screen.queryByText(/Modo demonstração/)).toBeNull()
    expect(gps.watchPosition).toHaveBeenCalledTimes(1)
  })

  it('com um cenário que não existe, também segue o fluxo normal', async () => {
    gravarRota()
    const gps = instalarGps()
    instalarTela()
    const user = userEvent.setup()
    renderizar('/rota/navegar?simular=inexistente')
    await comecar(user)
    expect(screen.queryByText(/Modo demonstração/)).toBeNull()
    expect(gps.watchPosition).toHaveBeenCalledTimes(1)
  })
})

describe('cada cenário simulado na página (?simular=, relógio falso, voz do app ligada)', () => {
  afterEach(() => vi.useRealTimers())

  async function simularNaPagina(cenario: string) {
    gravarRota()
    const gps = instalarGps()
    instalarTela()
    const { faladas } = instalarVoz()
    renderizar(`/rota/navegar?simular=${cenario}`)
    expect(await screen.findByText('Modo demonstração: a posição é simulada, não é a sua.')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Voz do app' }))
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Começar' }))
    for (let t = 0; t < 420_000; t += 5000) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
    }
    expect(gps.watchPosition).not.toHaveBeenCalled()
    return faladas
  }

  const CHEGADA = FALAS_FIXAS.chegada.texto
  const indice = (faladas: string[], inicio: string) => faladas.findIndex((t) => t.startsWith(inicio))

  it('desvio-lateral-25m: "Você saiu da rota" e não chega', async () => {
    const faladas = await simularNaPagina('desvio-lateral-25m')
    expect(indice(faladas, 'Você saiu da rota')).toBeGreaterThan(0)
    expect(faladas).not.toContain(CHEGADA)
  }, 60_000)

  it('volta-a-rota: sai, volta e chega', async () => {
    const faladas = await simularNaPagina('volta-a-rota')
    const saiu = indice(faladas, 'Você saiu da rota')
    expect(saiu).toBeGreaterThan(0)
    expect(indice(faladas, 'Você voltou para a rota.')).toBeGreaterThan(saiu)
    expect(faladas.at(-1)).toBe(CHEGADA)
  }, 60_000)

  it('precisao-ruim-40m: nenhuma leitura boa; a procura avisa que o sinal está fraco', async () => {
    const faladas = await simularNaPagina('precisao-ruim-40m')
    expect(faladas.filter((t) => t.startsWith('O sinal de localização está fraco aqui.'))).toHaveLength(1)
    expect(indice(faladas, 'Passo 1 de 5')).toBe(-1)
  }, 60_000)

  it('parado-no-cruzamento: parar não acrescenta fala, e chega', async () => {
    const faladas = await simularNaPagina('parado-no-cruzamento')
    expect(indice(faladas, 'Você saiu da rota')).toBe(-1)
    expect(faladas.at(-1)).toBe(CHEGADA)
  }, 60_000)

  it('sentido-contrario: avisa uma vez', async () => {
    const faladas = await simularNaPagina('sentido-contrario')
    expect(faladas.filter((t) => t === FALAS_FIXAS.contrario.texto)).toHaveLength(1)
  }, 60_000)

  it('aba-oculta-no-meio (30 s sem leitura): "sem sinal", "sinal de volta" e chega', async () => {
    const faladas = await simularNaPagina('aba-oculta-no-meio')
    const semSinal = faladas.indexOf(FALAS_FIXAS.sem_sinal.texto)
    expect(semSinal).toBeGreaterThan(0)
    expect(faladas.indexOf(FALAS_FIXAS.sinal_voltou.texto)).toBeGreaterThan(semSinal)
    expect(faladas.at(-1)).toBe(CHEGADA)
  }, 60_000)
})

describe('mapa da navegação na página (spec do mapa próprio, seção 10.4)', () => {
  /** O mesmo botão: "Mostrar o mapa" fechado, "Esconder o mapa" aberto (ação, sem aria-pressed). */
  const botaoMapa = () => screen.queryByRole('button', { name: /^(Mostrar|Esconder) o mapa$/ })
  /** a vem antes de b na ordem do documento (e, portanto, na leitura e no Tab). */
  const antes = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

  beforeEach(() => {
    mapa.motores.length = 0
    vi.mocked(lerPreferenciasMapa).mockClear()
    vi.mocked(gravarPreferenciaMapa).mockClear()
  })

  it('aparece em procurando, navegando e pausada; não no preparo nem na chegada; fechado por padrão', async () => {
    gravarRota()
    const gps = instalarGps()
    instalarTela()
    const user = userEvent.setup()
    renderizar()
    await screen.findByRole('button', { name: 'Começar' })
    expect(botaoMapa()).toBeNull()
    await comecar(user)
    expect(botaoMapa()).toHaveAccessibleName('Mostrar o mapa')
    expect(screen.queryByRole('img', { name: /^Mapa da rota a pé/ })).toBeNull()
    await gps.enviar(PONTOS_L.A)
    expect(botaoMapa()).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pausar' }))
    expect(botaoMapa()).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pausar' }))
    await andarAteOFim(gps.enviar)
    await screen.findByRole('heading', { level: 2, name: 'Você chegou ao destino' })
    expect(botaoMapa()).toBeNull()
    // fechado, nada do motor foi carregado
    expect(mapa.motores).toHaveLength(0)
  })

  // o mapa é complemento: aberto, não empurra para baixo da dobra (nem para depois no Tab) os controles
  it('aparece no passo a passo, depois de "Detalhes do trecho" e dos controles', async () => {
    gravarRota()
    instalarGps()
    const user = userEvent.setup()
    renderizar()
    await user.click(await screen.findByRole('button', { name: 'Seguir passo a passo, sem localização' }))
    const h2 = await screen.findByRole('heading', { level: 2, name: 'Passo 1 de 5' })
    const botao = botaoMapa()!
    expect(antes(h2, botao)).toBe(true)
    expect(antes(screen.getByRole('button', { name: 'Detalhes do trecho' }), botao)).toBe(true)
    expect(antes(screen.getByRole('button', { name: 'Próximo passo' }), botao)).toBe(true)
  })

  it('navegando: depois do painel, de "Detalhes do trecho" e dos controles; aberto, a figura também', async () => {
    gravarRota()
    const gps = instalarGps()
    instalarTela()
    const user = userEvent.setup()
    renderizar()
    await comecar(user)
    await gps.enviar(PONTOS_L.A)
    const h2 = screen.getByRole('heading', { level: 2 })
    const detalhes = screen.getByRole('button', { name: 'Detalhes do trecho' })
    const controles = screen.getByRole('group', { name: 'Controles da navegação' })
    await user.click(botaoMapa()!)
    const figura = await screen.findByRole('img', { name: /^Mapa da rota a pé/ })
    for (const el of [botaoMapa()!, figura]) {
      expect(antes(h2, el)).toBe(true)
      expect(antes(detalhes, el)).toBe(true)
      expect(antes(controles, el)).toBe(true)
    }
  })

  it('as preferências são lidas da aba e gravadas por gravarPreferenciaMapa, só com "0" e "1"', async () => {
    gravarRota()
    const gps = instalarGps()
    instalarTela()
    const user = userEvent.setup()
    renderizar()
    await comecar(user)
    await gps.enviar(PONTOS_L.A)
    expect(lerPreferenciasMapa).toHaveBeenCalled()
    expect(gravarPreferenciaMapa).not.toHaveBeenCalled()

    await user.click(botaoMapa()!)
    expect(gravarPreferenciaMapa).toHaveBeenLastCalledWith('aberto', true)
    expect(botaoMapa()).toHaveAccessibleName('Esconder o mapa')
    await waitFor(() => expect(mapa.motores).toHaveLength(1))
    // o foco fica no botão: abrir o mapa não leva a pessoa a lugar nenhum
    expect(botaoMapa()).toHaveFocus()

    const girar = await screen.findByRole('button', { name: 'Girar o mapa com a rota' })
    expect(girar).toHaveAttribute('aria-pressed', 'false')
    await user.click(girar)
    expect(gravarPreferenciaMapa).toHaveBeenLastCalledWith('girar', true)
    expect(screen.getByRole('button', { name: 'Girar o mapa com a rota' })).toHaveAttribute('aria-pressed', 'true')
    expect(sessionStorage.getItem(CHAVE_ABERTO)).toBe('1')
    expect(sessionStorage.getItem(CHAVE_GIRAR)).toBe('1')

    await user.click(screen.getByRole('button', { name: 'Girar o mapa com a rota' }))
    expect(gravarPreferenciaMapa).toHaveBeenLastCalledWith('girar', false)
    expect(sessionStorage.getItem(CHAVE_GIRAR)).toBe('0')
  })

  it('a escolha da aba vale ao voltar: com o mapa aberto na aba, ele abre sozinho ao começar', async () => {
    gravarRota()
    gravarPreferenciaMapa('aberto', true)
    gravarPreferenciaMapa('girar', true)
    vi.mocked(gravarPreferenciaMapa).mockClear()
    const gps = instalarGps()
    instalarTela()
    const user = userEvent.setup()
    renderizar()
    await comecar(user)
    await gps.enviar(PONTOS_L.A)
    expect(botaoMapa()).toHaveAccessibleName('Esconder o mapa')
    expect(await screen.findByRole('button', { name: 'Girar o mapa com a rota' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(mapa.motores).toHaveLength(1))
    // o motor recebe as leituras com a escolha de girar
    await waitFor(() => expect(mapa.motores[0].atualizar).toHaveBeenCalled())
    expect(mapa.motores[0].atualizar.mock.calls.at(-1)?.[1]).toBe(true)
    expect(gravarPreferenciaMapa).not.toHaveBeenCalled()
  })

  it('na chegada, o mapa aberto some, o motor é destruído e o foco vai ao h2', async () => {
    gravarRota()
    const gps = instalarGps()
    instalarTela()
    const user = userEvent.setup()
    renderizar()
    await comecar(user)
    await gps.enviar(PONTOS_L.A)
    await user.click(botaoMapa()!)
    await waitFor(() => expect(mapa.motores).toHaveLength(1))
    await screen.findByRole('img', { name: /^Mapa da rota a pé/ })
    await andarAteOFim(gps.enviar)
    const h2 = screen.getByRole('heading', { level: 2, name: 'Você chegou ao destino' })
    await waitFor(() => expect(h2).toHaveFocus())
    expect(botaoMapa()).toBeNull()
    expect(screen.queryByRole('img', { name: /^Mapa da rota a pé/ })).toBeNull()
    expect(document.querySelector('figure.mapa-nav')).toBeNull()
    expect(mapa.motores[0].destruir).toHaveBeenCalledTimes(1)
  })
})

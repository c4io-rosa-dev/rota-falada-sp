import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { gravarSessaoRota, PERFIL_FORM_PADRAO } from '../dados/sessaoRota'
import { montarPedido } from '../pages/rotaEstado'
import { apiFalsa } from './apiFalsa'
import { A, abrir, prepararColaboracao } from './apoioColaboracao'
import { endereco, passo, ROTA } from './fixturasRota'

vi.mock('../auth/cliente', () => import('./clienteFalso'))
prepararColaboracao()

const B = endereco(2, 'Rua B, 2 · Vila Mariana')
const POSICAO = { coords: { latitude: -23.59, longitude: -46.635, accuracy: 10 } } as GeolocationPosition

function adiado<T>() {
  let resolver!: (v: T) => void
  const promessa = new Promise<T>((r) => (resolver = r))
  return { promessa, resolver }
}

function comPontos(origem: typeof A | null = A, destino: typeof A | null = B) {
  gravarSessaoRota({ versao: 1, origem, destino, perfil: PERFIL_FORM_PADRAO, rota: null, rotaDe: null, calculadaEm: null })
}

function comRota(rota = ROTA) {
  gravarSessaoRota({
    versao: 1,
    origem: A,
    destino: B,
    perfil: PERFIL_FORM_PADRAO,
    rota,
    rotaDe: { pedido: montarPedido(A, B, PERFIL_FORM_PADRAO), origem: A.rotulo, destino: B.rotulo },
    calculadaEm: new Date().toISOString(),
  })
}

function gpsNegado() {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (_: PositionCallback, falha: PositionErrorCallback) => falha({ code: 1 } as GeolocationPositionError) },
  })
}

function gpsManual() {
  const controle: { responder: PositionCallback } = { responder: () => {} }
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (ok: PositionCallback) => (controle.responder = ok) },
  })
  return controle
}

const pausa = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

/** Como o fetch de verdade: abortar com o corpo a caminho rejeita o json() com AbortError. */
function respostaComCorpoPendente(sinal: AbortSignal | null | undefined, corpo: unknown) {
  let liberar!: () => void
  const pronto = new Promise<void>((r) => (liberar = r))
  const resposta = new Response('{}', { headers: { 'content-type': 'application/json' } })
  Object.defineProperty(resposta, 'json', {
    value: () =>
      new Promise((ok, falha) => {
        if (sinal?.aborted) return falha(new DOMException('Aborted', 'AbortError'))
        sinal?.addEventListener('abort', () => falha(new DOMException('Aborted', 'AbortError')))
        void pronto.then(() => ok(corpo))
      }),
  })
  return { resposta, liberar }
}

describe('abortar com o corpo a caminho', () => {
  function fetchPendente() {
    const pedidos: { liberar: () => void }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (new URL(url).pathname === '/health') return Response.json({ status: 'ok', banco: 'ok' })
        const { resposta, liberar } = respostaComCorpoPendente(init.signal, [A])
        pedidos.push({ liberar })
        return resposta
      }),
    )
    return pedidos
  }

  it('digitar durante a leitura do corpo não anuncia erro falso', async () => {
    const pedidos = fetchPendente()
    const user = userEvent.setup()
    abrir('/rota')
    await user.click(await screen.findByRole('combobox', { name: 'Origem' }))
    await user.keyboard('rua{Enter}')
    await waitFor(() => expect(pedidos).toHaveLength(1))
    await user.keyboard('x')
    await pausa(200)
    expect(screen.getByRole('status')).not.toHaveTextContent('Instabilidade no sistema')
  })

  it('Enter de novo durante a leitura do corpo: a segunda busca ainda vira lista', async () => {
    const pedidos = fetchPendente()
    const user = userEvent.setup()
    abrir('/rota')
    await user.click(await screen.findByRole('combobox', { name: 'Origem' }))
    await user.keyboard('rua{Enter}')
    await waitFor(() => expect(pedidos).toHaveLength(1))
    await user.keyboard('{Enter}')
    await waitFor(() => expect(pedidos).toHaveLength(2))
    await act(async () => pedidos[1].liberar())
    await pausa(50)
    expect(screen.queryAllByRole('option')).toHaveLength(1)
  })
})

describe('texto de lentidão', () => {
  it('o servidor acorda aos 20 s e o POST acabou de sair: não diz que o serviço de rotas está lento', async () => {
    comPontos()
    let acordou = false
    const chamadas: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const caminho = new URL(url).pathname
        chamadas.push(caminho)
        if (caminho === '/health') return acordou ? Response.json({ status: 'ok', banco: 'ok' }) : new Response('dormindo', { status: 503 })
        return new Promise<Response>(() => {})
      }),
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      abrir('/rota')
      fireEvent.click(await screen.findByRole('button', { name: 'Calcular rota' }))
      await act(() => vi.advanceTimersByTimeAsync(16_000))
      expect(screen.getAllByText(/Ainda sem resposta/).length).toBeGreaterThan(0)
      acordou = true
      await act(() => vi.advanceTimersByTimeAsync(5_000))
      expect(chamadas).toContain('/api/rotas')
      expect(screen.queryByText('Ainda calculando; o serviço de rotas está lento.')).toBeNull()
      // o limiar conta desde a saída do POST
      await act(() => vi.advanceTimersByTimeAsync(16_000))
      expect(screen.getByText('Ainda calculando; o serviço de rotas está lento.')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('"Calculando a rota." não sobra na região', () => {
  it('com resposta imediata, o foco vai ao h2 e nada de vencido é escrito depois', async () => {
    comPontos()
    apiFalsa({ 'POST /api/rotas': Response.json(ROTA) })
    const user = userEvent.setup()
    abrir('/rota')
    await user.click(await screen.findByRole('button', { name: 'Calcular rota' }))
    expect(await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })).toHaveFocus()
    await pausa(250)
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('com resposta lenta, a frase sai da região quando o foco vai ao resultado', async () => {
    comPontos()
    const post = adiado<Response>()
    apiFalsa({ 'POST /api/rotas': () => post.promessa })
    const user = userEvent.setup()
    abrir('/rota')
    await user.click(await screen.findByRole('button', { name: 'Calcular rota' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Calculando a rota.'))
    await act(async () => post.resolver(Response.json(ROTA)))
    expect(await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })).toHaveFocus()
    await pausa(250)
    expect(screen.getByRole('status').textContent).toBe('')
  })
})

describe('foco e envio durante o cálculo (D6)', () => {
  it('Enter no campo e edição no mesmo campo: o foco fica com quem digita, e a região anuncia', async () => {
    comPontos()
    const post = adiado<Response>()
    apiFalsa({ 'POST /api/rotas': () => post.promessa, 'GET /api/geocode': Response.json([]) })
    const user = userEvent.setup()
    abrir('/rota')
    const destino = await screen.findByRole('combobox', { name: 'Destino' })
    await user.click(destino)
    await user.keyboard('{Enter}')
    await screen.findByText('Calculando a rota…')
    await user.type(destino, 'x')
    await act(async () => post.resolver(Response.json(ROTA)))
    await screen.findByRole('heading', { level: 2, name: /Rota da busca anterior/ })
    expect(destino).toHaveFocus()
    await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe(''))
  })

  it('segundo envio durante o cálculo não aborta nem repete o POST', async () => {
    comPontos()
    const api = apiFalsa({ 'POST /api/rotas': () => new Promise<Response>(() => {}) })
    const user = userEvent.setup()
    abrir('/rota')
    const calcular = await screen.findByRole('button', { name: 'Calcular rota' })
    await user.click(calcular)
    await waitFor(() => expect(api.de('POST /api/rotas')).toHaveLength(1))
    await user.click(calcular)
    await pausa(50)
    expect(api.de('POST /api/rotas')).toHaveLength(1)
    expect(api.de('POST /api/rotas')[0].init.signal?.aborted).toBe(false)
  })

  it('"Cancelar" aborta o POST de verdade', async () => {
    comPontos()
    const api = apiFalsa({ 'POST /api/rotas': () => new Promise<Response>(() => {}) })
    const user = userEvent.setup()
    abrir('/rota')
    await user.click(await screen.findByRole('button', { name: 'Calcular rota' }))
    await waitFor(() => expect(api.de('POST /api/rotas')).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(api.de('POST /api/rotas')[0].init.signal?.aborted).toBe(true)
  })
})

describe('sair do campo com Tab', () => {
  it('durante o debounce: nenhuma busca sai, a lista não abre e a região não dá instrução', async () => {
    const api = apiFalsa({ 'GET /api/geocode': Response.json([A, B]) })
    const user = userEvent.setup()
    abrir('/rota')
    await user.click(await screen.findByRole('combobox', { name: 'Origem' }))
    await user.keyboard('rua')
    await user.tab()
    await pausa(900)
    expect(api.de('GET /api/geocode')).toHaveLength(0)
    expect(screen.getByRole('combobox', { name: 'Origem' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('status')).not.toHaveTextContent('Seta para baixo')
  })

  it('com a busca a caminho: a resposta é descartada, e o campo não fica "Buscando…" para sempre', async () => {
    const pedido = adiado<Response>()
    apiFalsa({ 'GET /api/geocode': () => pedido.promessa })
    const user = userEvent.setup()
    abrir('/rota')
    const origem = await screen.findByRole('combobox', { name: 'Origem' })
    await user.click(origem)
    await user.keyboard('rua{Enter}')
    await screen.findByText('Buscando…')
    await user.tab()
    await act(async () => pedido.resolver(Response.json([A, B])))
    await pausa(150)
    expect(origem).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Buscando…')).toBeNull()
    expect(screen.getByRole('status')).not.toHaveTextContent('Seta para baixo')
  })

  it('clicar fora também cancela; voltar e dar Enter busca de novo', async () => {
    const api = apiFalsa({ 'GET /api/geocode': Response.json([A, B]) })
    const user = userEvent.setup()
    abrir('/rota')
    const origem = await screen.findByRole('combobox', { name: 'Origem' })
    await user.click(origem)
    await user.keyboard('rua')
    await user.click(screen.getByRole('combobox', { name: 'Destino' }))
    await pausa(900)
    expect(api.de('GET /api/geocode')).toHaveLength(0)
    await user.click(origem)
    await user.keyboard('{Enter}')
    expect(await screen.findAllByRole('option')).toHaveLength(2)
  })

  it('a contagem que espera a vez não é falada depois de sair do campo', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A, B]) })
    const user = userEvent.setup()
    abrir('/rota')
    const origem = await screen.findByRole('combobox', { name: 'Origem' })
    await user.click(origem)
    await user.keyboard('rua{Enter}')
    await screen.findAllByRole('option')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 endereços para Origem.'))
    // a segunda contagem fica na fila: o intervalo é de 3 s
    await user.keyboard('{Backspace}a{Enter}')
    await screen.findAllByRole('option')
    await user.tab()
    await pausa(3200)
    expect(screen.getByRole('status')).toHaveTextContent('2 endereços para Origem. Seta para baixo para escolher.')
  }, 10_000)
})

describe('espera do servidor', () => {
  it('dois campos na mesma espera: o texto é anunciado uma vez só', async () => {
    let acordou = false
    const fala: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const caminho = new URL(url).pathname
        if (caminho === '/health') return acordou ? Response.json({ status: 'ok', banco: 'ok' }) : new Response('x', { status: 503 })
        return Response.json([A])
      }),
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      abrir('/rota')
      const origem = await screen.findByRole('combobox', { name: 'Origem' })
      const destino = screen.getByRole('combobox', { name: 'Destino' })
      const observador = new MutationObserver(() => {
        const texto = screen.getByRole('status').textContent ?? ''
        if (texto) fala.push(texto)
      })
      observador.observe(screen.getByRole('status'), { childList: true, characterData: true, subtree: true })
      fireEvent.change(origem, { target: { value: 'rua' } })
      fireEvent.keyDown(origem, { key: 'Enter' })
      await act(() => vi.advanceTimersByTimeAsync(4_500))
      fireEvent.change(destino, { target: { value: 'rua' } })
      fireEvent.keyDown(destino, { key: 'Enter' })
      await act(() => vi.advanceTimersByTimeAsync(1_000))
      observador.disconnect()
      expect(fala.filter((t) => t.startsWith('Ainda sem resposta'))).toHaveLength(1)
      acordou = true
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('"Usar minha localização"', () => {
  it('"Limpar busca" com origem vazia cancela o GPS', async () => {
    comPontos(null, B)
    apiFalsa({ 'GET /api/geocode/reverso': Response.json(A) })
    const gps = gpsManual()
    const user = userEvent.setup()
    abrir('/rota')
    await user.click(await screen.findByRole('button', { name: 'Usar minha localização' }))
    await user.click(screen.getByRole('button', { name: 'Limpar busca' }))
    await act(async () => gps.responder(POSICAO))
    await pausa(50)
    expect(screen.getByRole('combobox', { name: 'Origem' })).toHaveValue('')
    expect(JSON.parse(sessionStorage.getItem('rf-busca') ?? 'null')?.origem ?? null).toBeNull()
  })

  it('a frase de GPS negado sai quando há endereço no campo', async () => {
    gpsNegado()
    apiFalsa({ 'GET /api/geocode': Response.json([A]) })
    const user = userEvent.setup()
    abrir('/rota')
    await user.click(await screen.findByRole('button', { name: 'Usar minha localização' }))
    expect(await screen.findByText(/O navegador não autorizou a localização/)).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Origem' }))
    await user.keyboard('rua{Enter}')
    await screen.findAllByRole('option')
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Origem' })).toHaveValue(A.rotulo))
    expect(screen.queryByText(/O navegador não autorizou a localização/)).toBeNull()
  })

  it('e sai com "Limpar busca", mesmo com o campo vazio', async () => {
    gpsNegado()
    comPontos(null, B)
    apiFalsa({})
    const user = userEvent.setup()
    abrir('/rota')
    await user.click(await screen.findByRole('button', { name: 'Usar minha localização' }))
    await screen.findByText(/O navegador não autorizou a localização/)
    await user.click(screen.getByRole('button', { name: 'Limpar busca' }))
    expect(screen.queryByText(/O navegador não autorizou a localização/)).toBeNull()
  })
})

describe('resultado da rota', () => {
  it('sem fontes na rota, a ficha usa as dos passos e mantém o link', async () => {
    apiFalsa({})
    comRota({ ...ROTA, fontes: [] })
    abrir('/rota')
    await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })
    const licencas = screen.getByRole('link', { name: 'Licenças' })
    expect(licencas.closest('dd')).toHaveTextContent('OpenStreetMap. Licenças')
  })

  it('"Licenças" é um alvo de 44 px', async () => {
    apiFalsa({})
    comRota()
    abrir('/rota')
    expect(await screen.findByRole('link', { name: 'Licenças' })).toHaveClass('alvo')
  })

  it('trecho sem via casada diz "sem dado" em Degrau', async () => {
    apiFalsa({})
    comRota({ ...ROTA, passos: [passo(1, { data_referencia: null, largura_m: null, largura_medida: false, declividade_pct: null, guia: 'desconhecida' })] })
    abrir('/rota')
    const item = (await screen.findByRole('list', { name: 'Os 1 passos da rota' })).querySelector('#passo-1') as HTMLElement
    const rotulo = within(item).getByText('Degrau')
    expect(rotulo.nextElementSibling).toHaveTextContent('sem dado')
    expect(screen.queryByText(/Há degrau/)).toBeNull()
  })

  it('o passo recebe o foco do link "Voltar ao passo N na lista"', async () => {
    apiFalsa({})
    comRota()
    abrir('/rota')
    await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })
    expect(document.getElementById('passo-1')).toHaveAttribute('tabindex', '-1')
  })

  it('a tela não promete o que não cumpre sobre trajetos', async () => {
    apiFalsa({})
    abrir('/rota')
    await screen.findByRole('heading', { level: 1, name: 'Planejar rota' })
    expect(screen.queryByText(/não guardamos histórico de trajetos/)).toBeNull()
    expect(screen.getByText(/fica guardado sem identificação por até 6 horas/)).toBeInTheDocument()
  })
})

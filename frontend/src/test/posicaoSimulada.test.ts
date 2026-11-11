import type { LeituraPosicao } from '../dados/localizacao'
import { criarPosicaoSimulada, ritmoDaBusca } from '../dados/navegacao/posicaoSimulada'
import { leiturasDoCenario } from '../dados/navegacao/simulacao'
import { montarTrajeto } from '../dados/navegacao/trajeto'
import { ROTA_L } from './fixturasNavegacao'

const PONTOS = montarTrajeto(ROTA_L)!.pontos

describe('posição simulada', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('entrega as leituras do cenário por setTimeout, uma por intervalo', () => {
    const esperadas = leiturasDoCenario('reto', PONTOS)
    const recebidas: LeituraPosicao[] = []
    const parar = criarPosicaoSimulada('reto', PONTOS)((l) => recebidas.push(l), vi.fn())
    expect(recebidas).toHaveLength(0)
    vi.advanceTimersByTime(0)
    expect(recebidas).toHaveLength(1)
    vi.advanceTimersByTime(999)
    expect(recebidas).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(recebidas).toHaveLength(2)
    expect(recebidas[1]).toEqual({ lat: esperadas[1].lat, lon: esperadas[1].lon, precisaoM: esperadas[1].precisaoM, tMs: esperadas[1].tMs })
    parar()
  })

  it('o ritmo divide o intervalo', () => {
    const recebidas: LeituraPosicao[] = []
    const parar = criarPosicaoSimulada('reto', PONTOS, { ritmo: 5 })((l) => recebidas.push(l), vi.fn())
    vi.advanceTimersByTime(0)
    vi.advanceTimersByTime(200)
    expect(recebidas).toHaveLength(2)
    parar()
  })

  it('respeita os saltos do cenário (aba oculta)', () => {
    const esperadas = leiturasDoCenario('aba-oculta-no-meio', PONTOS)
    const salto = esperadas.findIndex((l, i) => i > 0 && l.tMs - esperadas[i - 1].tMs > 20_000)
    const recebidas: LeituraPosicao[] = []
    criarPosicaoSimulada('aba-oculta-no-meio', PONTOS)((l) => recebidas.push(l), vi.fn())
    vi.advanceTimersByTime((salto - 1) * 1000)
    expect(recebidas).toHaveLength(salto)
    vi.advanceTimersByTime(30_999)
    expect(recebidas).toHaveLength(salto)
    vi.advanceTimersByTime(1)
    expect(recebidas).toHaveLength(salto + 1)
  })

  it('entrega o cenário inteiro e para sozinho no fim', () => {
    const esperadas = leiturasDoCenario('reto', PONTOS)
    const recebidas: LeituraPosicao[] = []
    criarPosicaoSimulada('reto', PONTOS)((l) => recebidas.push(l), vi.fn())
    vi.runAllTimers()
    expect(recebidas).toHaveLength(esperadas.length)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('parar é idempotente e nada chega depois', () => {
    const aoMudar = vi.fn()
    const parar = criarPosicaoSimulada('reto', PONTOS)(aoMudar, vi.fn())
    vi.advanceTimersByTime(0)
    parar()
    parar()
    vi.advanceTimersByTime(10_000)
    expect(aoMudar).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('nunca usa o GPS real', () => {
    const watch = vi.fn()
    vi.stubGlobal('navigator', { ...navigator, geolocation: { watchPosition: watch, clearWatch: vi.fn(), getCurrentPosition: vi.fn() } })
    const parar = criarPosicaoSimulada('reto', PONTOS)(vi.fn(), vi.fn())
    vi.runAllTimers()
    parar()
    expect(watch).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('ritmo da busca: só números de 1 a 20; o resto vira 1', () => {
    expect(ritmoDaBusca(null)).toBe(1)
    expect(ritmoDaBusca('5')).toBe(5)
    expect(ritmoDaBusca('0')).toBe(1)
    expect(ritmoDaBusca('abc')).toBe(1)
    expect(ritmoDaBusca('500')).toBe(20)
  })
})

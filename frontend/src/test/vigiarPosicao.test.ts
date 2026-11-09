import { OPCOES_VIGIA, PRECISAO_ACEITAVEL_M, vigiarPosicao } from '../dados/localizacao'

type Vigia = { ok: PositionCallback; erro: PositionErrorCallback; opcoes?: PositionOptions }

function comVigia() {
  const vigias: Vigia[] = []
  const watchPosition = vi.fn((ok: PositionCallback, erro: PositionErrorCallback, opcoes?: PositionOptions) => {
    vigias.push({ ok, erro, opcoes })
    return 42
  })
  const clearWatch = vi.fn()
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition, clearWatch } })
  return { vigias, watchPosition, clearWatch }
}

function leitura(lat: number, lon: number, accuracy: number, timestamp: number) {
  return { coords: { latitude: lat, longitude: lon, accuracy }, timestamp } as GeolocationPosition
}

function erro(code: number) {
  return { code, message: '' } as GeolocationPositionError
}

afterEach(() => {
  delete (navigator as unknown as { geolocation?: unknown }).geolocation
})

describe('vigiarPosicao', () => {
  it('usa as opções exatas da vigia', () => {
    const { watchPosition } = comVigia()
    vigiarPosicao(vi.fn(), vi.fn())
    expect(OPCOES_VIGIA).toEqual({ enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })
    expect(watchPosition).toHaveBeenCalledTimes(1)
    expect(watchPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })
  })

  it('converte coordenadas, precisão e horário', () => {
    const { vigias } = comVigia()
    const aoMudar = vi.fn()
    vigiarPosicao(aoMudar, vi.fn())
    vigias[0].ok(leitura(-23.56, -46.65, 12, 1000))
    expect(aoMudar).toHaveBeenCalledWith({ lat: -23.56, lon: -46.65, precisaoM: 12, tMs: 1000 })
  })

  it('erro chama aoErrar com o código e não reinicia a vigia, nem no tempo esgotado', () => {
    const { vigias, watchPosition, clearWatch } = comVigia()
    const aoErrar = vi.fn()
    vigiarPosicao(vi.fn(), aoErrar)
    vigias[0].erro(erro(3))
    vigias[0].erro(erro(2))
    expect(aoErrar.mock.calls).toEqual([[3], [2]])
    expect(watchPosition).toHaveBeenCalledTimes(1)
    expect(clearWatch).not.toHaveBeenCalled()
  })

  it('parar chama clearWatch uma vez e ignora callbacks posteriores', () => {
    const { vigias, clearWatch } = comVigia()
    const aoMudar = vi.fn()
    const aoErrar = vi.fn()
    const parar = vigiarPosicao(aoMudar, aoErrar)
    parar()
    parar()
    expect(clearWatch).toHaveBeenCalledTimes(1)
    expect(clearWatch).toHaveBeenCalledWith(42)
    vigias[0].ok(leitura(-23.56, -46.65, 12, 1000))
    vigias[0].erro(erro(1))
    expect(aoMudar).not.toHaveBeenCalled()
    expect(aoErrar).not.toHaveBeenCalled()
  })

  it('sem geolocalização chama aoErrar(0) e devolve função vazia', () => {
    const aoErrar = vi.fn()
    const parar = vigiarPosicao(vi.fn(), aoErrar)
    expect(aoErrar).toHaveBeenCalledWith(0)
    expect(() => parar()).not.toThrow()
  })

  it('PRECISAO_ACEITAVEL_M continua 100', () => {
    expect(PRECISAO_ACEITAVEL_M).toBe(100)
  })
})

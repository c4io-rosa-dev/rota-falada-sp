import { detectarRecursos } from '../dados/navegacao/recursos'

type Opcoes = { geolocation?: boolean; wakeLock?: boolean; seguro?: boolean }

function janela({ geolocation = true, wakeLock = true, seguro = true }: Opcoes = {}) {
  const navigator: Record<string, unknown> = {}
  if (geolocation) navigator.geolocation = { watchPosition: vi.fn(), clearWatch: vi.fn() }
  if (wakeLock) navigator.wakeLock = { request: vi.fn() }
  return { navigator, isSecureContext: seguro } as unknown as Window
}

function vozes(lista: { lang: string; localService: boolean }[]) {
  vi.stubGlobal('speechSynthesis', { getVoices: () => lista, speak: vi.fn(), cancel: vi.fn() })
  vi.stubGlobal('SpeechSynthesisUtterance', class {})
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('detectarRecursos', () => {
  it('tudo disponível', () => {
    vozes([{ lang: 'pt-BR', localService: true }])
    expect(detectarRecursos(janela())).toEqual({ localizacao: true, telaLigada: true, voz: true })
  })

  it('sem geolocation, sem localização', () => {
    vozes([])
    expect(detectarRecursos(janela({ geolocation: false })).localizacao).toBe(false)
  })

  it('contexto não seguro, sem localização', () => {
    vozes([])
    expect(detectarRecursos(janela({ seguro: false })).localizacao).toBe(false)
  })

  it('sem wakeLock, sem tela ligada', () => {
    vozes([])
    expect(detectarRecursos(janela({ wakeLock: false })).telaLigada).toBe(false)
  })

  it('só voz remota, sem voz', () => {
    vozes([{ lang: 'pt-BR', localService: false }])
    expect(detectarRecursos(janela()).voz).toBe(false)
  })

  it('sem síntese, sem voz', () => {
    vi.stubGlobal('speechSynthesis', undefined)
    expect(detectarRecursos(janela()).voz).toBe(false)
  })
})

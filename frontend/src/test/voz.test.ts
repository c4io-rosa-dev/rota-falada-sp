import { assumirLeitura, criarVoz, vozLocalPortugues } from '../dados/navegacao/voz'

class FalaFalsa {
  text: string
  lang = ''
  voice: unknown = null
  constructor(texto: string) {
    this.text = texto
  }
}

type VozFalsa = { lang: string; name: string; localService: boolean }

const BR_LOCAL: VozFalsa = { lang: 'pt-BR', name: 'Local BR', localService: true }
const BR_REMOTA: VozFalsa = { lang: 'pt-BR', name: 'Remota BR', localService: false }
const PT_LOCAL: VozFalsa = { lang: 'pt_PT', name: 'Local PT', localService: true }
const EN_LOCAL: VozFalsa = { lang: 'en-US', name: 'Local EN', localService: true }

function sinteseCom(vozes: VozFalsa[]) {
  const ordem: string[] = []
  const faladas: FalaFalsa[] = []
  const s = {
    speak: vi.fn((f: FalaFalsa) => {
      ordem.push('speak')
      faladas.push(f)
    }),
    cancel: vi.fn(() => {
      ordem.push('cancel')
    }),
    getVoices: vi.fn(() => vozes),
  }
  return { s, ordem, faladas }
}

function instalar(vozes: VozFalsa[]) {
  const r = sinteseCom(vozes)
  vi.stubGlobal('speechSynthesis', r.s)
  vi.stubGlobal('SpeechSynthesisUtterance', FalaFalsa)
  return r
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('vozLocalPortugues', () => {
  const comVozes = (v: VozFalsa[]) => sinteseCom(v).s as unknown as SpeechSynthesis

  it('escolhe pt-BR local', () => {
    expect(vozLocalPortugues(comVozes([EN_LOCAL, PT_LOCAL, BR_LOCAL]))?.name).toBe('Local BR')
  })

  it('ignora pt-BR remota e cai para pt-PT local', () => {
    expect(vozLocalPortugues(comVozes([BR_REMOTA, PT_LOCAL]))?.name).toBe('Local PT')
  })

  it('sem voz local em português devolve null', () => {
    expect(vozLocalPortugues(comVozes([BR_REMOTA, EN_LOCAL]))).toBeNull()
  })

  it('sem síntese no navegador devolve null', () => {
    vi.stubGlobal('speechSynthesis', undefined)
    expect(vozLocalPortugues()).toBeNull()
  })

  it('usa a síntese global quando não recebe uma', () => {
    instalar([BR_LOCAL])
    expect(vozLocalPortugues()?.name).toBe('Local BR')
  })
})

describe('criarVoz', () => {
  it('null sem speechSynthesis', () => {
    vi.stubGlobal('speechSynthesis', undefined)
    vi.stubGlobal('SpeechSynthesisUtterance', FalaFalsa)
    expect(criarVoz()).toBeNull()
  })

  it('null sem SpeechSynthesisUtterance', () => {
    instalar([BR_LOCAL])
    vi.stubGlobal('SpeechSynthesisUtterance', undefined)
    expect(criarVoz()).toBeNull()
  })

  it('null sem voz local', () => {
    instalar([BR_REMOTA])
    expect(criarVoz()).toBeNull()
  })

  it('urgente cancela antes de falar, com a voz local e lang pt-BR', () => {
    const { ordem, faladas, s } = instalar([BR_REMOTA, BR_LOCAL])
    const voz = criarVoz()!
    expect(voz.falar('Vire à direita.', true)).toBe(true)
    expect(ordem).toEqual(['cancel', 'speak'])
    expect(s.speak).toHaveBeenCalledTimes(1)
    expect(faladas[0].text).toBe('Vire à direita.')
    expect(faladas[0].lang).toBe('pt-BR')
    expect(faladas[0].voice).toBe(BR_LOCAL)
  })

  it('não urgente só fala, sem cancelar', () => {
    const { ordem } = instalar([BR_LOCAL])
    const voz = criarVoz()!
    expect(voz.falar('Siga em frente.', false)).toBe(true)
    expect(ordem).toEqual(['speak'])
  })

  it('calar cancela', () => {
    const { s } = instalar([BR_LOCAL])
    criarVoz()!.calar()
    expect(s.cancel).toHaveBeenCalledTimes(1)
  })
})

describe('assumirLeitura', () => {
  it('B assume e para A uma vez; soltar A depois não solta B', () => {
    const pararA = vi.fn()
    const pararB = vi.fn()
    const pararC = vi.fn()
    const soltarA = assumirLeitura(pararA)
    const soltarB = assumirLeitura(pararB)
    expect(pararA).toHaveBeenCalledTimes(1)
    expect(pararB).not.toHaveBeenCalled()
    soltarA()
    // B continua dona: quem assumir agora para B.
    const soltarC = assumirLeitura(pararC)
    expect(pararB).toHaveBeenCalledTimes(1)
    expect(pararA).toHaveBeenCalledTimes(1)
    soltarB()
    soltarC()
  })

  it('soltar a dona não chama ninguém e libera o trinco', () => {
    const pararA = vi.fn()
    const pararB = vi.fn()
    const soltarA = assumirLeitura(pararA)
    soltarA()
    expect(pararA).not.toHaveBeenCalled()
    const soltarB = assumirLeitura(pararB)
    expect(pararA).not.toHaveBeenCalled()
    soltarB()
    expect(pararB).not.toHaveBeenCalled()
  })
})

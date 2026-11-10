/**
 * Preferências do mapa da navegação guiada (spec do mapa próprio, seção 6): só nesta aba,
 * em sessionStorage, com '0' ou '1'. A guarda estática lê o próprio código-fonte.
 */
import FONTE from '../dados/preferenciaMapa.ts?raw'
import { CHAVE_ABERTO, CHAVE_GIRAR, gravarPreferenciaMapa, lerPreferenciasMapa } from '../dados/preferenciaMapa'

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
})

describe('preferências do mapa nesta aba', () => {
  it('as chaves são as do contrato', () => {
    expect(CHAVE_ABERTO).toBe('rota-falada:mapa-aberto')
    expect(CHAVE_GIRAR).toBe('rota-falada:mapa-girar')
  })

  it('padrão: mapa fechado e sem girar', () => {
    expect(lerPreferenciasMapa()).toEqual({ aberto: false, girar: false })
  })

  it('grava e lê de volta cada escolha', () => {
    gravarPreferenciaMapa('aberto', true)
    expect(lerPreferenciasMapa()).toEqual({ aberto: true, girar: false })
    gravarPreferenciaMapa('girar', true)
    expect(lerPreferenciasMapa()).toEqual({ aberto: true, girar: true })
    gravarPreferenciaMapa('aberto', false)
    expect(lerPreferenciasMapa()).toEqual({ aberto: false, girar: true })
  })

  it('grava só "1" ou "0"', () => {
    gravarPreferenciaMapa('aberto', true)
    gravarPreferenciaMapa('girar', false)
    expect(sessionStorage.getItem(CHAVE_ABERTO)).toBe('1')
    expect(sessionStorage.getItem(CHAVE_GIRAR)).toBe('0')
  })

  it('qualquer outro valor lê false', () => {
    for (const v of ['sim', 'true', '', ' 1', '2', 'null']) {
      sessionStorage.setItem(CHAVE_ABERTO, v)
      sessionStorage.setItem(CHAVE_GIRAR, v)
      expect(lerPreferenciasMapa()).toEqual({ aberto: false, girar: false })
    }
  })

  it('armazenamento que lança na leitura não quebra e lê false', () => {
    sessionStorage.setItem(CHAVE_ABERTO, '1')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    expect(() => lerPreferenciasMapa()).not.toThrow()
    expect(lerPreferenciasMapa()).toEqual({ aberto: false, girar: false })
  })

  it('armazenamento que lança na escrita não quebra e a escrita é ignorada', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('cheio')
    })
    expect(() => gravarPreferenciaMapa('aberto', true)).not.toThrow()
    expect(() => gravarPreferenciaMapa('girar', true)).not.toThrow()
    vi.restoreAllMocks()
    expect(lerPreferenciasMapa()).toEqual({ aberto: false, girar: false })
  })

  it('depois de gravar as duas, a aba tem só as duas chaves, com "0" ou "1", e nada no localStorage', () => {
    gravarPreferenciaMapa('aberto', true)
    gravarPreferenciaMapa('girar', false)
    const chaves = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i)).sort()
    expect(chaves).toEqual([CHAVE_ABERTO, CHAVE_GIRAR].sort())
    for (const k of chaves) expect(['0', '1']).toContain(sessionStorage.getItem(k as string))
    expect(localStorage.length).toBe(0)
  })
})

describe('guarda estática do código das preferências', () => {
  it('lê o código de verdade', () => {
    expect(FONTE).toContain('sessionStorage')
    expect(FONTE).toContain('export function lerPreferenciasMapa')
  })

  it('não usa outro armazenamento, não registra e não serializa', () => {
    expect(FONTE).not.toMatch(/localStorage|indexedDB|console\.|JSON\.stringify/)
  })

  it('não fala de coordenada, rumo nem posição', () => {
    expect(FONTE).not.toMatch(/lat|lon|rumo|posicao|posição/i)
  })

  it("as únicas strings 'rota-falada:' são as duas chaves", () => {
    const achadas = FONTE.match(/rota-falada:[\w-]*/g) ?? []
    expect([...new Set(achadas)].sort()).toEqual(['rota-falada:mapa-aberto', 'rota-falada:mapa-girar'])
    expect(achadas).toHaveLength(2)
  })
})

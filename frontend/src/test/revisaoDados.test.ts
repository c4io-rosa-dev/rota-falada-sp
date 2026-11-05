import L from 'leaflet'
import { voltaSegura } from '../auth/config'
import { conferirChaves } from '../auth/guardaChaves'
import { vigiarTiles } from '../componentes/mapa/opcoesMapa'
import { textoVotoRegistrado } from '../dados/barreira'
import { rotuloCategoria } from '../dados/categorias'
import { nomesDasFontes, textoBarreira, textoDegrauDoPasso, textoFalado } from '../dados/passo'
import { buscarEnderecos, enderecoDoPonto } from '../api/client'
import { pedir } from '../api/http'
import { ehCancelamento, ErroApi } from '../api/base'
import { ficha } from './apoioColaboracao'
import { apiFalsa } from './apiFalsa'
import { passo, ROTA } from './fixturasRota'

vi.mock('../auth/cliente', () => import('./clienteFalso'))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('VITE_TILE_URL', () => {
  it('copiar o .env.example deixa a variável vazia, e o mapa continua com o padrão', async () => {
    vi.stubEnv('VITE_TILE_URL', '')
    vi.resetModules()
    const { URL_TILES } = await import('../componentes/mapa/opcoesMapa')
    expect(URL_TILES).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png')
  })

  it('com valor, usa o valor', async () => {
    vi.stubEnv('VITE_TILE_URL', 'https://tiles.exemplo.org/{z}/{x}/{y}.png')
    vi.resetModules()
    const { URL_TILES } = await import('../componentes/mapa/opcoesMapa')
    expect(URL_TILES).toBe('https://tiles.exemplo.org/{z}/{x}/{y}.png')
  })
})

describe('categorias do SP156', () => {
  it.each([
    ['calcada_danificada', 'Calçada danificada'],
    ['guia_danificada', 'Guia danificada'],
    ['travessia', 'Travessia'],
    ['obstaculo_calcada', 'Obstáculo na calçada'],
    ['guia_sem_rebaixamento', 'Guia sem rebaixamento'],
    ['raiz_de_arvore', 'Raiz de árvore'],
  ])('%s vira %s', (chave, rotulo) => {
    expect(rotuloCategoria(chave)).toBe(rotulo)
  })

  it('valor desconhecido só troca o sublinhado', () => {
    expect(rotuloCategoria('algo_novo')).toBe('Algo novo')
  })

  it('a síntese de voz e a ficha dizem a palavra certa', () => {
    const barreira = { id: 1, origem: 'oficial' as const, categoria: 'calcada_danificada', severidade: 'dificulta' as const, distancia_m: 5, confirmacoes: null, data_referencia: '2026-06-30' }
    expect(textoBarreira(barreira)).toContain('Calçada danificada, a 5 m.')
    expect(textoFalado(passo(1, { barreiras_proximas: [barreira] }))).toContain('barreira, Calçada danificada, a 5 metros.')
  })
})

describe('fontes da rota', () => {
  it('lista vazia usa as fontes dos passos', () => {
    expect(nomesDasFontes({ ...ROTA, fontes: [] })).toBe('OpenStreetMap')
  })

  it('sem nenhuma fonte, diz isso', () => {
    expect(nomesDasFontes({ ...ROTA, fontes: [], passos: [] })).toBe('sem fonte associada')
  })

  it('com fontes, usa as da rota', () => {
    expect(nomesDasFontes(ROTA)).toBe('OpenStreetMap, GeoSampa')
  })
})

describe('degrau sem dado', () => {
  const semVia = passo(1, { is_degrau: false, data_referencia: null, largura_m: null, largura_medida: false, declividade_pct: null, guia: 'desconhecida' })

  it('trecho sem via casada não afirma que não há degrau', () => {
    expect(textoDegrauDoPasso(semVia)).toBe('sem dado')
    expect(textoFalado(semVia)).toContain('Degrau: sem dado.')
  })

  it('com via casada, o dado vale', () => {
    expect(textoDegrauDoPasso(passo(1))).toBe('não')
    expect(textoDegrauDoPasso(passo(1, { is_degrau: true }))).toBe('sim')
    expect(textoDegrauDoPasso(passo(1, { is_degrau: true, data_referencia: null }))).toBe('sim')
    expect(textoFalado(passo(1))).not.toContain('Degrau: sem dado.')
  })
})

describe('voltaSegura', () => {
  it('caminho que a normalização transforma em outro host cai em /conta', () => {
    expect(voltaSegura('/.//evil.example')).toBe('/conta')
    expect(voltaSegura('/x/..//evil.example')).toBe('/conta')
    expect(voltaSegura('/barreiras/../admin')).toBe('/admin')
  })
})

describe('vigiarTiles', () => {
  it('"Tentar de novo" rearma: a segunda rodada de falhas também avisa', () => {
    const tiles = new L.TileLayer('http://x/{z}/{x}/{y}.png')
    const aoFalhar = vi.fn()
    const vigia = vigiarTiles(tiles, aoFalhar)
    for (let i = 0; i < 3; i++) tiles.fire('tileerror')
    expect(aoFalhar).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 3; i++) tiles.fire('tileerror')
    expect(aoFalhar).toHaveBeenCalledTimes(1)
    vigia.rearmar()
    for (let i = 0; i < 2; i++) tiles.fire('tileerror')
    expect(aoFalhar).toHaveBeenCalledTimes(1)
    tiles.fire('tileerror')
    vigia.parar()
    expect(aoFalhar).toHaveBeenCalledTimes(2)
  })

  it('o prazo sem carga também recomeça', () => {
    vi.useFakeTimers()
    try {
      const tiles = new L.TileLayer('http://x/{z}/{x}/{y}.png')
      const aoFalhar = vi.fn()
      const vigia = vigiarTiles(tiles, aoFalhar)
      vi.advanceTimersByTime(8_000)
      expect(aoFalhar).toHaveBeenCalledTimes(1)
      vigia.rearmar()
      vi.advanceTimersByTime(8_000)
      expect(aoFalhar).toHaveBeenCalledTimes(2)
      vigia.parar()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('anúncio do voto', () => {
  it('concorda no singular', () => {
    const b = ficha({ votos: { confirma: 1, contesta: 0, resolvida: 0 } })
    expect(textoVotoRegistrado('confirma', b)).toBe('Voto registrado. Agora é 1 confirmação. Ainda não muda a rota. Falta 1 confirmação.')
  })

  it('o plural é o do spec', () => {
    const b = ficha({ status: 'validada', votos: { confirma: 2, contesta: 0, resolvida: 0 } })
    expect(textoVotoRegistrado('confirma', b)).toBe('Voto registrado. Agora são 2 confirmações. A rota evita este ponto.')
  })

  it('"Não existe" fala do próprio voto, não de confirmações', () => {
    const b = ficha({ votos: { confirma: 0, contesta: 1, resolvida: 0 } })
    expect(textoVotoRegistrado('contesta', b)).toBe('Voto registrado. Agora é 1 voto de que não existe. Com 2, a votação encerra.')
  })

  it('"Já resolvida" também', () => {
    const b = ficha({ votos: { confirma: 0, contesta: 0, resolvida: 1 } })
    expect(textoVotoRegistrado('resolvida', b)).toBe('Voto registrado. Agora é 1 voto de que foi resolvida. Com 2, a votação encerra.')
  })
})

describe('guarda de chave no build', () => {
  it('sem chave ou com publishable, segue', () => {
    expect(() => conferirChaves({})).not.toThrow()
    expect(() => conferirChaves({ VITE_SUPABASE_PUBLISHABLE_KEY: '' })).not.toThrow()
    expect(() => conferirChaves({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc', VITE_API_URL: 'http://localhost:8000' })).not.toThrow()
  })

  it('chave secreta, JWT ou outra chave param o build sem repetir o valor', () => {
    for (const valor of ['sb_secret_abc', 'eyJhbGciOi.xx.yy', 'qualquer']) {
      expect(() => conferirChaves({ VITE_SUPABASE_PUBLISHABLE_KEY: valor })).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/)
    }
    let mensagem = ''
    try {
      conferirChaves({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' })
    } catch (e) {
      mensagem = (e as Error).message
    }
    expect(mensagem).not.toContain('sb_secret_abc')
  })

  it('segredo em qualquer outra variável VITE_ também para', () => {
    expect(() => conferirChaves({ VITE_OUTRA: 'sb_secret_abc' })).toThrow(/VITE_OUTRA/)
    expect(() => conferirChaves({ VITE_OUTRA: 'eyJhbGciOiJIUzI1NiJ9.abc.def' })).toThrow(/VITE_OUTRA/)
  })
})

describe('import.meta.env', () => {
  const CRUS = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

  it('nenhum código de produção usa o objeto inteiro: o Vite publicaria toda variável VITE_', () => {
    const achados = Object.entries(CRUS)
      .filter(([caminho]) => !caminho.includes('/test/'))
      .filter(([, texto]) => /import\.meta\.env(?![.\w])/.test(texto))
      .map(([caminho]) => caminho)
    expect(achados).toEqual([])
  })
})

describe('corpo da resposta a caminho', () => {
  function respostaQueFalhaNoCorpo(erro: unknown) {
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: () => Promise.reject(erro) } as unknown as Response
  }

  function fetchCom(resposta: Response) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/health') ? Response.json({ status: 'ok', banco: 'ok' }) : resposta)))
  }

  it('cancelar é cancelamento, não "serviço indisponível"', async () => {
    fetchCom(respostaQueFalhaNoCorpo(new DOMException('Aborted', 'AbortError')))
    const controle = new AbortController()
    controle.abort()
    const erro = await pedir('/api/geocode', { sinal: controle.signal }).catch((e: unknown) => e)
    expect(ehCancelamento(erro)).toBe(true)
  })

  it('o teto da operação é "tempo"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      fetchCom({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => new Promise((_, falhar) => setTimeout(() => falhar(new DOMException('Aborted', 'AbortError')), 50)),
      } as unknown as Response)
      const pedido = pedir('/api/geocode', { tempoMs: 10 }).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(100)
      expect(await pedido).toMatchObject({ tipo: 'tempo' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('a conexão que cai no meio do corpo é rede', async () => {
    fetchCom(respostaQueFalhaNoCorpo(new TypeError('network error')))
    expect(await pedir('/api/geocode').catch((e: unknown) => e)).toMatchObject({ tipo: 'rede' })
  })

  it('JSON inválido continua sendo "indisponível"', async () => {
    fetchCom(respostaQueFalhaNoCorpo(new SyntaxError('Unexpected token')))
    const erro = await pedir('/api/geocode').catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(ErroApi)
    expect(erro).toMatchObject({ tipo: 'indisponivel' })
  })
})

describe('o endereço não fica no cache do navegador', () => {
  it('geocode e reverso pedem sem cache e sem cabeçalho novo, para continuar sem preflight', async () => {
    const api = apiFalsa({ 'GET /api/geocode': Response.json([]), 'GET /api/geocode/reverso': Response.json({}) })
    await buscarEnderecos('rua da minha casa')
    await enderecoDoPonto(-23.59, -46.635)
    expect(api.de('GET /api/geocode')[0].init.cache).toBe('no-store')
    expect(api.de('GET /api/geocode/reverso')[0].init.cache).toBe('no-store')
    expect(api.de('GET /api/geocode')[0].init.headers).toEqual({})
  })
})

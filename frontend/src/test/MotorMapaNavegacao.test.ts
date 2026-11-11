import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cena, LonLat } from '../dados/navegacao/mapaNavegacao'
import fonteMotor from '../componentes/mapa/MotorMapaNavegacao.ts?raw'

/* ---------- dublês do maplibre-gl e do pmtiles (registram as chamadas) ---------- */

const estado = vi.hoisted(() => {
  type Ouvinte = (dados?: unknown) => void
  class MapaFalso {
    opcoes: Record<string, unknown>
    ouvintes = new Map<string, Set<Ouvinte>>()
    fontes: Record<string, { setData: ReturnType<typeof vi.fn> }> = {}
    canvas: HTMLCanvasElement
    /** Rumo desenhado e giro em andamento, como no MapLibre 6.16: o jumpTo para o giro onde ele estiver. */
    rumo = 0
    girando = false
    alvoGiro = 0
    jumpTo = vi.fn((o: { bearing?: number } = {}) => {
      if (this.girando) {
        this.girando = false
        this.rumo = this.rumo + (this.alvoGiro - this.rumo) / 2 // parado no meio (camera.ts: stop())
      }
      if (o.bearing !== undefined && o.bearing !== this.rumo) {
        this.rumo = o.bearing
        this.emitir('rotate')
      }
      this.emitir('moveend')
    })
    rotateTo = vi.fn<(alvo: number, opcoes?: { duration: number; easing: (t: number) => number }) => void>((alvo) => {
      this.girando = true
      this.alvoGiro = alvo
    })
    /** O giro de 200 ms chega ao fim sem interrupção. */
    terminarGiro() {
      if (!this.girando) return
      this.girando = false
      this.rumo = this.alvoGiro
      this.emitir('rotate')
      this.emitir('moveend')
    }
    isRotating = vi.fn(() => this.girando)
    getBearing = vi.fn(() => (this.rumo > 180 ? this.rumo - 360 : this.rumo))
    getCenter = vi.fn(() => ({ lng: -46.65, lat: -23.56 }))
    fitBounds = vi.fn()
    easeTo = vi.fn()
    flyTo = vi.fn()
    /** O estilo em vigor (o da criação ou o do último setStyle), para o getLayer responder de verdade. */
    estilo: { layers?: { id: string }[] }
    setStyle = vi.fn((estilo: { name?: string; layers?: { id: string }[] }) => {
      this.estilo = estilo
    })
    getLayer = vi.fn((id: string) => this.estilo.layers?.find((l) => l.id === id))
    setLayoutProperty = vi.fn()
    remove = vi.fn()
    constructor(opcoes: Record<string, unknown>) {
      this.opcoes = opcoes
      this.estilo = opcoes.style as { layers?: { id: string }[] }
      // como o MapLibre faz: o canvas recebe papel e nome próprios (e aqui um tabindex focável,
      // para provar que o motor o tira da ordem de foco)
      const container = opcoes.container as HTMLElement
      const contem = document.createElement('div')
      contem.className = 'maplibregl-canvas-container'
      this.canvas = document.createElement('canvas')
      this.canvas.setAttribute('tabindex', '0')
      this.canvas.setAttribute('role', 'region')
      this.canvas.setAttribute('aria-label', 'Map')
      contem.appendChild(this.canvas)
      container.appendChild(contem)
      estado.mapas.push(this)
    }
    on(evento: string, fn: Ouvinte) {
      if (!this.ouvintes.has(evento)) this.ouvintes.set(evento, new Set())
      this.ouvintes.get(evento)!.add(fn)
      return this
    }
    off(evento: string, fn: Ouvinte) {
      this.ouvintes.get(evento)?.delete(fn)
      return this
    }
    emitir(evento: string, dados?: unknown) {
      for (const fn of [...(this.ouvintes.get(evento) ?? [])]) fn(dados)
    }
    getSource(id: string) {
      this.fontes[id] ??= { setData: vi.fn() }
      return this.fontes[id]
    }
    getCanvas() {
      return this.canvas
    }
    getCanvasContainer() {
      return this.canvas.parentElement as HTMLElement
    }
  }
  return {
    MapaFalso,
    mapas: [] as InstanceType<typeof MapaFalso>[],
    addProtocol: vi.fn(),
    setWorkerUrl: vi.fn(),
    urlsPmtiles: [] as string[],
    fontesPmtiles: [] as { url: string; chromeWindowsNoCache: boolean; mustReload: boolean }[],
    protocolosAdd: vi.fn(),
    getHeader: vi.fn<() => Promise<unknown>>(),
  }
})

vi.mock('maplibre-gl', () => ({
  Map: estado.MapaFalso,
  addProtocol: estado.addProtocol,
  setWorkerUrl: estado.setWorkerUrl,
}))

vi.mock('pmtiles', () => ({
  // como o pmtiles 4.5: o construtor grava mustReload; no Chrome do Windows liga chromeWindowsNoCache
  FetchSource: class {
    url: string
    chromeWindowsNoCache: boolean
    mustReload: boolean
    constructor(url: string) {
      this.url = url
      this.mustReload = false
      this.chromeWindowsNoCache = false
    }
  },
  PMTiles: class {
    url: string
    constructor(fonte: string | { url: string; chromeWindowsNoCache: boolean; mustReload: boolean }) {
      this.url = typeof fonte === 'string' ? fonte : fonte.url
      if (typeof fonte !== 'string') estado.fontesPmtiles.push(fonte)
      estado.urlsPmtiles.push(this.url)
    }
    getHeader() {
      return estado.getHeader()
    }
  },
  Protocol: class {
    tile = vi.fn()
    add = estado.protocolosAdd
  },
}))

type ModuloMotor = typeof import('../componentes/mapa/MotorMapaNavegacao')

/* ---------- ambiente: WebGL, matchMedia, quadros e aba ---------- */

type ConsultaFalsa = {
  media: string
  matches: boolean
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  mudar: (matches: boolean) => void
}
let consultas: Record<string, ConsultaFalsa>
let quadros: Map<number, FrameRequestCallback>
let proximoQuadro: number
let oculta: boolean

function consulta(media: string): ConsultaFalsa {
  if (consultas[media]) return consultas[media]
  const ouvintes = new Set<(ev: { matches: boolean }) => void>()
  const c: ConsultaFalsa = {
    media,
    matches: false,
    addEventListener: vi.fn((_: string, fn: (ev: { matches: boolean }) => void) => ouvintes.add(fn)),
    removeEventListener: vi.fn((_: string, fn: (ev: { matches: boolean }) => void) => ouvintes.delete(fn)),
    mudar(matches: boolean) {
      c.matches = matches
      for (const fn of [...ouvintes]) fn({ matches })
    },
  }
  consultas[media] = c
  return c
}

function rodarQuadros() {
  const fila = [...quadros.values()]
  quadros.clear()
  for (const fn of fila) fn(0)
}

function comWebGL(tem: boolean) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() =>
    tem ? ({} as RenderingContext) : null) as HTMLCanvasElement['getContext'])
}

let M: ModuloMotor
let el: HTMLElement

beforeEach(async () => {
  vi.resetModules()
  estado.mapas.length = 0
  estado.urlsPmtiles.length = 0
  estado.fontesPmtiles.length = 0
  estado.addProtocol.mockClear()
  estado.setWorkerUrl.mockClear()
  estado.protocolosAdd.mockClear()
  estado.getHeader.mockReset()
  estado.getHeader.mockResolvedValue({ specVersion: 3 })
  consultas = {}
  quadros = new Map()
  proximoQuadro = 1
  oculta = false
  vi.stubGlobal('matchMedia', vi.fn((q: string) => consulta(q)))
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    const id = proximoQuadro++
    quadros.set(id, fn)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => quadros.delete(id))
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => oculta)
  comWebGL(true)
  el = document.createElement('div')
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 300 })
  document.body.appendChild(el)
  M = await import('../componentes/mapa/MotorMapaNavegacao')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('style')
})

function opcoes(extra: Partial<Parameters<ModuloMotor['criarMotor']>[1]> = {}) {
  return { reduzido: () => false, aoFalhar: vi.fn(), aoFaltarParte: vi.fn(), ...extra }
}

/** Cria o motor e emite o style.load e o load do mapa falso. */
async function motorPronto(extra: Partial<Parameters<ModuloMotor['criarMotor']>[1]> = {}) {
  const op = opcoes(extra)
  const motor = await M.criarMotor(el, op)
  const mapa = estado.mapas.at(-1)!
  mapa.emitir('style.load')
  mapa.emitir('load')
  return { motor, mapa, op }
}

/* ---------- cenas ---------- */

const A: LonLat = [-46.65, -23.56]
const B: LonLat = [-46.649, -23.56]
const C: LonLat = [-46.649, -23.559]

function cenaSeguir(extra: { centro?: LonLat; rumo?: number; pessoaAbaixo?: boolean } = {}): Cena {
  const centro = extra.centro ?? A
  return {
    andado: [A, centro],
    restante: [centro, B, C],
    manobra: { trecho: [B, C], ponto: B },
    setaManobra: null,
    destino: C,
    pessoa: { ponto: centro, encaixada: true, raioPrecisaoM: null },
    camera: { modo: 'seguir', centro, rumo: extra.rumo ?? 0, pessoaAbaixo: extra.pessoaAbaixo ?? false },
    rumoAplicado: extra.rumo ?? 0,
  }
}

const cenaCongelada = (): Cena => ({ ...cenaSeguir(), camera: { modo: 'congelar' } })

const cenaEnquadrar = (): Cena => ({
  ...cenaSeguir(),
  pessoa: null,
  andado: null,
  camera: { modo: 'enquadrar', caixa: [A, C], rumo: 0 },
})

const nenhumDeslize = (mapa: InstanceType<typeof estado.MapaFalso>) => {
  expect(mapa.easeTo).not.toHaveBeenCalled()
  expect(mapa.flyTo).not.toHaveBeenCalled()
}

/* ---------- antes de criar o mapa ---------- */

describe('criarMotor: antes do mapa', () => {
  it('sem WebGL avisa sem_webgl e não cria o Map nem pede o arquivo', async () => {
    comWebGL(false)
    const op = opcoes()
    await expect(M.criarMotor(el, op)).rejects.toMatchObject({ motivo: 'sem_webgl' })
    expect(op.aoFalhar).toHaveBeenCalledExactlyOnceWith('sem_webgl')
    expect(estado.mapas).toHaveLength(0)
    expect(estado.urlsPmtiles).toHaveLength(0)
    expect(op.aoFaltarParte).not.toHaveBeenCalled()
  })

  it('cabeçalho do pmtiles rejeitado (404, 503, rede) avisa nao_carregou e não cria o Map', async () => {
    estado.getHeader.mockRejectedValue(new Error('404'))
    const op = opcoes()
    await expect(M.criarMotor(el, op)).rejects.toMatchObject({ motivo: 'nao_carregou' })
    expect(op.aoFalhar).toHaveBeenCalledExactlyOnceWith('nao_carregou')
    expect(estado.mapas).toHaveLength(0)
  })

  it('cabeçalho que não responde em 8 s avisa nao_carregou', async () => {
    vi.useFakeTimers()
    estado.getHeader.mockReturnValue(new Promise(() => {}))
    const op = opcoes()
    const criando = M.criarMotor(el, op)
    const resultado = criando.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(7999)
    expect(op.aoFalhar).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await resultado).toMatchObject({ motivo: 'nao_carregou' })
    expect(op.aoFalhar).toHaveBeenCalledExactlyOnceWith('nao_carregou')
    expect(estado.mapas).toHaveLength(0)
  })

  it('pede o cabeçalho só ao próprio site e registra esse arquivo no protocolo', async () => {
    await M.criarMotor(el, opcoes())
    expect(estado.urlsPmtiles).toEqual(['/mapa/rota-falada-sp-20261109.pmtiles'])
    expect(estado.protocolosAdd).toHaveBeenCalledTimes(1)
  })

  it('pede os pedaços sem gravar no cache HTTP (no-store), nem o reload depois de uma ETag diferente', async () => {
    await M.criarMotor(el, opcoes())
    expect(estado.fontesPmtiles).toHaveLength(1)
    const fonte = estado.fontesPmtiles[0]
    expect(fonte.url).toBe('/mapa/rota-falada-sp-20261109.pmtiles')
    expect(fonte.chromeWindowsNoCache).toBe(true)
    fonte.mustReload = true // o pmtiles faz isso depois de uma ETag diferente
    expect(fonte.mustReload).toBe(false)
  })

  it('worker do MapLibre da mesma origem (sem blob, sem http)', async () => {
    await M.criarMotor(el, opcoes())
    expect(estado.setWorkerUrl).toHaveBeenCalledTimes(1)
    const url = estado.setWorkerUrl.mock.calls[0][0] as string
    expect(url).toMatch(/maplibre-gl-worker/)
    expect(url).not.toMatch(/^(https?:|blob:)/)
  })

  it('addProtocol("pmtiles") só uma vez em duas criações', async () => {
    const m1 = await M.criarMotor(el, opcoes())
    m1.destruir()
    await M.criarMotor(el, opcoes())
    expect(estado.addProtocol).toHaveBeenCalledTimes(1)
    expect(estado.addProtocol.mock.calls[0][0]).toBe('pmtiles')
    expect(typeof estado.addProtocol.mock.calls[0][1]).toBe('function')
    expect(estado.mapas).toHaveLength(2)
  })
})

/* ---------- criação ---------- */

describe('criarMotor: o mapa', () => {
  it('cria o Map com as opções exatas da spec 9', async () => {
    vi.stubGlobal('devicePixelRatio', 3)
    await M.criarMotor(el, opcoes())
    expect(estado.mapas).toHaveLength(1)
    const o = estado.mapas[0].opcoes
    expect(o).toMatchObject({
      container: el,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      // emenda de 10/11/2026 (decisão do dono): a vista inclinada existe, opcional. O mapa nasce
      // de cima (pitch 0) e o teto é o ângulo fixo de 45°, para os tiles do horizonte não explodirem
      pitch: 0,
      maxPitch: 45,
      pixelRatio: 2,
      maxTileCacheSize: 30,
      refreshExpiredTiles: false,
      minZoom: 14,
      maxZoom: 18,
      zoom: 17,
      locale: { 'Map.Title': '' },
    })
    const [[o1, s1], [l1, n1]] = o.maxBounds as [[number, number], [number, number]]
    expect(o1).toBeCloseTo(-46.73, 6)
    expect(s1).toBeCloseTo(-23.635, 6)
    expect(l1).toBeCloseTo(-46.565, 6)
    expect(n1).toBeCloseTo(-23.5, 6)
    expect(o).not.toHaveProperty('hash')
  })

  it('pixelRatio acompanha o aparelho abaixo de 2', async () => {
    vi.stubGlobal('devicePixelRatio', 1.5)
    await M.criarMotor(el, opcoes())
    expect(estado.mapas[0].opcoes.pixelRatio).toBe(1.5)
  })

  it('o estilo usa só o arquivo do próprio site e o tema claro por padrão', async () => {
    await M.criarMotor(el, opcoes())
    const estilo = estado.mapas[0].opcoes.style as { name: string; sources: Record<string, { url?: string }> }
    expect(estilo.name).toBe('rota-falada-navegacao-claro')
    expect(estilo.sources.protomaps.url).toBe('pmtiles:///mapa/rota-falada-sp-20261109.pmtiles')
    expect(JSON.stringify(estilo)).not.toMatch(/https?:\/\//)
  })

  it('lê as cores dos tokens do documento', async () => {
    document.documentElement.style.setProperty('--tinta', '#010203')
    await M.criarMotor(el, opcoes())
    const estilo = estado.mapas[0].opcoes.style as { layers: { id: string; paint?: Record<string, unknown> }[] }
    const restante = estilo.layers.find((l) => l.id === 'rota-restante')!
    expect(restante.paint!['line-color']).toBe('#010203')
  })

  it('com o tema escuro do aparelho, já nasce escuro', async () => {
    consulta('(prefers-color-scheme: dark)').matches = true
    await M.criarMotor(el, opcoes())
    expect((estado.mapas[0].opcoes.style as { name: string }).name).toBe('rota-falada-navegacao-escuro')
  })

  it('depois do load o canvas sai da ordem de foco e da árvore de acessibilidade', async () => {
    const { mapa } = await motorPronto()
    const canvas = mapa.getCanvas()
    expect(canvas.getAttribute('tabindex')).toBe('-1')
    expect(canvas.getAttribute('aria-hidden')).toBe('true')
    expect(canvas.hasAttribute('role')).toBe(false)
    expect(canvas.hasAttribute('aria-label')).toBe(false)
    expect(mapa.getCanvasContainer().hasAttribute('role')).toBe(false)
    expect(mapa.getCanvasContainer().hasAttribute('aria-label')).toBe(false)
    expect(el.querySelectorAll('[tabindex]:not([tabindex="-1"])')).toHaveLength(0)
  })
})

/* ---------- câmera ---------- */

describe('atualizar: câmera', () => {
  it('seguir chama jumpTo com o centro, zoom 17 e sem margem; nunca desliza', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    expect(mapa.jumpTo).toHaveBeenCalledExactlyOnceWith({
      center: A,
      zoom: 17,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
    })
    motor.atualizar(cenaSeguir({ centro: B }), false)
    expect(mapa.jumpTo).toHaveBeenLastCalledWith({
      center: B,
      zoom: 17,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
    })
    expect(mapa.rotateTo).not.toHaveBeenCalled()
    nenhumDeslize(mapa)
  })

  it('pessoaAbaixo põe 40% da altura no padding.top', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir({ rumo: 90, pessoaAbaixo: true }), true)
    expect(mapa.jumpTo.mock.calls[0][0]).toMatchObject({ padding: { top: 120, bottom: 0, left: 0, right: 0 } })
  })

  it('rumo novo sem movimento reduzido: jumpTo sem bearing e rotateTo de 200 ms', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir({ rumo: 90 }), true)
    expect(mapa.jumpTo.mock.calls[0][0]).not.toHaveProperty('bearing')
    expect(mapa.rotateTo).toHaveBeenCalledTimes(1)
    const [rumo, op] = mapa.rotateTo.mock.calls[0]
    expect(rumo).toBe(90)
    expect(op.duration).toBe(200)
    expect(op.easing(0)).toBe(0)
    expect(op.easing(1)).toBe(1)
    expect(op.easing(0.5)).toBeGreaterThan(0.5) // desacelera no fim (ease-out)
    nenhumDeslize(mapa)
  })

  it('rumo novo com movimento reduzido vai no próprio jumpTo, sem rotateTo', async () => {
    const { motor, mapa } = await motorPronto({ reduzido: () => true })
    motor.atualizar(cenaSeguir({ rumo: 90 }), true)
    expect(mapa.jumpTo.mock.calls[0][0]).toMatchObject({ center: A, zoom: 17, bearing: 90 })
    expect(mapa.rotateTo).not.toHaveBeenCalled()
  })

  it('movimento reduzido é lido a cada atualização', async () => {
    let reduzido = true
    const { motor, mapa } = await motorPronto({ reduzido: () => reduzido })
    motor.atualizar(cenaSeguir({ rumo: 90 }), true)
    expect(mapa.rotateTo).not.toHaveBeenCalled()
    reduzido = false
    motor.atualizar(cenaSeguir({ rumo: 180 }), true)
    expect(mapa.rotateTo).toHaveBeenCalledExactlyOnceWith(180, expect.objectContaining({ duration: 200 }))
  })

  it('mesmo rumo de novo não gira', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir({ rumo: 90 }), true)
    motor.atualizar(cenaSeguir({ rumo: 90, centro: B }), true)
    expect(mapa.rotateTo).toHaveBeenCalledTimes(1)
    expect(mapa.jumpTo).toHaveBeenCalledTimes(2)
  })

  it('girar desligado fica com o norte para cima, mesmo com rumo na cena', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir({ rumo: 90 }), false)
    expect(mapa.rotateTo).not.toHaveBeenCalled()
    expect(mapa.jumpTo.mock.calls[0][0]).not.toHaveProperty('bearing')
  })

  it('desligar girar volta o norte com a mesma regra (200 ms ou instantâneo)', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir({ rumo: 90 }), true)
    motor.atualizar(cenaSeguir({ rumo: 90 }), false)
    expect(mapa.rotateTo).toHaveBeenLastCalledWith(0, expect.objectContaining({ duration: 200 }))

    const r = await motorPronto({ reduzido: () => true })
    r.motor.atualizar(cenaSeguir({ rumo: 90 }), true)
    r.motor.atualizar(cenaSeguir({ rumo: 90 }), false)
    expect(r.mapa.jumpTo).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 0 }))
    expect(r.mapa.rotateTo).not.toHaveBeenCalled()
  })

  it('uma leitura no meio do giro não deixa o mapa preso num ângulo do meio', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir({ rumo: 90 }), true)
    expect(mapa.isRotating()).toBe(true)
    // o tique ou o GPS chegam antes dos 200 ms: o jumpTo leva o rumo-alvo junto
    motor.atualizar(cenaSeguir({ rumo: 90, centro: B }), true)
    expect(mapa.jumpTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: B, bearing: 90 }))
    expect(mapa.rumo).toBe(90)
    expect(mapa.rotateTo).toHaveBeenCalledTimes(1)
    nenhumDeslize(mapa)
  })

  it('sem giro em andamento, a posição vai sem bearing (o rumo fica como está)', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir({ rumo: 90 }), true)
    mapa.terminarGiro()
    motor.atualizar(cenaSeguir({ rumo: 90, centro: B }), true)
    expect(mapa.jumpTo.mock.calls.at(-1)![0]).not.toHaveProperty('bearing')
    expect(mapa.rumo).toBe(90)
  })

  it('a mesma câmera não chama jumpTo de novo: o tique com a pessoa parada não redesenha', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    motor.atualizar(cenaSeguir(), false)
    motor.atualizar({ ...cenaSeguir(), andado: [A, A] }, false)
    expect(mapa.jumpTo).toHaveBeenCalledTimes(1)
    // menos de 1 m também não
    motor.atualizar(cenaSeguir({ centro: [A[0] + 0.000001, A[1]] }), false)
    expect(mapa.jumpTo).toHaveBeenCalledTimes(1)
    // a margem muda (pessoa abaixo) ou o centro muda: aplica
    motor.atualizar(cenaSeguir({ pessoaAbaixo: true }), false)
    motor.atualizar(cenaSeguir({ centro: B, pessoaAbaixo: true }), false)
    expect(mapa.jumpTo).toHaveBeenCalledTimes(3)
  })

  it('depois de enquadrar ou congelar, a mesma posição volta a ser aplicada', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    motor.atualizar(cenaEnquadrar(), false)
    motor.atualizar(cenaSeguir(), false)
    expect(mapa.jumpTo).toHaveBeenCalledTimes(2)
  })

  it('o rumo real do mapa vai para aoMudarRumo e para data-rumo, a cada quadro e no fim', async () => {
    const aoMudarRumo = vi.fn()
    const { motor, mapa } = await motorPronto({ aoMudarRumo })
    expect(el.dataset.rumo).toBe('0')
    motor.atualizar(cenaSeguir({ rumo: 270 }), true)
    mapa.terminarGiro()
    expect(aoMudarRumo).toHaveBeenLastCalledWith(270)
    expect(el.dataset.rumo).toBe('270')
    motor.atualizar(cenaSeguir({ rumo: 270 }), false)
    mapa.terminarGiro()
    expect(aoMudarRumo).toHaveBeenLastCalledWith(0)
    expect(el.dataset.rumo).toBe('0')
  })

  it('enquadrar usa fitBounds sem animação, margem 24 e norte para cima', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaEnquadrar(), true)
    expect(mapa.fitBounds).toHaveBeenCalledExactlyOnceWith([A, C], { animate: false, padding: 24, bearing: 0 })
    expect(mapa.jumpTo).not.toHaveBeenCalled()
    nenhumDeslize(mapa)
  })

  it('depois de enquadrar, voltar a seguir com rumo gira a partir do norte', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir({ rumo: 90 }), true)
    motor.atualizar(cenaEnquadrar(), true)
    motor.atualizar(cenaSeguir({ rumo: 90 }), true)
    expect(mapa.rotateTo).toHaveBeenCalledTimes(2)
  })

  it('congelar não mexe na câmera', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaCongelada(), true)
    expect(mapa.jumpTo).not.toHaveBeenCalled()
    expect(mapa.fitBounds).not.toHaveBeenCalled()
    expect(mapa.rotateTo).not.toHaveBeenCalled()
    nenhumDeslize(mapa)
  })

  it('congelado e girado, desligar girar volta o norte sem mexer no centro (o rótulo diz norte)', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir({ rumo: 90 }), true)
    mapa.jumpTo.mockClear()
    motor.atualizar(cenaCongelada(), false)
    expect(mapa.rotateTo).toHaveBeenLastCalledWith(0, expect.objectContaining({ duration: 200 }))
    expect(mapa.jumpTo).not.toHaveBeenCalled()
    // de novo congelado e já no norte: não gira outra vez
    motor.atualizar(cenaCongelada(), false)
    expect(mapa.rotateTo).toHaveBeenCalledTimes(2)
    nenhumDeslize(mapa)

    const r = await motorPronto({ reduzido: () => true })
    r.motor.atualizar(cenaSeguir({ rumo: 90 }), true)
    r.motor.atualizar(cenaCongelada(), false)
    expect(r.mapa.jumpTo).toHaveBeenLastCalledWith({ bearing: 0 })
    expect(r.mapa.rotateTo).not.toHaveBeenCalled()
  })

  it('congelado com girar ligado mantém o rumo que já tem', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir({ rumo: 90 }), true)
    motor.atualizar(cenaCongelada(), true)
    expect(mapa.rotateTo).toHaveBeenCalledTimes(1)
    expect(mapa.jumpTo).toHaveBeenCalledTimes(1)
  })
})

/* ---------- vista inclinada e prédios (emenda de 10/11/2026, 19.2) ---------- */

describe('atualizar: vista inclinada', () => {
  const predios = (mapa: InstanceType<typeof estado.MapaFalso>) =>
    mapa.setLayoutProperty.mock.calls.filter((c) => c[0] === 'predios-3d').map((c) => c[2])

  it('o ângulo é fixo em 45° e é o teto do mapa', async () => {
    expect(M.INCLINACAO_GRAUS).toBe(45)
    await M.criarMotor(el, opcoes())
    expect(estado.mapas[0].opcoes.maxPitch).toBe(45)
    expect(M.INCLINACAO_GRAUS).toBeLessThanOrEqual(60) // limite estável do MapLibre
  })

  it('desligada por padrão: nenhum pitch no jumpTo, prédios escondidos, sinais em 0/nao', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    expect(mapa.jumpTo.mock.calls[0][0]).not.toHaveProperty('pitch')
    expect(el.dataset.inclinacao).toBe('0')
    expect(el.dataset.predios).toBe('nao')
    expect(predios(mapa)).not.toContain('visible')
  })

  it('ligar inclina num salto só (jumpTo com pitch 45), põe a pessoa no terço de baixo e mostra os prédios', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    motor.atualizar(cenaSeguir(), false, true)
    expect(mapa.jumpTo).toHaveBeenLastCalledWith({
      center: A,
      zoom: 17,
      padding: { top: 120, bottom: 0, left: 0, right: 0 },
      pitch: 45,
    })
    expect(el.dataset.inclinacao).toBe('45')
    expect(el.dataset.predios).toBe('sim')
    expect(predios(mapa).at(-1)).toBe('visible')
    expect(mapa.rotateTo).not.toHaveBeenCalled()
    nenhumDeslize(mapa)
  })

  it('com movimento reduzido a troca é o mesmo salto: nada anima', async () => {
    const { motor, mapa } = await motorPronto({ reduzido: () => true })
    motor.atualizar(cenaSeguir(), false, true)
    expect(mapa.jumpTo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ pitch: 45 }))
    expect(mapa.rotateTo).not.toHaveBeenCalled()
    nenhumDeslize(mapa)
  })

  it('inclinada e parada: o tique não redesenha; andando, o salto seguinte não repete o pitch', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false, true)
    motor.atualizar(cenaSeguir(), false, true)
    expect(mapa.jumpTo).toHaveBeenCalledTimes(1)
    motor.atualizar(cenaSeguir({ centro: B }), false, true)
    expect(mapa.jumpTo).toHaveBeenCalledTimes(2)
    expect(mapa.jumpTo.mock.calls[1][0]).not.toHaveProperty('pitch')
    expect(mapa.jumpTo.mock.calls[1][0]).toMatchObject({ padding: { top: 120 } })
  })

  it('desligar volta a ver de cima num salto e esconde os prédios', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false, true)
    motor.atualizar(cenaSeguir(), false, false)
    expect(mapa.jumpTo).toHaveBeenLastCalledWith({
      center: A,
      zoom: 17,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
      pitch: 0,
    })
    expect(el.dataset.inclinacao).toBe('0')
    expect(el.dataset.predios).toBe('nao')
    expect(predios(mapa).at(-1)).toBe('none')
  })

  it('inclinar e girar juntos: o pitch vai no salto e o giro continua com a regra dele', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir({ rumo: 90, pessoaAbaixo: true }), true, true)
    expect(mapa.jumpTo.mock.calls[0][0]).toMatchObject({ pitch: 45, padding: { top: 120 } })
    expect(mapa.jumpTo.mock.calls[0][0]).not.toHaveProperty('bearing')
    expect(mapa.rotateTo).toHaveBeenCalledExactlyOnceWith(90, expect.objectContaining({ duration: 200 }))
  })

  it('enquadrar (passo a passo) fica de cima mesmo com a vista inclinada ligada; ao voltar a seguir, inclina de novo', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false, true)
    motor.atualizar(cenaEnquadrar(), false, true)
    expect(mapa.jumpTo).toHaveBeenLastCalledWith({ pitch: 0 })
    expect(mapa.fitBounds).toHaveBeenCalledExactlyOnceWith([A, C], { animate: false, padding: 24, bearing: 0 })
    expect(el.dataset.inclinacao).toBe('0')
    expect(el.dataset.predios).toBe('nao')
    motor.atualizar(cenaSeguir(), false, true)
    expect(mapa.jumpTo).toHaveBeenLastCalledWith(expect.objectContaining({ pitch: 45 }))
    expect(el.dataset.predios).toBe('sim')
  })

  it('congelado, a escolha da vista vale na hora, sem mexer no centro', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    mapa.jumpTo.mockClear()
    motor.atualizar(cenaCongelada(), false, true)
    expect(mapa.jumpTo).toHaveBeenCalledExactlyOnceWith({ pitch: 45 })
    expect(el.dataset.inclinacao).toBe('45')
    motor.atualizar(cenaCongelada(), false, true)
    expect(mapa.jumpTo).toHaveBeenCalledTimes(1)
  })

  it('ao voltar à aba, a inclinação vai no mesmo salto instantâneo', async () => {
    const { motor, mapa } = await motorPronto()
    oculta = true
    motor.atualizar(cenaSeguir({ centro: B }), false, true)
    expect(mapa.jumpTo).not.toHaveBeenCalled()
    oculta = false
    document.dispatchEvent(new Event('visibilitychange'))
    expect(mapa.jumpTo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ center: B, pitch: 45, bearing: 0 }))
    nenhumDeslize(mapa)
  })

  it('no alto contraste não há prédios: a camada nem existe no estilo, e a vista inclina mesmo assim', async () => {
    consulta('(forced-colors: active)').matches = true
    const { motor, mapa } = await motorPronto()
    expect((mapa.opcoes.style as { name: string }).name).toBe('rota-falada-navegacao-contraste')
    motor.atualizar(cenaSeguir(), false, true)
    expect(el.dataset.inclinacao).toBe('45')
    expect(el.dataset.predios).toBe('nao')
    expect(mapa.setLayoutProperty).not.toHaveBeenCalled()
  })

  it('quem pede mais contraste (prefers-contrast: more) não recebe os prédios, e a mudança vale na hora', async () => {
    const mais = consulta('(prefers-contrast: more)')
    mais.matches = true
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false, true)
    expect(el.dataset.inclinacao).toBe('45')
    expect(el.dataset.predios).toBe('nao')
    expect(predios(mapa)).not.toContain('visible')
    mais.mudar(false)
    expect(el.dataset.predios).toBe('sim')
    expect(predios(mapa).at(-1)).toBe('visible')
    mais.mudar(true)
    expect(predios(mapa).at(-1)).toBe('none')
  })

  it('trocar o tema com a vista inclinada: o estilo novo carrega e os prédios voltam a aparecer', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false, true)
    motor.trocarTema('escuro')
    mapa.setLayoutProperty.mockClear()
    mapa.emitir('style.load')
    expect(predios(mapa)).toEqual(['visible'])
    // e ao cair no alto contraste, somem
    consulta('(forced-colors: active)').mudar(true)
    mapa.emitir('style.load')
    expect(el.dataset.predios).toBe('nao')
  })
})

/* ---------- seta da pessoa (emenda de 10/11/2026, 19.4) ---------- */

describe('apontar: a seta da pessoa', () => {
  it('sem direção, a fonte da seta não é escrita (anel sem seta)', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    rodarQuadros()
    expect(mapa.fontes.seta).toBeUndefined()
  })

  it('com direção, escreve um triângulo fechado no ponto da pessoa, com o bico para o rumo dado', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    motor.apontar(90)
    rodarQuadros()
    const dados = mapa.fontes.seta.setData.mock.calls[0][0]
    expect(dados.features).toHaveLength(1)
    expect(dados.features[0].geometry.type).toBe('Polygon')
    const anel = dados.features[0].geometry.coordinates[0] as LonLat[]
    expect(anel).toHaveLength(4)
    expect(anel[3]).toEqual(anel[0])
    // rumo 90 = leste: o bico fica a leste do ponto, na mesma latitude, a cerca de 15 m
    expect(anel[0][0]).toBeGreaterThan(A[0])
    expect(anel[0][1]).toBeCloseTo(A[1], 7)
    expect((anel[0][0] - A[0]) * 111_195 * Math.cos((A[1] * Math.PI) / 180)).toBeCloseTo(15, 0)
  })

  it('a mesma direção não reescreve; menos de 1° também não; uma direção nova reescreve só a seta', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    motor.apontar(90)
    rodarQuadros()
    motor.apontar(90)
    motor.apontar(90.3)
    rodarQuadros()
    expect(mapa.fontes.seta.setData).toHaveBeenCalledTimes(1)
    motor.apontar(120)
    rodarQuadros()
    expect(mapa.fontes.seta.setData).toHaveBeenCalledTimes(2)
    for (const id of ['rota', 'manobra', 'pessoa']) expect(mapa.fontes[id].setData).toHaveBeenCalledTimes(1)
    // a seta não mexe na câmera
    expect(mapa.jumpTo).toHaveBeenCalledTimes(1)
    nenhumDeslize(mapa)
  })

  it('a seta acompanha o ponto da pessoa', async () => {
    const { motor, mapa } = await motorPronto()
    motor.apontar(0)
    motor.atualizar(cenaSeguir(), false)
    rodarQuadros()
    motor.atualizar(cenaSeguir({ centro: B }), false)
    rodarQuadros()
    expect(mapa.fontes.seta.setData).toHaveBeenCalledTimes(2)
    const anel = mapa.fontes.seta.setData.mock.calls[1][0].features[0].geometry.coordinates[0] as LonLat[]
    expect(anel[0][0]).toBeCloseTo(B[0], 7)
    expect(anel[0][1]).toBeGreaterThan(B[1]) // rumo 0 = norte
  })

  it('apontar(null), valor não numérico ou cena sem pessoa esvaziam a seta', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    motor.apontar(45)
    rodarQuadros()
    motor.apontar(null)
    rodarQuadros()
    expect(mapa.fontes.seta.setData.mock.calls.at(-1)![0].features).toEqual([])
    motor.apontar(Number.NaN)
    rodarQuadros()
    expect(mapa.fontes.seta.setData).toHaveBeenCalledTimes(2)
    motor.apontar(45)
    rodarQuadros()
    motor.atualizar(cenaEnquadrar(), false)
    rodarQuadros()
    expect(mapa.fontes.seta.setData.mock.calls.at(-1)![0].features).toEqual([])
  })

  it('com a aba escondida nada é escrito; depois de destruído, apontar não faz nada', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    rodarQuadros()
    oculta = true
    motor.apontar(10)
    rodarQuadros()
    expect(mapa.fontes.seta).toBeUndefined()
    motor.destruir()
    motor.apontar(20)
    expect(quadros.size).toBe(0)
  })

  it('a direção nunca vai para o DOM', async () => {
    const { motor } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    motor.apontar(123)
    rodarQuadros()
    expect(JSON.stringify({ ...el.dataset })).not.toContain('123')
    expect(el.outerHTML).not.toContain('123')
  })
})

/* ---------- seta de manobra (emenda de 10/11/2026, 19.1) ---------- */

describe('atualizar: seta de manobra', () => {
  const HASTE: LonLat[] = [A, B, C]
  const PONTA: LonLat[] = [C, B, A, C]

  it('com seta, a fonte da manobra leva a haste e a ponta marcadas com parte = seta', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar({ ...cenaSeguir(), setaManobra: { haste: HASTE, ponta: PONTA } }, false)
    rodarQuadros()
    const manobra = mapa.fontes.manobra.setData.mock.calls[0][0]
    expect(manobra.features).toEqual([
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [B, C] } },
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: B } },
      { type: 'Feature', properties: { parte: 'seta' }, geometry: { type: 'LineString', coordinates: HASTE } },
      { type: 'Feature', properties: { parte: 'seta' }, geometry: { type: 'Polygon', coordinates: [PONTA] } },
    ])
  })

  it('sem manobra não há seta, mesmo que a cena traga uma', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar({ ...cenaSeguir(), manobra: null, setaManobra: { haste: HASTE, ponta: PONTA } }, false)
    rodarQuadros()
    expect(mapa.fontes.manobra.setData.mock.calls[0][0].features).toEqual([])
  })

  it('a seta que aparece ou some reescreve a fonte da manobra', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    rodarQuadros()
    motor.atualizar({ ...cenaSeguir(), setaManobra: { haste: HASTE, ponta: PONTA } }, false)
    rodarQuadros()
    expect(mapa.fontes.manobra.setData).toHaveBeenCalledTimes(2)
  })
})

/* ---------- dados ---------- */

describe('atualizar: dados das fontes', () => {
  it('só escreve as fontes depois que o estilo carregou', async () => {
    const motor = await M.criarMotor(el, opcoes())
    const mapa = estado.mapas[0]
    motor.atualizar(cenaSeguir(), false)
    rodarQuadros()
    expect(Object.keys(mapa.fontes)).toHaveLength(0)
    mapa.emitir('style.load')
    rodarQuadros()
    for (const id of ['rota', 'manobra', 'pessoa']) expect(mapa.fontes[id].setData).toHaveBeenCalledTimes(1)
  })

  it('escreve as features no contrato do estilo', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    rodarQuadros()
    const rota = mapa.fontes.rota.setData.mock.calls[0][0]
    expect(rota.type).toBe('FeatureCollection')
    expect(rota.features).toEqual([
      { type: 'Feature', properties: { parte: 'andado' }, geometry: { type: 'LineString', coordinates: [A, A] } },
      { type: 'Feature', properties: { parte: 'restante' }, geometry: { type: 'LineString', coordinates: [A, B, C] } },
      { type: 'Feature', properties: { parte: 'destino' }, geometry: { type: 'Point', coordinates: C } },
    ])
    const manobra = mapa.fontes.manobra.setData.mock.calls[0][0]
    expect(manobra.features.map((f: { geometry: { type: string } }) => f.geometry.type)).toEqual(['LineString', 'Point'])
    const pessoa = mapa.fontes.pessoa.setData.mock.calls[0][0]
    expect(pessoa.features).toEqual([
      { type: 'Feature', properties: { encaixada: true }, geometry: { type: 'Point', coordinates: A } },
    ])
  })

  it('pessoa fora leva o polígono de precisão em metros', async () => {
    const { motor, mapa } = await motorPronto()
    const cena: Cena = {
      ...cenaSeguir(),
      pessoa: { ponto: A, encaixada: false, raioPrecisaoM: 20 },
      camera: { modo: 'seguir', centro: A, rumo: 0, pessoaAbaixo: false },
    }
    motor.atualizar(cena, false)
    rodarQuadros()
    const pessoa = mapa.fontes.pessoa.setData.mock.calls[0][0]
    const tipos = pessoa.features.map((f: { geometry: { type: string } }) => f.geometry.type)
    expect(tipos).toEqual(['Polygon', 'Point'])
    const anel = pessoa.features[0].geometry.coordinates[0] as LonLat[]
    expect(anel).toHaveLength(33)
    expect(anel[0]).toEqual(anel[32])
    // ~20 m ao norte: 20 / 111 km em latitude
    const norte = Math.max(...anel.map((p) => p[1]))
    expect(norte - A[1]).toBeCloseTo(20 / 110_700, 4)
    expect(pessoa.features[1].properties).toEqual({ encaixada: false })
  })

  it('a mesma cena não reescreve as fontes', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    rodarQuadros()
    motor.atualizar(cenaSeguir(), false)
    rodarQuadros()
    for (const id of ['rota', 'manobra', 'pessoa']) expect(mapa.fontes[id].setData).toHaveBeenCalledTimes(1)
  })

  it('mudança abaixo de 1 m não reescreve; acima, só a fonte que mudou', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    rodarQuadros()
    motor.atualizar(cenaSeguir({ centro: [A[0] + 0.000001, A[1]] }), false) // ~0,1 m
    rodarQuadros()
    expect(mapa.fontes.pessoa.setData).toHaveBeenCalledTimes(1)
    expect(mapa.fontes.rota.setData).toHaveBeenCalledTimes(1)
    motor.atualizar(cenaSeguir({ centro: [A[0] + 0.0001, A[1]] }), false) // ~10 m
    rodarQuadros()
    expect(mapa.fontes.pessoa.setData).toHaveBeenCalledTimes(2)
    expect(mapa.fontes.rota.setData).toHaveBeenCalledTimes(2)
    expect(mapa.fontes.manobra.setData).toHaveBeenCalledTimes(1)
  })

  it('atualizações seguidas são agrupadas num quadro, com a cena mais nova', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    motor.atualizar(cenaSeguir({ centro: B }), false)
    motor.atualizar(cenaSeguir({ centro: C }), false)
    expect(quadros.size).toBe(1)
    rodarQuadros()
    expect(mapa.fontes.pessoa.setData).toHaveBeenCalledTimes(1)
    expect(mapa.fontes.pessoa.setData.mock.calls[0][0].features[0].geometry.coordinates).toEqual(C)
  })

  it('cena sem manobra e sem pessoa esvazia essas fontes', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    rodarQuadros()
    motor.atualizar({ ...cenaEnquadrar(), manobra: null }, false)
    rodarQuadros()
    expect(mapa.fontes.manobra.setData.mock.calls[1][0].features).toEqual([])
    expect(mapa.fontes.pessoa.setData.mock.calls[1][0].features).toEqual([])
  })
})

/* ---------- aba oculta ---------- */

describe('aba oculta', () => {
  it('não mexe em nada escondida e aplica a última cena ao voltar, sem animação', async () => {
    const { motor, mapa } = await motorPronto()
    oculta = true
    motor.atualizar(cenaSeguir({ rumo: 45 }), true)
    motor.atualizar(cenaSeguir({ rumo: 90, centro: B }), true)
    rodarQuadros()
    expect(mapa.jumpTo).not.toHaveBeenCalled()
    expect(mapa.rotateTo).not.toHaveBeenCalled()
    expect(mapa.fontes.pessoa).toBeUndefined()

    oculta = false
    document.dispatchEvent(new Event('visibilitychange'))
    expect(mapa.jumpTo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ center: B, zoom: 17, bearing: 90 }))
    expect(mapa.rotateTo).not.toHaveBeenCalled()
    rodarQuadros()
    expect(mapa.fontes.pessoa.setData).toHaveBeenCalledTimes(1)
    nenhumDeslize(mapa)
  })
})

/* ---------- tema ---------- */

describe('tema', () => {
  it('trocarTema faz setStyle e reaplica a última cena quando o estilo novo carrega', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    rodarQuadros()
    motor.trocarTema('escuro')
    expect(mapa.setStyle).toHaveBeenCalledTimes(1)
    expect(mapa.setStyle.mock.calls[0][0].name).toBe('rota-falada-navegacao-escuro')
    mapa.emitir('style.load')
    rodarQuadros()
    for (const id of ['rota', 'manobra', 'pessoa']) expect(mapa.fontes[id].setData).toHaveBeenCalledTimes(2)
  })

  it('observa o esquema de cor do aparelho', async () => {
    const { mapa } = await motorPronto()
    consulta('(prefers-color-scheme: dark)').mudar(true)
    expect(mapa.setStyle.mock.calls.at(-1)![0].name).toBe('rota-falada-navegacao-escuro')
  })

  it('no alto contraste, as cores vêm da sonda de cores de sistema', async () => {
    const original = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation((alvo: Element, pseudo?: string | null) => {
      const css = original(alvo, pseudo)
      if (!(alvo as HTMLElement).dataset?.sondaMapa) return css
      return { ...css, color: 'rgb(255, 255, 0)', backgroundColor: 'rgb(0, 0, 0)', outlineColor: 'rgb(0, 255, 255)' } as CSSStyleDeclaration
    })
    const { mapa } = await motorPronto()
    consulta('(forced-colors: active)').mudar(true)
    const estilo = mapa.setStyle.mock.calls.at(-1)![0] as { name: string; layers: { id: string; paint?: Record<string, unknown> }[] }
    expect(estilo.name).toBe('rota-falada-navegacao-contraste')
    const pinta = (id: string) => estilo.layers.find((l) => l.id === id)!.paint!
    expect(pinta('rota-restante')['line-color']).toBe('rgb(255, 255, 0)')
    expect(pinta('rota-manobra')['line-color']).toBe('rgb(0, 255, 255)')
    expect(pinta('rota-restante-casing')['line-color']).toBe('rgb(0, 0, 0)')
    expect(document.querySelector('[data-sonda-mapa]')).toBeNull()
  })
})

/* ---------- falhas depois de criado ---------- */

describe('falhas do mapa já criado', () => {
  it('contexto WebGL perdido avisa nao_carregou', async () => {
    const { mapa, op } = await motorPronto()
    mapa.emitir('webglcontextlost', {})
    expect(op.aoFalhar).toHaveBeenCalledExactlyOnceWith('nao_carregou')
  })

  it('3 erros de tile avisam que falta parte, uma vez só', async () => {
    const { mapa, op } = await motorPronto()
    mapa.emitir('error', { sourceId: 'protomaps', tile: {}, error: new Error('x') })
    mapa.emitir('error', { sourceId: 'protomaps', tile: {}, error: new Error('x') })
    expect(op.aoFaltarParte).not.toHaveBeenCalled()
    mapa.emitir('error', { sourceId: 'protomaps', tile: {}, error: new Error('x') })
    mapa.emitir('error', { sourceId: 'protomaps', tile: {}, error: new Error('x') })
    expect(op.aoFaltarParte).toHaveBeenCalledTimes(1)
    expect(op.aoFalhar).not.toHaveBeenCalled()
  })

  it('erro que não é de tile fica contado em data-erros-mapa, sem avisar parte faltando', async () => {
    const { mapa, op } = await motorPronto()
    expect(el.dataset.errosMapa).toBeUndefined()
    mapa.emitir('error', { error: new Error('estilo') })
    mapa.emitir('error', { error: new Error('letra') })
    expect(el.dataset.errosMapa).toBe('2')
    expect(op.aoFaltarParte).not.toHaveBeenCalled()
  })

  it('data-estilo só fica "carregado" depois do style.load e de um idle; trocar o tema volta a "carregando"', async () => {
    const motor = await M.criarMotor(el, opcoes())
    const mapa = estado.mapas.at(-1)!
    expect(el.dataset.estilo).toBe('carregando')
    mapa.emitir('idle')
    expect(el.dataset.estilo).toBe('carregando')
    mapa.emitir('style.load')
    expect(el.dataset.estilo).toBe('carregando')
    mapa.emitir('idle')
    expect(el.dataset.estilo).toBe('carregado')
    motor.trocarTema('escuro')
    expect(el.dataset.estilo).toBe('carregando')
    mapa.emitir('idle')
    expect(el.dataset.estilo).toBe('carregando')
  })

  it('fora do build de E2E, o centro nunca vai para o DOM', async () => {
    const { motor } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    expect(el.dataset.centro).toBeUndefined()
  })

  it('8 s sem idle depois da primeira câmera avisam que falta parte', async () => {
    vi.useFakeTimers()
    const { motor, op } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    vi.advanceTimersByTime(7999)
    expect(op.aoFaltarParte).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(op.aoFaltarParte).toHaveBeenCalledTimes(1)
  })

  it('idle a tempo não avisa', async () => {
    vi.useFakeTimers()
    const { motor, mapa, op } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    vi.advanceTimersByTime(3000)
    mapa.emitir('idle')
    vi.advanceTimersByTime(20_000)
    expect(op.aoFaltarParte).not.toHaveBeenCalled()
  })
})

/* ---------- destruir ---------- */

describe('destruir', () => {
  it('chama remove, tira os ouvintes de matchMedia e de visibilidade e para os quadros', async () => {
    const { motor, mapa } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    const escuro = consulta('(prefers-color-scheme: dark)')
    const contraste = consulta('(forced-colors: active)')
    expect(escuro.addEventListener).toHaveBeenCalledTimes(1)
    expect(contraste.addEventListener).toHaveBeenCalledTimes(1)
    motor.destruir()
    expect(mapa.remove).toHaveBeenCalledTimes(1)
    expect(escuro.removeEventListener).toHaveBeenCalledWith('change', escuro.addEventListener.mock.calls[0][1])
    expect(contraste.removeEventListener).toHaveBeenCalledWith('change', contraste.addEventListener.mock.calls[0][1])
    expect(quadros.size).toBe(0)

    escuro.mudar(true)
    document.dispatchEvent(new Event('visibilitychange'))
    motor.atualizar(cenaSeguir({ centro: B }), false)
    expect(mapa.setStyle).not.toHaveBeenCalled()
    expect(mapa.jumpTo).toHaveBeenCalledTimes(1)
    motor.destruir()
    expect(mapa.remove).toHaveBeenCalledTimes(1)
  })

  it('não avisa falta de parte depois de destruído', async () => {
    vi.useFakeTimers()
    const { motor, op } = await motorPronto()
    motor.atualizar(cenaSeguir(), false)
    motor.destruir()
    vi.advanceTimersByTime(20_000)
    expect(op.aoFaltarParte).not.toHaveBeenCalled()
  })
})

/* ---------- guardas do código ---------- */

describe('guardas do código-fonte', () => {
  it('lê o código de verdade', () => {
    expect(fonteMotor).toContain('export async function criarMotor')
  })

  it('nenhum sensor no motor: a direção chega pronta por apontar()', () => {
    expect(fonteMotor).not.toMatch(/deviceorientation|DeviceOrientationEvent|webkitCompass|geolocation/)
  })

  it('sem console, sem fetch direto, sem flyTo nem easeTo, sem promessas absolutas', () => {
    expect(fonteMotor).not.toMatch(/console\./)
    expect(fonteMotor).not.toMatch(/fetch\(/)
    expect(fonteMotor).not.toMatch(/flyTo|easeTo/)
    expect(fonteMotor).not.toMatch(/garant/i)
  })

  it('sem armazenamento: a posição nunca é gravada', () => {
    expect(fonteMotor).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/)
  })

  it('não troca [lat, lon] por conta própria (isso é só do paraLonLat)', () => {
    expect(fonteMotor).not.toMatch(/\[\s*\w+\[1\]\s*,\s*\w+\[0\]\s*\]/)
  })
})

/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl'
import {
  ARQUIVO_MAPA,
  CAIXA_AREA,
  URL_MAPA,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../componentes/mapa/arquivoMapa'
import {
  CAMADAS_ROTA,
  estiloMapaNavegacao,
  FONTES_ROTA,
  type CoresMapa,
  type Tema,
} from '../componentes/mapa/estiloMapaNavegacao'

// A mesma regex do Worker /mapa/* (spec 7.4).
const REGEX_WORKER = /^\/mapa\/rota-falada-sp-\d{8}\.pmtiles$/

const CORES_CLARO: CoresMapa = {
  vao: '#dfe0db',
  concreto: '#d2d4cf',
  torre: '#c3c6c0',
  placa: '#e6e7e2',
  junta: '#8a8f8a',
  juntaForte: '#5d625e',
  tinta: '#1c1f1d',
  tinta2: '#3a3f3b',
  oxido: '#9a3f2c',
}

// Como o motor monta no alto contraste: só Canvas, CanvasText e Highlight lidos pela sonda.
const CANVAS = 'rgb(1, 2, 3)'
const CANVAS_TEXT = 'rgb(250, 251, 252)'
const HIGHLIGHT = 'rgb(10, 200, 30)'
const CORES_CONTRASTE: CoresMapa = {
  vao: CANVAS,
  concreto: CANVAS,
  torre: CANVAS,
  placa: CANVAS,
  junta: CANVAS_TEXT,
  juntaForte: CANVAS_TEXT,
  tinta: CANVAS_TEXT,
  tinta2: CANVAS_TEXT,
  oxido: HIGHLIGHT,
}

const FONTES = { latin: '/assets/archivo-latin.woff2', latinExt: '/assets/archivo-latin-ext.woff2' }

function estilo(tema: Tema = 'claro', fontes: typeof FONTES | null = FONTES): StyleSpecification {
  return estiloMapaNavegacao({
    tema,
    urlArquivo: URL_MAPA,
    fontes,
    cores: tema === 'contraste' ? CORES_CONTRASTE : CORES_CLARO,
  })
}

function camada(s: StyleSpecification, id: string): LayerSpecification {
  const c = s.layers.find((l) => l.id === id)
  if (!c) throw new Error(`camada ${id} ausente`)
  return c
}

describe('arquivoMapa', () => {
  it('URL_MAPA casa com a regex do Worker e começa no placeholder', () => {
    expect(ARQUIVO_MAPA).toBe('rota-falada-sp-20261109.pmtiles')
    expect(URL_MAPA).toBe('/mapa/' + ARQUIVO_MAPA)
    expect(URL_MAPA).toMatch(REGEX_WORKER)
  })

  it('a caixa é a BBOX_UNIAO do ETL (lida de etl/etl/config.py) e os zooms são 14 a 18', () => {
    // a fonte da verdade é o ETL: se a área coberta mudar lá, este teste quebra até a caixa mudar aqui
    const CONFIG_ETL = readFileSync(join(import.meta.dirname, '..', '..', '..', 'etl', 'etl', 'config.py'), 'utf-8')
    // os recortes de AREA_PILOTO: "Nome": (oeste, sul, leste, norte); a caixa é o min/max deles
    const bloco = /AREA_PILOTO[^{]*\{([^}]*)\}/.exec(CONFIG_ETL)?.[1] ?? ''
    const recortes = [...bloco.matchAll(/\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g)].map((m) =>
      m.slice(1, 5).map(Number),
    )
    expect(recortes.length).toBeGreaterThanOrEqual(1)
    const uniao = [
      Math.min(...recortes.map((r) => r[0])),
      Math.min(...recortes.map((r) => r[1])),
      Math.max(...recortes.map((r) => r[2])),
      Math.max(...recortes.map((r) => r[3])),
    ]
    expect(CAIXA_AREA).toEqual(uniao)
    expect(ZOOM_MIN).toBe(14)
    expect(ZOOM_MAX).toBe(18)
  })
})

describe('estiloMapaNavegacao', () => {
  it('não tem nenhum endereço externo no JSON', () => {
    for (const tema of ['claro', 'escuro', 'contraste'] as const) {
      for (const fontes of [FONTES, null]) {
        expect(JSON.stringify(estilo(tema, fontes))).not.toMatch(/https?:\/\//)
      }
    }
  })

  it('a única fonte vetorial é o pmtiles do próprio site', () => {
    const s = estilo()
    const vetoriais = Object.entries(s.sources).filter(([, f]) => f.type === 'vector')
    expect(vetoriais).toHaveLength(1)
    const [nome, fonte] = vetoriais[0]
    expect(nome).toBe('protomaps')
    expect(fonte).toMatchObject({ type: 'vector', url: 'pmtiles://' + URL_MAPA })
    expect((fonte as { url: string }).url.startsWith('pmtiles:///mapa/rota-falada-sp-')).toBe(true)
    // sem tiles soltos nem raster
    expect(Object.values(s.sources).every((f) => f.type === 'vector' || f.type === 'geojson')).toBe(true)
  })

  it('as fontes GeoJSON são rota, manobra e pessoa, começando vazias', () => {
    const s = estilo()
    expect(FONTES_ROTA).toEqual(['rota', 'manobra', 'pessoa'])
    for (const nome of FONTES_ROTA) {
      expect(s.sources[nome]).toEqual({ type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    }
  })

  it('não tem glyphs, sprite nem icon-image', () => {
    for (const tema of ['claro', 'escuro', 'contraste'] as const) {
      const s = estilo(tema)
      expect(s).not.toHaveProperty('glyphs')
      expect(s).not.toHaveProperty('sprite')
      expect(JSON.stringify(s)).not.toContain('icon-image')
    }
  })

  it('não tem camada de POI, ônibus nem rótulo de lugar', () => {
    const ids = estilo().layers.map((l) => l.id)
    expect(ids).not.toContain('pois')
    expect(ids).not.toContain('roads_shields')
    expect(ids).not.toContain('roads_oneway')
    expect(ids.some((id) => id.startsWith('places_'))).toBe(false)
  })

  it('as camadas da rota estão todas, na ordem, acima de toda a base', () => {
    const ids = estilo().layers.map((l) => l.id)
    expect(CAMADAS_ROTA).toEqual([
      'rota-restante-casing',
      'rota-restante',
      'rota-andado',
      'rota-manobra',
      'manobra-ponto',
      'destino-anel',
      'destino',
      'precisao',
      'pessoa-borda',
      'pessoa',
    ])
    expect(ids.slice(-CAMADAS_ROTA.length)).toEqual([...CAMADAS_ROTA])
    expect(ids.length).toBeGreaterThan(CAMADAS_ROTA.length)
    // a base vem do Protomaps
    expect(ids[0]).toBe('background')
  })

  it('o andado é tracejado e fino; o restante é contínuo e grosso', () => {
    const s = estilo()
    const andado = camada(s, 'rota-andado')
    const restante = camada(s, 'rota-restante')
    expect(andado.type).toBe('line')
    expect(andado.paint).toMatchObject({ 'line-dasharray': [2, 2], 'line-width': 4, 'line-color': CORES_CLARO.tinta2 })
    expect(restante.paint).toMatchObject({ 'line-width': 6, 'line-color': CORES_CLARO.tinta })
    expect(restante.paint).not.toHaveProperty('line-dasharray')
    expect(camada(s, 'rota-restante-casing').paint).toMatchObject({ 'line-width': 10, 'line-color': CORES_CLARO.placa })
    expect(camada(s, 'rota-manobra').paint).toMatchObject({ 'line-width': 6, 'line-color': CORES_CLARO.oxido })
    expect(camada(s, 'manobra-ponto').paint).toMatchObject({
      'circle-radius': 7,
      'circle-opacity': 0,
      'circle-stroke-color': CORES_CLARO.oxido,
      'circle-stroke-width': 3,
    })
  })

  it('cada camada da rota lê a fonte certa', () => {
    const s = estilo()
    const fonteDe = (id: string) => (camada(s, id) as { source: string }).source
    expect(['rota-restante-casing', 'rota-restante', 'rota-andado', 'destino-anel', 'destino'].map(fonteDe)).toEqual([
      'rota', 'rota', 'rota', 'rota', 'rota',
    ])
    expect(['rota-manobra', 'manobra-ponto'].map(fonteDe)).toEqual(['manobra', 'manobra'])
    expect(['precisao', 'pessoa-borda', 'pessoa'].map(fonteDe)).toEqual(['pessoa', 'pessoa', 'pessoa'])
  })

  // "Forma, não só cor" (DESIGN.md): perto da chegada, destino e pessoa aparecem juntos
  it.each(['claro', 'contraste'] as const)('%s: o destino tem forma própria (alvo), diferente da pessoa na rota e fora dela', (tema) => {
    const s = estilo(tema)
    const desenho = (id: string) => {
      const p = camada(s, id).paint as Record<string, unknown>
      return { raio: p['circle-radius'], cor: p['circle-color'], opacidade: p['circle-opacity'] ?? 1, traco: p['circle-stroke-width'] ?? 0 }
    }
    const anel = desenho('destino-anel')
    const miolo = desenho('destino')
    // alvo: um anel com o miolo claro e um ponto no centro, menor que o anel
    expect(anel.traco).toBeGreaterThanOrEqual(3)
    expect(miolo.traco).toBe(0)
    expect(miolo.raio as number).toBeLessThan((anel.raio as number) - (anel.traco as number))
    // a pessoa: círculo cheio com borda clara (na rota) ou anel vazado sem ponto (fora)
    const pessoa = camada(s, 'pessoa').paint as Record<string, unknown>
    const combinacaoPessoa = JSON.stringify([pessoa['circle-radius'], pessoa['circle-opacity'], pessoa['circle-stroke-width']])
    for (const d of [anel, miolo]) expect(JSON.stringify([d.raio, d.opacidade, d.traco])).not.toBe(combinacaoPessoa)
    expect(anel.raio).not.toBe(pessoa['circle-radius'])
    expect(miolo.raio).not.toBe(pessoa['circle-radius'])
  })

  it('a variante escuro usa as cores recebidas', () => {
    const noturno: CoresMapa = { ...CORES_CLARO, tinta: '#e6e7e3', placa: '#282b29' }
    const s = estiloMapaNavegacao({ tema: 'escuro', urlArquivo: URL_MAPA, fontes: FONTES, cores: noturno })
    expect(camada(s, 'rota-restante').paint).toMatchObject({ 'line-color': '#e6e7e3' })
    expect(camada(s, 'rota-restante-casing').paint).toMatchObject({ 'line-color': '#282b29' })
  })

  it('a variante contraste só usa as cores passadas e tira prédios, água e parques', () => {
    const s = estilo('contraste')
    const json = JSON.stringify(s)
    const cores = json.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g) ?? []
    expect(cores.length).toBeGreaterThan(0)
    expect(new Set(cores)).toEqual(new Set([CANVAS, CANVAS_TEXT, HIGHLIGHT]))
    const ids = s.layers.map((l) => l.id)
    expect(ids).not.toContain('buildings')
    expect(ids.some((id) => id.startsWith('water'))).toBe(false)
    expect(ids.some((id) => id.startsWith('landuse_'))).toBe(false)
    expect(camada(s, 'rota-restante').paint).toMatchObject({ 'line-width': 8, 'line-color': CANVAS_TEXT })
    expect(camada(s, 'rota-restante-casing').paint).toMatchObject({ 'line-color': CANVAS })
    expect(camada(s, 'rota-andado').paint).toMatchObject({ 'line-dasharray': [2, 2] })
    expect(camada(s, 'rota-manobra').paint).toMatchObject({ 'line-color': HIGHLIGHT })
  })

  it('com fontes, declara o Archivo local em font-faces e só rótulos de rua', () => {
    const s = estilo()
    expect(s['font-faces']).toEqual({
      Archivo: [
        { url: FONTES.latin, 'unicode-range': expect.arrayContaining(['U+0000-00FF']) },
        { url: FONTES.latinExt, 'unicode-range': expect.arrayContaining(['U+0100-02BA']) },
      ],
    })
    const simbolos = s.layers.filter((l) => l.type === 'symbol')
    expect(simbolos.map((l) => l.id).sort()).toEqual(['roads_labels_major', 'roads_labels_minor'])
    for (const l of simbolos) {
      expect(l.minzoom).toBe(16)
      expect(l.layout).toMatchObject({ 'text-font': ['Archivo'], 'text-size': 15 })
      expect(l.paint).toMatchObject({
        'text-color': CORES_CLARO.tinta,
        'text-halo-color': CORES_CLARO.placa,
        'text-halo-width': 2,
      })
    }
    expect(JSON.stringify(s)).not.toContain('Noto')
  })

  it('sem fontes, nenhuma camada symbol com text-field nem font-faces', () => {
    for (const tema of ['claro', 'escuro', 'contraste'] as const) {
      const s = estilo(tema, null)
      expect(s).not.toHaveProperty('font-faces')
      const comTexto = s.layers.filter(
        (l) => l.type === 'symbol' && l.layout !== undefined && 'text-field' in l.layout,
      )
      expect(comTexto).toEqual([])
      expect(s.layers.slice(-CAMADAS_ROTA.length).map((l) => l.id)).toEqual([...CAMADAS_ROTA])
    }
  })

  it('passa no validador de estilo do MapLibre em todas as variantes', () => {
    for (const tema of ['claro', 'escuro', 'contraste'] as const) {
      for (const fontes of [FONTES, null]) {
        expect(validateStyleMin(estilo(tema, fontes))).toEqual([])
      }
    }
  })

  it('é pura: duas chamadas iguais dão o mesmo estilo e não compartilham objetos', () => {
    const a = estilo()
    const b = estilo()
    expect(a).toEqual(b)
    expect(a.layers).not.toBe(b.layers)
  })
})

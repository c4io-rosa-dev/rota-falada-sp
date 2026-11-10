import { layers, type Flavor } from '@protomaps/basemaps'
import type {
  ExpressionSpecification,
  FontFacesSpecification,
  LayerSpecification,
  StyleSpecification,
} from 'maplibre-gl'

/**
 * Estilo do mapa da navegação, gerado em código (spec 8). Função pura: as cores entram por
 * parâmetro (o motor lê os tokens do DESIGN.md com getComputedStyle, ou as cores de sistema
 * por sonda no alto contraste) e nada aqui lê o DOM.
 *
 * Nada de terceiros: a única fonte vetorial é o pmtiles do próprio site, sem glyphs, sem
 * sprite e sem ícones; a letra é o Archivo local declarado em font-faces.
 */

export type Tema = 'claro' | 'escuro' | 'contraste'

/** Papéis de cor do "Concreto da escola paulista" (DESIGN.md). No escuro, os pares -noturno. */
export type CoresMapa = {
  vao: string
  concreto: string
  torre: string
  placa: string
  junta: string
  juntaForte: string
  tinta: string
  tinta2: string
  oxido: string
}

export type FontesMapa = { latin: string; latinExt: string }

export type OpcoesEstilo = {
  tema: Tema
  /** Caminho do arquivo na mesma origem, ex. URL_MAPA ('/mapa/rota-falada-sp-AAAAMMDD.pmtiles'). */
  urlArquivo: string
  /** URLs locais dos woff2 do Archivo; null gera a variante sem nenhuma camada de texto. */
  fontes: FontesMapa | null
  cores: CoresMapa
}

/** Fontes GeoJSON que o motor preenche com setData. */
export const FONTES_ROTA = ['rota', 'manobra', 'pessoa', 'seta'] as const

/**
 * Contrato dos dados (o motor monta as features assim):
 * - `rota`: LineString com `parte: 'andado' | 'restante'` e Point com `parte: 'destino'`;
 * - `manobra`: LineString (trecho da virada) e Point (ponto da virada); com seta de manobra,
 *   LineString com `parte: 'seta'` (a haste) e Polygon (a ponta);
 * - `pessoa`: Point com `encaixada: boolean` e, quando fora da rota, Polygon da precisão;
 * - `seta`: Polygon da seta da pessoa (para onde ela olha ou anda), ou vazio.
 */
export const PROP_PARTE = 'parte'
export const PROP_ENCAIXADA = 'encaixada'
export const PARTE = { andado: 'andado', restante: 'restante', destino: 'destino', seta: 'seta' } as const

/**
 * Prédios em volume (emenda de 10/11/2026, 19.2): só com a vista inclinada. A camada nasce
 * escondida e o motor a mostra; no alto contraste ela nem existe.
 */
export const CAMADA_PREDIOS_3D = 'predios-3d'
/** Teto da "maquete": tira os valores absurdos do dado (até 26 km) e o efeito de cânion do centro. */
export const TETO_PREDIO_M = 15
/** 3,6% dos prédios não têm altura: ficam baixos. */
export const ALTURA_SEM_DADO_M = 3
/** A camada inteira translúcida: as ruas atrás de um prédio continuam perceptíveis. */
export const OPACIDADE_PREDIOS = 0.7

export const CAMADAS_ROTA = [
  'rota-restante-casing',
  'rota-restante',
  'rota-andado',
  'rota-manobra',
  'manobra-seta-casing',
  'manobra-seta-borda',
  'manobra-seta',
  'manobra-seta-ponta',
  'manobra-ponto',
  'destino-anel',
  'destino',
  'precisao',
  'pessoa-seta-borda',
  'pessoa-seta',
  'pessoa-borda',
  'pessoa',
] as const

const FONTE_BASE = 'protomaps'
const NOME_LETRA = 'Archivo'
/** Rótulos de rua só de perto, onde ajudam a conferir o nome que o painel e a voz dizem. */
const ZOOM_ROTULOS = 16
const ROTULOS_RUA = new Set(['roads_labels_minor', 'roads_labels_major'])

// Mesmos unicode-range do @fontsource-variable/archivo (wght.css), para o MapLibre baixar só o arquivo certo.
const FAIXA_LATIN = [
  'U+0000-00FF', 'U+0131', 'U+0152-0153', 'U+02BB-02BC', 'U+02C6', 'U+02DA', 'U+02DC', 'U+0304',
  'U+0308', 'U+0329', 'U+2000-206F', 'U+20AC', 'U+2122', 'U+2191', 'U+2193', 'U+2212', 'U+2215',
  'U+FEFF', 'U+FFFD',
]
const FAIXA_LATIN_EXT = [
  'U+0100-02BA', 'U+02BD-02C5', 'U+02C7-02CC', 'U+02CE-02D7', 'U+02DD-02FF', 'U+0304', 'U+0308',
  'U+0329', 'U+1D00-1DBF', 'U+1E00-1E9F', 'U+1EF2-1EFF', 'U+2020', 'U+20A0-20AB', 'U+20AD-20C0',
  'U+2113', 'U+2C60-2C7F', 'U+A720-A7FF',
]

/**
 * O "flavor" concreto: chão `vao`, quadras `concreto`, ruas `placa` com contorno `junta-forte`,
 * prédios quase sumidos, água e parques apagados no tom das quadras. Sem `pois` (dispensa sprite).
 * No alto contraste, fundo e áreas ficam todos no fundo e as ruas viram linhas finas de texto.
 */
function flavorConcreto(c: CoresMapa, contraste: boolean): Flavor {
  const area = contraste ? c.vao : c.concreto
  const rua = contraste ? c.tinta : c.placa
  const contorno = contraste ? c.vao : c.juntaForte
  const rotulo = c.tinta
  const halo = c.placa
  return {
    background: c.vao,
    earth: contraste ? c.vao : c.concreto,
    park_a: area, park_b: area, hospital: area, industrial: area, school: area,
    wood_a: area, wood_b: area, pedestrian: c.vao, scrub_a: area, scrub_b: area,
    glacier: area, sand: area, beach: area, aerodrome: area, runway: rua, water: contraste ? c.vao : c.torre,
    zoo: area, military: area,
    tunnel_other_casing: contorno, tunnel_minor_casing: contorno, tunnel_link_casing: contorno,
    tunnel_major_casing: contorno, tunnel_highway_casing: contorno,
    tunnel_other: rua, tunnel_minor: rua, tunnel_link: rua, tunnel_major: rua, tunnel_highway: rua,
    pier: rua,
    buildings: contraste ? c.vao : c.torre,
    minor_service_casing: contorno, minor_casing: contorno, link_casing: contorno,
    major_casing_late: contorno, highway_casing_late: contorno,
    other: rua, minor_service: rua, minor_a: rua, minor_b: rua, link: rua,
    major_casing_early: contorno, major: rua, highway_casing_early: contorno, highway: rua,
    railway: contraste ? c.tinta : c.junta,
    boundaries: contraste ? c.tinta : c.junta,
    bridges_other_casing: contorno, bridges_minor_casing: contorno, bridges_link_casing: contorno,
    bridges_major_casing: contorno, bridges_highway_casing: contorno,
    bridges_other: rua, bridges_minor: rua, bridges_link: rua, bridges_major: rua, bridges_highway: rua,
    roads_label_minor: rotulo, roads_label_minor_halo: halo,
    roads_label_major: rotulo, roads_label_major_halo: halo,
    ocean_label: rotulo, subplace_label: rotulo, subplace_label_halo: halo,
    city_label: rotulo, city_label_halo: halo, state_label: rotulo, state_label_halo: halo,
    country_label: rotulo, address_label: rotulo, address_label_halo: halo,
    regular: NOME_LETRA, bold: NOME_LETRA, italic: NOME_LETRA,
  }
}

/** No alto contraste saem prédios, água e parques (spec 8); sobram o chão, as ruas e a rota. */
function someNoContraste(id: string): boolean {
  return (
    id === 'buildings' ||
    id === 'landcover' ||
    id.startsWith('water') ||
    id.startsWith('landuse_') ||
    id.includes('casing')
  )
}

function camadasBase(c: CoresMapa, contraste: boolean, comTexto: boolean): LayerSpecification[] {
  const base = layers(FONTE_BASE, flavorConcreto(c, contraste), { lang: 'pt' })
  const saida: LayerSpecification[] = []
  for (const camada of base) {
    if (camada.type === 'symbol') {
      // Só nomes de rua: sem POI, placas de via, setas de mão única (ícones) nem nomes de lugar.
      if (!comTexto || !ROTULOS_RUA.has(camada.id)) continue
      saida.push({
        ...camada,
        minzoom: ZOOM_ROTULOS,
        layout: {
          ...camada.layout,
          // O nome em pt (ou o nome local); a expressão do Protomaps citaria letras Noto que não existem aqui.
          'text-field': ['coalesce', ['get', 'name:pt'], ['get', 'name']],
          'text-font': [NOME_LETRA],
          'text-size': 15,
        },
        paint: { 'text-color': c.tinta, 'text-halo-color': c.placa, 'text-halo-width': 2 },
      })
      continue
    }
    if (contraste && someNoContraste(camada.id)) continue
    if (contraste && camada.type === 'line') {
      saida.push({ ...camada, paint: { ...camada.paint, 'line-width': 2 } })
      continue
    }
    saida.push(camada)
  }
  if (contraste) return saida
  // Os volumes entram abaixo dos nomes de rua (ou no fim da base, sem letra): o nome continua legível.
  const primeiroTexto = saida.findIndex((camada) => camada.type === 'symbol')
  saida.splice(primeiroTexto === -1 ? saida.length : primeiroTexto, 0, camadaPredios3d(c))
  return saida
}

/**
 * Prédios extrudados, escolhidos pela acessibilidade (pesquisa de 09/11/2026):
 * - teto de 15 m e 3 m sem dado: sem pilares de quilômetros e sem cânion escondendo as ruas;
 * - camada inteira translúcida, na cor `torre` dos prédios planos, sem textura;
 * - só polígonos `kind = building`: ficam fora os pontos de endereço da mesma camada e os
 *   `building_part`, que duplicariam o volume;
 * - a rota vem depois no estilo e o MapLibre a desenha por cima dos volumes: nunca é encoberta.
 */
function camadaPredios3d(c: CoresMapa): LayerSpecification {
  return {
    id: CAMADA_PREDIOS_3D,
    type: 'fill-extrusion',
    source: FONTE_BASE,
    'source-layer': 'buildings',
    minzoom: 15,
    filter: ['all', ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]], ['==', ['get', 'kind'], 'building']],
    layout: { visibility: 'none' },
    paint: {
      'fill-extrusion-color': c.torre,
      'fill-extrusion-height': ['max', 0, ['min', ['number', ['get', 'height'], ALTURA_SEM_DADO_M], TETO_PREDIO_M]],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': OPACIDADE_PREDIOS,
    },
  }
}

const naParte = (parte: string): ExpressionSpecification => ['==', ['get', PROP_PARTE], parte]
const daGeometria = (tipo: string): ExpressionSpecification => ['==', ['geometry-type'], tipo]

function camadasRota(c: CoresMapa, contraste: boolean): LayerSpecification[] {
  // Faixa grossa (emenda de 10/11/2026, 19.1), na mesma cor: o contraste já é alto; sem halo nem brilho.
  const larguraRestante = contraste ? 12 : 10
  const larguraCasing = contraste ? 18 : 16
  const naoSeta: ExpressionSpecification = ['!=', ['get', PROP_PARTE], PARTE.seta]
  const ehSeta: ExpressionSpecification = ['==', ['get', PROP_PARTE], PARTE.seta]
  const encaixada: ExpressionSpecification = ['==', ['get', PROP_ENCAIXADA], true]
  return [
    {
      id: 'rota-restante-casing',
      type: 'line',
      source: 'rota',
      filter: naParte(PARTE.restante),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c.placa, 'line-width': larguraCasing },
    },
    {
      id: 'rota-restante',
      type: 'line',
      source: 'rota',
      filter: naParte(PARTE.restante),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c.tinta, 'line-width': larguraRestante },
    },
    {
      // Tracejado e fino: o segundo sinal além da cor. Ponta reta para o traço não virar linha cheia.
      id: 'rota-andado',
      type: 'line',
      source: 'rota',
      filter: naParte(PARTE.andado),
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': c.tinta2, 'line-width': 4, 'line-dasharray': [2, 2] },
    },
    {
      id: 'rota-manobra',
      type: 'line',
      source: 'manobra',
      filter: ['all', daGeometria('LineString'), naoSeta],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c.oxido, 'line-width': larguraRestante },
    },
    {
      // Seta de manobra: a FORMA é o sinal (óxido contra tinta tem só 2,47:1). O contorno claro
      // separa a seta da rota escura pela luminância, não só pela matiz. Sem sprite, sem ícone.
      id: 'manobra-seta-casing',
      type: 'line',
      source: 'manobra',
      filter: ['all', daGeometria('LineString'), ehSeta],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': c.placa, 'line-width': larguraCasing },
    },
    {
      // Contorno claro da ponta; a haste e o miolo da ponta vêm depois e cobrem a parte de dentro.
      id: 'manobra-seta-borda',
      type: 'line',
      source: 'manobra',
      filter: daGeometria('Polygon'),
      layout: { 'line-join': 'miter' },
      paint: { 'line-color': c.placa, 'line-width': 6 },
    },
    {
      id: 'manobra-seta',
      type: 'line',
      source: 'manobra',
      filter: ['all', daGeometria('LineString'), ehSeta],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': c.oxido, 'line-width': larguraRestante },
    },
    {
      id: 'manobra-seta-ponta',
      type: 'fill',
      source: 'manobra',
      filter: daGeometria('Polygon'),
      paint: { 'fill-color': c.oxido, 'fill-antialias': true },
    },
    {
      id: 'manobra-ponto',
      type: 'circle',
      source: 'manobra',
      filter: daGeometria('Point'),
      paint: {
        'circle-radius': 7,
        'circle-color': c.oxido,
        'circle-opacity': 0,
        'circle-stroke-color': c.oxido,
        'circle-stroke-width': 3,
      },
    },
    {
      // Destino em alvo (anel grosso com miolo claro e um ponto no centro): forma própria, que não
      // se confunde com a pessoa (círculo cheio na rota, anel vazado sem ponto fora), nem no contraste.
      id: 'destino-anel',
      type: 'circle',
      source: 'rota',
      filter: naParte(PARTE.destino),
      paint: {
        'circle-radius': 12,
        'circle-color': c.placa,
        'circle-stroke-color': c.tinta,
        'circle-stroke-width': 3,
      },
    },
    {
      id: 'destino',
      type: 'circle',
      source: 'rota',
      filter: naParte(PARTE.destino),
      paint: { 'circle-radius': 4, 'circle-color': c.tinta },
    },
    {
      // Círculo de precisão em metros (polígono feito pelo motor), só quando a pessoa está fora.
      id: 'precisao',
      type: 'fill',
      source: 'pessoa',
      filter: daGeometria('Polygon'),
      paint: { 'fill-color': c.tinta2, 'fill-opacity': 0.15, 'fill-outline-color': c.tinta2 },
    },
    {
      // Seta da pessoa (para onde ela olha ou anda): sai de baixo do círculo, com contorno claro
      // para não sumir sobre a rota, que tem a mesma cor.
      id: 'pessoa-seta-borda',
      type: 'line',
      source: 'seta',
      layout: { 'line-join': 'miter' },
      paint: { 'line-color': c.placa, 'line-width': 5 },
    },
    {
      id: 'pessoa-seta',
      type: 'fill',
      source: 'seta',
      paint: { 'fill-color': c.tinta, 'fill-antialias': true },
    },
    {
      // Fundo claro de 3 px em volta da pessoa: borda quando encaixada, miolo do círculo vazado quando fora.
      id: 'pessoa-borda',
      type: 'circle',
      source: 'pessoa',
      filter: daGeometria('Point'),
      paint: { 'circle-radius': 11, 'circle-color': c.placa },
    },
    {
      // Encaixada: círculo cheio. Fora: só o anel de 3 px (vazado). Forma, não só cor.
      id: 'pessoa',
      type: 'circle',
      source: 'pessoa',
      filter: daGeometria('Point'),
      paint: {
        'circle-radius': 8,
        'circle-color': c.tinta,
        'circle-opacity': ['case', encaixada, 1, 0],
        'circle-stroke-color': c.tinta,
        'circle-stroke-width': ['case', encaixada, 0, 3],
      },
    },
  ]
}

function fontFaces(f: FontesMapa): FontFacesSpecification {
  return {
    [NOME_LETRA]: [
      { url: f.latin, 'unicode-range': [...FAIXA_LATIN] },
      { url: f.latinExt, 'unicode-range': [...FAIXA_LATIN_EXT] },
    ],
  }
}

const vazio = () => ({ type: 'geojson' as const, data: { type: 'FeatureCollection' as const, features: [] } })

export function estiloMapaNavegacao(opcoes: OpcoesEstilo): StyleSpecification {
  const { tema, urlArquivo, fontes, cores } = opcoes
  const contraste = tema === 'contraste'
  const estilo: StyleSpecification = {
    version: 8,
    name: `rota-falada-navegacao-${tema}`,
    sources: {
      [FONTE_BASE]: {
        type: 'vector',
        url: 'pmtiles://' + urlArquivo,
        // O crédito fica em HTML, fora do role="img" (spec 10); o MapLibre não desenha atribuição.
        attribution: '',
        maxzoom: 15,
      },
      rota: vazio(),
      manobra: vazio(),
      pessoa: vazio(),
      seta: vazio(),
    },
    layers: [...camadasBase(cores, contraste, fontes !== null), ...camadasRota(cores, contraste)],
  }
  if (fontes) estilo['font-faces'] = fontFaces(fontes)
  return estilo
}

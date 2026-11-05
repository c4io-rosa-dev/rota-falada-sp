import type { MapOptions, TileLayer } from 'leaflet'

// || e não ??: copiar o .env.example deixa a variável vazia, e vazio cairia no Leaflet sem nenhum tile
export const URL_TILES = import.meta.env.VITE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const MAX_ZOOM = 19
export const LIMITE_FALHAS_TILE = 3
export const TEMPO_TILES_MS = 8_000

/**
 * Nada focável dentro do role="img" (axe: nested-interactive) e nenhum movimento: sem
 * animação em nenhuma preferência, sem roda do mouse e, no toque, sem arrastar nem pinçar,
 * para a página rolar e a pinça ampliar a página. Arrastar nunca é a única via (2.5.7).
 */
export function opcoesMapa(ponteiroFino: boolean): MapOptions {
  return {
    keyboard: false,
    attributionControl: false,
    zoomControl: false,
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
    inertia: false,
    scrollWheelZoom: false,
    boxZoom: false,
    touchZoom: false,
    doubleClickZoom: false,
    dragging: ponteiroFino,
    maxZoom: MAX_ZOOM,
  }
}

export type VigiaTiles = {
  parar: () => void
  /** "Tentar de novo": outra rodada, com outro aviso se o fundo falhar de novo. */
  rearmar: () => void
}

/**
 * Avisa uma vez por rodada se o fundo não carrega: várias falhas ou nenhum `load` no prazo.
 * Fica aqui para os dois mapas tratarem a falha do mesmo jeito.
 */
export function vigiarTiles(tiles: TileLayer, aoFalhar: () => void): VigiaTiles {
  let falhas = 0
  let avisou = false
  const avisar = () => {
    if (!avisou) aoFalhar()
    avisou = true
  }
  let semCarga = setTimeout(avisar, TEMPO_TILES_MS)
  tiles.on('tileerror', () => {
    falhas += 1
    if (falhas >= LIMITE_FALHAS_TILE) avisar()
  })
  tiles.on('load', () => clearTimeout(semCarga))
  return {
    parar: () => clearTimeout(semCarga),
    rearmar: () => {
      clearTimeout(semCarga)
      falhas = 0
      avisou = false
      semCarga = setTimeout(avisar, TEMPO_TILES_MS)
    },
  }
}

export function ponteiroEhFino(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches
}

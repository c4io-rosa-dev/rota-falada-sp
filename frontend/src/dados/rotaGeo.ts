/** Latitude e longitude, na ordem do Leaflet. O GeoJSON vem como [lng, lat]. */
export type PontoLatLng = [number, number]

function ehPosicao(p: unknown): p is [number, number] {
  return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
}

/** `geometria` é dict sem tipo no contrato. Devolve os pontos, ou null se não for uma linha válida. */
export function linhaDoGeoJson(geometria: unknown): PontoLatLng[] | null {
  const g = geometria as { type?: unknown; coordinates?: unknown } | null | undefined
  if (g?.type !== 'LineString' || !Array.isArray(g.coordinates) || g.coordinates.length < 2) return null
  if (!g.coordinates.every(ehPosicao)) return null
  return (g.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng])
}

const RAIO_TERRA_M = 6_371_000

/** Distância em metros (haversine). */
export function distanciaM(a: PontoLatLng, b: PontoLatLng): number {
  const rad = (g: number) => (g * Math.PI) / 180
  const dLat = rad(b[0] - a[0])
  const dLon = rad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2
  return 2 * RAIO_TERRA_M * Math.asin(Math.sqrt(h))
}

/** O ponto no meio da linha, medido ao longo dela. */
export function meioDaLinha(linha: PontoLatLng[]): PontoLatLng {
  const trechos = linha.slice(1).map((p, i) => distanciaM(linha[i], p))
  let falta = trechos.reduce((soma, d) => soma + d, 0) / 2
  for (let i = 0; i < trechos.length; i++) {
    if (falta <= trechos[i]) {
      const f = trechos[i] === 0 ? 0 : falta / trechos[i]
      return [linha[i][0] + (linha[i + 1][0] - linha[i][0]) * f, linha[i][1] + (linha[i + 1][1] - linha[i][1]) * f]
    }
    falta -= trechos[i]
  }
  return linha[linha.length - 1]
}

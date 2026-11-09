// Régua local equirretangular: ideia do cheap-ruler (ISC, github.com/mapbox/cheap-ruler), reescrita;
// nada copiado. Terra esférica igual a rotaGeo.distanciaM (raio 6 371 km), para as duas medidas baterem.
import type { PontoLatLng } from '../rotaGeo'

export type Regua = { lat0: number; kx: number; ky: number }

/** Metros por grau de latitude na Terra esférica de rotaGeo.distanciaM. */
export const METROS_POR_GRAU = (6_371_000 * Math.PI) / 180

export function criarRegua(lat0: number): Regua {
  const ky = METROS_POR_GRAU
  return { lat0, kx: ky * Math.cos((lat0 * Math.PI) / 180), ky }
}

/** Diferença b − a em metros: [leste, norte]. */
function emMetros(r: Regua, a: PontoLatLng, b: PontoLatLng): [number, number] {
  return [(b[1] - a[1]) * r.kx, (b[0] - a[0]) * r.ky]
}

export function distancia(r: Regua, a: PontoLatLng, b: PontoLatLng): number {
  const [x, y] = emMetros(r, a, b)
  return Math.hypot(x, y)
}

export type Projecao = { t: number; ponto: PontoLatLng; distanciaM: number }

/** t em [0,1]; segmento de comprimento zero devolve t = 0 e o próprio a. */
export function projetarNoSegmento(r: Regua, p: PontoLatLng, a: PontoLatLng, b: PontoLatLng): Projecao {
  const [sx, sy] = emMetros(r, a, b)
  const [px, py] = emMetros(r, a, p)
  const quadrado = sx * sx + sy * sy
  const t = quadrado === 0 ? 0 : Math.min(1, Math.max(0, (px * sx + py * sy) / quadrado))
  const ponto: PontoLatLng = t === 0 ? [a[0], a[1]] : t === 1 ? [b[0], b[1]] : [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  return { t, ponto, distanciaM: Math.hypot(px - sx * t, py - sy * t) }
}

/** Desloca o ponto em metros para o norte e para o leste (negativo: sul e oeste). */
export function deslocar(r: Regua, p: PontoLatLng, norteM: number, lesteM: number): PontoLatLng {
  return [p[0] + norteM / r.ky, p[1] + lesteM / r.kx]
}

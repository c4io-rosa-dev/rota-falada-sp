import { criarRegua, deslocar, distancia, METROS_POR_GRAU, projetarNoSegmento } from '../dados/navegacao/regua'
import { distanciaM, type PontoLatLng } from '../dados/rotaGeo'

const CENTRO: PontoLatLng = [-23.56, -46.65]

describe('régua local', () => {
  it('usa a mesma Terra esférica do haversine', () => {
    const r = criarRegua(-23.56)
    expect(METROS_POR_GRAU).toBeCloseTo((6_371_000 * Math.PI) / 180, 6)
    expect(r.ky).toBeCloseTo(111_194.93, 1)
    expect(r.kx).toBeCloseTo(r.ky * Math.cos((-23.56 * Math.PI) / 180), 6)
    expect(r.lat0).toBe(-23.56)
  })

  it('mede distâncias de até 3 km com erro menor que 0,2% contra o haversine', () => {
    const r = criarRegua(CENTRO[0])
    const deslocamentos: [number, number][] = [
      [10, 0], [0, 10], [150, -80], [-400, 300], [900, 900],
      [-1500, 200], [2000, -2000], [-2100, -2100], [0, -3000], [3000, 0],
    ]
    for (const [dn, de] of deslocamentos) {
      const a: PontoLatLng = [CENTRO[0] - dn / 2 / METROS_POR_GRAU, CENTRO[1]]
      const b = deslocar(r, a, dn, de)
      const real = distanciaM(a, b)
      expect(Math.abs(distancia(r, a, b) - real) / real).toBeLessThan(0.002)
    }
  })

  it('projeta no meio, antes, depois e em segmento de comprimento zero', () => {
    const r = criarRegua(CENTRO[0])
    const a = CENTRO
    const b = deslocar(r, a, 0, 100)
    const meio = deslocar(r, a, 10, 50)
    const p = projetarNoSegmento(r, meio, a, b)
    expect(p.t).toBeCloseTo(0.5, 6)
    expect(p.distanciaM).toBeCloseTo(10, 2)
    expect(distancia(r, p.ponto, deslocar(r, a, 0, 50))).toBeLessThan(0.01)

    const antes = projetarNoSegmento(r, deslocar(r, a, 0, -30), a, b)
    expect(antes.t).toBe(0)
    expect(antes.distanciaM).toBeCloseTo(30, 2)
    expect(projetarNoSegmento(r, deslocar(r, a, 0, 130), a, b).t).toBe(1)

    const zero = projetarNoSegmento(r, meio, a, a)
    expect(zero.t).toBe(0)
    expect(zero.ponto).toEqual(a)
    expect(zero.distanciaM).toBeCloseTo(distancia(r, meio, a), 6)
  })

  it('desloca em metros para norte e leste', () => {
    const r = criarRegua(CENTRO[0])
    const norte = deslocar(r, CENTRO, 100, 0)
    expect(Math.abs(distancia(r, CENTRO, norte) - 100)).toBeLessThan(0.01)
    expect(norte[0]).toBeGreaterThan(CENTRO[0])
    const oeste = deslocar(r, CENTRO, 0, -50)
    expect(oeste[1]).toBeLessThan(CENTRO[1])
    expect(oeste[0]).toBe(CENTRO[0])
    expect(Math.abs(distancia(r, CENTRO, oeste) - 50)).toBeLessThan(0.01)
  })
})

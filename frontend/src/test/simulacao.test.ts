import { distanciaM, type PontoLatLng } from '../dados/rotaGeo'
import {
  CENARIOS,
  ehCenario,
  gerarLeituras,
  leiturasDoCenario,
  mulberry32,
  PADRAO_SIMULACAO,
  type LeituraSimulada,
} from '../dados/navegacao/simulacao'

// Linha em L de 200 m: 100 m para leste e 100 m para o sul, montada com as fórmulas do spec.
const LAT0 = -23.56
const LON0 = -46.65
const KY = (6_371_000 * Math.PI) / 180
const KX = KY * Math.cos((LAT0 * Math.PI) / 180)
const A: PontoLatLng = [LAT0, LON0]
const B: PontoLatLng = [LAT0, LON0 + 100 / KX]
const C: PontoLatLng = [LAT0 - 100 / KY, LON0 + 100 / KX]
const LINHA: PontoLatLng[] = [A, B, C]

/** Coordenadas locais em metros: x para leste, y para o norte, a partir de A. */
function local(l: LeituraSimulada): { x: number; y: number } {
  return { x: (l.lon - LON0) * KX, y: (l.lat - LAT0) * KY }
}
const ponto = (l: LeituraSimulada): PontoLatLng => [l.lat, l.lon]
const limitar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

function distanciaDaLinha(l: LeituraSimulada): number {
  const { x, y } = local(l)
  const leste = Math.hypot(x - limitar(x, 0, 100), y)
  const sul = Math.hypot(x - 100, y - limitar(y, -100, 0))
  return Math.min(leste, sul)
}

function tempoCrescente(ls: LeituraSimulada[]): boolean {
  return ls.every((l, i) => i === 0 || l.tMs > ls[i - 1].tMs)
}

describe('mulberry32', () => {
  it('é determinístico, fica em [0, 1) e muda com a semente', () => {
    const a = mulberry32(1)
    const b = mulberry32(1)
    const sa = Array.from({ length: 50 }, () => a())
    const sb = Array.from({ length: 50 }, () => b())
    expect(sa).toEqual(sb)
    expect(sa.every((v) => v >= 0 && v < 1)).toBe(true)
    const c = mulberry32(2)
    const sc = Array.from({ length: 50 }, () => c())
    expect(sc).not.toEqual(sa)
  })
})

describe('gerarLeituras', () => {
  it('tem os padrões do spec', () => {
    expect(PADRAO_SIMULACAO).toEqual({ velocidadeMps: 0.9, intervaloMs: 1000, ruidoM: 3, precisaoM: 8, semente: 1, inicioMs: 0 })
  })

  it('sem ruído, anda 0,9 m por leitura do início ao fim exato', () => {
    const ls = gerarLeituras(LINHA, { ruidoM: 0 })
    const L = distanciaM(A, B) + distanciaM(B, C)
    expect(ls).toHaveLength(Math.ceil(L / 0.9) + 1)
    expect(ls).toHaveLength(Math.ceil(200 / 0.9) + 1)
    expect(ponto(ls[0])).toEqual(A)
    expect(distanciaM(ponto(ls[ls.length - 1]), C)).toBeLessThan(1e-6)
    ls.forEach((l, i) => expect(l.tMs).toBe(i * 1000))
    // passo constante, exceto o último (que encaixa no fim) e os que cruzam a esquina
    for (let i = 1; i < ls.length - 1; i++) {
      const { x } = local(ls[i])
      const { x: xAnt } = local(ls[i - 1])
      if (x > 99.99 && xAnt < 99.99) continue
      expect(distanciaM(ponto(ls[i - 1]), ponto(ls[i]))).toBeCloseTo(0.9, 2)
    }
    ls.forEach((l) => expect(distanciaDaLinha(l)).toBeLessThan(0.01))
  })

  it('precisão padrão 8 e inicioMs desloca o tempo', () => {
    const ls = gerarLeituras(LINHA, { ruidoM: 0, inicioMs: 5000 })
    expect(ls.every((l) => l.precisaoM === 8)).toBe(true)
    expect(ls[0].tMs).toBe(5000)
    expect(ls[3].tMs).toBe(8000)
  })

  it('ruído limitado a 3·√2 m e igual para a mesma semente', () => {
    const limpas = gerarLeituras(LINHA, { ruidoM: 0 })
    const ruidosas = gerarLeituras(LINHA, { ruidoM: 3, semente: 7 })
    expect(ruidosas).toEqual(gerarLeituras(LINHA, { ruidoM: 3, semente: 7 }))
    expect(ruidosas).not.toEqual(gerarLeituras(LINHA, { ruidoM: 3, semente: 8 }))
    expect(ruidosas).toHaveLength(limpas.length)
    const desvios = ruidosas.map((l, i) => distanciaM(ponto(l), ponto(limpas[i])))
    expect(Math.max(...desvios)).toBeLessThanOrEqual(3 * Math.SQRT2 + 1e-6)
    expect(Math.max(...desvios)).toBeGreaterThan(0.5)
  })

  it('linha vazia não gera leitura', () => {
    expect(gerarLeituras([])).toEqual([])
  })
})

describe('cenários', () => {
  it('lista os 7 cenários e reconhece o nome', () => {
    expect([...CENARIOS].sort()).toEqual(
      [
        'reto',
        'desvio-lateral-25m',
        'volta-a-rota',
        'precisao-ruim-40m',
        'parado-no-cruzamento',
        'sentido-contrario',
        'aba-oculta-no-meio',
      ].sort(),
    )
    expect(ehCenario('reto')).toBe(true)
    expect(ehCenario('x')).toBe(false)
    expect(ehCenario(null)).toBe(false)
  })

  it('reto é a linha inteira com os padrões', () => {
    expect(leiturasDoCenario('reto', LINHA)).toEqual(gerarLeituras(LINHA))
  })

  it('desvio-lateral-25m: 25 m à direita entre 0,4·L e 0,6·L e termina aí', () => {
    const ls = leiturasDoCenario('desvio-lateral-25m', LINHA, { ruidoM: 0 })
    // na esquina interna o ponto deslocado fica perto do trecho leste; por isso corta pelo índice
    const corte = ls.findIndex((l) => distanciaDaLinha(l) > 0.01)
    const dentro = ls.slice(0, corte)
    const fora = ls.slice(corte)
    expect(corte).toBeGreaterThan(0)
    expect(fora.length).toBeGreaterThanOrEqual(Math.floor(40 / 0.9))
    // antes do desvio: na linha, até 0,4·L (x ≤ 80 no trecho leste)
    dentro.forEach((l) => expect(local(l).x).toBeLessThanOrEqual(80.01))
    // depois: à direita do sentido de marcha (trecho leste → ao sul; trecho sul → a oeste)
    for (const l of fora) {
      const { x, y } = local(l)
      const noLeste = Math.abs(y + 25) <= 0.5 && x >= 79.99 && x <= 100.01
      const noSul = Math.abs(x - 75) <= 0.5 && y <= 0.01 && y >= -20.01
      expect(noLeste || noSul).toBe(true)
    }
    const ult = local(ls[ls.length - 1])
    expect(ult.x).toBeCloseTo(75, 1)
    expect(ult.y).toBeCloseTo(-20, 1)
    // o desvio não tem ruído, mesmo com o ruído padrão
    const comRuido = leiturasDoCenario('desvio-lateral-25m', LINHA)
    const ultR = local(comRuido[comRuido.length - 1])
    expect(ultR.x).toBeCloseTo(75, 1)
    expect(ultR.y).toBeCloseTo(-20, 1)
    expect(tempoCrescente(ls)).toBe(true)
  })

  it('volta-a-rota: depois de 0,6·L volta à linha e termina no fim', () => {
    const ls = leiturasDoCenario('volta-a-rota', LINHA, { ruidoM: 0 })
    const ultimaFora = ls.map((l) => distanciaDaLinha(l) > 1).lastIndexOf(true)
    expect(ultimaFora).toBeGreaterThan(0)
    const depois = ls.slice(ultimaFora + 1)
    expect(depois.length).toBeGreaterThan(80 / 0.9 - 2)
    depois.forEach((l) => expect(distanciaDaLinha(l)).toBeLessThan(1))
    expect(distanciaM(ponto(ls[ls.length - 1]), C)).toBeLessThan(1e-6)
    expect(tempoCrescente(ls)).toBe(true)
  })

  it('precisao-ruim-40m: precisão 40 e sem ruído', () => {
    const ls = leiturasDoCenario('precisao-ruim-40m', LINHA)
    expect(ls.every((l) => l.precisaoM === 40)).toBe(true)
    ls.forEach((l) => expect(distanciaDaLinha(l)).toBeLessThan(0.01))
    expect(distanciaM(ponto(ls[ls.length - 1]), C)).toBeLessThan(1e-6)
  })

  it('parado-no-cruzamento: 20 leituras idênticas seguidas e depois segue até o fim', () => {
    const ls = leiturasDoCenario('parado-no-cruzamento', LINHA)
    let maior = 1
    let atual = 1
    for (let i = 1; i < ls.length; i++) {
      atual = ls[i].lat === ls[i - 1].lat && ls[i].lon === ls[i - 1].lon ? atual + 1 : 1
      maior = Math.max(maior, atual)
    }
    expect(maior).toBeGreaterThanOrEqual(20)
    expect(ls.length).toBeGreaterThanOrEqual(gerarLeituras(LINHA).length + 20)
    expect(tempoCrescente(ls)).toBe(true)
  })

  it('sentido-contrario: termina 40 m antes de 0,5·L pela linha', () => {
    const ls = leiturasDoCenario('sentido-contrario', LINHA, { ruidoM: 0 })
    const ult = local(ls[ls.length - 1])
    expect(Math.abs(ult.y)).toBeLessThan(0.01)
    expect(100 - ult.x).toBeGreaterThanOrEqual(39)
    expect(100 - ult.x).toBeLessThanOrEqual(41)
    // chegou a 0,5·L (a esquina) antes de voltar
    expect(ls.some((l) => Math.abs(local(l).x - 100) < 0.01 && Math.abs(local(l).y) < 0.01)).toBe(true)
    expect(tempoCrescente(ls)).toBe(true)
  })

  it('aba-oculta-no-meio: um salto de 31 000 ms entre duas leituras', () => {
    const ls = leiturasDoCenario('aba-oculta-no-meio', LINHA)
    const saltos = ls.slice(1).map((l, i) => l.tMs - ls[i].tMs)
    expect(saltos.filter((s) => s === 31_000)).toHaveLength(1)
    expect(saltos.filter((s) => s !== 1000 && s !== 31_000)).toHaveLength(0)
    expect(distanciaM(ponto(ls[ls.length - 1]), C)).toBeLessThan(3 * Math.SQRT2 + 1e-6)
  })

  it('nenhum tMs repetido ou fora de ordem e a mesma semente dá a mesma saída', () => {
    for (const nome of CENARIOS) {
      const ls = leiturasDoCenario(nome, LINHA)
      expect(ls.length).toBeGreaterThan(1)
      expect(tempoCrescente(ls)).toBe(true)
      expect(ls).toEqual(leiturasDoCenario(nome, LINHA))
    }
  })
})

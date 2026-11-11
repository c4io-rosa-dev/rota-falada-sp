import type { RotaOut } from '../api/client'
import { deslocar, distancia } from '../dados/navegacao/regua'
import {
  antesDoInicioM,
  comprimentosDosPassos,
  distanciaAoFim,
  encaixar,
  encaixarNoPrimeiroRamo,
  montarTrajeto,
  passoEm,
  pontoAoLongo,
  type Trajeto,
} from '../dados/navegacao/trajeto'
import type { PontoLatLng } from '../dados/rotaGeo'
import { PONTOS_L, PONTOS_U, REGUA_L, ROTA_L, ROTA_L_SO_GEOMETRIA_TOTAL, ROTA_SEM_GEOMETRIA, ROTA_U } from './fixturasNavegacao'
import { passo } from './fixturasRota'

const { A, B, C, E } = PONTOS_L

function linha(...pontos: PontoLatLng[]) {
  return { type: 'LineString', coordinates: pontos.map(([lat, lng]) => [lng, lat]) }
}

function trajetoL(): Trajeto {
  const t = montarTrajeto(ROTA_L)
  if (!t) throw new Error('trajeto nulo')
  return t
}

function intervalos(t: Trajeto): [number, number][] {
  return t.passos.map((p) => [p.inicioM, p.fimM])
}

function esperaIntervalos(t: Trajeto, esperados: [number, number][]) {
  expect(t.passos).toHaveLength(esperados.length)
  intervalos(t).forEach(([inicio, fim], i) => {
    expect(Math.abs(inicio - esperados[i][0])).toBeLessThan(0.5)
    expect(Math.abs(fim - esperados[i][1])).toBeLessThan(0.5)
  })
}

describe('montar o trajeto', () => {
  it('junta os passos da rota em L', () => {
    const t = trajetoL()
    expect(Math.abs(t.totalM - 308)).toBeLessThan(0.5)
    esperaIntervalos(t, [[0, 120], [120, 200], [200, 208], [208, 208], [208, 308]])
    expect(t.passos.map((p) => [p.indice, p.ordem])).toEqual([[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]])
    expect(t.acumuladoM).toHaveLength(t.pontos.length)
    expect(t.acumuladoM[0]).toBe(0)
    for (let i = 1; i < t.pontos.length; i++) {
      expect(t.pontos[i]).not.toEqual(t.pontos[i - 1])
      expect(t.acumuladoM[i]).toBeGreaterThan(t.acumuladoM[i - 1])
    }
    expect(t.acumuladoM[t.acumuladoM.length - 1]).toBeCloseTo(t.totalM, 9)
    expect(t.regua.lat0).toBeCloseTo(t.pontos.reduce((s, p) => s + p[0], 0) / t.pontos.length, 12)
  })

  it('não repete o início de linha colado ao fim anterior', () => {
    const quaseB = deslocar(REGUA_L, B, 0.3, 0)
    const fim = deslocar(REGUA_L, quaseB, 0, 50)
    const t = montarTrajeto({ geometria: {}, passos: [passo(1, { geometria: linha(A, B) }), passo(2, { geometria: linha(quaseB, fim) })] })
    expect(t?.pontos).toHaveLength(3)
    expect(Math.abs((t?.totalM ?? 0) - 170)).toBeLessThan(0.5)
  })

  it('liga com segmento reto o início de linha afastado do fim anterior', () => {
    const longeB = deslocar(REGUA_L, B, 5, 0)
    const fim = deslocar(REGUA_L, longeB, 0, 50)
    const t = montarTrajeto({ geometria: {}, passos: [passo(1, { geometria: linha(A, B) }), passo(2, { geometria: linha(longeB, fim) })] })
    expect(t?.pontos).toHaveLength(4)
    expect(Math.abs((t?.totalM ?? 0) - 175)).toBeLessThan(0.5)
    expect(Math.abs((t?.passos[1].fimM ?? 0) - 175)).toBeLessThan(0.5)
  })

  it('passo do meio sem geometria vira intervalo de comprimento zero onde está', () => {
    const passos = ROTA_L.passos.map((p, i) => (i === 1 ? { ...p, geometria: {} } : p))
    const t = montarTrajeto({ ...ROTA_L, passos })
    if (!t) throw new Error('trajeto nulo')
    expect(Math.abs(t.totalM - 308)).toBeLessThan(0.5)
    esperaIntervalos(t, [[0, 120], [120, 120], [120, 208], [208, 208], [208, 308]])
  })

  it('sem linha nos passos, reparte a geometria total por distancia_m', () => {
    const t = montarTrajeto(ROTA_L_SO_GEOMETRIA_TOTAL)
    if (!t) throw new Error('trajeto nulo')
    esperaIntervalos(t, [[0, 120], [120, 200], [200, 208], [208, 208], [208, 308]])
  })

  it('com todas as distancia_m zeradas, reparte em partes iguais', () => {
    const passos = ROTA_L_SO_GEOMETRIA_TOTAL.passos.map((p) => ({ ...p, distancia_m: 0 }))
    const t = montarTrajeto({ ...ROTA_L_SO_GEOMETRIA_TOTAL, passos })
    if (!t) throw new Error('trajeto nulo')
    const parte = t.totalM / 5
    esperaIntervalos(t, [0, 1, 2, 3, 4].map((i) => [i * parte, (i + 1) * parte]))
  })

  it('devolve null sem geometria utilizável ou com menos de 1 m', () => {
    expect(montarTrajeto(ROTA_SEM_GEOMETRIA)).toBeNull()
    const pertinho = deslocar(REGUA_L, A, 0, 0.6)
    const curta: Pick<RotaOut, 'passos' | 'geometria'> = {
      geometria: linha(A, pertinho),
      passos: [passo(1, { geometria: linha(A, pertinho) })],
    }
    expect(montarTrajeto(curta)).toBeNull()
  })
})

describe('encaixar na rota', () => {
  const t = trajetoL()
  const meioPasso1 = deslocar(REGUA_L, A, 0, 60)
  const aoNorte = deslocar(REGUA_L, meioPasso1, 5, 0)

  it('acha o progresso e a distância lateral', () => {
    const e = encaixar(t, aoNorte, 0, 150)
    expect(Math.abs((e?.progressoM ?? 0) - 60)).toBeLessThan(0.5)
    expect(Math.abs((e?.lateralM ?? 0) - 5)).toBeLessThan(0.1)
    expect(distancia(t.regua, e!.ponto, meioPasso1)).toBeLessThan(0.05)
  })

  it('prende o progresso à janela', () => {
    const e = encaixar(t, aoNorte, 100, 250)
    expect(e?.progressoM).toBeCloseTo(100, 6)
    expect(Math.abs((e?.lateralM ?? 0) - 40.3)).toBeLessThan(0.5)
  })

  it('janela vazia devolve null; janela fora do trajeto é presa', () => {
    expect(encaixar(t, aoNorte, 150, 100)).toBeNull()
    expect(encaixar(t, aoNorte, -50, 1000)?.progressoM).toBeCloseTo(60, 0)
    expect(encaixar(t, aoNorte, 500, 900)?.progressoM).toBeCloseTo(t.totalM, 6)
  })

  it('no empate entre dois segmentos vence o de menor progresso', () => {
    // medido na régua do próprio trajeto, para as duas distâncias saírem iguais
    const naQuina = deslocar(t.regua, B, -10, -10)
    const e = encaixar(t, naQuina, 0, 308)
    expect(Math.abs((e?.progressoM ?? 0) - 110)).toBeLessThan(0.5)
    expect(Math.abs((e?.lateralM ?? 0) - 10)).toBeLessThan(0.01)
  })
})

describe('rota em U: pernas paralelas a 15 m', () => {
  const t = montarTrajeto(ROTA_U)!
  const { A: UA } = PONTOS_U
  // entre as duas pernas, um pouco mais perto da volta (7 m) que da ida (8 m)
  const entrePernas = deslocar(REGUA_L, UA, -8, 0)

  it('a menor distância lateral pula para a perna de volta (é por isso que existe o primeiro ramo)', () => {
    const e = encaixar(t, entrePernas, 0, t.totalM)
    expect(e!.progressoM).toBeGreaterThan(200)
  })

  it('encaixarNoPrimeiroRamo fica na ida: o menor progresso entre os ramos abaixo do limiar', () => {
    const e = encaixarNoPrimeiroRamo(t, entrePernas, 0, t.totalM, 20)
    expect(e!.progressoM).toBeLessThan(1)
    expect(Math.abs(e!.lateralM - 8)).toBeLessThan(0.1)
  })

  it('a ponta presa de um segmento anterior não vira um ramo à parte', () => {
    // na rota em L, o passo 1 tem dois segmentos (A → 60 m → B); a 70 m, a projeção no
    // primeiro fica presa nos 60 m, a 10 m de distância, mas não é um ramo da rota
    const tl = trajetoL()
    const e = encaixarNoPrimeiroRamo(tl, deslocar(REGUA_L, A, 0, 70), 0, tl.totalM, 20)
    expect(Math.abs(e!.progressoM - 70)).toBeLessThan(0.5)
  })

  it('perto da ida e a 18 m da volta, fica na ida', () => {
    const meio = deslocar(REGUA_L, UA, 3, 60)
    const e = encaixarNoPrimeiroRamo(t, meio, 0, t.totalM, 20)
    expect(Math.abs(e!.progressoM - 60)).toBeLessThan(0.5)
  })

  it('sem nenhum ramo abaixo do limiar, fica com a menor distância lateral', () => {
    const longe = deslocar(REGUA_L, UA, 80, 50)
    const e = encaixarNoPrimeiroRamo(t, longe, 0, t.totalM, 20)
    const global = encaixar(t, longe, 0, t.totalM)
    expect(e).toEqual(global)
  })

  it('respeita a janela: a volta sozinha na janela é o único ramo', () => {
    const naVolta = deslocar(REGUA_L, PONTOS_U.C, 1, -50)
    const e = encaixarNoPrimeiroRamo(t, naVolta, 120, t.totalM, 20)
    expect(Math.abs(e!.progressoM - 165)).toBeLessThan(0.5)
  })

  it('janela vazia devolve null', () => {
    expect(encaixarNoPrimeiroRamo(t, entrePernas, 150, 100, 20)).toBeNull()
  })
})

describe('antes do início da rota', () => {
  const t = trajetoL()

  it('mede quantos metros a pessoa está para trás do ponto de partida, no sentido do primeiro segmento', () => {
    expect(Math.abs(antesDoInicioM(t, deslocar(REGUA_L, A, 0, -16)) - 16)).toBeLessThan(0.05)
    expect(Math.abs(antesDoInicioM(t, deslocar(REGUA_L, A, 5, -10)) - 10)).toBeLessThan(0.05)
  })

  it('à frente do início, ou ao lado, é zero', () => {
    expect(antesDoInicioM(t, deslocar(REGUA_L, A, 0, 10))).toBe(0)
    expect(antesDoInicioM(t, deslocar(REGUA_L, A, 8, 0))).toBe(0)
  })
})

describe('consultas ao trajeto', () => {
  const t = trajetoL()

  it('diz em que passo está um progresso, pulando o degenerado', () => {
    expect(passoEm(t, 0)).toBe(0)
    expect(passoEm(t, 119.9)).toBe(0)
    expect(passoEm(t, 120)).toBe(1)
    expect(passoEm(t, 205)).toBe(2)
    expect(passoEm(t, 208)).toBe(4)
    expect(passoEm(t, 400)).toBe(4)
    expect(passoEm(t, -5)).toBe(0)
  })

  it('acha o ponto ao longo, prendendo ao trajeto', () => {
    expect(distancia(t.regua, pontoAoLongo(t, 60), deslocar(REGUA_L, A, 0, 60))).toBeLessThan(0.01)
    expect(pontoAoLongo(t, -10)).toEqual(t.pontos[0])
    expect(pontoAoLongo(t, 9999)).toEqual(t.pontos[t.pontos.length - 1])
    expect(distancia(t.regua, pontoAoLongo(t, 160), deslocar(REGUA_L, B, -40, 0))).toBeLessThan(0.05)
  })

  it('mede os passos e a distância ao fim', () => {
    const esperados = [120, 80, 8, 0, 100]
    comprimentosDosPassos(t).forEach((c, i) => expect(Math.abs(c - esperados[i])).toBeLessThan(0.5))
    expect(distanciaAoFim(t, E)).toBe(0)
    expect(Math.abs(distanciaAoFim(t, C) - Math.hypot(8, 100))).toBeLessThan(0.1)
  })
})

import type { RotaIn } from '../api/client'
import type { LeituraPosicao } from '../dados/localizacao'
import { proximoUtil } from '../dados/navegacao/falasNavegacao'
import {
  cenaDoMapa,
  circuloPrecisao,
  diferencaAngular,
  dividirRota,
  HISTERESE_RUMO_GRAUS,
  manobraEmDestaque,
  OLHAR_RUMO_M,
  paraLonLat,
  rumoEm,
  trechoDoPasso,
  ZOOM_NAVEGACAO,
  type Cena,
  type LonLat,
  type PrefsMapa,
} from '../dados/navegacao/mapaNavegacao'
import { estadoNavegacao, type EstadoNavegacao, type Fase } from '../dados/navegacao/navegacao'
import { criarRegua, deslocar, distancia } from '../dados/navegacao/regua'
import { montarTrajeto, pontoAoLongo, type Trajeto } from '../dados/navegacao/trajeto'
import type { PontoLatLng } from '../dados/rotaGeo'
import { PONTOS_L, ROTA_L } from './fixturasNavegacao'

const PEDIDO: RotaIn = {
  origem: { lat: -23.5617, lng: -46.656 },
  destino: { lat: -23.5636, lng: -46.6547 },
  perfil: { inclinacao_max: 6, guia_max_m: 0.06, largura_min_m: 0.9, evitar_degraus: true, velocidade_kmh: 3 },
}

const T = montarTrajeto(ROTA_L)!
const REGUA = T.regua

/** Trajeto reto sintético de `metros`, no rumo dado pelo deslocamento unitário (norte, leste). */
function trajetoReto(norte: number, leste: number, metros = 100): Trajeto {
  const regua = criarRegua(PONTOS_L.A[0])
  const a = PONTOS_L.A
  const b = deslocar(regua, a, norte * metros, leste * metros)
  const totalM = distancia(regua, a, b)
  return {
    regua,
    pontos: [a, b],
    acumuladoM: [0, totalM],
    totalM,
    passos: [{ indice: 0, ordem: 1, inicioM: 0, fimM: totalM }],
  }
}

function ll(p: PontoLatLng): LonLat {
  return [p[1], p[0]]
}

function perto(a: LonLat, b: LonLat, tol = 1e-9) {
  expect(Math.abs(a[0] - b[0])).toBeLessThan(tol)
  expect(Math.abs(a[1] - b[1])).toBeLessThan(tol)
}

function leitura(p: PontoLatLng, precisaoM = 8): LeituraPosicao {
  return { lat: p[0], lon: p[1], precisaoM, tMs: 1000 }
}

const BASE = estadoNavegacao(ROTA_L, PEDIDO, { simulacao: false })

function estado(
  fase: Fase,
  op: Partial<Omit<EstadoNavegacao, 'acompanhamento'>> & { acompanhamento?: Partial<EstadoNavegacao['acompanhamento']> } = {},
): EstadoNavegacao {
  const { acompanhamento, ...resto } = op
  return { ...BASE, ...resto, fase, acompanhamento: { ...BASE.acompanhamento, ...acompanhamento } }
}

const GIRAR: PrefsMapa = { aberto: true, girar: true }
const NORTE: PrefsMapa = { aberto: true, girar: false }

describe('constantes', () => {
  it('têm os valores do spec', () => {
    expect(OLHAR_RUMO_M).toBe(10)
    expect(HISTERESE_RUMO_GRAUS).toBe(10)
    expect(ZOOM_NAVEGACAO).toBe(17)
  })
})

describe('paraLonLat', () => {
  it('troca [lat, lon] por [lon, lat]', () => {
    expect(paraLonLat([-23.5, -46.6])).toEqual([-46.6, -23.5])
  })
})

describe('diferencaAngular', () => {
  it('é a menor diferença, atravessando o norte', () => {
    expect(diferencaAngular(350, 10)).toBeCloseTo(20)
    expect(diferencaAngular(10, 350)).toBeCloseTo(20)
    expect(diferencaAngular(0, 180)).toBeCloseTo(180)
    expect(diferencaAngular(90, 90)).toBe(0)
    expect(diferencaAngular(0, 359)).toBeCloseTo(1)
  })
})

describe('rumoEm', () => {
  it.each([
    [1, 0, 0],
    [0, 1, 90],
    [-1, 0, 180],
    [0, -1, 270],
  ])('trajeto (norte %i, leste %i) dá %i°', (norte, leste, esperado) => {
    const r = rumoEm(trajetoReto(norte, leste), 50)!
    expect(diferencaAngular(r, esperado)).toBeLessThanOrEqual(0.5)
    expect(r).toBeGreaterThanOrEqual(0)
    expect(r).toBeLessThan(360)
  })

  it('no L: antes da quina é o leste do primeiro trecho, depois (+15 m) é o sul do segundo', () => {
    expect(diferencaAngular(rumoEm(T, 100)!, 90)).toBeLessThanOrEqual(0.5)
    expect(diferencaAngular(rumoEm(T, 135)!, 180)).toBeLessThanOrEqual(0.5)
  })

  it('nas pontas não lança e prende a corda à rota', () => {
    expect(diferencaAngular(rumoEm(T, 0)!, 90)).toBeLessThanOrEqual(0.5)
    expect(diferencaAngular(rumoEm(T, T.totalM)!, 180)).toBeLessThanOrEqual(0.5)
    expect(() => rumoEm(T, -50)).not.toThrow()
    expect(() => rumoEm(T, T.totalM + 50)).not.toThrow()
  })

  it('corda menor que 0,5 m dá null', () => {
    expect(rumoEm(trajetoReto(1, 0, 0.3), 0.15)).toBeNull()
  })
})

describe('dividirRota', () => {
  const inteira = T.pontos.map(ll)

  it('com 0 não há andado e o restante é a rota inteira', () => {
    expect(dividirRota(T, 0)).toEqual({ andado: null, restante: inteira })
  })

  it('no meio de um segmento, o corte é o mesmo ponto nas duas linhas', () => {
    const { andado, restante } = dividirRota(T, 150)
    const corte = ll(pontoAoLongo(T, 150))
    expect(andado![andado!.length - 1]).toEqual(corte)
    expect(restante![0]).toEqual(corte)
    // A, MEIO, B e o corte; o corte, C, D e E
    expect(andado).toHaveLength(4)
    expect(restante).toHaveLength(4)
    expect(andado!.slice(0, 3)).toEqual(inteira.slice(0, 3))
    expect(restante!.slice(1)).toEqual(inteira.slice(3))
  })

  it('num vértice, o vértice não se repete', () => {
    const { andado, restante } = dividirRota(T, T.acumuladoM[2])
    expect(andado).toEqual(inteira.slice(0, 3))
    expect(restante).toEqual(inteira.slice(2))
  })

  it('com totalM e além dele, o restante some', () => {
    expect(dividirRota(T, T.totalM)).toEqual({ andado: inteira, restante: null })
    expect(dividirRota(T, T.totalM + 40)).toEqual({ andado: inteira, restante: null })
  })
})

describe('trechoDoPasso', () => {
  it('vai de pontoAoLongo(inicioM) a pontoAoLongo(fimM), com os vértices internos', () => {
    const t0 = trechoDoPasso(T, 0)
    // A, o vértice do meio do primeiro trecho e B
    expect(t0).toEqual([ll(PONTOS_L.A), ll(T.pontos[1]), ll(PONTOS_L.B)])
    expect(t0[0]).toEqual(ll(pontoAoLongo(T, T.passos[0].inicioM)))
    expect(t0[t0.length - 1]).toEqual(ll(pontoAoLongo(T, T.passos[0].fimM)))
  })

  it('passo do meio de um segmento: só as pontas mais os vértices de dentro', () => {
    const t1 = trechoDoPasso(T, 1)
    expect(t1).toHaveLength(2)
    perto(t1[0], ll(PONTOS_L.B))
    perto(t1[1], ll(PONTOS_L.C))
  })

  it('passo de comprimento zero dá duas pontas iguais; índice inexistente dá lista vazia', () => {
    const t3 = trechoDoPasso(T, 3)
    expect(t3).toHaveLength(2)
    expect(t3[0]).toEqual(t3[1])
    expect(trechoDoPasso(T, 99)).toEqual([])
  })
})

describe('manobraEmDestaque', () => {
  it('fora do passo a passo usa proximoUtil, a mesma regra do painel', () => {
    for (let i = 0; i < ROTA_L.passos.length; i++) {
      const e = estado('navegando', { passoAtual: i })
      const prox = proximoUtil(e.contexto, i)
      const m = manobraEmDestaque(e)
      if (prox === null) expect(m).toBeNull()
      else {
        expect(m!.passo).toBe(prox)
        expect(m!.trecho).toEqual(trechoDoPasso(T, prox))
        expect(m!.ponto).toEqual(m!.trecho[0])
      }
    }
  })

  it('pula o passo de comprimento zero (passo 4) igual ao proximoUtil', () => {
    expect(manobraEmDestaque(estado('navegando', { passoAtual: 2 }))!.passo).toBe(4)
  })

  it('no último passo, o próximo é o destino: null', () => {
    expect(manobraEmDestaque(estado('navegando', { passoAtual: 4 }))).toBeNull()
  })

  it('no passo a passo destaca o passo atual', () => {
    expect(manobraEmDestaque(estado('passo_a_passo', { passoAtual: 1 }))!.passo).toBe(1)
  })
})

describe('circuloPrecisao', () => {
  it('tem 33 vértices, fechado, todos a raio ± 0,5 m', () => {
    const centro = ll(PONTOS_L.B)
    const anel = circuloPrecisao(centro, 25, REGUA)
    expect(anel).toHaveLength(33)
    expect(anel[32]).toEqual(anel[0])
    for (const p of anel) {
      const d = distancia(REGUA, [centro[1], centro[0]], [p[1], p[0]])
      expect(Math.abs(d - 25)).toBeLessThanOrEqual(0.5)
    }
  })
})

/** Guarda contra rastro: nenhuma saída tem mais de um ponto da pessoa. */
function pontosDaPessoa(c: Cena, l: LeituraPosicao): number {
  // a câmera que segue centra na própria pessoa: é o mesmo ponto, não um segundo
  if (c.camera.modo === 'seguir' && c.pessoa) expect(c.camera.centro).toEqual(c.pessoa.ponto)
  const texto = JSON.stringify({ ...c, pessoa: null, camera: c.camera.modo === 'seguir' ? null : c.camera })
  const fora = texto.includes(String(l.lat)) || texto.includes(String(l.lon)) ? 1 : 0
  return (c.pessoa ? 1 : 0) + fora
}

describe('cenaDoMapa', () => {
  const inteira = T.pontos.map(ll)
  const destino = ll(PONTOS_L.E)
  // 30 m ao norte do primeiro trecho: fora da rota e longe de qualquer vértice
  const bruto = deslocar(REGUA, pontoAoLongo(T, 50), 30, 0.123)

  it('fases sem mapa e trajeto nulo dão null', () => {
    for (const f of ['preparo', 'sem_permissao', 'indisponivel', 'chegou'] as const) {
      expect(cenaDoMapa(estado(f), GIRAR, 0)).toBeNull()
    }
    expect(cenaDoMapa(estado('navegando', { trajeto: null }), GIRAR, 0)).toBeNull()
  })

  it('navegando na rota com sinal bom: pessoa encaixada no progressoMaxM, seguir, rumo da rota', () => {
    const e = estado('navegando', { passoAtual: 0, ultimaLeitura: leitura(bruto), acompanhamento: { progressoMaxM: 50 } })
    const c = cenaDoMapa(e, GIRAR, 0)!
    const ponto = ll(pontoAoLongo(T, 50))
    expect(c.pessoa).toEqual({ ponto, encaixada: true, raioPrecisaoM: null })
    expect(c.camera).toEqual({ modo: 'seguir', centro: ponto, rumo: c.rumoAplicado, pessoaAbaixo: true })
    expect(diferencaAngular(c.rumoAplicado, 90)).toBeLessThanOrEqual(0.5)
    expect(c.destino).toEqual(destino)
    expect(c.andado![c.andado!.length - 1]).toEqual(ponto)
    expect(c.restante![0]).toEqual(ponto)
    expect(c.manobra).toEqual({ trecho: trechoDoPasso(T, 1), ponto: trechoDoPasso(T, 1)[0] })
    expect(pontosDaPessoa(c, e.ultimaLeitura!)).toBe(1)
  })

  it('navegando fora da rota: ponto bruto com raio, seguir no bruto, norte mesmo com girar', () => {
    const e = estado('navegando', { ultimaLeitura: leitura(bruto, 12), acompanhamento: { progressoMaxM: 50, fora: true } })
    const c = cenaDoMapa(e, GIRAR, 90)!
    expect(c.pessoa).toEqual({ ponto: ll(bruto), encaixada: false, raioPrecisaoM: 12 })
    expect(c.camera).toEqual({ modo: 'seguir', centro: ll(bruto), rumo: 0, pessoaAbaixo: false })
    expect(c.rumoAplicado).toBe(0)
    expect(pontosDaPessoa(c, e.ultimaLeitura!)).toBe(1)
  })

  it('sentido contrário avisado conta como fora: ponto bruto e norte', () => {
    const e = estado('navegando', {
      ultimaLeitura: leitura(bruto, 9),
      acompanhamento: { progressoMaxM: 50, contrarioAvisado: true },
    })
    const c = cenaDoMapa(e, GIRAR, 90)!
    expect(c.pessoa).toEqual({ ponto: ll(bruto), encaixada: false, raioPrecisaoM: 9 })
    expect(c.camera).toMatchObject({ modo: 'seguir', centro: ll(bruto), rumo: 0 })
    expect(c.rumoAplicado).toBe(0)
  })

  it.each(['fraco', 'sem_sinal'] as const)('navegando com sinal %s: congela e mantém o rumo anterior', (sinal) => {
    const e = estado('navegando', { ultimaLeitura: leitura(bruto, 40), acompanhamento: { progressoMaxM: 50, sinal } })
    const c = cenaDoMapa(e, GIRAR, 77)!
    expect(c.camera).toEqual({ modo: 'congelar' })
    expect(c.rumoAplicado).toBe(77)
    expect(c.pessoa).toEqual({ ponto: ll(pontoAoLongo(T, 50)), encaixada: true, raioPrecisaoM: 40 })
  })

  it('sinal ruim e fora: congela com o ponto bruto', () => {
    const e = estado('navegando', {
      ultimaLeitura: leitura(bruto, 40),
      acompanhamento: { progressoMaxM: 50, sinal: 'fraco', fora: true },
    })
    const c = cenaDoMapa(e, GIRAR, 77)!
    expect(c.camera).toEqual({ modo: 'congelar' })
    expect(c.pessoa).toEqual({ ponto: ll(bruto), encaixada: false, raioPrecisaoM: 40 })
  })

  it('procurando sem leitura: enquadra a rota inteira, sem pessoa, sem andado', () => {
    const c = cenaDoMapa(estado('procurando'), GIRAR, 45)!
    expect(c.pessoa).toBeNull()
    expect(c.andado).toBeNull()
    expect(c.restante).toEqual(inteira)
    expect(c.rumoAplicado).toBe(0)
    expect(c.camera.modo).toBe('enquadrar')
    if (c.camera.modo !== 'enquadrar') return
    const lons = inteira.map((p) => p[0])
    const lats = inteira.map((p) => p[1])
    expect(c.camera.caixa).toEqual([
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ])
    expect(c.camera.rumo).toBe(0)
  })

  it('procurando com leitura: segue o ponto bruto com raio, norte', () => {
    const e = estado('procurando', { ultimaLeitura: leitura(bruto, 20) })
    const c = cenaDoMapa(e, GIRAR, 45)!
    expect(c.pessoa).toEqual({ ponto: ll(bruto), encaixada: false, raioPrecisaoM: 20 })
    expect(c.camera).toEqual({ modo: 'seguir', centro: ll(bruto), rumo: 0, pessoaAbaixo: false })
    expect(c.andado).toBeNull()
    expect(c.restante).toEqual(inteira)
    expect(pontosDaPessoa(c, e.ultimaLeitura!)).toBe(1)
  })

  it('pausada: congela, mantém o rumo e mostra o andado', () => {
    const e = estado('pausada', { ultimaLeitura: leitura(bruto), acompanhamento: { progressoMaxM: 150 } })
    const c = cenaDoMapa(e, GIRAR, 180)!
    expect(c.camera).toEqual({ modo: 'congelar' })
    expect(c.rumoAplicado).toBe(180)
    expect(c.pessoa).toEqual({ ponto: ll(pontoAoLongo(T, 150)), encaixada: true, raioPrecisaoM: null })
    expect(c.andado).not.toBeNull()
  })

  it('passo a passo: enquadra o trecho do passo, sem pessoa, norte, sem andado', () => {
    const e = estado('passo_a_passo', { passoAtual: 1, ultimaLeitura: leitura(bruto), acompanhamento: { progressoMaxM: 150 } })
    const c = cenaDoMapa(e, GIRAR, 180)!
    expect(c.pessoa).toBeNull()
    expect(c.andado).toBeNull()
    expect(c.restante).toEqual(inteira)
    expect(c.rumoAplicado).toBe(0)
    const trecho = trechoDoPasso(T, 1)
    const lons = trecho.map((p) => p[0])
    const lats = trecho.map((p) => p[1])
    expect(c.camera).toEqual({
      modo: 'enquadrar',
      caixa: [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      rumo: 0,
    })
    expect(c.manobra!.trecho).toEqual(trecho)
    expect(pontosDaPessoa(c, e.ultimaLeitura!)).toBe(0)
  })

  describe('histerese do rumo', () => {
    // no primeiro trecho o rumo da rota é 90°
    const e = estado('navegando', { acompanhamento: { progressoMaxM: 50 } })

    it('diferença de 9° não muda o rumo', () => {
      expect(cenaDoMapa(e, GIRAR, 81)!.rumoAplicado).toBe(81)
      expect(cenaDoMapa(e, GIRAR, 99)!.rumoAplicado).toBe(99)
    })

    it('diferença de 11° muda para o rumo da rota', () => {
      expect(diferencaAngular(cenaDoMapa(e, GIRAR, 79)!.rumoAplicado, 90)).toBeLessThanOrEqual(0.5)
      expect(diferencaAngular(cenaDoMapa(e, GIRAR, 101)!.rumoAplicado, 90)).toBeLessThanOrEqual(0.5)
    })

    it('rumo 0 aplicado com girar ligado deixa a pessoa no centro', () => {
      const norte = estado('navegando', { acompanhamento: { progressoMaxM: 50 } })
      const c = cenaDoMapa({ ...norte }, GIRAR, 0)!
      // 90 ≥ 10 de diferença: gira
      expect(c.camera).toMatchObject({ pessoaAbaixo: true })
      const parado = cenaDoMapa({ ...norte, trajeto: trajetoReto(1, 0) }, GIRAR, 0)!
      expect(parado.rumoAplicado).toBe(0)
      expect(parado.camera).toMatchObject({ pessoaAbaixo: false })
    })
  })

  it('girar desligado dá rumo 0 em todos os casos', () => {
    const casos: EstadoNavegacao[] = [
      estado('navegando', { acompanhamento: { progressoMaxM: 50 } }),
      estado('navegando', { ultimaLeitura: leitura(bruto), acompanhamento: { progressoMaxM: 50, fora: true } }),
      estado('navegando', { ultimaLeitura: leitura(bruto), acompanhamento: { progressoMaxM: 50, sinal: 'fraco' } }),
      estado('procurando'),
      estado('procurando', { ultimaLeitura: leitura(bruto) }),
      estado('pausada', { acompanhamento: { progressoMaxM: 50 } }),
      estado('passo_a_passo', { passoAtual: 2 }),
    ]
    for (const e of casos) {
      const c = cenaDoMapa(e, NORTE, 135)!
      expect(c.rumoAplicado).toBe(0)
      if (c.camera.modo !== 'congelar') expect(c.camera.rumo).toBe(0)
      if (c.camera.modo === 'seguir') expect(c.camera.pessoaAbaixo).toBe(false)
    }
  })

  it('não altera o estado recebido', () => {
    const e = estado('navegando', { ultimaLeitura: leitura(bruto), acompanhamento: { progressoMaxM: 50 } })
    const copia = JSON.stringify({ ...e, falados: [...e.falados] })
    cenaDoMapa(e, GIRAR, 0)
    expect(JSON.stringify({ ...e, falados: [...e.falados] })).toBe(copia)
  })
})

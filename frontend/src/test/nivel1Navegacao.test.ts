/**
 * Nível 1 da emenda de 10/11/2026 (spec do mapa, 19.1): seta de manobra, pictograma da manobra
 * e a linha de distância que falta. Módulos puros.
 */
import type { RotaIn } from '../api/client'
import { pictogramaDaManobra } from '../componentes/navegacao/pictogramaManobra'
import { DESENHOS } from '../componentes/pictogramas'
import {
  cenaDoMapa,
  manobraEmDestaque,
  rumoDaRotaAgora,
  SETA_MANOBRA,
  setaDaManobra,
  type LonLat,
} from '../dados/navegacao/mapaNavegacao'
import { estadoNavegacao, type EstadoNavegacao, type Fase } from '../dados/navegacao/navegacao'
import { resumoDoCaminho } from '../dados/navegacao/resumoCaminho'
import { montarTrajeto } from '../dados/navegacao/trajeto'
import { ROTA_L } from './fixturasNavegacao'

const PEDIDO: RotaIn = {
  origem: { lat: -23.5617, lng: -46.656 },
  destino: { lat: -23.5636, lng: -46.6547 },
  perfil: { inclinacao_max: 6, guia_max_m: 0.06, largura_min_m: 0.9, evitar_degraus: true, velocidade_kmh: 3 },
}
const T = montarTrajeto(ROTA_L)!
const BASE = estadoNavegacao(ROTA_L, PEDIDO, { simulacao: false })

function estado(
  fase: Fase,
  op: Partial<Omit<EstadoNavegacao, 'acompanhamento'>> & { acompanhamento?: Partial<EstadoNavegacao['acompanhamento']> } = {},
): EstadoNavegacao {
  const { acompanhamento, ...resto } = op
  return { ...BASE, ...resto, fase, acompanhamento: { ...BASE.acompanhamento, sinal: 'bom', ...acompanhamento } }
}

/** [leste, norte] em metros de a até b. */
function metros(a: LonLat, b: LonLat): [number, number] {
  return [(b[0] - a[0]) * T.regua.kx, (b[1] - a[1]) * T.regua.ky]
}
const comprimento = (a: LonLat, b: LonLat) => Math.hypot(...metros(a, b))

describe('setaDaManobra', () => {
  // ROTA_L: A → B 120 m para leste, B → C 80 m para sul (a virada à direita fica em 120 m)
  const VIRADA = T.passos[1].inicioM

  it('tem os tamanhos da emenda', () => {
    expect(SETA_MANOBRA).toMatchObject({ ANTES_M: 12, DEPOIS_M: 18, PONTA_COMPRIMENTO_M: 11, PONTA_LARGURA_M: 16 })
  })

  it('a haste vai de 12 m antes a 18 m depois da virada, passando pelo canto', () => {
    const seta = setaDaManobra(T, VIRADA)!
    const haste = seta.haste
    expect(haste.length).toBeGreaterThanOrEqual(3)
    const canto = haste[1]
    // antes do canto: 12 m vindos do oeste; depois: 18 m para o sul
    const [l1, n1] = metros(haste[0], canto)
    expect(l1).toBeCloseTo(12, 1)
    expect(Math.abs(n1)).toBeLessThan(0.01)
    const [l2, n2] = metros(canto, haste[haste.length - 1])
    expect(Math.abs(l2)).toBeLessThan(0.01)
    expect(n2).toBeCloseTo(-18, 1)
  })

  it('a ponta é um triângulo fechado no fim da haste, apontando no sentido da rota (sul)', () => {
    const seta = setaDaManobra(T, VIRADA)!
    const fim = seta.haste[seta.haste.length - 1]
    const [bico, direita, esquerda, fecho] = seta.ponta
    expect(seta.ponta).toHaveLength(4)
    expect(fecho).toEqual(bico)
    // bico 11 m adiante do fim da haste, para o sul
    const [lb, nb] = metros(fim, bico)
    expect(Math.abs(lb)).toBeLessThan(0.01)
    expect(nb).toBeCloseTo(-11, 2)
    // base de 16 m, centrada no fim da haste e perpendicular ao sentido
    expect(comprimento(direita, esquerda)).toBeCloseTo(16, 2)
    expect(comprimento(fim, direita)).toBeCloseTo(8, 2)
    expect(comprimento(fim, esquerda)).toBeCloseTo(8, 2)
    expect(Math.abs(metros(fim, direita)[1])).toBeLessThan(0.01)
    // andando para o sul, a direita é o oeste
    expect(metros(fim, direita)[0]).toBeLessThan(0)
    expect(metros(fim, esquerda)[0]).toBeGreaterThan(0)
  })

  it('no começo da rota a haste não sai da rota', () => {
    const seta = setaDaManobra(T, 0)!
    expect(seta.haste[0]).toEqual([T.pontos[0][1], T.pontos[0][0]])
    const [leste, norte] = metros(seta.haste[0], seta.haste[seta.haste.length - 1])
    expect(leste).toBeCloseTo(18, 1)
    expect(Math.abs(norte)).toBeLessThan(0.01)
  })

  it('sem 3 m de rota depois da virada, não há seta', () => {
    expect(setaDaManobra(T, T.totalM)).toBeNull()
    expect(setaDaManobra(T, T.totalM - 2)).toBeNull()
    expect(setaDaManobra(T, T.totalM - 4)).not.toBeNull()
  })

  it('é pura: mesma entrada, mesma saída, sem compartilhar vetores', () => {
    const a = setaDaManobra(T, VIRADA)!
    const b = setaDaManobra(T, VIRADA)!
    expect(a).toEqual(b)
    expect(a.haste).not.toBe(b.haste)
    expect(a.ponta[0]).not.toBe(a.ponta[3])
  })

  it('a cena leva a seta da mesma virada que o painel destaca', () => {
    const e = estado('navegando', { passoAtual: 0, acompanhamento: { progressoMaxM: 40 } })
    const m = manobraEmDestaque(e)!
    const cena = cenaDoMapa(e, { aberto: true, girar: false }, 0)!
    expect(cena.setaManobra).toEqual(setaDaManobra(T, T.passos[m.passo].inicioM))
    expect(cena.setaManobra).not.toBeNull()
  })

  it('sem próxima virada (o próximo é o destino), a cena não tem seta', () => {
    const ultimo = ROTA_L.passos.length - 1
    const cena = cenaDoMapa(estado('navegando', { passoAtual: ultimo, acompanhamento: { progressoMaxM: T.totalM - 30 } }), { aberto: true, girar: false }, 0)!
    expect(cena.manobra).toBeNull()
    expect(cena.setaManobra).toBeNull()
  })
})

describe('rumoDaRotaAgora (sentido da rota para a seta da pessoa)', () => {
  it('na rota, o rumo da corda no ponto da pessoa', () => {
    expect(rumoDaRotaAgora(estado('navegando', { acompanhamento: { progressoMaxM: 40 } }))).toBeCloseTo(90, 0)
    expect(rumoDaRotaAgora(estado('navegando', { acompanhamento: { progressoMaxM: 170 } }))).toBeCloseTo(180, 0)
    expect(rumoDaRotaAgora(estado('pausada', { faseAntesDaPausa: 'navegando', acompanhamento: { progressoMaxM: 40 } }))).toBeCloseTo(90, 0)
  })

  it('fora da rota, em sentido contrário, procurando e no passo a passo: nenhum', () => {
    expect(rumoDaRotaAgora(estado('navegando', { acompanhamento: { progressoMaxM: 40, fora: true } }))).toBeNull()
    expect(rumoDaRotaAgora(estado('navegando', { acompanhamento: { progressoMaxM: 40, contrarioAvisado: true } }))).toBeNull()
    expect(rumoDaRotaAgora(estado('procurando'))).toBeNull()
    expect(rumoDaRotaAgora(estado('pausada', { faseAntesDaPausa: 'procurando' }))).toBeNull()
    expect(rumoDaRotaAgora(estado('passo_a_passo'))).toBeNull()
    expect(rumoDaRotaAgora(estado('navegando', { trajeto: null }))).toBeNull()
  })
})

describe('pictogramaDaManobra', () => {
  const p = (direcao: string, instrucao: string) => pictogramaDaManobra({ direcao, instrucao })

  it('segue o campo direcao do passo', () => {
    expect(p('siga', 'Siga para leste em direção a Alameda Jaú')).toBe('em-frente')
    expect(p('vire_direita', 'Vire à direita em direção a Rua Augusta')).toBe('vire-direita')
    expect(p('vire_esquerda', 'Vire à esquerda e siga por Rua X')).toBe('vire-esquerda')
  })

  it('o texto refina: curva leve e retorno', () => {
    expect(p('vire_direita', 'Vire ligeiramente à direita em direção a Rua X')).toBe('leve-direita')
    expect(p('vire_esquerda', 'Vire levemente à esquerda')).toBe('leve-esquerda')
    expect(p('siga', 'Mantenha-se à esquerda em direção a Rua X')).toBe('leve-esquerda')
    expect(p('vire_esquerda', 'Faça o retorno')).toBe('retorno')
  })

  it('"siga" com o nome de uma rua "à direita" no texto não vira curva', () => {
    expect(p('siga', 'Siga em direção a Travessa à Direita')).toBe('em-frente')
    expect(p('desconhecida', '')).toBe('em-frente')
  })

  it('todo nome devolvido existe nos desenhos', () => {
    for (const nome of ['em-frente', 'vire-direita', 'vire-esquerda', 'leve-direita', 'leve-esquerda', 'retorno'] as const) {
      expect(DESENHOS[nome].length).toBeGreaterThan(0)
    }
  })
})

describe('resumoDoCaminho (distância que falta e passo, sem tempo)', () => {
  it('navegando na rota: o que falta até o destino e o passo', () => {
    const r = resumoDoCaminho(estado('navegando', { passoAtual: 1, acompanhamento: { progressoMaxM: T.totalM - 190 } }))
    expect(r).toEqual({ falta: 'Faltam 190 m até o destino.', passo: 'Passo 2 de 5.' })
  })

  it('usa o mesmo arredondamento da voz e nunca fala de tempo', () => {
    const r = resumoDoCaminho(estado('navegando', { acompanhamento: { progressoMaxM: T.totalM - 187.4 } }))!
    expect(r.falta).toBe('Faltam 185 m até o destino.')
    expect(`${r.falta} ${r.passo}`).not.toMatch(/min|segundo|hora/i)
  })

  it('sinal fraco ou sem sinal: "cerca de"', () => {
    for (const sinal of ['fraco', 'sem_sinal'] as const) {
      const r = resumoDoCaminho(estado('navegando', { acompanhamento: { progressoMaxM: T.totalM - 190, sinal } }))!
      expect(r.falta).toBe('Faltam cerca de 190 m até o destino.')
    }
  })

  it('um metro fica no singular e nunca fica negativo', () => {
    expect(resumoDoCaminho(estado('navegando', { acompanhamento: { progressoMaxM: T.totalM - 1 } }))!.falta).toBe('Falta 1 m até o destino.')
    expect(resumoDoCaminho(estado('navegando', { acompanhamento: { progressoMaxM: T.totalM + 50 } }))!.falta).toBe('Falta 1 m até o destino.')
  })

  it('fora da rota: só o passo', () => {
    const r = resumoDoCaminho(estado('navegando', { passoAtual: 1, acompanhamento: { progressoMaxM: 130, fora: true } }))
    expect(r).toEqual({ falta: null, passo: 'Passo 2 de 5.' })
  })

  it('pausada no meio da navegação continua mostrando; pausada na procura, não', () => {
    expect(resumoDoCaminho(estado('pausada', { faseAntesDaPausa: 'navegando', acompanhamento: { progressoMaxM: T.totalM - 100 } }))!.falta).toBe(
      'Faltam 100 m até o destino.',
    )
    expect(resumoDoCaminho(estado('pausada', { faseAntesDaPausa: 'procurando' }))).toBeNull()
  })

  it('passo a passo: do começo do passo até o destino', () => {
    const r = resumoDoCaminho(estado('passo_a_passo', { passoAtual: 1 }))!
    expect(r.passo).toBe('Passo 2 de 5.')
    expect(r.falta).toBe('Do começo deste passo até o destino: 190 m.')
    expect(resumoDoCaminho(estado('passo_a_passo', { passoAtual: 0 }))!.falta).toBe('Do começo deste passo até o destino: 310 m.')
  })

  it('fases sem passo na tela: nada', () => {
    for (const fase of ['preparo', 'procurando', 'chegou', 'sem_permissao', 'indisponivel'] as const) {
      expect(resumoDoCaminho(estado(fase))).toBeNull()
    }
  })
})

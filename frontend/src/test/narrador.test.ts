import type { RotaOut } from '../api/client'
import { alertasDaRota, falaDoPasso, falasDaRota, numeroFalado, ondeNosPassos, textoExigenciaDaRota } from '../dados/narrador'
import type { BarreiraResumo } from '../dados/passo'
import { passo, ROTA } from './fixturasRota'

const BARREIRA: BarreiraResumo = {
  id: 19401,
  origem: 'oficial',
  categoria: 'calcada_danificada',
  severidade: 'dificulta',
  distancia_m: 8.4,
  confirmacoes: null,
  data_referencia: '2026-05-04',
}

function rota(extras: Partial<RotaOut> = {}): RotaOut {
  return { ...ROTA, ...extras }
}

describe('alertas da rota', () => {
  it('rota sem nada a avisar não inventa aviso', () => {
    expect(alertasDaRota(rota(), 6)).toEqual([])
  })

  it('o que pode impedir a passagem vem antes do resto', () => {
    const passos = [
      passo(1, { declividade_pct: 9 }),
      passo(2, { is_degrau: true }),
      passo(3, { largura_m: 0.7 }),
      passo(4, { guia: 'nao_transponivel' }),
    ]
    expect(alertasDaRota(rota({ passos }), 6).map((a) => a.tipo)).toEqual(['degrau', 'guia', 'inclinacao', 'largura'])
  })

  it('a mesma barreira em dois passos vira um aviso só, no primeiro passo', () => {
    const passos = [passo(1, { barreiras_proximas: [BARREIRA] }), passo(2, { barreiras_proximas: [BARREIRA] })]
    const barreiras = alertasDaRota(rota({ passos }), 6).filter((a) => a.tipo === 'barreira')
    expect(barreiras).toHaveLength(1)
    expect(barreiras[0].passos).toEqual([1])
    expect(barreiras[0].texto).toBe('Calçada danificada a 8 m, perto do passo 1. Dificulta a passagem, não bloqueia.')
  })

  it('inclinação: diz o pedido, os passos e o maior valor', () => {
    const passos = [passo(1, { declividade_pct: 6.19 }), passo(2), passo(3, { declividade_pct: 11.11 })]
    const [alerta] = alertasDaRota(rota({ passos }), 6)
    expect(alerta.tipo).toBe('inclinacao')
    expect(alerta.passos).toEqual([1, 3])
    expect(alerta.texto).toBe('Inclinação acima do pedido (até 6%) nos passos 1 e 3. A maior é de 11,11%. Pode ser preciso ajuda.')
  })

  it('inclinação em muitos passos: conta e aponta só o pior', () => {
    const passos = Array.from({ length: 10 }, (_, i) => passo(i + 1, { declividade_pct: i === 4 ? 8.75 : 4 }))
    const [alerta] = alertasDaRota(rota({ passos }), 3)
    expect(alerta.texto).toBe('Inclinação acima do pedido (até 3%) em 10 de 10 passos. A maior é de 8,75%, no passo 5. Pode ser preciso ajuda.')
    expect(alerta.passos).toEqual([5])
  })

  it('sem limite pedido, ainda avisa de rampa acima da norma', () => {
    const [alerta] = alertasDaRota(rota({ passos: [passo(1, { declividade_pct: 12 })], nivel_exigencia_atendido: 'any' }), 'any')
    expect(alerta.texto).toBe('Inclinação acima de 8,33%, o máximo da norma para rampas, no passo 1. A maior é de 12%. Pode ser preciso ajuda.')
  })

  it('calçada mais estreita que o pedido', () => {
    const [alerta] = alertasDaRota(rota({ passos: [passo(1), passo(2, { largura_m: 0.5 })] }), 6)
    expect(alerta.texto).toBe('Calçada mais estreita que 0,9 m no passo 2. A mais estreita tem 0,5 m.')
  })

  it('falta de dado e rota de reserva vêm por último e não são graves', () => {
    const passos = [passo(1, { largura_m: null, largura_medida: false, declividade_pct: null, declividade_medida: false })]
    const alertas = alertasDaRota(rota({ passos, motor: 'pgrouting', nivel_exigencia_atendido: 'any' }), 6)
    expect(alertas.map((a) => [a.tipo, a.grave])).toEqual([
      ['sem_dados', false],
      ['reserva', false],
    ])
    expect(alertas[1].texto).toBe('Rota calculada pelo roteamento de reserva, que não mede a inclinação. Confira cada passo.')
  })

  it('pedido mais rígido que o atendido, sem passo marcado: avisa uma vez', () => {
    const alertas = alertasDaRota(rota({ nivel_exigencia_atendido: 10 }), 6)
    expect(alertas.map((a) => a.texto)).toEqual(['Só encontramos rota com inclinação de até 10%, acima do pedido (até 6%).'])
  })

  it('ondeNosPassos concorda em número', () => {
    expect(ondeNosPassos([5])).toBe('no passo 5')
    expect(ondeNosPassos([5, 10])).toBe('nos passos 5 e 10')
    expect(ondeNosPassos([1, 2, 3])).toBe('nos passos 1, 2 e 3')
  })
})

describe('exigência na ficha', () => {
  it('diz em palavras se o pedido foi cumprido', () => {
    expect(textoExigenciaDaRota(rota(), 6)).toBe('Até 6%, como pedido.')
    expect(textoExigenciaDaRota(rota({ passos: [passo(1, { declividade_pct: 9 })], nivel_exigencia_atendido: 'any' }), 6)).toBe(
      'Pedido: até 6%. A rota passa disso em 1 passo.',
    )
    expect(textoExigenciaDaRota(rota({ nivel_exigencia_atendido: 'any' }), 'any')).toBe('Qualquer inclinação, como pedido.')
  })
})

describe('narração', () => {
  it('números falados: arredonda sem esconder o excesso', () => {
    expect(numeroFalado(6.19)).toBe('6,2')
    expect(numeroFalado(11.11)).toBe('11')
    expect(numeroFalado(3)).toBe('3')
  })

  it('o passo diz ação, distância e só o que importa', () => {
    expect(falaDoPasso(passo(2, { instrucao: 'Vire à direita em direção a Rua dos Macaxás', distancia_m: 203 }), 9, 6)).toBe(
      'Passo 2 de 9. Vire à direita em direção a Rua dos Macaxás. 205 metros.',
    )
  })

  it('o passo com problema avisa antes do detalhe e com o valor', () => {
    const p = passo(8, {
      instrucao: 'Siga por Rua Jamboaçu',
      distancia_m: 213,
      declividade_pct: 13.94,
      largura_m: 0.8,
      guia: 'nao_transponivel',
      is_degrau: true,
      barreiras_proximas: [BARREIRA],
    })
    expect(falaDoPasso(p, 9, 6)).toBe(
      'Passo 8 de 9. Siga por Rua Jamboaçu. 215 metros. Atenção: degrau. Guia sem rebaixamento. Inclinação de 14 por cento, acima do pedido. Calçada estreita, 0,8 metro. Calçada danificada a 8 metros.',
    )
  })

  it('estimativa é dita como estimativa, e trecho sem medida não fica em silêncio', () => {
    const estimado = passo(1, { declividade_pct: 15, declividade_medida: false })
    expect(falaDoPasso(estimado, 1, 6)).toContain('Inclinação estimada de 15 por cento, acima do pedido.')
    const semDado = passo(1, { largura_m: null, largura_medida: false, declividade_pct: null, declividade_medida: false })
    expect(falaDoPasso(semDado, 1, 6)).toContain('Sem medida da calçada neste trecho.')
    expect(falaDoPasso(passo(1, { largura_m: null, largura_medida: false }), 1, 6)).toContain('Sem medida da largura da calçada neste trecho.')
  })

  it('a rota começa pelo resumo com os avisos e termina na chegada', () => {
    const falas = falasDaRota(rota({ passos: [passo(1), passo(2, { is_degrau: true })], distancia_m: 1234, duracao_s: 1480 }), 6)
    expect(falas[0]).toEqual({
      ordem: null,
      texto: 'Rota de 1,2 quilômetro, cerca de 25 minutos, em 2 passos. Um aviso: degrau no passo 2. Agora, os passos.',
    })
    expect(falas.map((f) => f.ordem)).toEqual([null, 1, 2])
    expect(falas[2].texto.endsWith('Você chegou ao destino.')).toBe(true)
  })

  it('rota sem avisos diz isso no resumo', () => {
    expect(falasDaRota(rota(), 6)[0].texto).toBe('Rota de 200 metros, cerca de 4 minutos, em 2 passos. Sem avisos. Agora, os passos.')
  })
})

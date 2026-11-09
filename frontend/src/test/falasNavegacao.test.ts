import { alertasFaladosDoPasso, falaDoPasso, gravesFaladosDoPasso, metrosFalados } from '../dados/narrador'
import {
  distanciaNaTela,
  FALAS_FIXAS,
  falaEntrada,
  falaErroRecalculo,
  falaInicio,
  falaLonge,
  falaNovaRota,
  falaRepetir,
  falaSaiu,
  falaVoltou,
  marcoDevido,
  MARCOS,
  PREFIXO_SIMULACAO,
  proximoUtil,
  situacao,
  type Contexto,
  type FalaNavegacao,
} from '../dados/navegacao/falasNavegacao'
import type { BarreiraResumo, Passo } from '../dados/passo'
import { passo } from './fixturasRota'

// Os 5 passos da ROTA_L (spec 10.1), sem geometria: aqui só importam textos e comprimentos.
const PASSOS_L: Passo[] = [
  passo(1, { instrucao: 'Siga para leste em direção a Alameda Jaú', direcao: 'siga', distancia_m: 120 }),
  passo(2, { instrucao: 'Vire à direita em direção a Rua Augusta', direcao: 'vire_direita', distancia_m: 80 }),
  passo(3, { instrucao: 'Vire à esquerda em direção a Rua Peixoto Gomide', direcao: 'vire_esquerda', distancia_m: 8 }),
  passo(4, { instrucao: 'Siga em direção a Rua Peixoto Gomide', direcao: 'siga', distancia_m: 0 }),
  passo(5, {
    instrucao: 'Vire à direita em direção a Alameda Santos',
    direcao: 'vire_direita',
    distancia_m: 100,
    is_degrau: true,
    guia: 'nao_transponivel',
  }),
]
const C: Contexto = { passos: PASSOS_L, comprimentosM: [120, 80, 8, 0, 100], pedido: 6 }

const BARREIRA: BarreiraResumo = {
  id: 1,
  origem: 'oficial',
  categoria: 'calcada_danificada',
  severidade: 'dificulta',
  distancia_m: 10,
  confirmacoes: null,
  data_referencia: '2026-05-04',
}

const NADA = new Set<string>()
// montada em partes para o próprio teste não conter a palavra que ele proíbe
const PALAVRA_PROIBIDA = ['gar', 'ant'].join('')
const todas: string[] = []
function anotar<T extends FalaNavegacao | null>(f: T): T {
  if (f) todas.push(f.texto)
  return f
}

describe('narrador: exports para a navegação', () => {
  it('metrosFalados arredonda como a voz da rota', () => {
    expect(metrosFalados(8)).toBe('8 metros')
    expect(metrosFalados(54)).toBe('55 metros')
    expect(metrosFalados(1)).toBe('1 metro')
    expect(metrosFalados(1500)).toBe('1,5 quilômetro')
  })

  it('alertasFaladosDoPasso são as frases que falaDoPasso diz depois da distância', () => {
    const p = passo(5, { is_degrau: true, guia: 'nao_transponivel' })
    const alertas = alertasFaladosDoPasso(p, 6)
    expect(alertas).toEqual(['Atenção: degrau.', 'Guia sem rebaixamento.'])
    expect(falaDoPasso(p, 5, 6)).toBe(`Passo 5 de 5. Siga por Rua 5. 100 metros. ${alertas.join(' ')}`)
  })

  it('alertasFaladosDoPasso inclui a falta de medida, no fim', () => {
    expect(alertasFaladosDoPasso(passo(1, { is_degrau: true, largura_m: null }), 6)).toEqual([
      'Atenção: degrau.',
      'Sem medida da largura da calçada neste trecho.',
    ])
  })

  it('gravesFaladosDoPasso: forma curta, só o que é grave, na ordem de gravidade', () => {
    expect(gravesFaladosDoPasso(passo(1, { is_degrau: true, guia: 'nao_transponivel' }), 6)).toEqual(['degrau', 'guia sem rebaixamento'])
    expect(gravesFaladosDoPasso(passo(1, { declividade_pct: 9.2 }), 6)).toEqual(['inclinação de 9,2 por cento, acima do pedido'])
    expect(gravesFaladosDoPasso(passo(1, { declividade_pct: 12 }), 'any')).toEqual(['inclinação de 12 por cento, acima da norma para rampas'])
    expect(gravesFaladosDoPasso(passo(1, { largura_m: 0.8 }), 6)).toEqual(['calçada estreita, 0,8 metro'])
    expect(gravesFaladosDoPasso(passo(1, { barreiras_proximas: [BARREIRA] }), 6)).toEqual(['calçada danificada a 10 metros'])
    expect(
      gravesFaladosDoPasso(
        passo(1, { barreiras_proximas: [BARREIRA], largura_m: 0.8, declividade_pct: 9.2, guia: 'nao_transponivel', is_degrau: true }),
        6,
      ),
    ).toEqual(['degrau', 'guia sem rebaixamento', 'inclinação de 9,2 por cento, acima do pedido', 'calçada estreita, 0,8 metro', 'calçada danificada a 10 metros'])
  })

  it('gravesFaladosDoPasso não diz a falta de medida', () => {
    expect(gravesFaladosDoPasso(passo(1, { largura_m: null, declividade_pct: null }), 6)).toEqual([])
  })
})

describe('falas da navegação', () => {
  it('MARCOS tem os limiares do spec', () => {
    expect(MARCOS).toEqual({ APROX_M: 50, PERTO_M: 15, MARGEM_M: 5, PASSO_CURTO_M: 70, ENCADEAR_M: 30, PASSO_MINIMO_M: 1 })
  })

  it('proximoUtil pula o passo degenerado; null é o destino', () => {
    expect(proximoUtil(C, 0)).toBe(1)
    expect(proximoUtil(C, 2)).toBe(4)
    expect(proximoUtil(C, 4)).toBeNull()
  })

  it('distanciaNaTela', () => {
    expect(distanciaNaTela(0.4)).toBe('1 m')
    expect(distanciaNaTela(8)).toBe('8 m')
    expect(distanciaNaTela(42)).toBe('40 m')
    expect(distanciaNaTela(43)).toBe('45 m')
    expect(distanciaNaTela(1200)).toBe('1,2 km')
  })

  it('falaInicio, com e sem simulação', () => {
    const base =
      'Passo 1 de 5. Siga para leste em direção a Alameda Jaú. 120 metros. Se não souber para que lado ir, ande alguns metros. O app avisa se for no sentido contrário.'
    expect(anotar(falaInicio(C, 0, false))).toEqual({ id: 'inicio', texto: base, urgente: false, tipo: 'instrucao' })
    const sim = anotar(falaInicio(C, 0, true))
    expect(sim.texto).toBe(`${PREFIXO_SIMULACAO} ${base}`)
    expect(PREFIXO_SIMULACAO).toBe('Modo demonstração: a posição é simulada, não é a sua.')
  })

  it('falaEntrada nos passos 2, 3 e 5; o degenerado não tem entrada', () => {
    expect(anotar(falaEntrada(C, 1))).toEqual({
      id: 'entrada:2',
      texto: 'Passo 2 de 5, Rua Augusta. Siga por 80 metros.',
      urgente: false,
      tipo: 'instrucao',
    })
    expect(anotar(falaEntrada(C, 2))?.texto).toBe(
      'Passo 3 de 5, Rua Peixoto Gomide. Siga por 8 metros. Depois, vire à direita em direção a Alameda Santos. No próximo trecho: degrau, guia sem rebaixamento.',
    )
    expect(falaEntrada(C, 3)).toBeNull()
    const ultimo = anotar(falaEntrada(C, 4))
    expect(ultimo?.id).toBe('entrada:5')
    expect(ultimo?.texto).toBe('Passo 5 de 5, Alameda Santos. Siga por 100 metros. Atenção: degrau. Guia sem rebaixamento.')
  })

  it('falaEntrada sem rua e com passo curto antes do destino', () => {
    const c: Contexto = {
      passos: [passo(1, { instrucao: 'Vire à esquerda', direcao: 'vire_esquerda', distancia_m: 40 })],
      comprimentosM: [40],
      pedido: 6,
    }
    expect(anotar(falaEntrada(c, 0))?.texto).toBe('Passo 1 de 1. Siga por 40 metros. Depois, o destino.')
  })

  describe('marcoDevido', () => {
    it('passo 1: antes do marco, nada', () => {
      expect(marcoDevido(C, { indicePasso: 0, faltaM: 56, foraDaRota: false }, NADA)).toEqual({ fala: null, marcar: [] })
    })

    it('passo 1: no marco de 50 m', () => {
      const r = marcoDevido(C, { indicePasso: 0, faltaM: 54.2, foraDaRota: false }, NADA)
      anotar(r.fala)
      expect(r).toEqual({
        fala: { id: '1:aprox', texto: 'Em 50 metros, vire à direita em direção a Rua Augusta.', urgente: false, tipo: 'instrucao' },
        marcar: ['1:aprox'],
      })
    })

    it('passo 1: pulou o marco, diz a distância real', () => {
      expect(marcoDevido(C, { indicePasso: 0, faltaM: 30, foraDaRota: false }, NADA).fala?.texto).toBe(
        'Em 30 metros, vire à direita em direção a Rua Augusta.',
      )
    })

    it('passo 1: dois marcos devidos, fala só o mais perto e marca os dois', () => {
      const r = marcoDevido(C, { indicePasso: 0, faltaM: 19, foraDaRota: false }, NADA)
      anotar(r.fala)
      expect(r.fala).toEqual({ id: '1:perto', texto: 'Logo à frente, vire à direita.', urgente: true, tipo: 'instrucao' })
      expect(r.marcar).toEqual(['1:aprox', '1:perto'])
    })

    it('marco já falado não se repete', () => {
      expect(marcoDevido(C, { indicePasso: 0, faltaM: 19, foraDaRota: false }, new Set(['1:aprox', '1:perto']))).toEqual({
        fala: null,
        marcar: [],
      })
      expect(marcoDevido(C, { indicePasso: 0, faltaM: 40, foraDaRota: false }, new Set(['1:aprox']))).toEqual({ fala: null, marcar: [] })
    })

    it('fora da rota, nada', () => {
      expect(marcoDevido(C, { indicePasso: 0, faltaM: 19, foraDaRota: true }, NADA)).toEqual({ fala: null, marcar: [] })
    })

    it('passo 2: encadeia a virada seguinte quando o próximo é curto', () => {
      const r = marcoDevido(C, { indicePasso: 1, faltaM: 15, foraDaRota: false }, NADA)
      anotar(r.fala)
      expect(r.fala).toEqual({
        id: '2:perto',
        texto: 'Logo à frente, vire à esquerda. Logo depois, vire à direita.',
        urgente: true,
        tipo: 'instrucao',
      })
      expect(r.marcar).toEqual(['2:aprox', '2:perto'])
    })

    it('passo 3, curto: nenhum marco', () => {
      expect(marcoDevido(C, { indicePasso: 2, faltaM: 4, foraDaRota: false }, NADA)).toEqual({ fala: null, marcar: [] })
    })

    it('passo 5, último: o destino', () => {
      const aprox = marcoDevido(C, { indicePasso: 4, faltaM: 52, foraDaRota: false }, NADA)
      const perto = marcoDevido(C, { indicePasso: 4, faltaM: 18, foraDaRota: false }, new Set(['5:aprox']))
      anotar(aprox.fala)
      anotar(perto.fala)
      expect(aprox.fala).toEqual({ id: '5:aprox', texto: 'Em 50 metros, o destino.', urgente: false, tipo: 'instrucao' })
      expect(perto.fala).toEqual({ id: '5:perto', texto: 'Logo à frente, o destino.', urgente: true, tipo: 'instrucao' })
      expect(perto.marcar).toEqual(['5:perto'])
    })

    it('próximo "siga" com grave: aprox avisa o trecho; sem grave: nada', () => {
      const comDegrau: Contexto = {
        passos: [passo(1, { distancia_m: 100 }), passo(2, { is_degrau: true }), passo(3)],
        comprimentosM: [100, 100, 100],
        pedido: 6,
      }
      const r = marcoDevido(comDegrau, { indicePasso: 0, faltaM: 50, foraDaRota: false }, NADA)
      anotar(r.fala)
      expect(r.fala?.texto).toBe('Em 50 metros, no próximo trecho: degrau.')
      // perto não é elegível com próximo "siga"
      expect(marcoDevido(comDegrau, { indicePasso: 0, faltaM: 15, foraDaRota: false }, new Set(['1:aprox']))).toEqual({ fala: null, marcar: [] })

      const semGrave: Contexto = { ...comDegrau, passos: [passo(1), passo(2), passo(3)] }
      expect(marcoDevido(semGrave, { indicePasso: 0, faltaM: 50, foraDaRota: false }, NADA)).toEqual({ fala: null, marcar: [] })
    })

    it('próximo é virada com grave: aprox junta o trecho', () => {
      const c: Contexto = { ...C, passos: PASSOS_L.map((p, i) => (i === 1 ? { ...p, is_degrau: true } : p)) }
      expect(marcoDevido(c, { indicePasso: 0, faltaM: 50, foraDaRota: false }, NADA).fala?.texto).toBe(
        'Em 50 metros, vire à direita em direção a Rua Augusta. No próximo trecho: degrau.',
      )
    })
  })

  it('situacao: meio, último e sinal fraco', () => {
    expect(situacao(C, 1, 42, false)).toBe('Passo 2 de 5, Rua Augusta. Faltam 40 metros.')
    expect(situacao(C, 4, 42, false)).toBe('Passo 5 de 5, Alameda Santos. Faltam 40 metros para o destino.')
    expect(situacao(C, 1, 42, true)).toBe('Passo 2 de 5, Rua Augusta. Faltam cerca de 40 metros.')
  })

  it('falaRepetir nos quatro modos', () => {
    const op = { fora: false, lateralM: 0, sinalFraco: false, procurando: false }
    expect(anotar(falaRepetir(C, 1, 42, op))).toEqual({
      id: 'repetir',
      texto: 'Passo 2 de 5, Rua Augusta. Faltam 40 metros. Depois, vire à esquerda em direção a Rua Peixoto Gomide.',
      urgente: true,
      tipo: 'instrucao',
    })
    expect(anotar(falaRepetir(C, 4, 42, op)).texto).toBe(
      'Passo 5 de 5, Alameda Santos. Faltam 40 metros para o destino. Atenção: degrau. Guia sem rebaixamento.',
    )
    expect(anotar(falaRepetir(C, 1, 42, { ...op, fora: true, lateralM: 25 })).texto).toBe(
      'Você está fora da rota, a cerca de 25 metros dela. Volte para a rota ou toque em Recalcular.',
    )
    expect(anotar(falaRepetir(C, 1, 42, { ...op, procurando: true })).texto).toBe('Procurando sua posição.')
  })

  it('longe, saiu e voltou', () => {
    expect(anotar(falaLonge(300))).toEqual({
      id: 'longe',
      texto: 'Você está a cerca de 300 metros da rota. Vá até ela ou toque em Recalcular.',
      urgente: false,
      tipo: 'instrucao',
    })
    expect(anotar(falaSaiu(25))).toEqual({
      id: 'saiu',
      texto: 'Você saiu da rota, a cerca de 25 metros dela. As instruções de curva estão suspensas. Volte para a rota ou toque em Recalcular.',
      urgente: true,
      tipo: 'instrucao',
    })
    expect(anotar(falaVoltou(C, 1, 42, false))).toEqual({
      id: 'voltou',
      texto: 'Você voltou para a rota. Passo 2 de 5, Rua Augusta. Faltam 40 metros.',
      urgente: false,
      tipo: 'instrucao',
    })
  })

  it('falaNovaRota', () => {
    const uma = anotar(falaNovaRota({ passos: [PASSOS_L[0]], distancia_m: 120 }, 6))
    expect(uma).toEqual({
      id: 'nova_rota',
      texto: 'Nova rota calculada: 120 metros, em 1 passo. Passo 1 de 1. Siga para leste em direção a Alameda Jaú. 120 metros.',
      urgente: true,
      tipo: 'instrucao',
    })
    expect(anotar(falaNovaRota({ passos: PASSOS_L, distancia_m: 308 }, 6)).texto).toMatch(/^Nova rota calculada: 310 metros, em 5 passos\. Passo 1 de 5\./)
  })

  it('falaErroRecalculo nos três motivos', () => {
    expect(anotar(falaErroRecalculo('sem_rota'))).toEqual({
      id: 'erro_recalculo',
      texto: 'Não encontramos rota acessível a partir daqui. A rota anterior continua valendo.',
      urgente: false,
      tipo: 'instrucao',
    })
    expect(anotar(falaErroRecalculo('fora_da_area')).texto).toBe(
      'Daqui não conseguimos calcular rota: este ponto está fora da área atendida. A rota anterior continua valendo.',
    )
    expect(anotar(falaErroRecalculo('falha')).texto).toBe('Não foi possível calcular uma nova rota agora. A rota anterior continua valendo.')
  })

  it('FALAS_FIXAS com texto, tipo e urgência da tabela', () => {
    const esperado: Record<keyof typeof FALAS_FIXAS, [string, 'instrucao' | 'estado', boolean]> = {
      iniciada: ['Navegação iniciada.', 'instrucao', true],
      contrario: ['Você parece estar andando no sentido contrário da rota. Dê meia-volta para seguir a rota.', 'instrucao', true],
      sinal_fraco: ['Sinal de localização fraco. A posição pode errar alguns metros. Pare e confira antes de virar.', 'instrucao', false],
      sinal_voltou: ['Sinal de localização de volta.', 'instrucao', false],
      sem_sinal: ['Sem sinal de localização. Siga a descrição do passo atual e confira a tela.', 'instrucao', false],
      pausada: ['Navegação pausada. A localização está desligada.', 'estado', false],
      retomada: ['Navegação retomada.', 'estado', false],
      calculando: ['Calculando nova rota a partir de onde você está.', 'estado', false],
      sinal_insuficiente: ['Sinal de localização fraco. Espere o sinal melhorar para pedir uma nova rota.', 'estado', false],
      procurando_recalculo: ['Ainda procurando sua posição. Espere para pedir uma nova rota.', 'estado', false],
      aguarde: ['Aguarde alguns segundos para recalcular de novo.', 'estado', false],
      tela: ['A tela pode apagar sozinha. Com a tela apagada, as instruções param.', 'estado', false],
      chegada: ['Você chegou ao destino. A posição pode errar alguns metros; confira pelo entorno.', 'instrucao', true],
    }
    expect(Object.keys(FALAS_FIXAS).sort()).toEqual(Object.keys(esperado).sort())
    for (const [id, [texto, tipo, urgente]] of Object.entries(esperado)) {
      const fala = FALAS_FIXAS[id as keyof typeof FALAS_FIXAS]
      anotar(fala)
      expect(fala).toEqual({ id, texto, tipo, urgente })
    }
  })

  it('nenhuma frase promete o que o app não pode cumprir', () => {
    expect(todas.length).toBeGreaterThan(20)
    for (const t of todas) expect(t.toLowerCase()).not.toContain(PALAVRA_PROIBIDA)
  })
})

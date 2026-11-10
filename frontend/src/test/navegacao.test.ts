import type { RotaIn, RotaOut } from '../api/client'
import type { LeituraPosicao } from '../dados/localizacao'
import { falaDoPasso } from '../dados/narrador'
import {
  estadoNavegacao,
  reduzirNavegacao,
  type Efeito,
  type EstadoNavegacao,
  type EventoNavegacao,
} from '../dados/navegacao/navegacao'
import { deslocar } from '../dados/navegacao/regua'
import { leiturasDoCenario, type Cenario } from '../dados/navegacao/simulacao'
import { montarTrajeto, pontoAoLongo } from '../dados/navegacao/trajeto'
import { PONTOS_L, PONTOS_U, REGUA_L, ROTA_L, ROTA_SEM_GEOMETRIA, ROTA_U } from './fixturasNavegacao'

const PEDIDO: RotaIn = {
  origem: { lat: -23.5617, lng: -46.656 },
  destino: { lat: -23.5636, lng: -46.6547 },
  perfil: { inclinacao_max: 6, guia_max_m: 0.06, largura_min_m: 0.9, evitar_degraus: true, velocidade_kmh: 3 },
}

const TRAJETO = montarTrajeto(ROTA_L)!

function leitura(p: [number, number], tMs: number, precisaoM = 8): LeituraPosicao {
  return { lat: p[0], lon: p[1], precisaoM, tMs }
}

type Rodada = { estado: EstadoNavegacao; efeitos: Efeito[]; falas: string[]; textos: string[]; passos: number[] }

function rodar(estado: EstadoNavegacao, eventos: EventoNavegacao[]): Rodada {
  const efeitos: Efeito[] = []
  const passos: number[] = []
  let e = estado
  for (const ev of eventos) {
    const r = reduzirNavegacao(e, ev)
    e = r.estado
    efeitos.push(...r.efeitos)
    passos.push(e.passoAtual)
  }
  const falados = efeitos.filter((x): x is Extract<Efeito, { tipo: 'falar' }> => x.tipo === 'falar')
  return { estado: e, efeitos, falas: falados.map((f) => f.fala.id), textos: falados.map((f) => f.fala.texto), passos }
}

function comecado(op: { simulacao?: boolean; rota?: RotaOut } = {}): EstadoNavegacao {
  const inicial = estadoNavegacao(op.rota ?? ROTA_L, PEDIDO, { simulacao: op.simulacao ?? false })
  return reduzirNavegacao(inicial, { tipo: 'comecar', agoraMs: 0 }).estado
}

/**
 * Cada leitura do cenário, com tiques de 1 s entre elas (como o intervalo da página). Nada é
 * inventado aqui: o que o cenário não entrega (aba oculta, por exemplo) a página também não vê.
 */
function eventosDoCenario(nome: Cenario, inicioMs = 0): EventoNavegacao[] {
  const leituras = leiturasDoCenario(nome, TRAJETO.pontos, { semente: 1, inicioMs })
  const eventos: EventoNavegacao[] = []
  leituras.forEach((l, i) => {
    const anterior = leituras[i - 1]
    if (anterior) for (let t = anterior.tMs + 1000; t < l.tMs; t += 1000) eventos.push({ tipo: 'tempo', agoraMs: t })
    eventos.push({ tipo: 'tempo', agoraMs: l.tMs }, { tipo: 'leitura', leitura: l })
  })
  return eventos
}

const SEQUENCIA_RETO = [
  'inicio',
  '1:aprox',
  '1:perto',
  'entrada:2',
  '2:aprox',
  '2:perto',
  'entrada:3',
  'entrada:5',
  '5:aprox',
  '5:perto',
  'chegada',
]

const MARCOS_OU_ENTRADAS = /^(\d+:(aprox|perto)|entrada:\d+)$/

describe('estado inicial', () => {
  it('rota com desenho começa no preparo', () => {
    const e = estadoNavegacao(ROTA_L, PEDIDO, { simulacao: false })
    expect(e.fase).toBe('preparo')
    expect(e.passoAtual).toBe(0)
  })

  it('rota sem desenho fica indisponível, com o motivo', () => {
    const e = estadoNavegacao(ROTA_SEM_GEOMETRIA, PEDIDO, { simulacao: false })
    expect(e.fase).toBe('indisponivel')
    expect(e.motivoIndisponivel).toBe('sem_desenho')
  })

  it('sem localização no navegador também fica indisponível', () => {
    const e = estadoNavegacao(ROTA_L, PEDIDO, { simulacao: false, localizacao: false })
    expect(e.fase).toBe('indisponivel')
    expect(e.motivoIndisponivel).toBe('sem_localizacao')
  })

  it('com simulação, a falta de localização real não importa', () => {
    expect(estadoNavegacao(ROTA_L, PEDIDO, { simulacao: true, localizacao: false }).fase).toBe('preparo')
  })
})

describe('começar e primeira leitura', () => {
  it('comecar vai a procurando, liga os sensores e foca o painel; a fala "iniciada" é só da voz do app', () => {
    const inicial = estadoNavegacao(ROTA_L, PEDIDO, { simulacao: false })
    const r = reduzirNavegacao(inicial, { tipo: 'comecar', agoraMs: 0 })
    expect(r.estado.fase).toBe('procurando')
    expect(r.efeitos.map((x) => x.tipo)).toEqual(['falar', 'ligar_sensores', 'focar'])
    expect(r.efeitos[0]).toMatchObject({ fala: { id: 'iniciada', urgente: true } })
    expect(r.efeitos[2]).toEqual({ tipo: 'focar', alvo: 'painel' })
  })

  it('leitura ruim procurando não fala nada', () => {
    const r = rodar(comecado(), [{ tipo: 'leitura', leitura: leitura(PONTOS_L.A, 1000, 50) }])
    expect(r.estado.fase).toBe('procurando')
    expect(r.falas).toEqual([])
  })

  it('primeira leitura boa perto de A: navegando com a fala de início', () => {
    const r = rodar(comecado(), [{ tipo: 'leitura', leitura: leitura(PONTOS_L.A, 1000) }])
    expect(r.estado.fase).toBe('navegando')
    expect(r.falas).toEqual(['inicio'])
    expect(r.textos[0]).toBe(
      'Passo 1 de 5. Siga para leste em direção a Alameda Jaú. 120 metros. Se não souber para que lado ir, ande alguns metros. O app avisa se for no sentido contrário.',
    )
    expect(r.estado.acompanhamento.fora).toBe(false)
  })

  it('com simulação, a fala de início começa pelo aviso de demonstração', () => {
    const r = rodar(comecado({ simulacao: true }), [{ tipo: 'leitura', leitura: leitura(PONTOS_L.A, 1000) }])
    expect(r.textos[0]).toMatch(/^Modo demonstração: a posição é simulada, não é a sua\. Passo 1 de 5\./)
  })

  it('primeira leitura boa a 300 m: navegando, fora da rota, fala "longe" e nunca "saiu"', () => {
    const longe = deslocar(REGUA_L, PONTOS_L.A, 300, 0)
    const r = rodar(comecado(), [
      { tipo: 'leitura', leitura: leitura(longe, 1000) },
      { tipo: 'leitura', leitura: leitura(deslocar(REGUA_L, longe, 1, 0), 2000) },
      { tipo: 'leitura', leitura: leitura(deslocar(REGUA_L, longe, 2, 0), 3000) },
      { tipo: 'tempo', agoraMs: 13_000 },
    ])
    expect(r.estado.fase).toBe('navegando')
    expect(r.estado.acompanhamento.fora).toBe(true)
    expect(r.falas).toEqual(['longe'])
    expect(r.textos[0]).toBe('Você está a cerca de 300 metros da rota. Vá até ela ou toque em Recalcular.')
  })

  it('quem começou longe e chega à rota ouve "voltou"', () => {
    const longe = deslocar(REGUA_L, PONTOS_L.A, 300, 0)
    const r = rodar(comecado(), [
      { tipo: 'leitura', leitura: leitura(longe, 1000) },
      { tipo: 'leitura', leitura: leitura(deslocar(REGUA_L, PONTOS_L.A, 2, 5), 2000) },
    ])
    expect(r.falas).toEqual(['longe', 'voltou'])
    expect(r.estado.acompanhamento.fora).toBe(false)
  })
})

describe('voltar para a rota num passo mais adiante (andou por uma paralela)', () => {
  /** Sai da rota no passo 1 (40 m ao norte) e volta para ela no ponto `voltaM` do trajeto. */
  function saiEVoltaEm(voltaM: number, depois: EventoNavegacao[] = []): Rodada {
    const fora = deslocar(REGUA_L, pontoAoLongo(TRAJETO, 30), 40, 0)
    return rodar(comecado(), [
      { tipo: 'leitura', leitura: leitura(pontoAoLongo(TRAJETO, 0), 1000) },
      { tipo: 'leitura', leitura: leitura(pontoAoLongo(TRAJETO, 20), 2000) },
      ...[0, 1, 2].map((i): EventoNavegacao => ({ tipo: 'leitura', leitura: leitura(deslocar(REGUA_L, fora, 0, i * 5), 3000 + i * 1000) })),
      { tipo: 'leitura', leitura: leitura(pontoAoLongo(TRAJETO, voltaM), 6000) },
      ...depois,
    ])
  }

  it('fala só "voltou", com a distância que falta no passo e a próxima manobra; nunca "Siga por" o passo inteiro', () => {
    const r = saiEVoltaEm(140)
    const saiu = r.falas.indexOf('saiu')
    expect(saiu).toBeGreaterThan(0)
    expect(r.estado.passoAtual).toBe(1)
    expect(r.falas.slice(saiu + 1)).toEqual(['voltou'])
    expect(r.textos.at(-1)).toBe(
      'Você voltou para a rota. Passo 2 de 5, Rua Augusta. Faltam 60 metros. Depois, vire à esquerda em direção a Rua Peixoto Gomide.',
    )
    expect(r.textos.slice(saiu + 1).join(' ')).not.toMatch(/Siga por/)
  })

  it('a entrada do passo não sai depois, e o marco de 50 m continua valendo', () => {
    const r = saiEVoltaEm(140, [{ tipo: 'leitura', leitura: leitura(pontoAoLongo(TRAJETO, 150), 7000) }])
    expect(r.falas.slice(r.falas.indexOf('voltou') + 1)).toEqual(['2:aprox'])
  })

  it('com o marco já devido na volta, ele não repete a distância logo depois do "voltou"', () => {
    const r = saiEVoltaEm(150, [{ tipo: 'leitura', leitura: leitura(pontoAoLongo(TRAJETO, 155), 7000) }])
    expect(r.falas.slice(r.falas.indexOf('saiu') + 1)).toEqual(['voltou'])
    expect(r.textos.at(-1)).toMatch(/Faltam 50 metros\. Depois, vire à esquerda/)
  })

  it('voltando num passo com alertas que ainda não foram ditos, eles vêm junto', () => {
    // passo 5 (degrau, guia sem rebaixamento): a entrada dele nunca foi dita
    const r = saiEVoltaEm(250)
    expect(r.falas.slice(r.falas.indexOf('saiu') + 1)).toEqual(['voltou'])
    expect(r.textos.at(-1)).toBe(
      'Você voltou para a rota. Passo 5 de 5, Alameda Santos. Faltam 60 metros para o destino. Atenção: degrau. Guia sem rebaixamento.',
    )
  })

  it('voltando no mesmo passo, os alertas já ditos na entrada não se repetem', () => {
    const r = saiEVoltaEm(40)
    expect(r.textos.at(-1)).toBe(
      'Você voltou para a rota. Passo 1 de 5, Alameda Jaú. Faltam 80 metros. Depois, vire à direita em direção a Rua Augusta.',
    )
  })
})

describe('cenários simulados contra o reducer (semente 1)', () => {
  it('reto: a sequência exata de falas, sensores parados e fase chegou', () => {
    const r = rodar(comecado(), eventosDoCenario('reto'))
    expect(r.falas).toEqual(SEQUENCIA_RETO)
    expect(r.estado.fase).toBe('chegou')
    expect(r.efeitos.filter((x) => x.tipo === 'parar_sensores')).toHaveLength(1)
    expect(r.efeitos.at(-1)).toEqual({ tipo: 'focar', alvo: 'chegada' })
    // o passo atual nunca desce
    r.passos.forEach((p, i) => expect(p).toBeGreaterThanOrEqual(r.passos[i - 1] ?? 0))
  })

  it('reto: as frases de marco e de entrada são as do spec', () => {
    const r = rodar(comecado(), eventosDoCenario('reto'))
    const texto = (id: string) => r.textos[r.falas.indexOf(id)]
    expect(texto('1:aprox')).toBe('Em 50 metros, vire à direita em direção a Rua Augusta.')
    expect(texto('1:perto')).toBe('Logo à frente, vire à direita.')
    expect(texto('entrada:2')).toBe('Passo 2 de 5, Rua Augusta. Siga por 80 metros.')
    expect(texto('2:perto')).toBe('Logo à frente, vire à esquerda. Logo depois, vire à direita.')
    expect(texto('entrada:3')).toBe(
      'Passo 3 de 5, Rua Peixoto Gomide. Siga por 8 metros. Depois, vire à direita em direção a Alameda Santos. No próximo trecho: degrau, guia sem rebaixamento.',
    )
    expect(texto('entrada:5')).toBe('Passo 5 de 5, Alameda Santos. Siga por 100 metros. Atenção: degrau. Guia sem rebaixamento.')
    expect(texto('5:aprox')).toBe('Em 50 metros, o destino.')
    expect(texto('5:perto')).toBe('Logo à frente, o destino.')
    expect(texto('chegada')).toBe('Você chegou ao destino. A posição pode errar alguns metros; confira pelo entorno.')
  })

  it('desvio-lateral-25m: "saiu" e nenhum marco nem entrada depois dele', () => {
    const r = rodar(comecado(), eventosDoCenario('desvio-lateral-25m'))
    const i = r.falas.indexOf('saiu')
    expect(i).toBeGreaterThan(0)
    expect(r.falas.slice(i + 1).filter((id) => MARCOS_OU_ENTRADAS.test(id))).toEqual([])
    expect(r.estado.acompanhamento.fora).toBe(true)
  })

  it('volta-a-rota: "saiu", "voltou" e marcos de novo', () => {
    const r = rodar(comecado(), eventosDoCenario('volta-a-rota'))
    const saiu = r.falas.indexOf('saiu')
    const voltou = r.falas.indexOf('voltou')
    expect(saiu).toBeGreaterThan(0)
    expect(voltou).toBeGreaterThan(saiu)
    expect(r.falas.slice(voltou + 1).filter((id) => MARCOS_OU_ENTRADAS.test(id)).length).toBeGreaterThan(0)
    expect(r.falas.at(-1)).toBe('chegada')
  })

  it('precisao-ruim-40m: depois do início, só "sinal_fraco" e nenhum marco', () => {
    const r = rodar(comecado(), [{ tipo: 'leitura', leitura: leitura(PONTOS_L.A, 0) }, ...eventosDoCenario('precisao-ruim-40m', 1000)])
    expect(r.falas).toEqual(['inicio', 'sinal_fraco'])
  })

  it('parado-no-cruzamento: parar não acrescenta fala nenhuma', () => {
    const r = rodar(comecado(), eventosDoCenario('parado-no-cruzamento'))
    expect(r.falas).toEqual(SEQUENCIA_RETO)
  })

  it('sentido-contrario: "contrario" uma vez só', () => {
    const r = rodar(comecado(), eventosDoCenario('sentido-contrario'))
    expect(r.falas.filter((id) => id === 'contrario')).toHaveLength(1)
    r.passos.forEach((p, i) => expect(p).toBeGreaterThanOrEqual(r.passos[i - 1] ?? 0))
  })

  it('aba-oculta-no-meio: o cenário é um buraco de 30 s sem leitura; a página diz "sem_sinal" e depois "sinal_voltou"', () => {
    // a simulação não oculta a aba de verdade; a pausa automática por aba oculta é testada em
    // "tempo, pausa e visibilidade" e na página (Navegar.test.tsx)
    const r = rodar(comecado(), eventosDoCenario('aba-oculta-no-meio'))
    const semSinal = r.falas.indexOf('sem_sinal')
    expect(semSinal).toBeGreaterThan(0)
    expect(r.falas[semSinal + 1]).toBe('sinal_voltou')
    expect(r.falas.filter((id) => id === 'sem_sinal')).toHaveLength(1)
    expect(r.falas).not.toContain('retomada')
    expect(r.falas.at(-1)).toBe('chegada')
  })
})

describe('tempo, pausa e visibilidade', () => {
  function navegando(): EstadoNavegacao {
    return rodar(comecado(), [{ tipo: 'leitura', leitura: leitura(PONTOS_L.A, 1000) }]).estado
  }

  it('15 s sem leitura: "sem_sinal" uma vez', () => {
    const r = rodar(navegando(), [
      { tipo: 'tempo', agoraMs: 10_000 },
      { tipo: 'tempo', agoraMs: 16_000 },
      { tipo: 'tempo', agoraMs: 17_000 },
    ])
    expect(r.falas).toEqual(['sem_sinal'])
  })

  it('pausar: fase pausada, sensores parados, leituras ignoradas', () => {
    const r = rodar(navegando(), [
      { tipo: 'pausar' },
      { tipo: 'leitura', leitura: leitura(deslocar(REGUA_L, PONTOS_L.A, 0, 100), 3000) },
      { tipo: 'tempo', agoraMs: 60_000 },
    ])
    expect(r.estado.fase).toBe('pausada')
    expect(r.efeitos.map((x) => x.tipo)).toEqual(['parar_sensores', 'falar'])
    expect(r.falas).toEqual(['pausada'])
    expect(r.estado.ultimaLeitura?.tMs).toBe(1000)
  })

  it('continuar: liga os sensores, diz "retomada" e reencaixa com janela ampla', () => {
    // 228 m ao longo da rota: fora da janela normal (que vai até 150 m), dentro da ampla
    const longeNaRota = deslocar(REGUA_L, PONTOS_L.D, -20, 0)
    const r = rodar(navegando(), [
      { tipo: 'pausar' },
      { tipo: 'continuar', agoraMs: 100_000 },
      { tipo: 'leitura', leitura: leitura(longeNaRota, 101_000) },
    ])
    expect(r.estado.fase).toBe('navegando')
    expect(r.efeitos.filter((x) => x.tipo === 'ligar_sensores')).toHaveLength(1)
    expect(r.falas).toEqual(['pausada', 'retomada', 'situacao'])
    expect(r.estado.passoAtual).toBe(4)
    expect(r.estado.acompanhamento.fora).toBe(false)
    // a situação substitui a entrada do passo pulado
    expect(r.textos[2]).toBe('Passo 5 de 5, Alameda Santos. Faltam 80 metros para o destino.')
    expect(r.estado.falados.has('entrada:5')).toBe(true)
  })

  it('oculta pausa sem falar; visível religa e diz "retomada"', () => {
    const r = rodar(navegando(), [{ tipo: 'oculta' }, { tipo: 'tempo', agoraMs: 60_000 }, { tipo: 'visivel', agoraMs: 61_000 }])
    expect(r.efeitos.map((x) => x.tipo)).toEqual(['parar_sensores', 'ligar_sensores', 'falar'])
    expect(r.falas).toEqual(['retomada'])
    expect(r.estado.fase).toBe('navegando')
  })

  it('oculta durante a pausa da pessoa não religa nada ao voltar', () => {
    const r = rodar(navegando(), [{ tipo: 'pausar' }, { tipo: 'oculta' }, { tipo: 'visivel', agoraMs: 5000 }])
    expect(r.estado.fase).toBe('pausada')
    expect(r.efeitos.filter((x) => x.tipo === 'ligar_sensores')).toHaveLength(0)
  })
})

describe('recalcular', () => {
  const PERTO_DE_A = deslocar(REGUA_L, PONTOS_L.A, 2.345, 3.21)

  function comLeitura(tMs: number, precisaoM = 8): EstadoNavegacao {
    return rodar(comecado(), [{ tipo: 'leitura', leitura: leitura(PERTO_DE_A, tMs, precisaoM) }]).estado
  }

  it('procurando, sem nenhuma leitura ainda: diz que ainda procura, e não fala de sinal fraco', () => {
    const r = rodar(comecado(), [{ tipo: 'pedir_recalculo', agoraMs: 1000 }])
    expect(r.textos).toEqual(['Ainda procurando sua posição. Espere para pedir uma nova rota.'])
    expect(r.efeitos.some((x) => x.tipo === 'recalcular')).toBe(false)
  })

  it('procurando, só com leitura ruim: "sinal_insuficiente"', () => {
    const r = rodar(comecado(), [
      { tipo: 'leitura', leitura: leitura(PONTOS_L.A, 500, 50) },
      { tipo: 'pedir_recalculo', agoraMs: 1000 },
    ])
    expect(r.falas).toEqual(['sinal_insuficiente'])
  })

  it('última leitura ruim também: "sinal_insuficiente"', () => {
    const e = rodar(comLeitura(1000), [{ tipo: 'leitura', leitura: leitura(PERTO_DE_A, 2000, 45) }]).estado
    expect(rodar(e, [{ tipo: 'pedir_recalculo', agoraMs: 3000 }]).falas).toEqual(['sinal_insuficiente'])
  })

  it('leitura velha (mais de 10 s): "sinal_insuficiente"', () => {
    expect(rodar(comLeitura(1000), [{ tipo: 'pedir_recalculo', agoraMs: 11_001 }]).falas).toEqual(['sinal_insuficiente'])
  })

  it('aceito: "calculando" e o pedido com só a origem trocada, em 4 casas', () => {
    const r = rodar(comLeitura(1000), [{ tipo: 'pedir_recalculo', agoraMs: 5000 }])
    expect(r.falas).toEqual(['calculando'])
    const recalculo = r.efeitos.find((x) => x.tipo === 'recalcular')
    expect(recalculo).toBeDefined()
    const pedido = (recalculo as Extract<Efeito, { tipo: 'recalcular' }>).pedido
    expect(pedido.destino).toEqual(PEDIDO.destino)
    expect(pedido.perfil).toEqual(PEDIDO.perfil)
    expect(pedido.origem.lat).toBe(Math.round(PERTO_DE_A[0] * 10_000) / 10_000)
    expect(pedido.origem.lng).toBe(Math.round(PERTO_DE_A[1] * 10_000) / 10_000)
    expect(String(pedido.origem.lat).split('.')[1].length).toBeLessThanOrEqual(4)
    expect(r.estado.recalculando).toBe(true)
  })

  it('um segundo pedido durante o cálculo ou antes de 10 s: "aguarde"', () => {
    const r = rodar(comLeitura(1000), [
      { tipo: 'pedir_recalculo', agoraMs: 5000 },
      { tipo: 'pedir_recalculo', agoraMs: 6000 },
      { tipo: 'recalculo_falhou', motivo: 'falha' },
      { tipo: 'leitura', leitura: leitura(PERTO_DE_A, 7000) },
      { tipo: 'pedir_recalculo', agoraMs: 8000 },
    ])
    expect(r.falas).toEqual(['calculando', 'aguarde', 'erro_recalculo', 'aguarde'])
    expect(r.efeitos.filter((x) => x.tipo === 'recalcular')).toHaveLength(1)
  })

  it('rota nova: zera progresso, passo e falas, e fala a rota nova', () => {
    const andou = rodar(comecado(), eventosDoCenario('reto').slice(0, 300)).estado
    expect(andou.passoAtual).toBeGreaterThan(0)
    const pedido = rodar(andou, [{ tipo: 'pedir_recalculo', agoraMs: andou.ultimaLeitura!.tMs + 100 }]).estado
    const r = rodar(pedido, [{ tipo: 'rota_nova', rota: ROTA_L, agoraMs: andou.ultimaLeitura!.tMs + 2000 }])
    expect(r.falas).toEqual(['nova_rota'])
    expect(r.textos[0]).toMatch(/^Nova rota calculada: 310 metros, em 5 passos\. Passo 1 de 5\./)
    expect(r.estado.passoAtual).toBe(0)
    expect(r.estado.acompanhamento.progressoMaxM).toBe(0)
    expect(r.estado.falados.size).toBe(0)
    expect(r.estado.recalculando).toBe(false)
    expect(r.estado.pedido.origem).not.toEqual(PEDIDO.origem)
  })

  it('rota nova sem passos não é rota: "sem rota" e a anterior continua', () => {
    const e = rodar(comLeitura(1000), [{ tipo: 'pedir_recalculo', agoraMs: 2000 }]).estado
    const r = rodar(e, [{ tipo: 'rota_nova', rota: { ...ROTA_L, passos: [] }, agoraMs: 3000 }])
    expect(r.textos).toEqual(['Não encontramos rota acessível a partir daqui. A rota anterior continua valendo.'])
    expect(r.estado.rota).toBe(ROTA_L)
  })

  it('recálculo que falha mantém a rota anterior e diz o motivo', () => {
    const e = rodar(comLeitura(1000), [{ tipo: 'pedir_recalculo', agoraMs: 2000 }]).estado
    for (const [motivo, frase] of [
      ['sem_rota', 'Não encontramos rota acessível a partir daqui. A rota anterior continua valendo.'],
      ['fora_da_area', 'Daqui não conseguimos calcular rota: este ponto está fora da área atendida. A rota anterior continua valendo.'],
      ['falha', 'Não foi possível calcular uma nova rota agora. A rota anterior continua valendo.'],
    ] as const) {
      const r = rodar(e, [{ tipo: 'recalculo_falhou', motivo }])
      expect(r.textos).toEqual([frase])
      expect(r.estado.rota).toBe(ROTA_L)
      expect(r.estado.recalculando).toBe(false)
    }
  })
})

describe('erros de posição', () => {
  it('permissão negada: sem_permissao, sensores parados e foco na mensagem', () => {
    const r = rodar(comecado(), [{ tipo: 'erro_posicao', codigo: 1, agoraMs: 500 }])
    expect(r.estado.fase).toBe('sem_permissao')
    expect(r.efeitos).toEqual([{ tipo: 'parar_sensores' }, { tipo: 'focar', alvo: 'permissao' }])
  })

  it('códigos 2 e 3 não mudam nada', () => {
    const e = comecado()
    for (const codigo of [2, 3]) {
      const r = reduzirNavegacao(e, { tipo: 'erro_posicao', codigo, agoraMs: 500 })
      expect(r.estado).toEqual(e)
      expect(r.efeitos).toEqual([])
    }
  })

  it('código 0 (sem geolocalização): indisponível, com foco na mensagem', () => {
    const r = rodar(comecado(), [{ tipo: 'erro_posicao', codigo: 0, agoraMs: 500 }])
    expect(r.estado.fase).toBe('indisponivel')
    expect(r.estado.motivoIndisponivel).toBe('sem_localizacao')
    expect(r.efeitos).toEqual([{ tipo: 'parar_sensores' }, { tipo: 'focar', alvo: 'permissao' }])
  })
})

describe('procurando sem conseguir a posição (localização aproximada, prédio, GPS desligado)', () => {
  it('sem nenhuma leitura, depois de 20 s avisa uma vez e oferece o passo a passo', () => {
    const r = rodar(comecado(), [
      { tipo: 'tempo', agoraMs: 19_999 },
      { tipo: 'tempo', agoraMs: 20_000 },
      { tipo: 'tempo', agoraMs: 30_000 },
    ])
    expect(r.estado.fase).toBe('procurando')
    expect(r.estado.procuraDemorada).toBe(true)
    expect(r.textos).toEqual([
      'Ainda não conseguimos a sua posição. Confira se a localização do aparelho está ligada. Você também pode seguir passo a passo.',
    ])
  })

  it('erros 2 e 3 do GPS não mudam nada na hora, mas o prazo vale do mesmo jeito', () => {
    const r = rodar(comecado(), [
      { tipo: 'erro_posicao', codigo: 2, agoraMs: 500 },
      { tipo: 'erro_posicao', codigo: 3, agoraMs: 15_500 },
      { tipo: 'tempo', agoraMs: 20_000 },
    ])
    expect(r.falas).toEqual(['procura_sem_posicao'])
  })

  it('com localização aproximada (precisão de centenas de metros), diz como ativar a localização exata', () => {
    const r = rodar(comecado(), [
      { tipo: 'leitura', leitura: leitura(PONTOS_L.A, 1000, 1500) },
      { tipo: 'tempo', agoraMs: 20_000 },
    ])
    expect(r.falas).toEqual(['procura_aproximada'])
    expect(r.textos[0]).toMatch(/^A localização deste aparelho está aproximada, /)
    expect(r.textos[0]).toContain('Sites do Safari, Localização Exata')
    expect(r.textos[0]).toContain('Usar local exato')
    expect(r.textos[0]).toMatch(/Você também pode seguir passo a passo\.$/)
  })

  it('com sinal só fraco (31 a 200 m), diz que o sinal está fraco', () => {
    const r = rodar(comecado(), [
      { tipo: 'leitura', leitura: leitura(PONTOS_L.A, 1000, 60) },
      { tipo: 'tempo', agoraMs: 20_000 },
    ])
    expect(r.falas).toEqual(['procura_fraco'])
    expect(r.textos[0]).toBe(
      'O sinal de localização está fraco aqui. Tente um lugar mais aberto, longe de prédios altos. Você também pode seguir passo a passo.',
    )
  })

  it('Repetir na procura demorada repete o aviso', () => {
    const e = rodar(comecado(), [{ tipo: 'tempo', agoraMs: 20_000 }]).estado
    expect(rodar(e, [{ tipo: 'repetir' }]).textos[0]).toMatch(/^Ainda não conseguimos a sua posição\./)
  })

  it('a primeira leitura boa depois do aviso segue normalmente', () => {
    const e = rodar(comecado(), [{ tipo: 'tempo', agoraMs: 20_000 }]).estado
    const r = rodar(e, [{ tipo: 'leitura', leitura: leitura(PONTOS_L.A, 21_000) }])
    expect(r.estado.fase).toBe('navegando')
    expect(r.falas).toEqual(['inicio'])
  })

  it('pausar e continuar procurando recomeça o prazo', () => {
    const r = rodar(comecado(), [
      { tipo: 'tempo', agoraMs: 15_000 },
      { tipo: 'pausar' },
      { tipo: 'continuar', agoraMs: 60_000 },
      { tipo: 'tempo', agoraMs: 70_000 },
      { tipo: 'tempo', agoraMs: 80_000 },
    ])
    expect(r.falas).toEqual(['pausada', 'retomada', 'procura_sem_posicao'])
  })
})

describe('tentar de novo depois da permissão negada', () => {
  it('volta a procurar, liga os sensores e foca o painel', () => {
    const negado = rodar(comecado(), [{ tipo: 'erro_posicao', codigo: 1, agoraMs: 500 }]).estado
    const r = reduzirNavegacao(negado, { tipo: 'tentar_de_novo', agoraMs: 5000 })
    expect(r.estado.fase).toBe('procurando')
    expect(r.estado.procurandoDesdeMs).toBe(5000)
    expect(r.efeitos.map((x) => x.tipo)).toEqual(['falar', 'ligar_sensores', 'focar'])
    expect(r.efeitos[0]).toMatchObject({ fala: { id: 'iniciada' } })
    expect(r.efeitos.at(-1)).toEqual({ tipo: 'focar', alvo: 'painel' })
  })

  it('fora de sem_permissao, não faz nada', () => {
    const e = comecado()
    expect(reduzirNavegacao(e, { tipo: 'tentar_de_novo', agoraMs: 1000 })).toEqual({ estado: e, efeitos: [] })
  })
})

describe('rota que volta sobre si (U: atravessa a rua e volta pela outra calçada)', () => {
  const T_U = montarTrajeto(ROTA_U)!
  const naIda = (x: number, sul = 0) => deslocar(REGUA_L, PONTOS_U.A, -sul, x)

  it('primeira leitura entre as duas pernas: fica no começo, não chega ao destino', () => {
    const r = rodar(comecado({ rota: ROTA_U }), [{ tipo: 'leitura', leitura: leitura(naIda(0, 8), 1000) }])
    expect(r.estado.fase).toBe('navegando')
    expect(r.falas).toEqual(['inicio'])
    expect(r.estado.passoAtual).toBe(0)
    expect(r.estado.acompanhamento.progressoMaxM).toBeLessThan(1)
  })

  it('andando na ida com o GPS puxado para a perna de volta, não salta de passo nem acusa sentido contrário', () => {
    const eventos: EventoNavegacao[] = []
    for (let x = 0, k = 0; x <= 90; x += 2, k++) {
      eventos.push({ tipo: 'leitura', leitura: leitura(naIda(x, k % 2 === 0 ? 8 : 7.5), 1000 + k * 1000) })
    }
    const r = rodar(comecado({ rota: ROTA_U }), eventos)
    expect(r.estado.passoAtual).toBe(0)
    expect(r.falas).not.toContain('entrada:3')
    expect(r.falas).not.toContain('contrario')
    expect(r.falas).not.toContain('chegada')
    expect(Math.abs(r.estado.acompanhamento.progressoMaxM - 90)).toBeLessThan(3)
  })

  it('a rota em U inteira: entradas em ordem e chegada só no fim', () => {
    const eventos: EventoNavegacao[] = []
    let t = 1000
    for (let m = 0; m <= T_U.totalM; m += 1) {
      eventos.push({ tipo: 'leitura', leitura: leitura(pontoAoLongo(T_U, m), t) })
      t += 1000
    }
    const r = rodar(comecado({ rota: ROTA_U }), eventos)
    expect(r.falas.filter((id) => id.startsWith('entrada:'))).toEqual(['entrada:2', 'entrada:3'])
    expect(r.falas).not.toContain('contrario')
    expect(r.falas.at(-1)).toBe('chegada')
    expect(r.falas.filter((id) => id === 'chegada')).toHaveLength(1)
    r.passos.forEach((p, i) => expect(p).toBeGreaterThanOrEqual(r.passos[i - 1] ?? 0))
  })
})

describe('sentido contrário logo no início', () => {
  it('quem anda para trás a partir do ponto de partida ouve o aviso antes de sair da rota', () => {
    const atras = (m: number) => deslocar(REGUA_L, PONTOS_L.A, 0, -m)
    const r = rodar(comecado(), [
      { tipo: 'leitura', leitura: leitura(PONTOS_L.A, 1000) },
      { tipo: 'leitura', leitura: leitura(atras(5), 2000) },
      { tipo: 'leitura', leitura: leitura(atras(10), 3000) },
      { tipo: 'leitura', leitura: leitura(atras(16), 4000) },
      { tipo: 'leitura', leitura: leitura(atras(17), 5000) },
      { tipo: 'leitura', leitura: leitura(atras(18), 6000) },
    ])
    expect(r.falas).toEqual(['inicio', 'contrario'])
    expect(r.estado.acompanhamento.fora).toBe(false)
  })

  it('a primeira leitura já atrás do início encaixa no começo, com progresso zero', () => {
    const r = rodar(comecado(), [{ tipo: 'leitura', leitura: leitura(deslocar(REGUA_L, PONTOS_L.A, 0, -10), 1000) }])
    expect(r.falas).toEqual(['inicio'])
    expect(r.estado.acompanhamento.progressoMaxM).toBe(0)
  })
})

describe('passo a passo, sem localização', () => {
  it('entra no primeiro passo, fala o passo e foca o painel', () => {
    const inicial = estadoNavegacao(ROTA_L, PEDIDO, { simulacao: false })
    const r = rodar(inicial, [{ tipo: 'passo_a_passo' }])
    expect(r.estado.fase).toBe('passo_a_passo')
    expect(r.textos).toEqual([falaDoPasso(ROTA_L.passos[0], 5, 6)])
    expect(r.efeitos.at(-1)).toEqual({ tipo: 'focar', alvo: 'painel' })
  })

  it('anterior e próximo falam o passo e não passam dos limites; o último diz a chegada', () => {
    const inicial = rodar(estadoNavegacao(ROTA_L, PEDIDO, { simulacao: false }), [{ tipo: 'passo_a_passo' }]).estado
    const r = rodar(inicial, [
      { tipo: 'passo_anterior' },
      { tipo: 'proximo_passo' },
      { tipo: 'proximo_passo' },
      { tipo: 'proximo_passo' },
      { tipo: 'proximo_passo' },
      { tipo: 'proximo_passo' },
    ])
    expect(r.textos).toHaveLength(4)
    expect(r.estado.passoAtual).toBe(4)
    expect(r.textos.at(-1)).toBe(`${falaDoPasso(ROTA_L.passos[4], 5, 6)} Você chegou ao destino.`)
  })

  it('de sem_permissao e de indisponivel também dá para seguir passo a passo', () => {
    const negado = rodar(comecado(), [{ tipo: 'erro_posicao', codigo: 1, agoraMs: 0 }]).estado
    expect(reduzirNavegacao(negado, { tipo: 'passo_a_passo' }).estado.fase).toBe('passo_a_passo')
    const semDesenho = estadoNavegacao(ROTA_SEM_GEOMETRIA, PEDIDO, { simulacao: false })
    expect(reduzirNavegacao(semDesenho, { tipo: 'passo_a_passo' }).estado.fase).toBe('passo_a_passo')
  })

  it('a partir da navegação, desliga os sensores', () => {
    const r = rodar(comecado(), [{ tipo: 'passo_a_passo' }])
    expect(r.efeitos[0]).toEqual({ tipo: 'parar_sensores' })
  })
})

describe('repetir', () => {
  it('em cada fase', () => {
    const preparo = estadoNavegacao(ROTA_L, PEDIDO, { simulacao: false })
    expect(reduzirNavegacao(preparo, { tipo: 'repetir' }).efeitos).toEqual([])

    expect(rodar(comecado(), [{ tipo: 'repetir' }]).textos).toEqual(['Procurando sua posição.'])

    const naRota = rodar(comecado(), [{ tipo: 'leitura', leitura: leitura(deslocar(REGUA_L, PONTOS_L.A, 0, 10), 1000) }]).estado
    expect(rodar(naRota, [{ tipo: 'repetir' }]).textos).toEqual([
      'Passo 1 de 5, Alameda Jaú. Faltam 110 metros. Depois, vire à direita em direção a Rua Augusta.',
    ])

    const longe = rodar(comecado(), [{ tipo: 'leitura', leitura: leitura(deslocar(REGUA_L, PONTOS_L.A, 100, 0), 1000) }]).estado
    expect(rodar(longe, [{ tipo: 'repetir' }]).textos).toEqual([
      'Você está fora da rota, a cerca de 100 metros dela. Volte para a rota ou toque em Recalcular.',
    ])

    const pausada = rodar(naRota, [{ tipo: 'pausar' }]).estado
    expect(rodar(pausada, [{ tipo: 'repetir' }]).textos).toEqual(['Navegação pausada. A localização está desligada.'])

    const chegou = rodar(comecado(), eventosDoCenario('reto')).estado
    expect(rodar(chegou, [{ tipo: 'repetir' }]).falas).toEqual(['chegada'])

    const pap = rodar(preparo, [{ tipo: 'passo_a_passo' }]).estado
    expect(rodar(pap, [{ tipo: 'repetir' }]).textos).toEqual([falaDoPasso(ROTA_L.passos[0], 5, 6)])
  })
})

describe('privacidade do estado', () => {
  it('guarda só a última leitura, nunca uma lista de posições', () => {
    const e = rodar(comecado(), eventosDoCenario('reto')).estado
    expect(e.ultimaLeitura).not.toBeNull()
    const chaves = Object.keys(e)
    expect(chaves.filter((k) => /leituras|posicoes|historico|trilha/i.test(k))).toEqual([])
    for (const valor of Object.values(e)) {
      if (Array.isArray(valor)) {
        expect(valor.some((x) => x && typeof x === 'object' && 'tMs' in x)).toBe(false)
      }
    }
  })

  it('reduzirNavegacao não altera o estado recebido', () => {
    const e = comecado()
    const copia = structuredClone({ ...e, falados: [...e.falados] })
    reduzirNavegacao(e, { tipo: 'leitura', leitura: leitura(PONTOS_L.A, 1000) })
    expect({ ...e, falados: [...e.falados] }).toEqual(copia)
  })
})

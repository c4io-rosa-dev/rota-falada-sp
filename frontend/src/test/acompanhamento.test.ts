import {
  estadoInicial,
  leituraBoa,
  LIMITES,
  limiarDesvio,
  limiarVolta,
  registrarLeitura,
  registrarTempo,
  retomar,
  type EstadoAcompanhamento,
  type Medida,
  type Ocorrencia,
} from '../dados/navegacao/acompanhamento'

function medida(extras: Partial<Medida> = {}): Medida {
  return {
    agoraMs: 0,
    precisaoM: 8,
    progressoM: 0,
    lateralM: 2,
    distanciaAoFimM: 300,
    totalM: 308,
    ...extras,
  }
}

/** Aplica várias leituras em sequência e devolve o estado final e as ocorrências de cada uma. */
function sequencia(inicio: EstadoAcompanhamento, medidas: Partial<Medida>[]) {
  let estado = inicio
  const ocorrencias: Ocorrencia[][] = []
  for (const extras of medidas) {
    const r = registrarLeitura(estado, medida(extras))
    estado = r.estado
    ocorrencias.push(r.ocorrencias)
  }
  return { estado, ocorrencias }
}

const INICIO = estadoInicial({ agoraMs: 0 })

describe('limiares', () => {
  it('limiar de desvio é o maior entre 20 m e 1,5 vez a precisão', () => {
    expect(limiarDesvio(8)).toBe(20)
    expect(limiarDesvio(20)).toBe(30)
  })

  it('leitura boa vai até 30 m de precisão', () => {
    expect(leituraBoa(30)).toBe(true)
    expect(leituraBoa(30.1)).toBe(false)
  })

  it('expõe as constantes do desenho', () => {
    expect(LIMITES).toMatchObject({
      PRECISAO_BOA_M: 30,
      DESVIO_MIN_M: 20,
      FATOR_PRECISAO: 1.5,
      LEITURAS_DESVIO: 3,
      TEMPO_DESVIO_MS: 10_000,
      LEITURAS_DESVIO_TEMPO: 2,
      VOLTA_M: 12,
      FATOR_VOLTA: 0.6,
      PARADO_M: 0.01,
      CONTRARIO_M: 15,
      LEITURAS_CONTRARIO: 3,
      REARME_CONTRARIO_M: 5,
      CHEGADA_M: 15,
      CHEGADA_FOLGA_M: 30,
      CHEGADA_PROGRESSO_M: 5,
      SINAL_FRACO_MS: 10_000,
      SEM_SINAL_MS: 15_000,
    })
  })
})

describe('progresso', () => {
  it('só sobe', () => {
    const { estado } = sequencia(INICIO, [
      { agoraMs: 0, progressoM: 10, lateralM: 2 },
      { agoraMs: 1000, progressoM: 30, lateralM: 3 },
      { agoraMs: 2000, progressoM: 20, lateralM: 4 },
    ])
    expect(estado.progressoMaxM).toBe(30)
  })

  it('leitura com lateral acima do limiar não move o progresso', () => {
    const { estado } = sequencia(INICIO, [{ progressoM: 50, lateralM: 25 }])
    expect(estado.progressoMaxM).toBe(0)
  })
})

describe('leitura ruim', () => {
  it('não move o progresso', () => {
    const r = registrarLeitura(INICIO, medida({ precisaoM: 40, progressoM: 100 }))
    expect(r.estado.progressoMaxM).toBe(0)
    expect(r.ocorrencias).toEqual([])
  })

  it('não conta para o desvio', () => {
    const { estado, ocorrencias } = sequencia(INICIO, [
      { agoraMs: 0, precisaoM: 40, lateralM: 100 },
      { agoraMs: 1000, precisaoM: 40, lateralM: 101 },
      { agoraMs: 2000, precisaoM: 40, lateralM: 102 },
    ])
    expect(estado.leiturasFora).toBe(0)
    expect(estado.fora).toBe(false)
    expect(ocorrencias.flat()).toEqual([])
  })

  it('atualiza a última leitura', () => {
    const r = registrarLeitura(INICIO, medida({ agoraMs: 5000, precisaoM: 40 }))
    expect(r.estado.ultimaLeituraMs).toBe(5000)
  })
})

describe('desvio', () => {
  it('três leituras boas fora saem só na terceira', () => {
    const { estado, ocorrencias } = sequencia(INICIO, [
      { agoraMs: 0, lateralM: 25 },
      { agoraMs: 1000, lateralM: 26 },
      { agoraMs: 2000, lateralM: 27 },
    ])
    expect(ocorrencias).toEqual([[], [], ['saiu']])
    expect(estado.fora).toBe(true)
  })

  it('duas fora e uma dentro zeram o contador', () => {
    const { estado, ocorrencias } = sequencia(INICIO, [
      { agoraMs: 0, lateralM: 25 },
      { agoraMs: 1000, lateralM: 26 },
      { agoraMs: 2000, lateralM: 3 },
      { agoraMs: 3000, lateralM: 25 },
    ])
    expect(ocorrencias.flat()).toEqual([])
    expect(estado.leiturasFora).toBe(1)
    expect(estado.foraDesdeMs).toBe(3000)
  })

  it('sai por tempo com 10 s fora entre leituras', () => {
    const { ocorrencias } = sequencia(INICIO, [
      { agoraMs: 0, lateralM: 25 },
      { agoraMs: 10_000, lateralM: 26 },
    ])
    expect(ocorrencias).toEqual([[], ['saiu']])
  })

  it('sai por tempo sem leitura nova (registrarTempo), com duas leituras boas fora', () => {
    const { estado } = sequencia(INICIO, [
      { agoraMs: 0, lateralM: 25 },
      { agoraMs: 1000, lateralM: 26 },
    ])
    expect(registrarTempo(estado, 9_999).ocorrencias).toEqual([])
    const r = registrarTempo(estado, 10_000)
    expect(r.ocorrencias).toEqual(['saiu'])
    expect(r.estado.fora).toBe(true)
    expect(registrarTempo(r.estado, 11_000).ocorrencias).toEqual([])
  })

  it('um pico isolado fora, seguido de sinal ruim, não confirma o desvio pelo relógio', () => {
    const { estado } = sequencia(INICIO, [
      { agoraMs: 0, lateralM: 2 },
      { agoraMs: 1000, lateralM: 60 },
      { agoraMs: 2000, precisaoM: 45, lateralM: 3 },
      { agoraMs: 3000, precisaoM: 45, lateralM: 3 },
    ])
    expect(registrarTempo(estado, 12_000).ocorrencias).not.toContain('saiu')
    expect(registrarTempo(estado, 20_000).estado.fora).toBe(false)
  })

  it('um pico isolado seguido de leituras paradas também não confirma pelo relógio', () => {
    const { estado } = sequencia(INICIO, [
      { agoraMs: 0, lateralM: 2 },
      { agoraMs: 1000, lateralM: 60 },
      { agoraMs: 2000, lateralM: 60 },
      { agoraMs: 3000, lateralM: 60 },
    ])
    expect(registrarTempo(estado, 12_000).ocorrencias).toEqual([])
  })

  it('precisão maior alarga o limiar', () => {
    const { estado, ocorrencias } = sequencia(INICIO, [
      { agoraMs: 0, precisaoM: 20, lateralM: 25 },
      { agoraMs: 1000, precisaoM: 20, lateralM: 26 },
      { agoraMs: 2000, precisaoM: 20, lateralM: 27 },
    ])
    expect(ocorrencias.flat()).toEqual([])
    expect(estado.leiturasFora).toBe(0)
  })

  it('progresso nulo conta como fora', () => {
    const { ocorrencias } = sequencia(INICIO, [
      { agoraMs: 0, progressoM: null, lateralM: Infinity },
      { agoraMs: 1000, progressoM: null, lateralM: Infinity },
      { agoraMs: 2000, progressoM: null, lateralM: Infinity },
    ])
    expect(ocorrencias).toEqual([[], [], ['saiu']])
  })

  it('andar em paralelo à rota, à mesma distância, não é leitura parada: o progresso muda', () => {
    const { estado, ocorrencias } = sequencia(INICIO, [
      { agoraMs: 0, progressoM: 120, lateralM: 25 },
      { agoraMs: 1000, progressoM: 121, lateralM: 25 },
      { agoraMs: 2000, progressoM: 122, lateralM: 25 },
    ])
    expect(ocorrencias).toEqual([[], [], ['saiu']])
    expect(estado.fora).toBe(true)
  })

  it('leitura parada conta uma só vez', () => {
    const { estado, ocorrencias } = sequencia(INICIO, [
      { agoraMs: 0, lateralM: 25 },
      { agoraMs: 1000, lateralM: 25 },
      { agoraMs: 2000, lateralM: 25 },
    ])
    expect(ocorrencias.flat()).toEqual([])
    expect(estado.leiturasFora).toBe(1)
    expect(estado.fora).toBe(false)
  })
})

describe('histerese da volta', () => {
  const fora = estadoInicial({ agoraMs: 0, progressoM: 40, fora: true })

  it('lateral 15 não volta', () => {
    const r = registrarLeitura(fora, medida({ progressoM: 60, lateralM: 15 }))
    expect(r.ocorrencias).toEqual([])
    expect(r.estado.fora).toBe(true)
    expect(r.estado.progressoMaxM).toBe(40)
  })

  it('lateral 11 volta e leva o progresso', () => {
    const r = registrarLeitura(fora, medida({ progressoM: 60, lateralM: 11 }))
    expect(r.ocorrencias).toEqual(['voltou'])
    expect(r.estado.fora).toBe(false)
    expect(r.estado.progressoMaxM).toBe(60)
    expect(r.estado.leiturasFora).toBe(0)
    expect(r.estado.foraDesdeMs).toBeNull()
  })

  it('volta sem baixar o progresso', () => {
    const r = registrarLeitura(fora, medida({ progressoM: 20, lateralM: 11 }))
    expect(r.ocorrencias).toEqual(['voltou'])
    expect(r.estado.progressoMaxM).toBe(40)
  })

  it('progresso nulo não volta', () => {
    const r = registrarLeitura(fora, medida({ progressoM: null, lateralM: 5 }))
    expect(r.ocorrencias).toEqual([])
    expect(r.estado.fora).toBe(true)
  })

  it('o limiar de volta acompanha a precisão e fica sempre abaixo do de saída', () => {
    expect(limiarVolta(5)).toBe(12)
    expect(limiarVolta(8)).toBe(12)
    expect(limiarVolta(20)).toBeCloseTo(18, 9)
    expect(limiarVolta(25)).toBeCloseTo(22.5, 9)
    expect(limiarVolta(30)).toBeCloseTo(27, 9)
    for (let p = 1; p <= 30; p++) expect(limiarVolta(p)).toBeLessThan(limiarDesvio(p))
  })

  it.each([20, 25, 30])('com precisão %i, a pessoa na calçada certa com o ruído normal volta', (precisaoM) => {
    // ruído acima dos 12 m fixos, logo abaixo do limiar de volta (18, 22,5 e 27 m)
    const lateralM = limiarVolta(precisaoM) - 0.5
    expect(lateralM).toBeGreaterThan(LIMITES.VOLTA_M)
    const r = registrarLeitura(fora, medida({ precisaoM, progressoM: 60, lateralM }))
    expect(r.ocorrencias).toEqual(['voltou'])
    expect(r.estado.fora).toBe(false)
  })
})

describe('sentido contrário', () => {
  const em100 = estadoInicial({ agoraMs: 0, progressoM: 100 })

  it('avisa uma vez, rearma e avisa de novo', () => {
    const { ocorrencias } = sequencia(em100, [
      { agoraMs: 1000, progressoM: 80 },
      { agoraMs: 2000, progressoM: 80 },
      { agoraMs: 3000, progressoM: 80 },
      { agoraMs: 4000, progressoM: 80 },
      { agoraMs: 5000, progressoM: 96 },
      { agoraMs: 6000, progressoM: 80 },
      { agoraMs: 7000, progressoM: 80 },
      { agoraMs: 8000, progressoM: 80 },
    ])
    expect(ocorrencias).toEqual([[], [], ['sentido_contrario'], [], [], [], [], ['sentido_contrario']])
  })

  it('não rearma entre 85 e 95', () => {
    const { ocorrencias } = sequencia(em100, [
      { agoraMs: 1000, progressoM: 80 },
      { agoraMs: 2000, progressoM: 80 },
      { agoraMs: 3000, progressoM: 80 },
      { agoraMs: 4000, progressoM: 90 },
      { agoraMs: 5000, progressoM: 80 },
      { agoraMs: 6000, progressoM: 80 },
      { agoraMs: 7000, progressoM: 80 },
    ])
    expect(ocorrencias.flat()).toEqual(['sentido_contrario'])
  })

  it('com precisão 25, recuo de 20 m não conta', () => {
    const { estado, ocorrencias } = sequencia(em100, [
      { agoraMs: 1000, precisaoM: 25, progressoM: 80 },
      { agoraMs: 2000, precisaoM: 25, progressoM: 80 },
      { agoraMs: 3000, precisaoM: 25, progressoM: 80 },
    ])
    expect(ocorrencias.flat()).toEqual([])
    expect(estado.leiturasContrario).toBe(0)
  })

  it('para trás do início (progresso negativo) também conta: anda para trás a partir do começo', () => {
    const noInicio = estadoInicial({ agoraMs: 0, progressoM: 0 })
    const { ocorrencias } = sequencia(noInicio, [
      { agoraMs: 1000, progressoM: -5, lateralM: 5 },
      { agoraMs: 2000, progressoM: -10, lateralM: 10 },
      { agoraMs: 3000, progressoM: -16, lateralM: 16 },
      { agoraMs: 4000, progressoM: -17, lateralM: 17 },
      { agoraMs: 5000, progressoM: -18, lateralM: 18 },
    ])
    expect(ocorrencias.flat()).toEqual(['sentido_contrario'])
  })

  it('fora da rota não conta', () => {
    const fora = estadoInicial({ agoraMs: 0, progressoM: 100, fora: true })
    const { estado } = sequencia(fora, [
      { agoraMs: 1000, progressoM: 80, lateralM: 15 },
      { agoraMs: 2000, progressoM: 80, lateralM: 16 },
      { agoraMs: 3000, progressoM: 80, lateralM: 17 },
    ])
    expect(estado.leiturasContrario).toBe(0)
  })
})

describe('chegada', () => {
  it('perto do fim com progresso suficiente chega', () => {
    const e = estadoInicial({ agoraMs: 0, progressoM: 280 })
    const r = registrarLeitura(e, medida({ progressoM: 280, distanciaAoFimM: 14 }))
    expect(r.ocorrencias).toEqual(['chegou'])
    expect(r.estado.chegou).toBe(true)
  })

  it('perto do fim sem progresso não chega', () => {
    const e = estadoInicial({ agoraMs: 0, progressoM: 200 })
    const r = registrarLeitura(e, medida({ progressoM: 200, distanciaAoFimM: 14 }))
    expect(r.ocorrencias).toEqual([])
    expect(r.estado.chegou).toBe(false)
  })

  it('progresso a 5 m do total chega, mesmo a mais de 15 m do ponto final (lateral até o limiar)', () => {
    const e = estadoInicial({ agoraMs: 0, progressoM: 304 })
    const r = registrarLeitura(e, medida({ progressoM: 304, lateralM: 18, distanciaAoFimM: 22 }))
    expect(r.ocorrencias).toEqual(['chegou'])
  })

  it('progresso no fim sem estar perto do ponto final não chega (salto de encaixe)', () => {
    const e = estadoInicial({ agoraMs: 0, progressoM: 304 })
    const r = registrarLeitura(e, medida({ progressoM: 304, distanciaAoFimM: 150 }))
    expect(r.ocorrencias).toEqual([])
    expect(r.estado.chegou).toBe(false)
  })

  it('não repete', () => {
    const e = estadoInicial({ agoraMs: 0, progressoM: 304 })
    const { ocorrencias } = sequencia(e, [
      { agoraMs: 1000, progressoM: 304, distanciaAoFimM: 5 },
      { agoraMs: 2000, progressoM: 305, distanciaAoFimM: 4 },
    ])
    expect(ocorrencias).toEqual([['chegou'], []])
  })

  it('fora da rota também chega', () => {
    const e = estadoInicial({ agoraMs: 0, progressoM: 290, fora: true })
    const r = registrarLeitura(e, medida({ progressoM: null, lateralM: Infinity, distanciaAoFimM: 10 }))
    expect(r.ocorrencias).toEqual(['chegou'])
    expect(r.estado.fora).toBe(true)
  })

  it('leitura ruim não chega', () => {
    const e = estadoInicial({ agoraMs: 0, progressoM: 304 })
    const r = registrarLeitura(e, medida({ precisaoM: 40, distanciaAoFimM: 1 }))
    expect(r.ocorrencias).toEqual([])
  })
})

describe('sinal', () => {
  it('fraco depois de 10 s de leituras ruins e volta com leitura boa', () => {
    const { estado, ocorrencias } = sequencia(INICIO, [
      { agoraMs: 0, precisaoM: 40 },
      { agoraMs: 9_999, precisaoM: 40 },
      { agoraMs: 10_000, precisaoM: 40 },
      { agoraMs: 11_000, precisaoM: 40 },
      { agoraMs: 12_000, precisaoM: 8 },
    ])
    expect(ocorrencias).toEqual([[], [], ['sinal_fraco'], [], ['sinal_voltou']])
    expect(estado.sinal).toBe('bom')
    expect(estado.ruimDesdeMs).toBeNull()
    expect(estado.ultimaBoaMs).toBe(12_000)
  })

  it('fraco por tempo (registrarTempo)', () => {
    const { estado } = sequencia(INICIO, [{ agoraMs: 0, precisaoM: 40 }])
    expect(registrarTempo(estado, 9_999).ocorrencias).toEqual([])
    const r = registrarTempo(estado, 10_000)
    expect(r.ocorrencias).toEqual(['sinal_fraco'])
    expect(r.estado.sinal).toBe('fraco')
  })

  it('sem sinal depois de 15 s sem leitura, uma vez', () => {
    const { estado } = sequencia(INICIO, [{ agoraMs: 1000 }])
    expect(registrarTempo(estado, 15_999).ocorrencias).toEqual([])
    const r = registrarTempo(estado, 16_000)
    expect(r.ocorrencias).toEqual(['sem_sinal'])
    expect(r.estado.sinal).toBe('sem_sinal')
    expect(registrarTempo(r.estado, 30_000).ocorrencias).toEqual([])
    const volta = registrarLeitura(r.estado, medida({ agoraMs: 31_000 }))
    expect(volta.ocorrencias).toEqual(['sinal_voltou'])
  })

  it('estado inicial sem nenhuma leitura fica sem sinal em 15 s', () => {
    expect(registrarTempo(estadoInicial({ agoraMs: 0 }), 15_000).ocorrencias).toEqual(['sem_sinal'])
  })
})

describe('ordem das ocorrências', () => {
  it('sinal volta antes de chegar', () => {
    const e = { ...estadoInicial({ agoraMs: 0, progressoM: 304 }), sinal: 'fraco' as const }
    const r = registrarLeitura(e, medida({ agoraMs: 1000, progressoM: 304, distanciaAoFimM: 5 }))
    expect(r.ocorrencias).toEqual(['sinal_voltou', 'chegou'])
  })
})

describe('estadoInicial e retomar', () => {
  it('estadoInicial respeita progresso e fora', () => {
    const e = estadoInicial({ agoraMs: 500, progressoM: 50, fora: true })
    expect(e).toEqual({
      progressoMaxM: 50,
      fora: true,
      leiturasFora: 0,
      foraDesdeMs: null,
      ultimaLateralM: null,
      ultimoProgressoM: null,
      sinal: 'bom',
      ruimDesdeMs: null,
      ultimaLeituraMs: 500,
      ultimaBoaMs: null,
      leiturasContrario: 0,
      contrarioAvisado: false,
      chegou: false,
    })
  })

  it('estadoInicial padrão começa do zero e na rota', () => {
    const e = estadoInicial({ agoraMs: 0 })
    expect(e.progressoMaxM).toBe(0)
    expect(e.fora).toBe(false)
  })

  it('retomar zera contadores e mantém progresso, fora e chegada', () => {
    const sujo: EstadoAcompanhamento = {
      progressoMaxM: 120,
      fora: true,
      leiturasFora: 2,
      foraDesdeMs: 1000,
      ultimaLateralM: 25,
      ultimoProgressoM: 80,
      sinal: 'bom',
      ruimDesdeMs: 3000,
      ultimaLeituraMs: 4000,
      ultimaBoaMs: 2000,
      leiturasContrario: 2,
      contrarioAvisado: false,
      chegou: true,
    }
    const e = retomar(Object.freeze(sujo), 60_000)
    expect(e.leiturasFora).toBe(0)
    expect(e.foraDesdeMs).toBeNull()
    expect(e.ultimaLateralM).toBeNull()
    expect(e.ultimoProgressoM).toBeNull()
    expect(e.ruimDesdeMs).toBeNull()
    expect(e.leiturasContrario).toBe(0)
    expect(e.ultimaLeituraMs).toBe(60_000)
    expect(e.progressoMaxM).toBe(120)
    expect(e.fora).toBe(true)
    expect(e.chegou).toBe(true)
  })

  it('depois de retomar não acusa sem sinal de imediato', () => {
    const e = retomar(estadoInicial({ agoraMs: 0 }), 60_000)
    expect(registrarTempo(e, 61_000).ocorrencias).toEqual([])
  })
})

describe('pureza', () => {
  it('não altera estado nem medida recebidos', () => {
    const estado = Object.freeze(estadoInicial({ agoraMs: 0, progressoM: 100 }))
    const copia = { ...estado }
    const m = Object.freeze(medida({ agoraMs: 1000, progressoM: 80, lateralM: 25, precisaoM: 40 }))
    expect(() => registrarLeitura(estado, m)).not.toThrow()
    expect(() => registrarLeitura(estado, medida({ agoraMs: 1000, lateralM: 25 }))).not.toThrow()
    expect(() => registrarTempo(estado, 20_000)).not.toThrow()
    expect(() => retomar(estado, 20_000)).not.toThrow()
    expect(estado).toEqual(copia)
  })
})

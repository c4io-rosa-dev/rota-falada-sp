/**
 * Acompanhamento da pessoa ao longo da rota: desvio (com histerese), qualidade do sinal,
 * sentido contrário e chegada. Módulo puro e determinístico: não importa nada do projeto,
 * não guarda nada e nunca altera os objetos recebidos.
 *
 * Origem dos números (só os valores e a ideia, nenhum código copiado):
 * - Organic Maps (Apache-2.0): contador de leituras para acusar desvio, limiar de 20 m a pé,
 *   leitura parada não conta e chegada a 15 m para pedestre.
 * - Ferrostar (BSD-3-Clause): leitura de GPS ruim (precisão acima de ~25 m) não acusa desvio.
 * Os demais valores vêm do desenho da navegação guiada (spec 6.2).
 */

export type Sinal = 'bom' | 'fraco' | 'sem_sinal'

export type Medida = {
  agoraMs: number
  precisaoM: number
  /** Encaixe bruto na janela; null quando não há. */
  progressoM: number | null
  /** Distância à linha na janela (Infinity se não há encaixe). */
  lateralM: number
  distanciaAoFimM: number
  totalM: number
}

export type EstadoAcompanhamento = {
  progressoMaxM: number
  fora: boolean
  leiturasFora: number
  foraDesdeMs: number | null
  ultimaLateralM: number | null
  /** Progresso bruto da última leitura boa: com a lateral, diz se a pessoa está parada. */
  ultimoProgressoM: number | null
  sinal: Sinal
  ruimDesdeMs: number | null
  ultimaLeituraMs: number
  ultimaBoaMs: number | null
  leiturasContrario: number
  contrarioAvisado: boolean
  chegou: boolean
}

export type Ocorrencia =
  | 'saiu'
  | 'voltou'
  | 'sentido_contrario'
  | 'sinal_fraco'
  | 'sinal_voltou'
  | 'sem_sinal'
  | 'chegou'

export type ResultadoAcompanhamento = { estado: EstadoAcompanhamento; ocorrencias: Ocorrencia[] }

export const LIMITES = {
  /** Leitura com precisão até este valor é "boa". */
  PRECISAO_BOA_M: 30,
  DESVIO_MIN_M: 20,
  FATOR_PRECISAO: 1.5,
  LEITURAS_DESVIO: 3,
  TEMPO_DESVIO_MS: 10_000,
  /** Pelo relógio, o desvio só se confirma com pelo menos isto de leituras boas fora (um pico isolado não basta). */
  LEITURAS_DESVIO_TEMPO: 2,
  /** Histerese: fora da rota, só volta com lateral abaixo de limiarVolta(precisão), nunca menos que isto. */
  VOLTA_M: 12,
  /** A volta acompanha a precisão, mas fica sempre abaixo da saída: até 0,6 vez o limiar de desvio. */
  FATOR_VOLTA: 0.6,
  /** Variação lateral até este valor é leitura parada e não conta para o desvio. */
  PARADO_M: 0.01,
  /** Recuo mínimo para contar sentido contrário; o recuo usado é max(15, precisão). */
  CONTRARIO_M: 15,
  LEITURAS_CONTRARIO: 3,
  REARME_CONTRARIO_M: 5,
  CHEGADA_M: 15,
  CHEGADA_FOLGA_M: 30,
  CHEGADA_PROGRESSO_M: 5,
  SINAL_FRACO_MS: 10_000,
  SEM_SINAL_MS: 15_000,
} as const

export function limiarDesvio(precisaoM: number): number {
  return Math.max(LIMITES.DESVIO_MIN_M, LIMITES.FATOR_PRECISAO * precisaoM)
}

/**
 * Histerese da volta: max(12, min(precisão, 0,6 · limiarDesvio)). Com precisão boa fica nos 12 m;
 * com precisão de 20 a 30 m, o ruído normal de quem está na calçada certa passa de 12 m e a
 * navegação ficaria presa em "fora da rota".
 */
export function limiarVolta(precisaoM: number): number {
  return Math.max(LIMITES.VOLTA_M, Math.min(precisaoM, LIMITES.FATOR_VOLTA * limiarDesvio(precisaoM)))
}

export function leituraBoa(precisaoM: number): boolean {
  return precisaoM <= LIMITES.PRECISAO_BOA_M
}

export function estadoInicial(op: {
  agoraMs: number
  progressoM?: number
  fora?: boolean
}): EstadoAcompanhamento {
  return {
    progressoMaxM: op.progressoM ?? 0,
    fora: op.fora ?? false,
    leiturasFora: 0,
    foraDesdeMs: null,
    ultimaLateralM: null,
    ultimoProgressoM: null,
    sinal: 'bom',
    ruimDesdeMs: null,
    ultimaLeituraMs: op.agoraMs,
    ultimaBoaMs: null,
    leiturasContrario: 0,
    contrarioAvisado: false,
    chegou: false,
  }
}

export function registrarLeitura(e: EstadoAcompanhamento, m: Medida): ResultadoAcompanhamento {
  const estado: EstadoAcompanhamento = { ...e, ultimaLeituraMs: m.agoraMs }
  const ocorrencias: Ocorrencia[] = []

  // Leitura ruim: só conta para o sinal.
  if (!leituraBoa(m.precisaoM)) {
    if (estado.ruimDesdeMs === null) estado.ruimDesdeMs = m.agoraMs
    if (estado.sinal === 'bom' && m.agoraMs - estado.ruimDesdeMs >= LIMITES.SINAL_FRACO_MS) {
      estado.sinal = 'fraco'
      ocorrencias.push('sinal_fraco')
    }
    return { estado, ocorrencias }
  }

  // Sinal.
  estado.ruimDesdeMs = null
  estado.ultimaBoaMs = m.agoraMs
  if (estado.sinal !== 'bom') {
    estado.sinal = 'bom'
    ocorrencias.push('sinal_voltou')
  }

  const limiar = limiarDesvio(m.precisaoM)

  // Progresso: só sobe, e só com a pessoa na linha.
  if (!estado.fora && m.progressoM !== null && m.lateralM <= limiar) {
    estado.progressoMaxM = Math.max(estado.progressoMaxM, m.progressoM)
  }

  // Desvio. Leitura parada (lateral e progresso iguais aos da anterior) não conta. Só a lateral
  // não basta: quem anda em paralelo à rota, à mesma distância, não está parado.
  const mesmoProgresso =
    m.progressoM === estado.ultimoProgressoM ||
    (m.progressoM !== null &&
      estado.ultimoProgressoM !== null &&
      Math.abs(m.progressoM - estado.ultimoProgressoM) <= LIMITES.PARADO_M)
  const parada =
    estado.ultimaLateralM !== null &&
    Math.abs(m.lateralM - estado.ultimaLateralM) <= LIMITES.PARADO_M &&
    mesmoProgresso
  if (!parada) {
    estado.ultimaLateralM = m.lateralM
    estado.ultimoProgressoM = m.progressoM
    if (!estado.fora) {
      if (m.progressoM === null || m.lateralM > limiar) {
        estado.leiturasFora += 1
        if (estado.foraDesdeMs === null) estado.foraDesdeMs = m.agoraMs
        if (
          estado.leiturasFora >= LIMITES.LEITURAS_DESVIO ||
          m.agoraMs - estado.foraDesdeMs >= LIMITES.TEMPO_DESVIO_MS
        ) {
          sair(estado)
          ocorrencias.push('saiu')
        }
      } else {
        estado.leiturasFora = 0
        estado.foraDesdeMs = null
      }
    } else if (m.progressoM !== null && m.lateralM < limiarVolta(m.precisaoM)) {
      estado.fora = false
      estado.leiturasFora = 0
      estado.foraDesdeMs = null
      estado.leiturasContrario = 0
      estado.progressoMaxM = Math.max(estado.progressoMaxM, m.progressoM)
      ocorrencias.push('voltou')
    }
  }

  // Sentido contrário.
  if (!estado.fora && m.progressoM !== null) {
    const recuo = Math.max(LIMITES.CONTRARIO_M, m.precisaoM)
    if (m.progressoM < estado.progressoMaxM - recuo) {
      estado.leiturasContrario += 1
    } else {
      estado.leiturasContrario = 0
    }
    if (estado.leiturasContrario >= LIMITES.LEITURAS_CONTRARIO && !estado.contrarioAvisado) {
      estado.contrarioAvisado = true
      ocorrencias.push('sentido_contrario')
    }
    if (m.progressoM >= estado.progressoMaxM - LIMITES.REARME_CONTRARIO_M) {
      estado.contrarioAvisado = false
      estado.leiturasContrario = 0
    }
  }

  // Chegada (vale mesmo fora da rota).
  if (!estado.chegou) {
    const perto =
      m.distanciaAoFimM <= LIMITES.CHEGADA_M &&
      estado.progressoMaxM >= m.totalM - LIMITES.CHEGADA_FOLGA_M
    // "andou" exige também estar perto do ponto final (até o limiar mais os 5 m que faltam):
    // um salto do encaixe para o fim da rota não vira chegada.
    const andou =
      estado.progressoMaxM >= m.totalM - LIMITES.CHEGADA_PROGRESSO_M &&
      m.distanciaAoFimM <= limiar + LIMITES.CHEGADA_PROGRESSO_M
    if (perto || andou) {
      estado.chegou = true
      ocorrencias.push('chegou')
    }
  }

  return { estado, ocorrencias }
}

export function registrarTempo(e: EstadoAcompanhamento, agoraMs: number): ResultadoAcompanhamento {
  const estado: EstadoAcompanhamento = { ...e }
  const ocorrencias: Ocorrencia[] = []

  if (agoraMs - estado.ultimaLeituraMs >= LIMITES.SEM_SINAL_MS && estado.sinal !== 'sem_sinal') {
    estado.sinal = 'sem_sinal'
    ocorrencias.push('sem_sinal')
  } else if (
    estado.sinal === 'bom' &&
    estado.ruimDesdeMs !== null &&
    agoraMs - estado.ruimDesdeMs >= LIMITES.SINAL_FRACO_MS
  ) {
    estado.sinal = 'fraco'
    ocorrencias.push('sinal_fraco')
  }

  // Pelo relógio só com duas leituras boas fora: um pico isolado seguido de sinal ruim (que não
  // conta) ou de leituras paradas (que também não contam) não confirma o desvio.
  if (
    !estado.fora &&
    estado.foraDesdeMs !== null &&
    estado.leiturasFora >= LIMITES.LEITURAS_DESVIO_TEMPO &&
    agoraMs - estado.foraDesdeMs >= LIMITES.TEMPO_DESVIO_MS
  ) {
    sair(estado)
    ocorrencias.push('saiu')
  }

  return { estado, ocorrencias }
}

export function retomar(e: EstadoAcompanhamento, agoraMs: number): EstadoAcompanhamento {
  return {
    ...e,
    leiturasFora: 0,
    foraDesdeMs: null,
    ultimaLateralM: null,
    ultimoProgressoM: null,
    leiturasContrario: 0,
    ruimDesdeMs: null,
    ultimaLeituraMs: agoraMs,
  }
}

/** Marca a saída da rota numa cópia já feita (nunca no objeto recebido). */
function sair(estado: EstadoAcompanhamento): void {
  estado.fora = true
  estado.leiturasFora = 0
  estado.foraDesdeMs = null
  estado.leiturasContrario = 0
}

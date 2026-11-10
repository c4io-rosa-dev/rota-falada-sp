/**
 * Para onde aponta a seta da pessoa no mapa (emenda de 10/11/2026 da spec do mapa, 19.4).
 *
 * Puro e determinístico: recebe os números do evento de orientação, do GPS e da rota e devolve
 * graus [0, 360), 0 = norte, 90 = leste. Nada aqui lê sensor, relógio ou DOM, e nada é guardado:
 * a direção só vive na memória da página, para desenhar a seta.
 *
 * Ordem das fontes: bússola do aparelho → sentido da caminhada (GPS) → sentido da rota → nenhuma.
 * A rotação do MAPA não passa por aqui: ela continua vindo da corda da rota (mapaNavegacao.ts).
 */

export const DIRECAO = {
  /** Erro declarado pelo iPhone (webkitCompassAccuracy) acima disto: a bússola não vale. */
  PRECISAO_MAX_GRAUS: 45,
  /** Bússola ou GPS sem leitura nova por este tempo: não vale mais. */
  VALIDADE_BUSSOLA_MS: 3000,
  VALIDADE_GPS_MS: 5000,
  /** Abaixo disto a pessoa está parada e o rumo do GPS é ruído. */
  VELOCIDADE_MIN_MPS: 0.5,
  /** Peso de cada leitura nova na média circular (0 a 1). */
  SUAVIZACAO: 0.25,
  /** A seta muda no máximo a cada INTERVALO_MS e só com PASSO_GRAUS ou mais de diferença. */
  INTERVALO_MS: 250,
  PASSO_GRAUS: 5,
  /** Até esta inclinação (beta) vale o topo do aparelho; mais em pé, as costas dele (a câmera). */
  BETA_DEITADO_GRAUS: 70,
} as const

export type FonteDirecao = 'bussola' | 'caminhada' | 'rota'
export type Direcao = { graus: number; fonte: FonteDirecao }

/** O que interessa de um DeviceOrientationEvent (no iPhone, com os campos webkit). */
export type EventoOrientacao = {
  absolute?: boolean
  alpha?: number | null
  beta?: number | null
  gamma?: number | null
  webkitCompassHeading?: number | null
  webkitCompassAccuracy?: number | null
}

const RAD = Math.PI / 180
const numero = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

export function normalizarGraus(graus: number): number {
  const n = ((graus % 360) + 360) % 360
  return n >= 360 ? 0 : n
}

/** Diferença mínima entre dois rumos, em graus [0, 180]. */
export function diferencaGraus(a: number, b: number): number {
  const d = normalizarGraus(a - b)
  return d > 180 ? 360 - d : d
}

/**
 * Rumo do topo da TELA, em graus, ou null se a leitura não é confiável.
 * - iPhone: webkitCompassHeading (já é rumo de bússola), descartado se a precisão declarada é
 *   negativa (sem calibração) ou pior que 45°.
 * - Android: só evento absoluto (deviceorientationabsolute), com alpha, beta e gamma. Aparelho
 *   deitado ou meio inclinado: o topo dele (360 − alpha). Aparelho em pé: as costas dele (para
 *   onde a câmera olha), pela matriz de rotação do W3C, porque o topo aponta para o céu.
 * anguloTela (screen.orientation.angle) corrige a tela girada: paisagem soma 90 ou 270.
 */
export function rumoDoEvento(ev: EventoOrientacao, anguloTela: number): number | null {
  const tela = numero(anguloTela) ? anguloTela : 0
  if (numero(ev.webkitCompassHeading)) {
    const precisao = ev.webkitCompassAccuracy
    if (numero(precisao) && (precisao < 0 || precisao > DIRECAO.PRECISAO_MAX_GRAUS)) return null
    return normalizarGraus(ev.webkitCompassHeading + tela)
  }
  if (ev.absolute !== true || !numero(ev.alpha) || !numero(ev.beta) || !numero(ev.gamma)) return null
  if (Math.abs(ev.beta) <= DIRECAO.BETA_DEITADO_GRAUS) return normalizarGraus(360 - ev.alpha + tela)
  const a = ev.alpha * RAD
  const b = ev.beta * RAD
  const g = ev.gamma * RAD
  // costas do aparelho (−z) no referencial da Terra: x = leste, y = norte
  const leste = -Math.sin(g) * Math.cos(a) - Math.cos(g) * Math.sin(b) * Math.sin(a)
  const norte = -Math.sin(g) * Math.sin(a) + Math.cos(g) * Math.sin(b) * Math.cos(a)
  if (Math.hypot(leste, norte) < 1e-6) return null
  return normalizarGraus(Math.atan2(leste, norte) / RAD + tela)
}

/**
 * Média circular exponencial: soma vetores (seno e cosseno), então 359° e 1° dão 0°, não 180°.
 * Guarda só o vetor atual (dois números), nunca a lista de leituras.
 */
export function criarSuavizador(peso: number = DIRECAO.SUAVIZACAO) {
  let x: number | null = null
  let y = 0
  return {
    somar(graus: number): number {
      const sx = Math.sin(graus * RAD)
      const sy = Math.cos(graus * RAD)
      if (x === null) {
        x = sx
        y = sy
      } else {
        x += (sx - x) * peso
        y += (sy - y) * peso
      }
      return normalizarGraus(Math.atan2(x, y) / RAD)
    },
    zerar() {
      x = null
      y = 0
    },
  }
}

/** Limite de frequência: a seta só muda depois de 250 ms e com 5° ou mais de diferença. */
export function deveAtualizar(anterior: { graus: number; emMs: number } | null, graus: number, agoraMs: number): boolean {
  if (!anterior) return true
  if (agoraMs - anterior.emMs < DIRECAO.INTERVALO_MS) return false
  return diferencaGraus(anterior.graus, graus) >= DIRECAO.PASSO_GRAUS
}

export type FontesDirecao = {
  agoraMs: number
  /** A última leitura confiável da bússola, já suavizada. */
  bussola: { graus: number; emMs: number } | null
  /** A última leitura do GPS (coords.heading e coords.speed), se houver. */
  gps: { rumoGraus?: number | null; velocidadeMps?: number | null; tMs: number } | null
  /** O sentido da rota no ponto da pessoa; null fora da rota. */
  rumoRota: number | null
}

/** A melhor fonte disponível agora; null = anel sem seta. */
export function escolherDirecao(f: FontesDirecao): Direcao | null {
  const b = f.bussola
  if (b && numero(b.graus) && f.agoraMs - b.emMs <= DIRECAO.VALIDADE_BUSSOLA_MS) {
    return { graus: normalizarGraus(b.graus), fonte: 'bussola' }
  }
  const g = f.gps
  if (
    g &&
    numero(g.rumoGraus) &&
    numero(g.velocidadeMps) &&
    g.velocidadeMps >= DIRECAO.VELOCIDADE_MIN_MPS &&
    f.agoraMs - g.tMs <= DIRECAO.VALIDADE_GPS_MS
  ) {
    return { graus: normalizarGraus(g.rumoGraus), fonte: 'caminhada' }
  }
  if (numero(f.rumoRota)) return { graus: normalizarGraus(f.rumoRota), fonte: 'rota' }
  return null
}

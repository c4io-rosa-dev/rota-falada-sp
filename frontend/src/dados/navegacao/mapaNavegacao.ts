/**
 * O que o mapa da navegação guiada mostra (spec do mapa próprio, seção 5).
 *
 * Puro e determinístico: recebe o estado da navegação e as preferências da aba e devolve a cena
 * (linhas da rota, manobra, pessoa e câmera). Não guarda nada: nenhuma lista de posições, nem em
 * memória. A cena tem no máximo um ponto da pessoa, e o rumo anterior entra como um número.
 *
 * Ordem das coordenadas: o resto do app usa [lat, lon] (PontoLatLng); o mapa usa [lon, lat]
 * (ordem do GeoJSON). A troca acontece só em paraLonLat.
 */
import type { PontoLatLng } from '../rotaGeo'
import { proximoUtil } from './falasNavegacao'
import type { EstadoNavegacao } from './navegacao'
import type { Regua } from './regua'
import { pontoAoLongo, type Trajeto } from './trajeto'

/** Meia corda do rumo, em metros. */
export const OLHAR_RUMO_M = 10
export const HISTERESE_RUMO_GRAUS = 10
export const ZOOM_NAVEGACAO = 17

/** Corda mais curta que isso não tem rumo. */
const CORDA_MINIMA_M = 0.5
/** Lados do polígono do círculo de precisão (33 vértices, o último repete o primeiro). */
const LADOS_CIRCULO = 32

export type LonLat = [number, number]

/** inclinada e cheia (emenda de 10/11/2026): ausentes valem desligadas. */
export type PrefsMapa = { aberto: boolean; girar: boolean; inclinada?: boolean; cheia?: boolean }

/** Seta de manobra desenhada pelo app: a haste segue a rota pela virada e a ponta fecha em triângulo. */
export const SETA_MANOBRA = {
  ANTES_M: 12,
  DEPOIS_M: 18,
  /** Sem pelo menos isto de rota depois da virada, não há para onde apontar. */
  MINIMO_DEPOIS_M: 3,
  /** Trecho final usado para o sentido da ponta. */
  OLHAR_M: 3,
  PONTA_COMPRIMENTO_M: 11,
  PONTA_LARGURA_M: 16,
} as const

/** haste: linha ao longo da rota; ponta: anel fechado do triângulo (4 vértices, o último repete o primeiro). */
export type SetaManobra = { haste: LonLat[]; ponta: LonLat[] }

export type Cena = {
  andado: LonLat[] | null
  restante: LonLat[] | null
  manobra: { trecho: LonLat[]; ponto: LonLat } | null
  /** A seta da próxima virada (forma, não só cor); null sem manobra ou sem rota depois dela. */
  setaManobra: SetaManobra | null
  destino: LonLat
  pessoa: { ponto: LonLat; encaixada: boolean; raioPrecisaoM: number | null } | null
  /** 'seguir': centro na pessoa; 'enquadrar': caixa do trecho; 'congelar': não mexe na câmera. */
  camera:
    | { modo: 'seguir'; centro: LonLat; rumo: number; pessoaAbaixo: boolean }
    | { modo: 'enquadrar'; caixa: [LonLat, LonLat]; rumo: 0 }
    | { modo: 'congelar' }
  /** Para o próximo cálculo de histerese; não sai do estado da casca. */
  rumoAplicado: number
}

/** [lat, lon] → [lon, lat]. O único lugar onde a ordem troca. */
export function paraLonLat(p: PontoLatLng): LonLat {
  return [p[1], p[0]]
}

/** Diferença angular mínima, em graus [0, 180], entre dois rumos. */
export function diferencaAngular(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360)
  return d > 180 ? 360 - d : d
}

function normalizar(graus: number): number {
  const n = ((graus % 360) + 360) % 360
  return n >= 360 ? 0 : n
}

/**
 * Rumo em graus [0, 360) da corda entre pontoAoLongo(m − 10) e pontoAoLongo(m + 10), com as
 * pontas presas à rota. 0 = norte, 90 = leste. null se a corda tem menos de 0,5 m.
 */
export function rumoEm(t: Trajeto, m: number): number | null {
  const a = pontoAoLongo(t, m - OLHAR_RUMO_M)
  const b = pontoAoLongo(t, m + OLHAR_RUMO_M)
  const leste = (b[1] - a[1]) * t.regua.kx
  const norte = (b[0] - a[0]) * t.regua.ky
  if (Math.hypot(leste, norte) < CORDA_MINIMA_M) return null
  return normalizar((Math.atan2(leste, norte) * 180) / Math.PI)
}

/** O pedaço da geometria entre deM e ateM (presos à rota), com os vértices de dentro. */
function pedaco(t: Trajeto, deM: number, ateM: number): LonLat[] {
  const de = Math.min(t.totalM, Math.max(0, deM))
  const ate = Math.min(t.totalM, Math.max(de, ateM))
  const linha: LonLat[] = [paraLonLat(pontoAoLongo(t, de))]
  for (let i = 0; i < t.pontos.length; i++) {
    if (t.acumuladoM[i] > de && t.acumuladoM[i] < ate) linha.push(paraLonLat(t.pontos[i]))
  }
  linha.push(paraLonLat(pontoAoLongo(t, ate)))
  return linha
}

/**
 * Linhas da geometria da rota (nunca do GPS), cortadas em pontoAoLongo(progresso).
 * progresso ≤ 0: andado = null. progresso ≥ totalM: restante = null.
 */
export function dividirRota(t: Trajeto, progressoM: number): { andado: LonLat[] | null; restante: LonLat[] | null } {
  const inteira = t.pontos.map(paraLonLat)
  if (progressoM <= 0) return { andado: null, restante: inteira }
  if (progressoM >= t.totalM) return { andado: inteira, restante: null }
  return { andado: pedaco(t, 0, progressoM), restante: pedaco(t, progressoM, t.totalM) }
}

/** Pedaço da geometria entre inicioM e fimM do passo i (com os vértices internos). Passo inexistente: []. */
export function trechoDoPasso(t: Trajeto, i: number): LonLat[] {
  const passo = t.passos[i]
  if (!passo) return []
  return pedaco(t, passo.inicioM, passo.fimM)
}

/**
 * A próxima virada com a MESMA regra do painel: passo_a_passo → passoAtual; senão
 * proximoUtil(contexto, passoAtual). null = o próximo é o destino.
 */
export function manobraEmDestaque(
  e: EstadoNavegacao,
): { passo: number; trecho: LonLat[]; ponto: LonLat; seta: SetaManobra | null } | null {
  const t = e.trajeto
  if (!t) return null
  const passo = e.fase === 'passo_a_passo' ? e.passoAtual : proximoUtil(e.contexto, e.passoAtual)
  if (passo === null) return null
  const trecho = trechoDoPasso(t, passo)
  if (trecho.length === 0) return null
  return { passo, trecho, ponto: trecho[0], seta: setaDaManobra(t, t.passos[passo].inicioM) }
}

/**
 * A seta da virada que começa em viradaM (metros ao longo da rota): haste de 12 m antes até 18 m
 * depois, presa à rota, e ponta triangular em metros no fim da haste, no sentido do último trecho.
 * A forma é o sinal: o óxido da virada contra a tinta da rota tem só 2,47:1 de contraste.
 */
export function setaDaManobra(t: Trajeto, viradaM: number): SetaManobra | null {
  const S = SETA_MANOBRA
  const virada = Math.min(t.totalM, Math.max(0, viradaM))
  const fim = Math.min(t.totalM, virada + S.DEPOIS_M)
  if (fim - virada < S.MINIMO_DEPOIS_M) return null
  const a = pontoAoLongo(t, Math.max(virada, fim - S.OLHAR_M))
  const b = pontoAoLongo(t, fim)
  const leste = (b[1] - a[1]) * t.regua.kx
  const norte = (b[0] - a[0]) * t.regua.ky
  const tamanho = Math.hypot(leste, norte)
  if (tamanho < CORDA_MINIMA_M) return null
  const ux = leste / tamanho
  const uy = norte / tamanho
  const meia = S.PONTA_LARGURA_M / 2
  // deslocamento em metros (leste, norte) a partir do fim da haste, já em [lon, lat]
  const em = (lesteM: number, norteM: number): LonLat => [b[1] + lesteM / t.regua.kx, b[0] + norteM / t.regua.ky]
  const bico = em(ux * S.PONTA_COMPRIMENTO_M, uy * S.PONTA_COMPRIMENTO_M)
  const esquerda = em(-uy * meia, ux * meia)
  const direita = em(uy * meia, -ux * meia)
  return {
    haste: pedaco(t, Math.max(0, virada - S.ANTES_M), fim),
    ponta: [bico, direita, esquerda, [bico[0], bico[1]]],
  }
}

/**
 * O sentido da rota no ponto da pessoa, para a seta dela quando não há bússola nem caminhada.
 * Só com a pessoa encaixada na rota (navegando ou pausada no meio da navegação); senão null.
 */
export function rumoDaRotaAgora(e: EstadoNavegacao): number | null {
  const t = e.trajeto
  if (!t) return null
  const acompanhando = e.fase === 'navegando' || (e.fase === 'pausada' && e.faseAntesDaPausa === 'navegando')
  if (!acompanhando || e.acompanhamento.fora || e.acompanhamento.contrarioAvisado) return null
  return rumoEm(t, e.acompanhamento.progressoMaxM)
}

/** Polígono fechado (33 vértices) a raioM metros do centro, medido com a régua do trajeto. */
export function circuloPrecisao(centro: LonLat, raioM: number, regua: Regua): LonLat[] {
  const anel: LonLat[] = []
  for (let k = 0; k < LADOS_CIRCULO; k++) {
    const angulo = (2 * Math.PI * k) / LADOS_CIRCULO
    anel.push([centro[0] + (raioM * Math.sin(angulo)) / regua.kx, centro[1] + (raioM * Math.cos(angulo)) / regua.ky])
  }
  anel.push([anel[0][0], anel[0][1]])
  return anel
}

/** Seta da pessoa, em metros a partir do centro do círculo dela (no zoom 17, 1 m ≈ 1,8 px). */
export const SETA_PESSOA = { BICO_M: 15, BASE_M: 8, ABERTURA_GRAUS: 42 } as const

/**
 * Triângulo fechado (4 vértices) que sai do ponto da pessoa e aponta para `graus` (0 = norte,
 * 90 = leste): o bico a 15 m e os dois cantos da base a 8 m, abertos 42° para cada lado. O círculo
 * da pessoa é desenhado por cima da base; sobra o bico, como numa bússola de mapa.
 */
export function setaDaPessoa(centro: LonLat, graus: number, regua: Regua): LonLat[] {
  const S = SETA_PESSOA
  const em = (angulo: number, raioM: number): LonLat => {
    const rad = (angulo * Math.PI) / 180
    return [centro[0] + (raioM * Math.sin(rad)) / regua.kx, centro[1] + (raioM * Math.cos(rad)) / regua.ky]
  }
  const bico = em(graus, S.BICO_M)
  return [bico, em(graus + S.ABERTURA_GRAUS, S.BASE_M), em(graus - S.ABERTURA_GRAUS, S.BASE_M), [bico[0], bico[1]]]
}

function caixaDe(linha: LonLat[]): [LonLat, LonLat] {
  const lons = linha.map((p) => p[0])
  const lats = linha.map((p) => p[1])
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ]
}

const FASES_COM_MAPA = new Set(['procurando', 'navegando', 'pausada', 'passo_a_passo'])

/** A pessoa na rota ou, se está fora (desvio ou sentido contrário), o ponto bruto da última leitura. */
function pessoaNaRota(e: EstadoNavegacao, t: Trajeto, fora: boolean, comRaio: boolean): Cena['pessoa'] {
  const l = e.ultimaLeitura
  if (fora && l) return { ponto: paraLonLat([l.lat, l.lon]), encaixada: false, raioPrecisaoM: l.precisaoM }
  return {
    ponto: paraLonLat(pontoAoLongo(t, e.acompanhamento.progressoMaxM)),
    encaixada: true,
    raioPrecisaoM: comRaio && l ? l.precisaoM : null,
  }
}

/** Com girar ligado e na rota: troca o rumo só com diferença de 10° ou mais. */
function rumoComHisterese(t: Trajeto, progressoM: number, rumoAnterior: number): number {
  const r = rumoEm(t, progressoM)
  if (r === null || diferencaAngular(r, rumoAnterior) < HISTERESE_RUMO_GRAUS) return rumoAnterior
  return r
}

/** A cena do mapa para o estado atual (tabela 5.1 do spec). null = fase sem mapa. */
export function cenaDoMapa(e: EstadoNavegacao, prefs: PrefsMapa, rumoAnterior: number): Cena | null {
  const t = e.trajeto
  if (!t || !FASES_COM_MAPA.has(e.fase)) return null

  const a = e.acompanhamento
  const fora = a.fora || a.contrarioAvisado
  const comAndado = e.fase === 'navegando' || e.fase === 'pausada'
  const { andado, restante } = comAndado
    ? dividirRota(t, a.progressoMaxM)
    : { andado: null, restante: t.pontos.map(paraLonLat) }
  const m = manobraEmDestaque(e)
  const base = {
    andado,
    restante,
    manobra: m && { trecho: m.trecho, ponto: m.ponto },
    setaManobra: m ? m.seta : null,
    destino: paraLonLat(t.pontos[t.pontos.length - 1]),
  }
  const rumoMantido = prefs.girar ? rumoAnterior : 0

  if (e.fase === 'passo_a_passo') {
    const trecho = trechoDoPasso(t, e.passoAtual)
    const caixa = caixaDe(trecho.length > 0 ? trecho : t.pontos.map(paraLonLat))
    return { ...base, pessoa: null, camera: { modo: 'enquadrar', caixa, rumo: 0 }, rumoAplicado: 0 }
  }

  if (e.fase === 'procurando') {
    const l = e.ultimaLeitura
    if (!l) return { ...base, pessoa: null, camera: { modo: 'enquadrar', caixa: caixaDe(t.pontos.map(paraLonLat)), rumo: 0 }, rumoAplicado: 0 }
    const ponto = paraLonLat([l.lat, l.lon])
    return {
      ...base,
      pessoa: { ponto, encaixada: false, raioPrecisaoM: l.precisaoM },
      camera: { modo: 'seguir', centro: ponto, rumo: 0, pessoaAbaixo: false },
      rumoAplicado: 0,
    }
  }

  if (e.fase === 'pausada') {
    return { ...base, pessoa: pessoaNaRota(e, t, fora, false), camera: { modo: 'congelar' }, rumoAplicado: rumoMantido }
  }

  // navegando
  if (a.sinal !== 'bom') {
    return { ...base, pessoa: pessoaNaRota(e, t, fora, true), camera: { modo: 'congelar' }, rumoAplicado: rumoMantido }
  }
  const pessoa = pessoaNaRota(e, t, fora, false)!
  const rumo = prefs.girar && !fora ? rumoComHisterese(t, a.progressoMaxM, rumoAnterior) : 0
  return {
    ...base,
    pessoa,
    camera: { modo: 'seguir', centro: pessoa.ponto, rumo, pessoaAbaixo: prefs.girar && rumo !== 0 },
    rumoAplicado: rumo,
  }
}

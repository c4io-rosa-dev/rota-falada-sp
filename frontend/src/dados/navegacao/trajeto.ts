// Trajeto da navegação guiada (spec 6.1 e 7.1): a rota vira uma linha medida em metros,
// com o intervalo de cada passo, para encaixar a posição e saber em que passo a pessoa está.
import type { RotaOut } from '../../api/client'
import { linhaDoGeoJson, type PontoLatLng } from '../rotaGeo'
import { criarRegua, distancia, projetarNoSegmento, type Regua } from './regua'

export type TrechoDoPasso = { indice: number; ordem: number; inicioM: number; fimM: number }
export type Trajeto = {
  regua: Regua
  /** Sem pontos repetidos seguidos; pelo menos 2. */
  pontos: PontoLatLng[]
  /** Mesmo tamanho de pontos; acumuladoM[0] = 0. */
  acumuladoM: number[]
  totalM: number
  /** Mesmo tamanho e ordem de rota.passos. */
  passos: TrechoDoPasso[]
}
export type Encaixe = { progressoM: number; lateralM: number; ponto: PontoLatLng }

type RotaParaTrajeto = Pick<RotaOut, 'passos' | 'geometria'>

/** Ponto mais perto que isso do anterior é o mesmo ponto. */
const PONTO_REPETIDO_M = 0.01
/** Início de linha mais perto que isso do fim acumulado não se repete; mais longe, vira segmento reto. */
const JUNCAO_COLADA_M = 0.5
/** Trajeto mais curto que isso não serve para navegar. */
const TOTAL_MINIMO_M = 1
/** Diferença lateral até isso é empate. */
const EMPATE_M = 1e-6

function reguaDaMedia(pontos: PontoLatLng[]): Regua {
  return criarRegua(pontos.reduce((soma, p) => soma + p[0], 0) / pontos.length)
}

function acumular(regua: Regua, pontos: PontoLatLng[]): number[] {
  const acumulado = [0]
  for (let i = 1; i < pontos.length; i++) acumulado.push(acumulado[i - 1] + distancia(regua, pontos[i - 1], pontos[i]))
  return acumulado
}

function semRepetidos(regua: Regua, linha: PontoLatLng[]): PontoLatLng[] {
  const pontos: PontoLatLng[] = []
  for (const p of linha) {
    if (pontos.length === 0 || distancia(regua, pontos[pontos.length - 1], p) >= PONTO_REPETIDO_M) pontos.push(p)
  }
  return pontos
}

/** Junta as linhas dos passos; cada passo guarda o índice do ponto onde começa e onde termina. */
function juntarLinhasDosPassos(
  linhas: (PontoLatLng[] | null)[],
  regua: Regua,
): { pontos: PontoLatLng[]; indices: [number, number][] } {
  const pontos: PontoLatLng[] = []
  const indices: [number, number][] = []
  for (const bruta of linhas) {
    const linha = bruta ? semRepetidos(regua, bruta) : null
    const ultimo = Math.max(0, pontos.length - 1)
    // geometria inválida ou de comprimento zero: intervalo zero onde o trajeto está
    if (!linha || linha.length < 2) {
      indices.push([ultimo, ultimo])
      continue
    }
    linha.forEach((p, j) => {
      if (pontos.length === 0) {
        pontos.push(p)
        return
      }
      const d = distancia(regua, pontos[pontos.length - 1], p)
      if (j === 0 ? d >= JUNCAO_COLADA_M : d >= PONTO_REPETIDO_M) pontos.push(p)
    })
    indices.push([ultimo, Math.max(0, pontos.length - 1)])
  }
  return { pontos, indices }
}

function medir(pontos: PontoLatLng[]): { regua: Regua; acumuladoM: number[]; totalM: number } | null {
  if (pontos.length < 2) return null
  const regua = reguaDaMedia(pontos)
  const acumuladoM = acumular(regua, pontos)
  const totalM = acumuladoM[acumuladoM.length - 1]
  return totalM < TOTAL_MINIMO_M ? null : { regua, acumuladoM, totalM }
}

function pelosPassos(rota: RotaParaTrajeto): Trajeto | null {
  const linhas = rota.passos.map((p) => linhaDoGeoJson(p.geometria))
  const todos = linhas.flatMap((l) => l ?? [])
  if (todos.length < 2) return null
  const { pontos, indices } = juntarLinhasDosPassos(linhas, reguaDaMedia(todos))
  const medida = medir(pontos)
  if (!medida) return null
  const { acumuladoM } = medida
  const passos = rota.passos.map((p, indice) => ({
    indice,
    ordem: p.ordem,
    inicioM: acumuladoM[indices[indice][0]],
    fimM: acumuladoM[indices[indice][1]],
  }))
  return { ...medida, pontos, passos }
}

/** Sem linha utilizável nos passos: reparte a geometria total na proporção de distancia_m. */
function pelaGeometriaTotal(rota: RotaParaTrajeto): Trajeto | null {
  const linha = linhaDoGeoJson(rota.geometria)
  if (!linha) return null
  const pontos = semRepetidos(reguaDaMedia(linha), linha)
  const medida = medir(pontos)
  if (!medida) return null
  const { totalM } = medida
  const pesos = rota.passos.map((p) => Math.max(0, p.distancia_m))
  const soma = pesos.reduce((s, x) => s + x, 0)
  const partes = soma > 0 ? pesos.map((x) => (x / soma) * totalM) : pesos.map(() => totalM / rota.passos.length)
  let inicioM = 0
  const passos = rota.passos.map((p, indice) => {
    const fimM = indice === rota.passos.length - 1 ? totalM : Math.min(totalM, inicioM + partes[indice])
    const trecho = { indice, ordem: p.ordem, inicioM, fimM }
    inicioM = fimM
    return trecho
  })
  return { ...medida, pontos, passos }
}

export function montarTrajeto(rota: RotaParaTrajeto): Trajeto | null {
  return pelosPassos(rota) ?? pelaGeometriaTotal(rota)
}

function prender(x: number, de: number, ate: number): number {
  return Math.min(ate, Math.max(de, x))
}

/** Índice i do segmento [i, i+1] que contém o progresso m (já preso ao trajeto). */
function segmentoEm(t: Trajeto, m: number): number {
  let baixo = 0
  let alto = t.pontos.length - 2
  while (baixo < alto) {
    const meio = (baixo + alto + 1) >> 1
    if (t.acumuladoM[meio] <= m) baixo = meio
    else alto = meio - 1
  }
  return baixo
}

/** O ponto a m metros do início, com m preso a [0, totalM]. */
export function pontoAoLongo(t: Trajeto, m: number): PontoLatLng {
  const preso = prender(m, 0, t.totalM)
  const i = segmentoEm(t, preso)
  const a = t.pontos[i]
  const b = t.pontos[i + 1]
  const tamanho = t.acumuladoM[i + 1] - t.acumuladoM[i]
  const f = tamanho === 0 ? 0 : (preso - t.acumuladoM[i]) / tamanho
  if (f <= 0) return [a[0], a[1]]
  if (f >= 1) return [b[0], b[1]]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
}

/** O mais perto de cada segmento que cruza a janela, e se ele caiu na ponta de início ou de fim do pedaço. */
type Candidato = Encaixe & { naPontaInicial: boolean; naPontaFinal: boolean }

function candidatos(t: Trajeto, p: PontoLatLng, deM: number, ateM: number): Candidato[] | null {
  const de = prender(deM, 0, t.totalM)
  const ate = prender(ateM, 0, t.totalM)
  if (deM > ateM || de > ate) return null
  const lista: Candidato[] = []
  for (let i = 0; i < t.pontos.length - 1; i++) {
    const inicio = t.acumuladoM[i]
    const fim = t.acumuladoM[i + 1]
    if (fim < de || inicio > ate) continue
    const projecao = projetarNoSegmento(t.regua, p, t.pontos[i], t.pontos[i + 1])
    const progresso = inicio + projecao.t * (fim - inicio)
    // o pedaço do segmento que está dentro da janela
    const pedacoDe = Math.max(inicio, de)
    const pedacoAte = Math.min(fim, ate)
    const preso = prender(progresso, pedacoDe, pedacoAte)
    const naPontaInicial = preso <= pedacoDe
    const naPontaFinal = preso >= pedacoAte
    if (preso === progresso && projecao.t > 0 && projecao.t < 1) {
      lista.push({ progressoM: progresso, lateralM: projecao.distanciaM, ponto: projecao.ponto, naPontaInicial, naPontaFinal })
    } else {
      const ponto = pontoAoLongo(t, preso)
      lista.push({ progressoM: preso, lateralM: distancia(t.regua, p, ponto), ponto, naPontaInicial, naPontaFinal })
    }
  }
  return lista
}

function semMarcas(c: Candidato): Encaixe {
  return { progressoM: c.progressoM, lateralM: c.lateralM, ponto: c.ponto }
}

function menorLateral(lista: Candidato[]): Candidato | null {
  let melhor: Candidato | null = null
  for (const c of lista) {
    const empate = melhor !== null && Math.abs(c.lateralM - melhor.lateralM) <= EMPATE_M
    if (melhor === null || (empate ? c.progressoM < melhor.progressoM : c.lateralM < melhor.lateralM)) melhor = c
  }
  return melhor
}

/**
 * Encaixa a posição no trajeto olhando só a janela [deM, ateM], presa a [0, totalM].
 * Fica com a menor distância lateral; no empate, com o menor progresso. Raio e limiares são de quem chama.
 */
export function encaixar(t: Trajeto, p: PontoLatLng, deM: number, ateM: number): Encaixe | null {
  const lista = candidatos(t, p, deM, ateM)
  if (!lista) return null
  const melhor = menorLateral(lista)
  return melhor && semMarcas(melhor)
}

/**
 * Encaixe para quando não se sabe onde a pessoa está na rota (primeira leitura, retomada, volta
 * para a rota): entre os ramos da rota a até `limiarM` da posição, fica com o de MENOR progresso.
 *
 * Um ramo é um mínimo local da distância lateral ao longo da rota. A ponta presa de um segmento
 * só é ramo quando o segmento vizinho também tem o mais perto na mesma ponta (uma quina);
 * senão o vizinho tem um ponto mais perto e a ponta não conta. Assim, numa rota que volta sobre
 * si (atravessa a rua e volta pela outra calçada), o GPS puxado para a perna de volta não faz a
 * navegação pular para o fim. Sem nenhum ramo abaixo do limiar, fica com a menor distância lateral.
 */
export function encaixarNoPrimeiroRamo(t: Trajeto, p: PontoLatLng, deM: number, ateM: number, limiarM: number): Encaixe | null {
  const lista = candidatos(t, p, deM, ateM)
  if (!lista) return null
  const ramos = lista.filter((c, k) => {
    if (c.naPontaFinal && !c.naPontaInicial && k < lista.length - 1 && !lista[k + 1].naPontaInicial) return false
    if (c.naPontaInicial && !c.naPontaFinal && k > 0 && !lista[k - 1].naPontaFinal) return false
    return true
  })
  let primeiro: Candidato | null = null
  for (const c of ramos) {
    if (c.lateralM <= limiarM && (primeiro === null || c.progressoM < primeiro.progressoM)) primeiro = c
  }
  const escolhido = primeiro ?? menorLateral(lista)
  return escolhido && semMarcas(escolhido)
}

/**
 * Quantos metros a pessoa está para trás do ponto de partida, medidos no sentido do primeiro
 * segmento (0 se está à frente ou ao lado). Antes do início, a projeção na rota fica presa no
 * ponto de partida; sem isto, quem anda no sentido errado logo no começo nunca recuaria.
 */
export function antesDoInicioM(t: Trajeto, p: PontoLatLng): number {
  const a = t.pontos[0]
  const b = t.pontos[1]
  const leste = (b[1] - a[1]) * t.regua.kx
  const norte = (b[0] - a[0]) * t.regua.ky
  const tamanho = Math.hypot(leste, norte)
  if (tamanho === 0) return 0
  const ao = ((p[1] - a[1]) * t.regua.kx * leste + (p[0] - a[0]) * t.regua.ky * norte) / tamanho
  return ao < 0 ? -ao : 0
}

/** Índice do passo em que está o progresso; passos de comprimento zero são pulados. */
export function passoEm(t: Trajeto, progressoM: number): number {
  let achado = 0
  t.passos.forEach((trecho, i) => {
    if (trecho.fimM - trecho.inicioM <= 0) return
    if (progressoM >= t.totalM || trecho.inicioM <= progressoM) achado = i
  })
  return achado
}

/** fimM − inicioM de cada passo. */
export function comprimentosDosPassos(t: Trajeto): number[] {
  return t.passos.map((trecho) => trecho.fimM - trecho.inicioM)
}

/** Distância em linha reta até o último ponto do trajeto. */
export function distanciaAoFim(t: Trajeto, p: PontoLatLng): number {
  return distancia(t.regua, p, t.pontos[t.pontos.length - 1])
}

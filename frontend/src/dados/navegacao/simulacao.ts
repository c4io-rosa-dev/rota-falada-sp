/**
 * Simulação determinística de caminhada para o modo demonstração e os testes.
 *
 * Ideia do simulador do Ferrostar (BSD-3), reescrita; corrige a longitude por cos(lat).
 * Sem Math.random: o ruído vem de mulberry32 com semente. Nada é gravado: o módulo só
 * devolve arrays em memória.
 */
import { distanciaM, type PontoLatLng } from '../rotaGeo'

export type LeituraSimulada = { lat: number; lon: number; precisaoM: number; tMs: number }
export type OpcoesSimulacao = {
  velocidadeMps?: number
  intervaloMs?: number
  ruidoM?: number
  precisaoM?: number
  semente?: number
  inicioMs?: number
}

export const PADRAO_SIMULACAO = { velocidadeMps: 0.9, intervaloMs: 1000, ruidoM: 3, precisaoM: 8, semente: 1, inicioMs: 0 }

export type Cenario =
  | 'reto'
  | 'desvio-lateral-25m'
  | 'volta-a-rota'
  | 'precisao-ruim-40m'
  | 'parado-no-cruzamento'
  | 'sentido-contrario'
  | 'aba-oculta-no-meio'

export const CENARIOS: readonly Cenario[] = [
  'reto',
  'desvio-lateral-25m',
  'volta-a-rota',
  'precisao-ruim-40m',
  'parado-no-cruzamento',
  'sentido-contrario',
  'aba-oculta-no-meio',
]

export function ehCenario(valor: string | null): valor is Cenario {
  return valor !== null && (CENARIOS as readonly string[]).includes(valor)
}

/** PRNG mulberry32 (algoritmo de domínio público). Devolve números em [0, 1). */
export function mulberry32(semente: number): () => number {
  let a = semente >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const KY = (6_371_000 * Math.PI) / 180
const kxEm = (lat: number) => KY * Math.cos((lat * Math.PI) / 180)

type Opcoes = typeof PADRAO_SIMULACAO

/** Um ponto a gerar: distância ao longo da linha, deslocamento à direita, ruído e precisão. */
type Amostra = { d: number; direitaM: number; ruidoM: number; precisaoM: number; saltoMs?: number; repete?: boolean }

type Percurso = { linha: PontoLatLng[]; acumulado: number[]; total: number }

function percurso(linha: PontoLatLng[]): Percurso {
  const acumulado = [0]
  for (let i = 1; i < linha.length; i++) acumulado.push(acumulado[i - 1] + distanciaM(linha[i - 1], linha[i]))
  return { linha, acumulado, total: acumulado[acumulado.length - 1] }
}

/** Posição a `d` metros do início, com `direitaM` metros à direita do sentido de marcha. */
function posicaoEm(p: Percurso, d: number, direitaM: number): PontoLatLng {
  const { linha, acumulado, total } = p
  const alvo = Math.min(total, Math.max(0, d))
  let i = 0
  while (i < linha.length - 2 && (acumulado[i + 1] < alvo || acumulado[i + 1] === acumulado[i])) i++
  const a = linha[i]
  const b = linha[i + 1] ?? a
  const comprimento = acumulado[i + 1] - acumulado[i]
  const f = comprimento > 0 ? Math.min(1, Math.max(0, (alvo - acumulado[i]) / comprimento)) : 0
  if (alvo >= total) return deslocar(linha[linha.length - 1], a, linha[linha.length - 1], direitaM)
  const base: PontoLatLng = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
  return deslocar(base, a, b, direitaM)
}

function deslocar(base: PontoLatLng, a: PontoLatLng, b: PontoLatLng, direitaM: number): PontoLatLng {
  if (direitaM === 0) return base
  const kx = kxEm(base[0])
  const leste = (b[1] - a[1]) * kx
  const norte = (b[0] - a[0]) * KY
  const n = Math.hypot(leste, norte)
  if (n === 0) return base
  // À direita de (leste, norte) é (norte, −leste).
  return [base[0] + ((-leste / n) * direitaM) / KY, base[1] + ((norte / n) * direitaM) / kx]
}

/** Distâncias de `de` até `ate` em passos de `passo`; a última é `ate` exata. */
function caminhar(de: number, ate: number, passo: number, incluirInicio: boolean): number[] {
  const ds = incluirInicio ? [de] : []
  const extensao = Math.abs(ate - de)
  if (extensao === 0 || passo <= 0) return ds
  const sinal = ate > de ? 1 : -1
  const n = Math.ceil(extensao / passo - 1e-9)
  for (let k = 1; k < n; k++) ds.push(de + sinal * k * passo)
  ds.push(ate)
  return ds
}

function montar(p: Percurso, amostras: Amostra[], o: Opcoes): LeituraSimulada[] {
  const sorteio = mulberry32(o.semente)
  const leituras: LeituraSimulada[] = []
  let t = o.inicioMs
  amostras.forEach((am, k) => {
    if (k > 0) t += o.intervaloMs + (am.saltoMs ?? 0)
    const anterior = leituras[leituras.length - 1]
    if (am.repete && anterior) {
      leituras.push({ ...anterior, tMs: t })
      return
    }
    const [lat, lon] = posicaoEm(p, am.d, am.direitaM)
    const norte = (sorteio() * 2 - 1) * am.ruidoM
    const leste = (sorteio() * 2 - 1) * am.ruidoM
    leituras.push({ lat: lat + norte / KY, lon: lon + leste / kxEm(lat), precisaoM: am.precisaoM, tMs: t })
  })
  return leituras
}

const opcoes = (op?: OpcoesSimulacao): Opcoes => ({ ...PADRAO_SIMULACAO, ...op })
const passoDe = (o: Opcoes) => (o.velocidadeMps * o.intervaloMs) / 1000

function trecho(de: number, ate: number, o: Opcoes, incluirInicio: boolean, extra: Partial<Amostra> = {}): Amostra[] {
  return caminhar(de, ate, passoDe(o), incluirInicio).map((d) => ({
    d,
    direitaM: 0,
    ruidoM: o.ruidoM,
    precisaoM: o.precisaoM,
    ...extra,
  }))
}

export function gerarLeituras(linha: PontoLatLng[], op?: OpcoesSimulacao): LeituraSimulada[] {
  if (linha.length === 0) return []
  const p = percurso(linha)
  const o = opcoes(op)
  return montar(p, trecho(0, p.total, o, true), o)
}

export function leiturasDoCenario(nome: Cenario, linha: PontoLatLng[], op?: OpcoesSimulacao): LeituraSimulada[] {
  if (linha.length === 0) return []
  const p = percurso(linha)
  const o = opcoes(op)
  const L = p.total
  const meio = 0.5 * L
  let amostras: Amostra[]
  switch (nome) {
    case 'reto':
      amostras = trecho(0, L, o, true)
      break
    case 'precisao-ruim-40m':
      amostras = trecho(0, L, { ...o, ruidoM: 0, precisaoM: 40 }, true)
      break
    case 'desvio-lateral-25m':
    case 'volta-a-rota':
      amostras = [
        ...trecho(0, 0.4 * L, o, true),
        ...trecho(0.4 * L, 0.6 * L, o, false, { direitaM: 25, ruidoM: 0 }),
        ...(nome === 'volta-a-rota' ? trecho(0.6 * L, L, o, false) : []),
      ]
      break
    case 'parado-no-cruzamento': {
      const parado: Amostra[] = Array.from({ length: 20 }, () => ({ d: meio, direitaM: 0, ruidoM: 0, precisaoM: o.precisaoM, repete: true }))
      amostras = [...trecho(0, meio, o, true), ...parado, ...trecho(meio, L, o, false)]
      break
    }
    case 'sentido-contrario':
      amostras = [...trecho(0, meio, o, true), ...trecho(meio, Math.max(0, meio - 40), o, false)]
      break
    case 'aba-oculta-no-meio': {
      const resto = trecho(meio, L, o, false)
      if (resto.length > 0) resto[0] = { ...resto[0], saltoMs: 30_000 }
      amostras = [...trecho(0, meio, o, true), ...resto]
      break
    }
  }
  return montar(p, amostras, o)
}

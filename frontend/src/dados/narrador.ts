import type { RotaOut } from '../api/client'
import { rotuloCategoria } from './categorias'
import { textoInstrucao, type BarreiraResumo, type Passo } from './passo'

/**
 * O narrador da rota: o que avisar, em que ordem e com que palavras, para a tela e para a voz.
 *
 * Quem usa é, na maior parte, quem não pode errar o caminho: cadeirante, quem anda com apoio,
 * quem tem baixa visão. Então a fala é objetiva e vai do mais grave ao menos grave: primeiro o que
 * pode impedir a passagem (degrau, guia sem rebaixamento), depois o que cansa ou exige ajuda
 * (inclinação acima do pedido, calçada estreita, barreira), e por último o que não sabemos.
 * O que está dentro do pedido não é dito, para a fala não esconder o importante; a falta de
 * medida é dita, porque silêncio pareceria "está tudo bem". Determinístico: só dados da rota.
 */

export type Exigencia = 3 | 6 | 10 | 'any'

/** O mesmo valor que o formulário pede ao backend (pages/rotaEstado.ts). */
export const LARGURA_MINIMA_M = 0.9
/** NBR 9050: inclinação máxima de rampa. Vale como referência quando a pessoa não pôs limite. */
export const INCLINACAO_NORMA_PCT = 8.33
/** Acima disso, a lista de passos cansa mais do que ajuda: conta e aponta só o pior. */
const MAX_PASSOS_LISTADOS = 5

type TipoAlerta = 'degrau' | 'guia' | 'inclinacao' | 'largura' | 'barreira' | 'exigencia' | 'sem_dados' | 'reserva'

export type Alerta = {
  tipo: TipoAlerta
  /** Pode impedir a passagem ou exigir ajuda. */
  grave: boolean
  /** Texto da tela. */
  texto: string
  /** O mesmo aviso para a voz: números em palavras, sem símbolos. */
  fala: string
  /** Passos citados, para a tela virar link. */
  passos: number[]
}

export type Fala = { ordem: number | null; texto: string }

const virgula = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

/** "no passo 5", "nos passos 5 e 10", "nos passos 1, 2 e 3". */
export function ondeNosPassos(ordens: number[]): string {
  if (ordens.length === 1) return `no passo ${ordens[0]}`
  return `nos passos ${ordens.slice(0, -1).join(', ')} e ${ordens[ordens.length - 1]}`
}

/** Para a voz: abaixo de 10 uma casa (6,19 vira 6,2, sem esconder que passou de 6); acima, inteiro. */
export function numeroFalado(valor: number): string {
  const arredondado = valor >= 10 ? Math.round(valor) : Math.round(valor * 10) / 10
  return virgula.format(arredondado)
}

function metrosFalados(metros: number): string {
  if (metros >= 1000) {
    const km = Math.round(metros / 100) / 10
    return `${virgula.format(km)} ${km < 2 ? 'quilômetro' : 'quilômetros'}`
  }
  const m = metros < 10 ? Math.max(1, Math.round(metros)) : Math.round(metros / 5) * 5
  return `${m} ${m === 1 ? 'metro' : 'metros'}`
}

function limite(pedido: Exigencia): number {
  return pedido === 'any' ? INCLINACAO_NORMA_PCT : pedido
}

function acimaDoLimite(p: Passo, pedido: Exigencia): boolean {
  return p.declividade_pct !== null && p.declividade_pct > limite(pedido)
}

function estreita(p: Passo): boolean {
  return p.largura_medida && p.largura_m !== null && p.largura_m < LARGURA_MINIMA_M
}

/** Largura ou inclinação desconhecida: para quem usa cadeira, as duas importam. */
function semMedida(p: Passo): boolean {
  return p.largura_m === null || p.declividade_pct === null
}

function faltaFalada(p: Passo): string | null {
  if (p.largura_m === null && p.declividade_pct === null) return 'Sem medida da calçada neste trecho.'
  if (p.largura_m === null) return 'Sem medida da largura da calçada neste trecho.'
  if (p.declividade_pct === null) return 'Sem medida da inclinação neste trecho.'
  return null
}

function minuscula(texto: string): string {
  return texto.charAt(0).toLowerCase() + texto.slice(1)
}

/** Lista curta: todos os passos; longa: "em 23 de 29 passos". */
function onde(ordens: number[], total: number): string {
  return ordens.length > MAX_PASSOS_LISTADOS ? `em ${ordens.length} de ${total} passos` : ondeNosPassos(ordens)
}

function alertaDeInclinacao(passos: Passo[], pedido: Exigencia): Alerta | null {
  const acima = passos.filter((p) => acimaDoLimite(p, pedido))
  if (acima.length === 0) return null
  const pior = acima.reduce((a, b) => ((b.declividade_pct ?? 0) > (a.declividade_pct ?? 0) ? b : a))
  const maior = pior.declividade_pct ?? 0
  const muitos = acima.length > MAX_PASSOS_LISTADOS
  const regra = pedido === 'any' ? `Inclinação acima de ${virgula.format(INCLINACAO_NORMA_PCT)}%, o máximo da norma para rampas,` : `Inclinação acima do pedido (até ${pedido}%)`
  const regraFalada =
    pedido === 'any' ? `inclinação acima de ${numeroFalado(INCLINACAO_NORMA_PCT)} por cento, o máximo da norma para rampas,` : `inclinação acima do pedido`
  const ordens = acima.map((p) => p.ordem)
  const lugar = onde(ordens, passos.length)
  const maiorTexto = muitos ? `A maior é de ${virgula.format(maior)}%, no passo ${pior.ordem}.` : `A maior é de ${virgula.format(maior)}%.`
  const maiorFala = muitos ? `a maior, de ${numeroFalado(maior)} por cento, no passo ${pior.ordem}` : `até ${numeroFalado(maior)} por cento`
  return {
    tipo: 'inclinacao',
    grave: true,
    texto: `${regra} ${lugar}. ${maiorTexto} Pode ser preciso ajuda.`,
    fala: `${regraFalada} ${lugar}, ${maiorFala}`,
    passos: muitos ? [pior.ordem] : ordens,
  }
}

function alertaDeLargura(passos: Passo[]): Alerta | null {
  const estreitos = passos.filter(estreita)
  if (estreitos.length === 0) return null
  const menor = Math.min(...estreitos.map((p) => p.largura_m ?? 0))
  const lugar = onde(
    estreitos.map((p) => p.ordem),
    passos.length,
  )
  const minimo = virgula.format(LARGURA_MINIMA_M)
  return {
    tipo: 'largura',
    grave: true,
    texto: `Calçada mais estreita que ${minimo} m ${lugar}. A mais estreita tem ${virgula.format(menor)} m.`,
    fala: `calçada estreita ${lugar}, a mais estreita com ${numeroFalado(menor)} metro`,
    passos: estreitos.length > MAX_PASSOS_LISTADOS ? [estreitos.find((p) => p.largura_m === menor)!.ordem] : estreitos.map((p) => p.ordem),
  }
}

function alertaSimples(tipo: 'degrau' | 'guia', passos: Passo[], filtro: (p: Passo) => boolean, nome: string): Alerta | null {
  const ordens = passos.filter(filtro).map((p) => p.ordem)
  if (ordens.length === 0) return null
  const lugar = onde(ordens, passos.length)
  return { tipo, grave: true, texto: `${nome} ${lugar}.`, fala: `${minuscula(nome)} ${lugar}`, passos: ordens.slice(0, MAX_PASSOS_LISTADOS) }
}

function alertasDeBarreira(passos: Passo[]): Alerta[] {
  const vistas = new Set<string>()
  const alertas: Alerta[] = []
  for (const p of passos) {
    for (const b of p.barreiras_proximas) {
      const chave = `${b.origem}:${b.id}`
      if (vistas.has(chave)) continue
      vistas.add(chave)
      alertas.push(alertaDeBarreira(b, p.ordem))
    }
  }
  return alertas
}

function alertaDeBarreira(b: BarreiraResumo, ordem: number): Alerta {
  const nome = rotuloCategoria(b.categoria)
  const metros = Math.round(b.distancia_m)
  return {
    tipo: 'barreira',
    grave: true,
    texto: `${nome} a ${metros} m, perto do passo ${ordem}. Dificulta a passagem, não bloqueia.`,
    fala: `${minuscula(nome)} perto do passo ${ordem}`,
    passos: [ordem],
  }
}

function alertaDeExigencia(rota: Pick<RotaOut, 'nivel_exigencia_atendido'>, pedido: Exigencia): Alerta | null {
  const atendido = rota.nivel_exigencia_atendido
  if (pedido === 'any' || atendido === pedido) return null
  const texto =
    atendido === 'any'
      ? `Não conseguimos confirmar que a rota fica dentro do pedido (até ${pedido}%) em todos os trechos.`
      : `Só encontramos rota com inclinação de até ${atendido}%, acima do pedido (até ${pedido}%).`
  const fala =
    atendido === 'any'
      ? `não conseguimos confirmar a inclinação de todos os trechos`
      : `só encontramos rota com inclinação de até ${atendido} por cento`
  return { tipo: 'exigencia', grave: false, texto, fala, passos: [] }
}

/** Os avisos da rota, do mais grave ao menos grave, sem repetição. */
export function alertasDaRota(rota: Pick<RotaOut, 'passos' | 'motor' | 'nivel_exigencia_atendido'>, pedido: Exigencia): Alerta[] {
  const { passos } = rota
  const inclinacao = alertaDeInclinacao(passos, pedido)
  const alertas: (Alerta | null)[] = [
    alertaSimples('degrau', passos, (p) => p.is_degrau, 'Degrau'),
    alertaSimples('guia', passos, (p) => p.guia === 'nao_transponivel', 'Guia sem rebaixamento'),
    inclinacao,
    alertaDeLargura(passos),
    ...alertasDeBarreira(passos),
    // a inclinação acima do pedido, ou a rota de reserva, já explica por que o pedido não foi atendido
    inclinacao || rota.motor === 'pgrouting' ? null : alertaDeExigencia(rota, pedido),
  ]
  const semDado = passos.filter(semMedida).map((p) => p.ordem)
  if (semDado.length > 0) {
    const lugar = onde(semDado, passos.length)
    alertas.push({
      tipo: 'sem_dados',
      grave: false,
      texto: `Sem medida completa da calçada (largura ou inclinação) ${lugar}.`,
      fala: `sem medida da calçada ${lugar}`,
      passos: semDado.slice(0, MAX_PASSOS_LISTADOS),
    })
  }
  if (rota.motor === 'pgrouting') {
    alertas.push({
      tipo: 'reserva',
      grave: false,
      texto: 'Rota calculada pelo roteamento de reserva, que não mede a inclinação. Confira cada passo.',
      fala: 'rota calculada pelo roteamento de reserva, que não mede a inclinação',
      passos: [],
    })
  }
  return alertas.filter((a): a is Alerta => a !== null)
}

/** A linha "Exigência" da ficha, em palavras. */
export function textoExigenciaDaRota(rota: Pick<RotaOut, 'passos' | 'nivel_exigencia_atendido'>, pedido: Exigencia): string {
  if (pedido === 'any') return 'Qualquer inclinação, como pedido.'
  if (rota.nivel_exigencia_atendido === pedido) return `Até ${pedido}%, como pedido.`
  const acima = rota.passos.filter((p) => acimaDoLimite(p, pedido)).length
  if (acima > 0) return `Pedido: até ${pedido}%. A rota passa disso em ${acima} ${acima === 1 ? 'passo' : 'passos'}.`
  if (rota.nivel_exigencia_atendido !== 'any') return `Pedido: até ${pedido}%. A rota encontrada vai até ${rota.nivel_exigencia_atendido}%.`
  return `Pedido: até ${pedido}%. Não conseguimos confirmar a inclinação de todos os trechos.`
}

/** Um passo para a voz: ação, distância e só o que importa, do mais grave ao menos grave. */
export function falaDoPasso(p: Passo, total: number, pedido: Exigencia): string {
  const partes = [`Passo ${p.ordem} de ${total}.`, `${textoInstrucao(p)}.`, `${metrosFalados(p.distancia_m)}.`]
  if (p.is_degrau) partes.push('Atenção: degrau.')
  if (p.guia === 'nao_transponivel') partes.push('Guia sem rebaixamento.')
  if (acimaDoLimite(p, pedido) && p.declividade_pct !== null) {
    const valor = numeroFalado(p.declividade_pct)
    const qual = pedido === 'any' ? 'acima da norma para rampas' : 'acima do pedido'
    partes.push(p.declividade_medida ? `Inclinação de ${valor} por cento, ${qual}.` : `Inclinação estimada de ${valor} por cento, ${qual}.`)
  }
  if (estreita(p) && p.largura_m !== null) partes.push(`Calçada estreita, ${numeroFalado(p.largura_m)} metro.`)
  for (const b of p.barreiras_proximas) partes.push(`${rotuloCategoria(b.categoria)} a ${metrosFalados(b.distancia_m)}.`)
  const falta = faltaFalada(p)
  if (falta) partes.push(falta)
  return partes.join(' ')
}

/** A rota inteira para a voz: o resumo com os avisos, cada passo, e a chegada. */
export function falasDaRota(rota: Pick<RotaOut, 'passos' | 'motor' | 'nivel_exigencia_atendido' | 'distancia_m' | 'duracao_s'>, pedido: Exigencia): Fala[] {
  const total = rota.passos.length
  const minutos = Math.max(1, Math.round(rota.duracao_s / 60))
  const alertas = alertasDaRota(rota, pedido)
  const avisos =
    alertas.length === 0
      ? 'Sem avisos.'
      : `${alertas.length === 1 ? 'Um aviso' : `${alertas.length} avisos`}: ${alertas.map((a) => a.fala).join('; ')}.`
  const resumo = `Rota de ${metrosFalados(rota.distancia_m)}, cerca de ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}, em ${total} ${total === 1 ? 'passo' : 'passos'}. ${avisos} Agora, os passos.`
  const passos = rota.passos.map((p, i) => ({
    ordem: p.ordem,
    texto: i === total - 1 ? `${falaDoPasso(p, total, pedido)} Você chegou ao destino.` : falaDoPasso(p, total, pedido),
  }))
  return [{ ordem: null, texto: resumo }, ...passos]
}

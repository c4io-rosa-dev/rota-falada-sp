import type { components } from '../api/types.gen'

export type Passo = components['schemas']['Passo']
export type Guia = Passo['guia']

const SEM_DADO = 'sem dado'
const SEPARADOR_RUA = ' em direção a '

const umaCasa = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const ateDuasCasas = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

/** "Vire à direita em direção a Rua X" → { acao: "Vire à direita", rua: "Rua X" }. */
export function separarInstrucao(instrucao: string): { acao: string; rua: string | null } {
  const i = instrucao.indexOf(SEPARADOR_RUA)
  if (i < 0) return { acao: instrucao, rua: null }
  return { acao: instrucao.slice(0, i), rua: instrucao.slice(i + SEPARADOR_RUA.length) }
}

/** O nome gravado no vão: a rua quando a instrução a traz, senão a própria instrução. */
export function letreiroDoPasso(passo: Passo): string {
  return separarInstrucao(passo.instrucao).rua ?? passo.instrucao
}

export function formatarDistancia(metros: number): string {
  return `${umaCasa.format(metros)} m`
}

export function textoLargura(passo: Passo): string {
  return passo.largura_m === null ? SEM_DADO : `${ateDuasCasas.format(passo.largura_m)} m`
}

export function textoDeclividade(passo: Passo): string {
  return passo.declividade_pct === null ? SEM_DADO : `${ateDuasCasas.format(passo.declividade_pct)}%`
}

export function textoGuia(guia: Guia): string {
  if (guia === 'transponivel') return 'rebaixada'
  if (guia === 'nao_transponivel') return 'não rebaixada'
  return SEM_DADO
}

export function textoDegrau(degrau: boolean): string {
  return degrau ? 'com degrau' : 'sem degrau'
}

const FONTES: Record<string, string> = {
  osm: 'OpenStreetMap',
  geosampa: 'GeoSampa',
  sp156: 'SP156',
  sptrans: 'SPTrans',
  ors: 'openrouteservice',
}

export function nomeFonte(chave: string): string {
  return FONTES[chave] ?? chave
}

/** ISO "2026-10-12" → "12/10/2026", sem passar por Date (evita deslocamento de fuso). */
export function formatarData(iso: string | null): string {
  if (!iso) return SEM_DADO
  const [ano, mes, dia] = iso.slice(0, 10).split('-')
  return `${dia}/${mes}/${ano}`
}

function metros(valor: number): string {
  return `${ateDuasCasas.format(valor)} ${valor < 2 ? 'metro' : 'metros'}`
}

/** Texto lido pela síntese de voz. Determinístico: só dados do passo. */
export function textoFalado(passo: Passo): string {
  const partes = [
    `Passo ${passo.ordem}.`,
    `${passo.instrucao}.`,
    `${metros(passo.distancia_m)}.`,
    `Largura da calçada: ${passo.largura_m === null ? SEM_DADO : metros(passo.largura_m)}.`,
    `Declividade: ${passo.declividade_pct === null ? SEM_DADO : `${ateDuasCasas.format(passo.declividade_pct)} por cento`}.`,
    `Guia ${textoGuia(passo.guia)}.`,
  ]
  if (passo.is_degrau) partes.push('Atenção: degrau.')
  return partes.join(' ')
}

import type { components } from '../api/types.gen'
import { rotuloCategoria } from './categorias'

export type Passo = components['schemas']['Passo']
export type Guia = Passo['guia']
export type BarreiraResumo = components['schemas']['BarreiraResumo']
type RotaOut = components['schemas']['RotaOut']

const SEM_DADO = 'sem dado'
const SEPARADOR_RUA = ' em direção a '
// formato do fallback pgRouting (services/pgrouting.py): "Siga por X", "Vire à direita e siga por X"
const SEPARADOR_PGROUTING = ' e siga por '
const PREFIXO_PGROUTING = 'Siga por '
const VIA_SEM_NOME = 'a via'

const umaCasa = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const ateDuasCasas = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

function ruaOuNula(rua: string): string | null {
  return rua === VIA_SEM_NOME ? null : rua
}

/** "Vire à direita em direção a Rua X" → { acao: "Vire à direita", rua: "Rua X" }. */
export function separarInstrucao(instrucao: string): { acao: string; rua: string | null } {
  let i = instrucao.indexOf(SEPARADOR_RUA)
  if (i >= 0) return { acao: instrucao.slice(0, i), rua: instrucao.slice(i + SEPARADOR_RUA.length) }
  i = instrucao.indexOf(SEPARADOR_PGROUTING)
  if (i >= 0) return { acao: instrucao.slice(0, i), rua: ruaOuNula(instrucao.slice(i + SEPARADOR_PGROUTING.length)) }
  if (instrucao.startsWith(PREFIXO_PGROUTING)) {
    return { acao: 'Siga', rua: ruaOuNula(instrucao.slice(PREFIXO_PGROUTING.length)) }
  }
  return { acao: instrucao, rua: null }
}

// "Siga para este" do ORS quer dizer leste, mas soa como "este aqui"; "por a via" é a rua sem nome do pgRouting
const AJUSTES_INSTRUCAO: [RegExp, string][] = [
  [/\bpara este\b/g, 'para leste'],
  [/ por a via\b/g, ' pela via sem nome'],
  // o ORS fala português de Portugal
  [/\brotunda\b/g, 'rotatória'],
]

/** A instrução vazia existe (services/rota.py); a lista nunca mostra um passo mudo. */
export function textoInstrucao(passo: Passo): string {
  const texto = passo.instrucao.trim()
  if (!texto) return 'Siga o trecho'
  return AJUSTES_INSTRUCAO.reduce((t, [de, para]) => t.replace(de, para), texto)
}

/** O nome gravado no vão: a rua quando a instrução a traz, senão a própria instrução. */
export function letreiroDoPasso(passo: Passo): string {
  return separarInstrucao(passo.instrucao).rua ?? textoInstrucao(passo)
}

/** Metro inteiro abaixo de 1 km; acima, km com uma casa. Precisão de centímetro não ajuda ninguém na rua. */
export function formatarDistancia(metros: number): string {
  return metros >= 1000 ? `${umaCasa.format(metros / 1000)} km` : `${Math.round(metros)} m`
}

export function textoDuracao(segundos: number): string {
  const minutos = Math.max(1, Math.round(segundos / 60))
  return `cerca de ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} a pé`
}

export function textoExigencia(nivel: RotaOut['nivel_exigencia_atendido']): string {
  return nivel === 'any' ? 'qualquer inclinação' : `até ${nivel}%`
}

export function textoMotor(motor: RotaOut['motor']): string {
  if (motor === 'ors') return 'openrouteservice.org by HeiGIT'
  if (motor === 'pgrouting') return 'roteamento local de reserva'
  return 'rota gravada para demonstração, não calculada agora'
}

const PIOR_VALOR = 'A largura e a inclinação de cada passo são o pior valor conhecido no trecho, nos dois lados da rua.'

/**
 * A frase fixa da ficha. Só diz o que o motor faz: o ORS e o pgRouting desviam das barreiras
 * confirmadas que bloqueiam; o pgRouting também evita as escadas da base de ruas.
 */
export function textoSobreARota(motor: RotaOut['motor']): string {
  if (motor === 'pgrouting') {
    return `Rota sugerida pelo roteamento local de reserva. Ela evita as escadas da base de ruas e as barreiras confirmadas que bloqueiam a passagem, e avisa das que só dificultam. Relatos ainda sem confirmação não mudam a rota, e não sabemos o que não foi registrado. ${PIOR_VALOR}`
  }
  if (motor === 'fixture') {
    return 'Rota gravada para demonstração. Ela não muda com as barreiras registradas, e não sabemos o que não foi registrado.'
  }
  return `Rota sugerida com os dados disponíveis. Ela evita as barreiras confirmadas que bloqueiam a passagem e avisa das que só dificultam. Relatos ainda sem confirmação não mudam a rota, e não sabemos o que não foi registrado. ${PIOR_VALOR}`
}

export function textoLargura(passo: Passo): string {
  return passo.largura_m === null || !passo.largura_medida ? SEM_DADO : `${ateDuasCasas.format(passo.largura_m)} m`
}

/** A medida vem do diagnóstico do GeoSampa e não é um limite máximo; a classe do ORS é só uma estimativa. */
export function textoDeclividade(passo: Passo): string {
  if (passo.declividade_pct === null) return SEM_DADO
  const valor = ateDuasCasas.format(passo.declividade_pct)
  return passo.declividade_medida ? `${valor}% (GeoSampa)` : `cerca de ${valor}% (estimativa)`
}

export function textoGuia(guia: Guia): string {
  if (guia === 'transponivel') return 'rebaixada'
  if (guia === 'nao_transponivel') return 'não rebaixada'
  return SEM_DADO
}

export function textoDegrau(degrau: boolean): string {
  return degrau ? 'com degrau' : 'sem degrau'
}

/**
 * Sem via OSM a até 10 m, o backend mantém `is_degrau: false` e devolve a data nula
 * (services/enriquecimento.py): ali "não" afirmaria o que o produto não sabe.
 */
export function textoDegrauDoPasso(passo: Passo): string {
  if (passo.is_degrau) return 'sim'
  return passo.data_referencia ? 'não' : SEM_DADO
}

const FONTES: Record<string, string> = {
  osm: 'OpenStreetMap',
  geosampa: 'GeoSampa',
  sp156: 'SP156',
  sptrans: 'SPTrans',
  ors: 'openrouteservice',
  colaborativo: 'colaboradores',
}

export function nomeFonte(chave: string): string {
  return FONTES[chave] ?? chave
}

/** A ficha não pode dizer menos que os passos: sem fontes na rota, vale o que cada passo declara. */
export function nomesDasFontes(rota: Pick<RotaOut, 'fontes' | 'passos'>): string {
  const chaves = rota.fontes.length > 0 ? rota.fontes : [...new Set(rota.passos.map((p) => p.fonte))]
  return chaves.length > 0 ? chaves.map(nomeFonte).join(', ') : 'sem fonte associada'
}

/** `fonte` é a da via; largura e declividade medidas só podem ter vindo do GeoSampa e a lista diz isso. */
export function textoFontePasso(passo: Passo): string {
  const base = nomeFonte(passo.fonte)
  if (passo.fonte === 'geosampa') return base
  if (passo.largura_medida && passo.declividade_medida) return `${base}; largura e declividade: GeoSampa`
  if (passo.largura_medida) return `${base}; largura: GeoSampa`
  return passo.declividade_medida ? `${base}; declividade: GeoSampa` : base
}

/** ISO "2026-10-12" → "12/10/2026", sem passar por Date (evita deslocamento de fuso). */
export function formatarData(iso: string | null): string {
  if (!iso) return SEM_DADO
  const [ano, mes, dia] = iso.slice(0, 10).split('-')
  return `${dia}/${mes}/${ano}`
}

/** A data do passo é a do trecho no OSM, mesmo quando a largura vem do GeoSampa. */
export function textoDataPasso(passo: Passo): string {
  const data = formatarData(passo.data_referencia)
  return passo.largura_medida && passo.data_referencia ? `${data} (trecho no OSM)` : data
}

/** "Buraco, a 12 m. Dificulta a passagem, não bloqueia a rota. 1 confirmação. Fonte: colaboradores, 03/11/2026." */
export function textoBarreira(b: BarreiraResumo): string {
  const partes = [`${rotuloCategoria(b.categoria)}, a ${Math.round(b.distancia_m)} m.`, 'Dificulta a passagem, não bloqueia a rota.']
  if (b.confirmacoes !== null) partes.push(`${b.confirmacoes} ${b.confirmacoes === 1 ? 'confirmação' : 'confirmações'}.`)
  const fonte = b.origem === 'colaborativa' ? 'colaboradores' : 'SP156'
  partes.push(`Fonte: ${fonte}, ${formatarData(b.data_referencia)}.`)
  return partes.join(' ')
}

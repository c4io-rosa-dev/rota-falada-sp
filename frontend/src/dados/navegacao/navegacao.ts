/**
 * O reducer da navegação guiada (spec 6.4 e 7.6): junta trajeto, acompanhamento e falas.
 *
 * Puro e determinístico: o tempo entra nos eventos, nada de Date.now() nem API do navegador.
 * Os efeitos (falar, ligar e parar sensores, recalcular, focar) saem como dados e quem executa
 * é a página. O estado guarda só a ÚLTIMA leitura, para mostrar e para recalcular; nunca uma
 * lista de posições.
 *
 * Janela de busca para trás curta (30 m) e saída do passo com 2 m de margem: ideias do Organic
 * Maps (Apache-2.0, nunca procura para trás) e do Ferrostar (BSD-3, saída encaixada de 2 m para
 * pedestre). Só a ideia e os números; nenhum código foi copiado.
 *
 * Rota que volta sobre si (atravessa a rua e volta pela outra calçada): a janela da frente nunca
 * passa do que a pessoa pode ter andado desde a leitura anterior, e quando não se sabe onde ela
 * está (procurando, retomando, fora da rota) fica-se com o primeiro ramo da rota perto dela, não
 * com o mais perto. Assim um erro de GPS de poucos metros não vira um salto para o fim.
 */
import type { RotaIn, RotaOut } from '../../api/client'
import { arredondar4, type LeituraPosicao } from '../localizacao'
import { falaDoPasso, type Exigencia } from '../narrador'
import {
  estadoInicial,
  leituraBoa,
  limiarDesvio,
  limiarVolta,
  registrarLeitura,
  registrarTempo,
  retomar,
  type EstadoAcompanhamento,
  type Medida,
  type Ocorrencia,
} from './acompanhamento'
import {
  FALAS_FIXAS,
  falaEntrada,
  falaErroRecalculo,
  falaInicio,
  falaLonge,
  falaNovaRota,
  falaProcuraDemorada,
  falaRepetir,
  falaSaiu,
  falaVoltou,
  marcoDevido,
  situacao,
  type Contexto,
  type FalaNavegacao,
} from './falasNavegacao'
import { distancia } from './regua'
import {
  antesDoInicioM,
  comprimentosDosPassos,
  distanciaAoFim,
  encaixar,
  encaixarNoPrimeiroRamo,
  montarTrajeto,
  passoEm,
  type Trajeto,
} from './trajeto'

export const NAVEGACAO = {
  JANELA_ATRAS_M: 30,
  JANELA_FRENTE_M: 150,
  MARGEM_AVANCO_M: 2,
  RECALCULO_PRECISAO_M: 30,
  RECALCULO_IDADE_MS: 10_000,
  RECALCULO_INTERVALO_MS: 10_000,
  /** Folga somada ao avanço plausível por leitura (deslocamento + precisões). */
  SALTO_MARGEM_M: 10,
  /** Procurando sem nenhuma leitura boa por este tempo: avisa uma vez e oferece o passo a passo. */
  PROCURA_PRAZO_MS: 20_000,
  /** Precisão acima disto é localização aproximada (iPhone sem "Localização Exata", Android com "aproximada"). */
  PRECISAO_APROXIMADA_M: 200,
} as const

export type Fase = 'preparo' | 'procurando' | 'navegando' | 'pausada' | 'chegou' | 'passo_a_passo' | 'sem_permissao' | 'indisponivel'

export type MotivoRecalculo = 'sem_rota' | 'fora_da_area' | 'falha'

export type EventoNavegacao =
  | { tipo: 'comecar'; agoraMs: number }
  | { tipo: 'leitura'; leitura: LeituraPosicao }
  | { tipo: 'erro_posicao'; codigo: number; agoraMs: number }
  | { tipo: 'tempo'; agoraMs: number }
  | { tipo: 'pausar' }
  | { tipo: 'continuar'; agoraMs: number }
  | { tipo: 'oculta' }
  | { tipo: 'visivel'; agoraMs: number }
  | { tipo: 'repetir' }
  | { tipo: 'pedir_recalculo'; agoraMs: number }
  | { tipo: 'rota_nova'; rota: RotaOut; agoraMs: number }
  | { tipo: 'recalculo_falhou'; motivo: MotivoRecalculo }
  | { tipo: 'passo_a_passo' }
  | { tipo: 'passo_anterior' }
  | { tipo: 'proximo_passo' }
  | { tipo: 'tentar_de_novo'; agoraMs: number }

export type Efeito =
  | { tipo: 'falar'; fala: FalaNavegacao }
  | { tipo: 'parar_sensores' }
  | { tipo: 'ligar_sensores' }
  | { tipo: 'recalcular'; pedido: RotaIn }
  | { tipo: 'focar'; alvo: 'painel' | 'chegada' | 'permissao' }

export type EstadoNavegacao = {
  fase: Fase
  /** Só com fase 'indisponivel'. */
  motivoIndisponivel: 'sem_desenho' | 'sem_localizacao' | null
  rota: RotaOut
  pedido: RotaIn
  simulacao: boolean
  trajeto: Trajeto | null
  contexto: Contexto
  /** Índice do passo atual em rota.passos. Só avança enquanto a rota é a mesma. */
  passoAtual: number
  /** Metros até o fim do passo atual. */
  faltaM: number
  /** Distância à linha na última leitura boa; Infinity sem encaixe. */
  lateralM: number
  acompanhamento: EstadoAcompanhamento
  /** Ids de fala já ditos uma vez (entradas e marcos). Só na memória; zera com rota nova. */
  falados: ReadonlySet<string>
  /** A última leitura, e só ela. */
  ultimaLeitura: LeituraPosicao | null
  /** Depois de pausa ou de aba oculta: janela ampla e a situação no primeiro reencaixe. */
  retomando: boolean
  /** A aba está oculta (pausa automática, sem fala). */
  oculta: boolean
  /** De onde a pessoa pausou, para voltar ao mesmo lugar. */
  faseAntesDaPausa: 'procurando' | 'navegando'
  recalculando: boolean
  ultimoRecalculoMs: number | null
  /** Quando começou a procura atual (Começar, Tentar de novo ou retomar procurando). */
  procurandoDesdeMs: number
  /** A procura passou do prazo e o aviso já foi dado (uma vez). */
  procuraDemorada: boolean
}

type Resultado = { estado: EstadoNavegacao; efeitos: Efeito[] }

function contextoDe(rota: RotaOut, pedido: RotaIn, trajeto: Trajeto | null): Contexto {
  return {
    passos: rota.passos,
    comprimentosM: trajeto ? comprimentosDosPassos(trajeto) : rota.passos.map((p) => p.distancia_m),
    pedido: pedido.perfil.inclinacao_max as Exigencia,
  }
}

export function estadoNavegacao(
  rota: RotaOut,
  pedido: RotaIn,
  op: { simulacao: boolean; localizacao?: boolean },
): EstadoNavegacao {
  const trajeto = montarTrajeto(rota)
  const semLocalizacao = !op.simulacao && op.localizacao === false
  const motivo = trajeto === null ? 'sem_desenho' : semLocalizacao ? 'sem_localizacao' : null
  return {
    fase: motivo ? 'indisponivel' : 'preparo',
    motivoIndisponivel: motivo,
    rota,
    pedido,
    simulacao: op.simulacao,
    trajeto,
    contexto: contextoDe(rota, pedido, trajeto),
    passoAtual: 0,
    faltaM: trajeto ? trajeto.passos[0]?.fimM ?? 0 : 0,
    lateralM: Infinity,
    acompanhamento: estadoInicial({ agoraMs: 0 }),
    falados: new Set(),
    ultimaLeitura: null,
    retomando: false,
    oculta: false,
    faseAntesDaPausa: 'procurando',
    recalculando: false,
    ultimoRecalculoMs: null,
    procurandoDesdeMs: 0,
    procuraDemorada: false,
  }
}

const falar = (fala: FalaNavegacao): Efeito => ({ tipo: 'falar', fala })

function instrucao(id: string, texto: string, urgente: boolean): FalaNavegacao {
  return { id, texto, urgente, tipo: 'instrucao' }
}

/** A fala do modo passo a passo: a mesma do "Ouvir a rota", e o último diz a chegada. */
function falaPassoAPasso(e: EstadoNavegacao, i: number): FalaNavegacao {
  const p = e.rota.passos[i]
  const total = e.rota.passos.length
  const base = falaDoPasso(p, total, e.contexto.pedido)
  return instrucao(`passo:${p.ordem}`, i === total - 1 ? `${base} Você chegou ao destino.` : base, true)
}

function ativa(e: EstadoNavegacao): boolean {
  return e.fase === 'procurando' || e.fase === 'navegando'
}

function sinalFraco(e: EstadoNavegacao): boolean {
  return e.acompanhamento.sinal !== 'bom'
}

/** Onde procurar a leitura na rota. `ramo` não nulo: não se sabe onde a pessoa está, fica o primeiro ramo até esse limiar. */
type Janela = { de: number; ate: number; ramo: number | null }

function janela(e: EstadoNavegacao, t: Trajeto, l: LeituraPosicao): Janela {
  const inicio = t.passos[e.passoAtual]?.inicioM ?? 0
  if (e.fase === 'procurando') return { de: 0, ate: t.totalM, ramo: limiarDesvio(l.precisaoM) }
  if (e.acompanhamento.fora) return { de: inicio, ate: t.totalM, ramo: limiarVolta(l.precisaoM) }
  if (e.retomando) return { de: inicio, ate: t.totalM, ramo: limiarDesvio(l.precisaoM) }
  const max = e.acompanhamento.progressoMaxM
  // nunca mais à frente do que a pessoa pode ter andado desde a leitura anterior
  const anterior = e.ultimaLeitura
  const plausivel = anterior
    ? distancia(t.regua, [anterior.lat, anterior.lon], [l.lat, l.lon]) + anterior.precisaoM + l.precisaoM + NAVEGACAO.SALTO_MARGEM_M
    : NAVEGACAO.JANELA_FRENTE_M
  return {
    de: Math.max(inicio, max - NAVEGACAO.JANELA_ATRAS_M),
    ate: max + Math.min(NAVEGACAO.JANELA_FRENTE_M, plausivel),
    ramo: null,
  }
}

function medir(t: Trajeto, l: LeituraPosicao, j: Janela): Medida {
  const ponto: [number, number] = [l.lat, l.lon]
  const encaixe = j.ramo === null ? encaixar(t, ponto, j.de, j.ate) : encaixarNoPrimeiroRamo(t, ponto, j.de, j.ate, j.ramo)
  let progressoM = encaixe?.progressoM ?? null
  // antes do ponto de partida a projeção fica presa no zero; o progresso negativo deixa o
  // "sentido contrário" valer também para quem anda para trás logo no começo
  if (progressoM === 0 && j.de <= 0) {
    const atras = antesDoInicioM(t, ponto)
    if (atras > 0) progressoM = -atras
  }
  return {
    agoraMs: l.tMs,
    precisaoM: l.precisaoM,
    progressoM,
    lateralM: encaixe?.lateralM ?? Infinity,
    distanciaAoFimM: distanciaAoFim(t, ponto),
    totalM: t.totalM,
  }
}

function faltaNoPasso(t: Trajeto, i: number, progressoMaxM: number): number {
  return Math.max(0, (t.passos[i]?.fimM ?? 0) - progressoMaxM)
}

function chegou(e: EstadoNavegacao, efeitosAntes: Efeito[] = []): Resultado {
  // se na mesma leitura havia outras falas, só a chegada sai
  return {
    estado: { ...e, fase: 'chegou', retomando: false },
    efeitos: [...efeitosAntes.filter((x) => x.tipo !== 'falar'), falar(FALAS_FIXAS.chegada), { tipo: 'parar_sensores' }, { tipo: 'focar', alvo: 'chegada' }],
  }
}

function primeiraLeitura(e: EstadoNavegacao, t: Trajeto, l: LeituraPosicao): Resultado {
  // procurando: nada é falado até a primeira leitura boa
  if (!leituraBoa(l.precisaoM)) return { estado: { ...e, ultimaLeitura: l }, efeitos: [] }
  const m = medir(t, l, janela(e, t, l))
  const perto = m.progressoM !== null && m.lateralM <= limiarDesvio(l.precisaoM)
  const base = estadoInicial(perto ? { agoraMs: l.tMs, progressoM: Math.max(0, m.progressoM ?? 0) } : { agoraMs: l.tMs, fora: true })
  const { estado: acompanhamento, ocorrencias } = registrarLeitura(base, m)
  const passoAtual = Math.max(0, passoEm(t, acompanhamento.progressoMaxM - NAVEGACAO.MARGEM_AVANCO_M))
  const falados = new Set(e.falados)
  for (let i = 0; i <= passoAtual; i++) falados.add(`entrada:${e.rota.passos[i].ordem}`)
  const estado: EstadoNavegacao = {
    ...e,
    fase: 'navegando',
    acompanhamento,
    passoAtual,
    faltaM: faltaNoPasso(t, passoAtual, acompanhamento.progressoMaxM),
    lateralM: m.lateralM,
    falados,
    ultimaLeitura: l,
    retomando: false,
  }
  if (ocorrencias.includes('chegou')) return chegou(estado)
  const fala = perto ? falaInicio(e.contexto, passoAtual, e.simulacao) : falaLonge(m.lateralM)
  return { estado, efeitos: [falar(fala)] }
}

function falaDaOcorrencia(o: Ocorrencia, e: EstadoNavegacao): FalaNavegacao | null {
  switch (o) {
    case 'sinal_fraco':
      return FALAS_FIXAS.sinal_fraco
    case 'sinal_voltou':
      return FALAS_FIXAS.sinal_voltou
    case 'sem_sinal':
      return FALAS_FIXAS.sem_sinal
    case 'saiu':
      return falaSaiu(e.lateralM)
    case 'voltou':
      return falaVoltou(e.contexto, e.passoAtual, e.faltaM, sinalFraco(e))
    case 'sentido_contrario':
      return FALAS_FIXAS.contrario
    case 'chegou':
      return null
  }
}

function novaLeitura(e: EstadoNavegacao, l: LeituraPosicao): Resultado {
  const t = e.trajeto
  if (!t || e.oculta || !ativa(e)) return { estado: e, efeitos: [] }
  if (e.fase === 'procurando') return primeiraLeitura(e, t, l)

  const m = medir(t, l, janela(e, t, l))
  const { estado: acompanhamento, ocorrencias } = registrarLeitura(e.acompanhamento, m)
  const boa = leituraBoa(l.precisaoM)
  const passoAntes = e.passoAtual
  const passoAtual = Math.max(passoAntes, passoEm(t, acompanhamento.progressoMaxM - NAVEGACAO.MARGEM_AVANCO_M))
  const estado: EstadoNavegacao = {
    ...e,
    acompanhamento,
    passoAtual,
    faltaM: faltaNoPasso(t, passoAtual, acompanhamento.progressoMaxM),
    lateralM: boa ? m.lateralM : e.lateralM,
    ultimaLeitura: l,
  }
  if (ocorrencias.includes('chegou')) return chegou(estado)

  const efeitos: Efeito[] = []
  for (const o of ocorrencias) {
    const fala = falaDaOcorrencia(o, estado)
    if (fala) efeitos.push(falar(fala))
  }
  // fora da rota, nenhum marco nem entrada
  if (acompanhamento.fora) return { estado, efeitos }

  const falados = new Set(estado.falados)
  const reencaixou = estado.retomando && boa && m.progressoM !== null && m.lateralM <= limiarDesvio(l.precisaoM)
  if (reencaixou) {
    estado.retomando = false
    // a situação já diz o passo: as entradas puladas ficam como ditas
    for (let i = passoAntes + 1; i <= passoAtual; i++) falados.add(`entrada:${e.rota.passos[i].ordem}`)
    if (!ocorrencias.includes('voltou')) {
      efeitos.push(falar(instrucao('situacao', situacao(estado.contexto, passoAtual, estado.faltaM, sinalFraco(estado)), false)))
    }
  } else if (passoAtual > passoAntes) {
    // pulou vários passos de uma vez: fala só a entrada do último
    for (let i = passoAntes + 1; i < passoAtual; i++) falados.add(`entrada:${e.rota.passos[i].ordem}`)
    const entrada = falaEntrada(estado.contexto, passoAtual)
    if (entrada && !falados.has(entrada.id)) efeitos.push(falar(entrada))
    falados.add(`entrada:${e.rota.passos[passoAtual].ordem}`)
  }

  if (!estado.retomando) {
    const marco = marcoDevido(estado.contexto, { indicePasso: passoAtual, faltaM: estado.faltaM, foraDaRota: false }, falados)
    marco.marcar.forEach((id) => falados.add(id))
    if (marco.fala) efeitos.push(falar(marco.fala))
  }
  estado.falados = falados
  return { estado, efeitos }
}

/** O aviso da procura demorada, conforme a última leitura (nenhuma, fraca ou aproximada). */
export function avisoDaProcura(e: EstadoNavegacao): FalaNavegacao | null {
  if (e.fase !== 'procurando' || !e.procuraDemorada) return null
  const l = e.ultimaLeitura
  if (!l) return falaProcuraDemorada('sem_posicao')
  return falaProcuraDemorada(l.precisaoM > NAVEGACAO.PRECISAO_APROXIMADA_M ? 'aproximada' : 'fraco')
}

function tempo(e: EstadoNavegacao, agoraMs: number): Resultado {
  if (e.fase === 'procurando' && !e.oculta) {
    // procurando sem prazo deixaria a pessoa em "Procurando sua posição" para sempre, calada
    if (e.procuraDemorada || agoraMs - e.procurandoDesdeMs < NAVEGACAO.PROCURA_PRAZO_MS) return { estado: e, efeitos: [] }
    const estado = { ...e, procuraDemorada: true }
    return { estado, efeitos: [falar(avisoDaProcura(estado)!)] }
  }
  if (e.fase !== 'navegando' || e.oculta) return { estado: e, efeitos: [] }
  const { estado: acompanhamento, ocorrencias } = registrarTempo(e.acompanhamento, agoraMs)
  const estado = { ...e, acompanhamento }
  const efeitos = ocorrencias.map((o) => falaDaOcorrencia(o, estado)).filter((f): f is FalaNavegacao => f !== null).map(falar)
  return { estado, efeitos }
}

function retomarSensores(e: EstadoNavegacao, fase: 'procurando' | 'navegando', agoraMs: number): Resultado {
  return {
    estado: {
      ...e,
      fase,
      oculta: false,
      retomando: fase === 'navegando',
      acompanhamento: retomar(e.acompanhamento, agoraMs),
      // procurando de novo: o prazo da procura recomeça
      ...(fase === 'procurando' ? { procurandoDesdeMs: agoraMs, procuraDemorada: false } : {}),
    },
    efeitos: [{ tipo: 'ligar_sensores' }, falar(FALAS_FIXAS.retomada)],
  }
}

function pedirRecalculo(e: EstadoNavegacao, agoraMs: number): Resultado {
  if (!ativa(e) || e.oculta) return { estado: e, efeitos: [] }
  const cedo = e.ultimoRecalculoMs !== null && agoraMs - e.ultimoRecalculoMs < NAVEGACAO.RECALCULO_INTERVALO_MS
  if (e.recalculando || cedo) return { estado: e, efeitos: [falar(FALAS_FIXAS.aguarde)] }
  const l = e.ultimaLeitura
  // nenhuma leitura ainda: não há sinal nenhum para chamar de fraco
  if (!l) return { estado: e, efeitos: [falar(FALAS_FIXAS.procurando_recalculo)] }
  const recente = l.precisaoM <= NAVEGACAO.RECALCULO_PRECISAO_M && agoraMs - l.tMs <= NAVEGACAO.RECALCULO_IDADE_MS
  if (!recente) return { estado: e, efeitos: [falar(FALAS_FIXAS.sinal_insuficiente)] }
  // só a origem muda, arredondada (cerca de 11 m); o resto do pedido é o mesmo
  const pedido: RotaIn = { ...e.pedido, origem: { lat: arredondar4(l.lat), lng: arredondar4(l.lon) } }
  return {
    estado: { ...e, recalculando: true, ultimoRecalculoMs: agoraMs },
    efeitos: [falar(FALAS_FIXAS.calculando), { tipo: 'recalcular', pedido }],
  }
}

function rotaNova(e: EstadoNavegacao, rota: RotaOut, agoraMs: number): Resultado {
  if (!e.recalculando) return { estado: e, efeitos: [] }
  // lista vazia não é rota (como em /rota); rota sem desenho não dá para acompanhar
  if (rota.passos.length === 0) return { estado: { ...e, recalculando: false }, efeitos: [falar(falaErroRecalculo('sem_rota'))] }
  const trajeto = montarTrajeto(rota)
  if (!trajeto) return { estado: { ...e, recalculando: false }, efeitos: [falar(falaErroRecalculo('falha'))] }
  const l = e.ultimaLeitura
  const pedido: RotaIn = l ? { ...e.pedido, origem: { lat: arredondar4(l.lat), lng: arredondar4(l.lon) } } : e.pedido
  const estado: EstadoNavegacao = {
    ...e,
    fase: e.fase === 'procurando' ? 'navegando' : e.fase,
    rota,
    pedido,
    trajeto,
    contexto: contextoDe(rota, pedido, trajeto),
    passoAtual: 0,
    faltaM: trajeto.passos[0]?.fimM ?? 0,
    lateralM: Infinity,
    acompanhamento: estadoInicial({ agoraMs }),
    falados: new Set(),
    retomando: false,
    recalculando: false,
  }
  return { estado, efeitos: [falar(falaNovaRota(rota, estado.contexto.pedido))] }
}

function repetir(e: EstadoNavegacao): Resultado {
  switch (e.fase) {
    case 'procurando':
    case 'navegando': {
      const aviso = avisoDaProcura(e)
      if (aviso) return { estado: e, efeitos: [falar({ ...aviso, urgente: true })] }
      const fala = falaRepetir(e.contexto, e.passoAtual, e.faltaM, {
        fora: e.acompanhamento.fora,
        lateralM: e.lateralM,
        sinalFraco: sinalFraco(e),
        procurando: e.fase === 'procurando',
      })
      return { estado: e, efeitos: [falar(fala)] }
    }
    case 'pausada':
      return { estado: e, efeitos: [falar(FALAS_FIXAS.pausada)] }
    case 'chegou':
      return { estado: e, efeitos: [falar(FALAS_FIXAS.chegada)] }
    case 'passo_a_passo':
      return { estado: e, efeitos: [falar(falaPassoAPasso(e, e.passoAtual))] }
    default:
      return { estado: e, efeitos: [] }
  }
}

function moverPasso(e: EstadoNavegacao, delta: number): Resultado {
  if (e.fase !== 'passo_a_passo') return { estado: e, efeitos: [] }
  const i = e.passoAtual + delta
  if (i < 0 || i >= e.rota.passos.length) return { estado: e, efeitos: [] }
  return { estado: { ...e, passoAtual: i }, efeitos: [falar(falaPassoAPasso(e, i))] }
}

/** Começar (ou Tentar de novo): procura a posição, liga os sensores no gesto e foca o painel. */
function procurar(e: EstadoNavegacao, agoraMs: number): Resultado {
  return {
    estado: {
      ...e,
      fase: 'procurando',
      motivoIndisponivel: null,
      acompanhamento: estadoInicial({ agoraMs }),
      oculta: false,
      procurandoDesdeMs: agoraMs,
      procuraDemorada: false,
    },
    efeitos: [falar(FALAS_FIXAS.iniciada), { tipo: 'ligar_sensores' }, { tipo: 'focar', alvo: 'painel' }],
  }
}

export function reduzirNavegacao(e: EstadoNavegacao, ev: EventoNavegacao): Resultado {
  switch (ev.tipo) {
    case 'comecar':
      if (e.fase !== 'preparo') return { estado: e, efeitos: [] }
      return procurar(e, ev.agoraMs)
    case 'tentar_de_novo':
      // depois de liberar a permissão nos ajustes: o toque é um gesto, então pode pedir o GPS de novo
      if (e.fase !== 'sem_permissao') return { estado: e, efeitos: [] }
      return procurar(e, ev.agoraMs)
    case 'leitura':
      return novaLeitura(e, ev.leitura)
    case 'erro_posicao':
      if (!ativa(e)) return { estado: e, efeitos: [] }
      if (ev.codigo === 1) {
        return { estado: { ...e, fase: 'sem_permissao' }, efeitos: [{ tipo: 'parar_sensores' }, { tipo: 'focar', alvo: 'permissao' }] }
      }
      if (ev.codigo === 0) {
        return {
          estado: { ...e, fase: 'indisponivel', motivoIndisponivel: 'sem_localizacao' },
          efeitos: [{ tipo: 'parar_sensores' }, { tipo: 'focar', alvo: 'permissao' }],
        }
      }
      // 2 (sem posição) e 3 (tempo esgotado): o navegador continua tentando. Navegando, o tempo
      // cuida do "sem sinal"; procurando, o prazo da procura (PROCURA_PRAZO_MS) avisa a pessoa.
      return { estado: e, efeitos: [] }
    case 'tempo':
      return tempo(e, ev.agoraMs)
    case 'pausar':
      if (!ativa(e)) return { estado: e, efeitos: [] }
      return {
        estado: { ...e, fase: 'pausada', faseAntesDaPausa: e.fase as 'procurando' | 'navegando', oculta: false },
        efeitos: [{ tipo: 'parar_sensores' }, falar(FALAS_FIXAS.pausada)],
      }
    case 'continuar':
      if (e.fase !== 'pausada') return { estado: e, efeitos: [] }
      return retomarSensores(e, e.faseAntesDaPausa, ev.agoraMs)
    case 'oculta':
      // pausa automática, sem fala
      if (!ativa(e) || e.oculta) return { estado: e, efeitos: [] }
      return { estado: { ...e, oculta: true }, efeitos: [{ tipo: 'parar_sensores' }] }
    case 'visivel':
      if (!ativa(e) || !e.oculta) return { estado: e, efeitos: [] }
      return retomarSensores(e, e.fase as 'procurando' | 'navegando', ev.agoraMs)
    case 'repetir':
      return repetir(e)
    case 'pedir_recalculo':
      return pedirRecalculo(e, ev.agoraMs)
    case 'rota_nova':
      return rotaNova(e, ev.rota, ev.agoraMs)
    case 'recalculo_falhou':
      if (!e.recalculando) return { estado: e, efeitos: [] }
      return { estado: { ...e, recalculando: false }, efeitos: [falar(falaErroRecalculo(ev.motivo))] }
    case 'passo_a_passo': {
      if (e.fase === 'passo_a_passo' || e.fase === 'chegou') return { estado: e, efeitos: [] }
      const estado: EstadoNavegacao = { ...e, fase: 'passo_a_passo', passoAtual: 0, oculta: false, retomando: false, recalculando: false }
      const parar: Efeito[] = ativa(e) || e.fase === 'pausada' ? [{ tipo: 'parar_sensores' }] : []
      return { estado, efeitos: [...parar, falar(falaPassoAPasso(estado, 0)), { tipo: 'focar', alvo: 'painel' }] }
    }
    case 'passo_anterior':
      return moverPasso(e, -1)
    case 'proximo_passo':
      return moverPasso(e, 1)
  }
}

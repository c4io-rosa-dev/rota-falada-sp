import type { RotaOut } from '../../api/client'
import { alertasFaladosDoPasso, falaDoPasso, gravesFaladosDoPasso, metrosFalados, type Exigencia } from '../narrador'
import { formatarDistancia, separarInstrucao, textoInstrucao, type Passo } from '../passo'

/**
 * O que a navegação guiada fala, e quando (spec da navegação guiada, seções 5 e 6.3).
 *
 * Puro e determinístico: recebe o passo atual e quanto falta, devolve a frase. Não sabe onde a
 * pessoa está, só em que passo e a que distância do fim dele; a sequência de posições nunca passa
 * por aqui. Os marcos de 50 m e 15 m seguem a ideia dos avisos por distância do Organic Maps
 * (Apache-2.0), só a ideia e os números; nenhum código foi copiado.
 */

export type FalaNavegacao = { id: string; texto: string; urgente: boolean; tipo: 'instrucao' | 'estado' }

export const MARCOS = { APROX_M: 50, PERTO_M: 15, MARGEM_M: 5, PASSO_CURTO_M: 70, ENCADEAR_M: 30, PASSO_MINIMO_M: 1 } as const

/** `comprimentosM[i]` é o comprimento do passo i no trajeto (pode diferir de `distancia_m`). */
export type Contexto = { passos: Passo[]; comprimentosM: readonly number[]; pedido: Exigencia }

/**
 * Só existe no build de teste ou de demonstração (VITE_PERMITIR_SIMULACAO=true). Em produção a
 * variável não existe, a comparação vira `false` no build e o texto nem entra no pacote.
 */
export const PREFIXO_SIMULACAO =
  import.meta.env.VITE_PERMITIR_SIMULACAO === 'true' ? 'Modo demonstração: a posição é simulada, não é a sua.' : ''

const AJUDA_INICIO = 'Se não souber para que lado ir, ande alguns metros. O app avisa se for no sentido contrário.'
const ROTA_ANTERIOR = 'A rota anterior continua valendo.'

function instrucao(id: string, texto: string, urgente: boolean): FalaNavegacao {
  return { id, texto, urgente, tipo: 'instrucao' }
}

function estado(id: string, texto: string): FalaNavegacao {
  return { id, texto, urgente: false, tipo: 'estado' }
}

function minuscula(texto: string): string {
  return texto.charAt(0).toLowerCase() + texto.slice(1)
}

function comprimento(c: Contexto, i: number): number {
  return c.comprimentosM[i] ?? 0
}

function instr(p: Passo): string {
  return minuscula(textoInstrucao(p))
}

function acao(p: Passo): string {
  return minuscula(separarInstrucao(textoInstrucao(p)).acao)
}

function virada(p: Passo): boolean {
  return p.direcao !== 'siga'
}

/** "Passo 2 de 5, Rua Augusta." ou, sem rua, "Passo 2 de 5." */
function cabecalho(c: Contexto, i: number): string {
  const p = c.passos[i]
  const rua = separarInstrucao(p.instrucao).rua
  return rua ? `Passo ${p.ordem} de ${c.passos.length}, ${rua}.` : `Passo ${p.ordem} de ${c.passos.length}.`
}

/** O primeiro passo depois de `i` com comprimento de pelo menos 1 m; `null` é o destino. */
export function proximoUtil(c: Contexto, i: number): number | null {
  for (let j = i + 1; j < c.passos.length; j++) {
    if (comprimento(c, j) >= MARCOS.PASSO_MINIMO_M) return j
  }
  return null
}

/** "8 m", "40 m", "1,2 km": o mesmo arredondamento da voz, para a tela não contradizer a fala. */
export function distanciaNaTela(m: number): string {
  if (m < 10) return `${Math.max(1, Math.round(m))} m`
  const cinco = Math.round(m / 5) * 5
  return cinco < 1000 ? `${cinco} m` : formatarDistancia(cinco)
}

function textoAprox(c: Contexto, faltaM: number, prox: number | null): string {
  const d = metrosFalados(Math.min(faltaM, MARCOS.APROX_M))
  if (prox === null) return `Em ${d}, o destino.`
  const p = c.passos[prox]
  const graves = gravesFaladosDoPasso(p, c.pedido)
  if (!virada(p)) return `Em ${d}, no próximo trecho: ${graves.join(', ')}.`
  const trecho = graves.length > 0 ? ` No próximo trecho: ${graves.join(', ')}.` : ''
  return `Em ${d}, ${instr(p)}.${trecho}`
}

function textoPerto(c: Contexto, prox: number | null): string {
  if (prox === null) return 'Logo à frente, o destino.'
  const p = c.passos[prox]
  let texto = `Logo à frente, ${acao(p)}.`
  if (comprimento(c, prox) < MARCOS.ENCADEAR_M) {
    const seguinte = proximoUtil(c, prox)
    if (seguinte !== null && virada(c.passos[seguinte])) texto += ` Logo depois, ${acao(c.passos[seguinte])}.`
  }
  return texto
}

/**
 * O marco de fala devido agora, se houver. Vários devidos de uma vez (a pessoa pulou o de 50 m):
 * fala só o mais perto e marca todos, para nenhum sair atrasado depois. Fora da rota, nada.
 */
export function marcoDevido(
  c: Contexto,
  s: { indicePasso: number; faltaM: number; foraDaRota: boolean },
  falados: ReadonlySet<string>,
): { fala: FalaNavegacao | null; marcar: string[] } {
  if (s.foraDaRota) return { fala: null, marcar: [] }
  const i = s.indicePasso
  const p = c.passos[i]
  if (!p) return { fala: null, marcar: [] }
  const tamanho = comprimento(c, i)
  const prox = proximoUtil(c, i)
  const pProx = prox === null ? null : c.passos[prox]
  const devido = (marco: number) => s.faltaM - marco <= MARCOS.MARGEM_M

  const idAprox = `${p.ordem}:aprox`
  const idPerto = `${p.ordem}:perto`
  const aproxElegivel =
    tamanho >= MARCOS.PASSO_CURTO_M && (pProx === null || virada(pProx) || gravesFaladosDoPasso(pProx, c.pedido).length > 0)
  const pertoElegivel = tamanho > MARCOS.PERTO_M + MARCOS.MARGEM_M && (pProx === null || virada(pProx))

  const marcar: string[] = []
  let fala: FalaNavegacao | null = null
  if (aproxElegivel && !falados.has(idAprox) && devido(MARCOS.APROX_M)) {
    marcar.push(idAprox)
    fala = instrucao(idAprox, textoAprox(c, s.faltaM, prox), false)
  }
  if (pertoElegivel && !falados.has(idPerto) && devido(MARCOS.PERTO_M)) {
    marcar.push(idPerto)
    fala = instrucao(idPerto, textoPerto(c, prox), true)
  }
  return { fala, marcar }
}

/** A primeira fala, quando a primeira leitura boa encaixa no passo i. */
export function falaInicio(c: Contexto, i: number, simulacao: boolean): FalaNavegacao {
  const texto = `${falaDoPasso(c.passos[i], c.passos.length, c.pedido)} ${AJUDA_INICIO}`
  return instrucao('inicio', simulacao ? `${PREFIXO_SIMULACAO} ${texto}` : texto, false)
}

/** Ao entrar num passo. Passo curto já diz o que vem depois, porque não haverá aviso de 50 m. */
export function falaEntrada(c: Contexto, i: number): FalaNavegacao | null {
  const tamanho = comprimento(c, i)
  if (tamanho < MARCOS.PASSO_MINIMO_M) return null
  const p = c.passos[i]
  const partes = [cabecalho(c, i), `Siga por ${metrosFalados(tamanho)}.`]
  if (tamanho < MARCOS.PASSO_CURTO_M) {
    const prox = proximoUtil(c, i)
    if (prox === null) partes.push('Depois, o destino.')
    else {
      const pProx = c.passos[prox]
      partes.push(`Depois, ${instr(pProx)}.`)
      const graves = gravesFaladosDoPasso(pProx, c.pedido)
      if (graves.length > 0) partes.push(`No próximo trecho: ${graves.join(', ')}.`)
    }
  }
  partes.push(...alertasFaladosDoPasso(p, c.pedido))
  return instrucao(`entrada:${p.ordem}`, partes.join(' '), false)
}

/** "Passo 2 de 5, Rua Augusta. Faltam 40 metros." Com sinal fraco, "cerca de". */
export function situacao(c: Contexto, i: number, faltaM: number, sinalFraco: boolean): string {
  const d = `${sinalFraco ? 'cerca de ' : ''}${metrosFalados(faltaM)}`
  const fim = proximoUtil(c, i) === null ? ' para o destino' : ''
  return `${cabecalho(c, i)} Faltam ${d}${fim}.`
}

export function falaRepetir(
  c: Contexto,
  i: number,
  faltaM: number,
  op: { fora: boolean; lateralM: number; sinalFraco: boolean; procurando: boolean },
): FalaNavegacao {
  if (op.procurando) return instrucao('repetir', 'Procurando sua posição.', true)
  if (op.fora) {
    return instrucao(
      'repetir',
      `Você está fora da rota, a cerca de ${metrosFalados(op.lateralM)} dela. Volte para a rota ou toque em Recalcular.`,
      true,
    )
  }
  const partes = [situacao(c, i, faltaM, op.sinalFraco)]
  const prox = proximoUtil(c, i)
  if (prox !== null) partes.push(`Depois, ${instr(c.passos[prox])}.`)
  partes.push(...alertasFaladosDoPasso(c.passos[i], c.pedido))
  return instrucao('repetir', partes.join(' '), true)
}

export function falaLonge(lateralM: number): FalaNavegacao {
  return instrucao('longe', `Você está a cerca de ${metrosFalados(lateralM)} da rota. Vá até ela ou toque em Recalcular.`, false)
}

export function falaSaiu(lateralM: number): FalaNavegacao {
  return instrucao(
    'saiu',
    `Você saiu da rota, a cerca de ${metrosFalados(lateralM)} dela. As instruções de curva estão suspensas. Volte para a rota ou toque em Recalcular.`,
    true,
  )
}

export function falaVoltou(c: Contexto, i: number, faltaM: number, sinalFraco: boolean): FalaNavegacao {
  return instrucao('voltou', `Você voltou para a rota. ${situacao(c, i, faltaM, sinalFraco)}`, false)
}

export function falaNovaRota(rota: Pick<RotaOut, 'passos' | 'distancia_m'>, pedido: Exigencia): FalaNavegacao {
  const n = rota.passos.length
  const resumo = `Nova rota calculada: ${metrosFalados(rota.distancia_m)}, em ${n} ${n === 1 ? 'passo' : 'passos'}.`
  const texto = n > 0 ? `${resumo} ${falaDoPasso(rota.passos[0], n, pedido)}` : resumo
  return instrucao('nova_rota', texto, true)
}

const PASSO_A_PASSO_TAMBEM = 'Você também pode seguir passo a passo.'

/** Por que a procura pela posição está demorando: nenhuma leitura, só leituras fracas, ou localização aproximada. */
export type MotivoProcura = 'sem_posicao' | 'fraco' | 'aproximada'

const PROCURA_DEMORADA: Record<MotivoProcura, string> = {
  sem_posicao: `Ainda não conseguimos a sua posição. Confira se a localização do aparelho está ligada. ${PASSO_A_PASSO_TAMBEM}`,
  fraco: `O sinal de localização está fraco aqui. Tente um lugar mais aberto, longe de prédios altos. ${PASSO_A_PASSO_TAMBEM}`,
  // iPhone com "Localização Exata" desligada para o Safari; Android com a permissão "aproximada" no Chrome
  aproximada:
    'A localização deste aparelho está aproximada, e assim não dá para acompanhar a rota. Ative a localização exata. ' +
    'No iPhone: Ajustes, Privacidade e Segurança, Serviços de Localização, Sites do Safari, Localização Exata. ' +
    `No Android: Configurações, Apps, Chrome, Permissões, Local, Usar local exato. ${PASSO_A_PASSO_TAMBEM}`,
}

/** Dita uma vez quando a procura passa do prazo sem nenhuma leitura boa. */
export function falaProcuraDemorada(motivo: MotivoProcura): FalaNavegacao {
  return instrucao(`procura_${motivo}`, PROCURA_DEMORADA[motivo], false)
}

const ERROS_RECALCULO: Record<'sem_rota' | 'fora_da_area' | 'falha', string> = {
  sem_rota: `Não encontramos rota acessível a partir daqui. ${ROTA_ANTERIOR}`,
  fora_da_area: `Daqui não conseguimos calcular rota: este ponto está fora da área atendida. ${ROTA_ANTERIOR}`,
  falha: `Não foi possível calcular uma nova rota agora. ${ROTA_ANTERIOR}`,
}

export function falaErroRecalculo(motivo: 'sem_rota' | 'fora_da_area' | 'falha'): FalaNavegacao {
  return instrucao('erro_recalculo', ERROS_RECALCULO[motivo], false)
}

type IdFixo =
  | 'iniciada'
  | 'contrario'
  | 'sinal_fraco'
  | 'sinal_voltou'
  | 'sem_sinal'
  | 'pausada'
  | 'retomada'
  | 'calculando'
  | 'sinal_insuficiente'
  | 'procurando_recalculo'
  | 'aguarde'
  | 'tela'
  | 'chegada'

/** As falas que não dependem da rota. Estados vão para a região viva; instruções, para a voz quando ligada. */
export const FALAS_FIXAS: Record<IdFixo, FalaNavegacao> = {
  iniciada: instrucao('iniciada', 'Navegação iniciada.', true),
  contrario: instrucao('contrario', 'Você parece estar andando no sentido contrário da rota. Dê meia-volta para seguir a rota.', true),
  sinal_fraco: instrucao(
    'sinal_fraco',
    'Sinal de localização fraco. A posição pode errar alguns metros. Pare e confira antes de virar.',
    false,
  ),
  sinal_voltou: instrucao('sinal_voltou', 'Sinal de localização de volta.', false),
  sem_sinal: instrucao('sem_sinal', 'Sem sinal de localização. Siga a descrição do passo atual e confira a tela.', false),
  pausada: estado('pausada', 'Navegação pausada. A localização está desligada.'),
  retomada: estado('retomada', 'Navegação retomada.'),
  calculando: estado('calculando', 'Calculando nova rota a partir de onde você está.'),
  sinal_insuficiente: estado('sinal_insuficiente', 'Sinal de localização fraco. Espere o sinal melhorar para pedir uma nova rota.'),
  procurando_recalculo: estado('procurando_recalculo', 'Ainda procurando sua posição. Espere para pedir uma nova rota.'),
  aguarde: estado('aguarde', 'Aguarde alguns segundos para recalcular de novo.'),
  tela: estado('tela', 'A tela pode apagar sozinha. Com a tela apagada, as instruções param.'),
  chegada: instrucao('chegada', 'Você chegou ao destino. A posição pode errar alguns metros; confira pelo entorno.', true),
}

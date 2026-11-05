import type { Barreira, Evento, StatusBarreira, Voto } from '../api/colaboracao'
import { distanciaM } from './rotaGeo'

/** Limiares de services/moderacao.py; o backend decide, a interface só explica. */
const LIMIAR: Record<Barreira['severidade'], number> = { intransponivel: 2, dificulta: 1, informativo: 0 }

const TEXTO_STATUS: Record<StatusBarreira, string> = {
  pendente: 'Aguardando confirmação',
  validada: 'Confirmada',
  contestada: 'Contestada',
  resolvida: 'Resolvida',
  expirada: 'Expirada',
  removida: 'Removida pela moderação',
}

export const SIGNIFICADO_STATUS: Record<StatusBarreira, string> = {
  pendente: 'Ainda não muda a rota.',
  validada: 'Passa a valer para as rotas, conforme a categoria.',
  contestada: 'Não existe, segundo a decisão. A rota não considera. Votação encerrada.',
  resolvida: 'Foi consertada. A rota não considera. Votação encerrada.',
  expirada: 'Venceu o prazo. A rota não considera. Votação encerrada.',
  removida: 'Some do público e a foto é apagada de vez: é falsa, abusiva ou duplicada.',
}

export const STATUS_TODOS = Object.keys(TEXTO_STATUS) as StatusBarreira[]

export function textoStatus(b: Pick<Barreira, 'status' | 'severidade'>): string {
  return b.status === 'validada' && b.severidade === 'informativo' ? 'Informativa' : TEXTO_STATUS[b.status]
}

export function votacaoEncerrada(b: Pick<Barreira, 'status'>): boolean {
  return b.status === 'contestada' || b.status === 'resolvida' || b.status === 'expirada' || b.status === 'removida'
}

/** O que esta barreira faz com a rota, em texto: "evita" e "avisa", nunca uma promessa. */
export function textoEfeito(b: Pick<Barreira, 'status' | 'severidade' | 'votos'>): string {
  switch (b.status) {
    case 'pendente': {
      const falta = Math.max(1, LIMIAR[b.severidade] - b.votos.confirma)
      return `Ainda não muda a rota. ${falta === 1 ? 'Falta 1 confirmação' : `Faltam ${falta} confirmações`}.`
    }
    case 'validada':
      if (b.severidade === 'intransponivel') return 'A rota evita este ponto.'
      if (b.severidade === 'dificulta') return 'A rota avisa, mas pode passar por aqui.'
      return 'Não muda a rota.'
    case 'contestada':
      return 'Pessoas disseram que não existe. A rota não considera. Votação encerrada.'
    case 'resolvida':
      return 'Foi consertada, segundo quem votou. Votação encerrada.'
    case 'expirada':
      return 'Ninguém confirmou no prazo. A rota não considera. Votação encerrada.'
    case 'removida':
      return 'Removida pela moderação. Não aparece para o público.'
  }
}

export function explicacaoVoto(voto: Voto, b: Pick<Barreira, 'severidade'>): string {
  // informativa nasce validada e nunca entra na rota: não há efeito a prometer
  const informativa = b.severidade === 'informativo'
  if (voto === 'confirma') {
    if (informativa) return 'Eu vi: a barreira está lá. Isto é só informação: não muda a rota.'
    const n = LIMIAR[b.severidade]
    const efeito = b.severidade === 'intransponivel' ? 'evitar este ponto' : 'avisar sobre este ponto'
    return `Eu vi: a barreira está lá. Com ${n} ${n === 1 ? 'confirmação' : 'confirmações'}, a rota passa a ${efeito}.`
  }
  const fim = informativa ? 'Com 2 votos, a votação encerra.' : 'Com 2 votos, ela sai das rotas e a votação encerra.'
  return voto === 'contesta' ? `Estive no lugar e essa barreira não existe. ${fim}` : `Existia e foi consertada. ${fim}`
}

const VOTO_CONTRARIO: Record<Exclude<Voto, 'confirma'>, string> = { contesta: 'de que não existe', resolvida: 'de que foi resolvida' }

/** O anúncio depois do voto: fala do voto dado, porque quem contesta não quer ouvir sobre confirmações. */
export function textoVotoRegistrado(voto: Voto, b: Pick<Barreira, 'status' | 'severidade' | 'votos'>): string {
  if (voto === 'confirma') {
    const n = b.votos.confirma
    return `Voto registrado. ${n === 1 ? 'Agora é 1 confirmação' : `Agora são ${n} confirmações`}. ${textoEfeito(b)}`
  }
  const n = voto === 'contesta' ? b.votos.contesta : b.votos.resolvida
  return `Voto registrado. Agora ${n === 1 ? 'é 1 voto' : `são ${n} votos`} ${VOTO_CONTRARIO[voto]}. Com 2, a votação encerra.`
}

export const ROTULO_VOTO: Record<Voto, string> = { confirma: 'Confirmo', contesta: 'Não existe', resolvida: 'Já resolvida' }

export function textoVotos(b: Pick<Barreira, 'votos'>): string {
  const { confirma, contesta, resolvida } = b.votos
  return `${confirma} ${confirma === 1 ? 'confirmação' : 'confirmações'}, ${contesta} ${contesta === 1 ? 'contestação' : 'contestações'}, ${resolvida} ${resolvida === 1 ? 'voto' : 'votos'} de resolvida`
}

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
const DATA = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' })

/** Com fuso: cortar a string mostraria o dia seguinte à noite. */
export function formatarDataHora(iso: string): string {
  return DATA_HORA.format(new Date(iso))
}

export function formatarDia(iso: string): string {
  return DATA.format(new Date(iso))
}

const RUMOS = ['norte', 'nordeste', 'leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste']

export function distanciaDirecao(origem: [number, number], b: Pick<Barreira, 'lat' | 'lon'>): string {
  const m = Math.round(distanciaM(origem, [b.lat, b.lon]))
  if (m < 5) return 'aqui'
  const dLat = b.lat - origem[0]
  const dLon = (b.lon - origem[1]) * Math.cos((origem[0] * Math.PI) / 180)
  const graus = ((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360
  return `${m} m a ${RUMOS[Math.round(graus / 45) % 8]}`
}

function autorDo(e: Evento): string {
  return e.usuario_id ? `conta ${e.usuario_id.slice(0, 8)}` : 'sistema'
}

/** A auditoria em texto determinístico; o e-mail nunca aparece (D9). */
export function textoEvento(e: Evento): string {
  const quando = formatarDataHora(e.criado_em)
  const quem = autorDo(e)
  const d = e.detalhe as { motivo?: unknown; voto?: unknown; anterior?: unknown; acao?: unknown }
  switch (e.tipo) {
    case 'criada':
      return `${quando}: criada por ${quem}, status ${e.para_status}.`
    case 'voto': {
      const troca = d.anterior ? ` (antes: ${String(d.anterior)})` : ''
      return `${quando}: voto ${String(d.voto)}${troca}, ${quem}.`
    }
    case 'status': {
      const prazo = d.motivo === 'prazo' ? ' por prazo' : ''
      return `${quando}: status de ${e.de_status} para ${e.para_status}${prazo}, ${quem}.`
    }
    case 'foto':
      return `${quando}: foto alterada, ${quem}.`
    case 'admin':
      return `${quando}: decisão da moderação, de ${e.de_status} para ${e.para_status}. Motivo: ${String(d.motivo)}. ${quem}.`
    default:
      return `${quando}: ${e.tipo}, ${quem}.`
  }
}

const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES_FOTO = 5 * 1024 * 1024

/** Os limites de services/fotos.py, antes de gastar o envio. Os 12 megapixels ficam para o servidor. */
export function erroDoArquivo(arquivo: File): string | null {
  if (!TIPOS_FOTO.includes(arquivo.type)) return 'Use uma foto em JPEG, PNG ou WebP.'
  if (arquivo.size > MAX_BYTES_FOTO) return 'A foto passa de 5 MB. Escolha uma menor.'
  return null
}

export function erroDaDescricao(texto: string): string | null {
  const n = texto.trim().length
  return n < 5 || n > 300 ? 'Descreva a foto em 5 a 300 caracteres. Quem não enxerga a foto vai ouvir este texto.' : null
}

export function erroDoMotivo(motivo: string): string | null {
  const n = motivo.trim().length
  return n < 3 || n > 300 ? 'Escreva o motivo, de 3 a 300 caracteres. Ele fica na auditoria.' : null
}

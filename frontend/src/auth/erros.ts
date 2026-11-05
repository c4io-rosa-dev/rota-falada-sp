import { MSG_INSTABILIDADE } from '../api/base'
import { ErroApi } from '../api/base'

export const MSG_CODIGO_ERRADO = 'Código incorreto ou vencido. Confira os dígitos ou peça outro.'
export const MSG_LIMITE = 'Muitos pedidos agora. Tente em alguns minutos. O que você escreveu continua aqui.'
export const MSG_REDE_AUTH = MSG_INSTABILIDADE
export const MSG_TEMPO_AUTH = MSG_INSTABILIDADE
export const MSG_ABRIR_LOGIN = MSG_INSTABILIDADE

const POR_CODIGO: Record<string, string> = {
  otp_expired: MSG_CODIGO_ERRADO,
  over_email_send_rate_limit: MSG_LIMITE,
  over_request_rate_limit: MSG_LIMITE,
  email_address_not_authorized: 'Este e-mail ainda não pode receber código: o envio está em fase de teste.',
  email_address_invalid: 'Confira o e-mail digitado.',
  validation_failed: 'Confira o e-mail digitado.',
  signup_disabled: 'O login está desligado no momento.',
  otp_disabled: 'O login está desligado no momento.',
}

export function mensagemDeErroAuth(erro: unknown): string {
  if (erro instanceof ErroApi) return erro.message
  const codigo = (erro as { code?: unknown } | null)?.code
  if (typeof codigo === 'string' && POR_CODIGO[codigo]) return POR_CODIGO[codigo]
  return MSG_REDE_AUTH
}

/** Colar "123 456" ou "123-456" funciona; o maxLength cortaria a colagem. */
export function normalizarCodigo(texto: string): string {
  return texto.replace(/[\s-]/g, '')
}

export function erroDoCodigo(codigo: string): string | null {
  if (!/^\d+$/.test(codigo)) return 'O código tem só números.'
  if (codigo.length !== 6) return `O código tem 6 dígitos; você digitou ${codigo.length}.`
  return null
}

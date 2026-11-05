const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export function apiUrl(caminho: string): string {
  return BASE + caminho
}

export type TipoErro =
  | 'rede'
  | 'tempo'
  | 'sessao'
  | 'permissao'
  | 'nao_encontrado'
  | 'conflito'
  | 'validacao'
  | 'limite'
  | 'foto'
  | 'indisponivel'
  | 'inesperado'

export type CampoInvalido = { campo: string; codigo: string }

/** Todo erro da API chega à interface nesta forma; `message` já está em português. */
export class ErroApi extends Error {
  readonly tipo: TipoErro
  readonly status?: number
  readonly campos?: CampoInvalido[]

  constructor(tipo: TipoErro, mensagem: string, status?: number, campos?: CampoInvalido[]) {
    super(mensagem)
    this.name = 'ErroApi'
    this.tipo = tipo
    this.status = status
    this.campos = campos
  }
}

/** Decisão do dono (05/11/2026): a tela de erro reporta só instabilidade, sem apontar causa nem culpar a conexão da pessoa. */
export const MSG_INSTABILIDADE = 'Instabilidade no sistema. Tente de novo em alguns minutos.'
export const MSG_SEM_INTERNET = MSG_INSTABILIDADE
export const MSG_REDE = MSG_INSTABILIDADE
export const MSG_TEMPO = MSG_INSTABILIDADE
export const MSG_INDISPONIVEL = MSG_INSTABILIDADE
export const MSG_SEM_RESPOSTA = MSG_INSTABILIDADE
export const MSG_VALIDACAO = 'Confira os dados informados.'
export const MSG_INESPERADO = MSG_INSTABILIDADE

/** Cancelamento pedido por quem chamou: nunca é erro para a pessoa. */
export function ehCancelamento(erro: unknown): boolean {
  return erro instanceof DOMException && erro.name === 'AbortError'
}

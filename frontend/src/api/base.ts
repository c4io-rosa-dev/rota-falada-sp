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

export const MSG_SEM_INTERNET = 'Sem conexão com a internet. Confira o sinal e tente de novo.'
export const MSG_REDE = 'Não conseguimos falar com o servidor. Confira sua conexão e tente de novo.'
export const MSG_TEMPO = 'Demorou demais. Tente de novo.'
export const MSG_INDISPONIVEL = 'O serviço não respondeu agora. Tente de novo em alguns minutos.'
export const MSG_SEM_RESPOSTA = 'O servidor não respondeu. Confira o sinal e tente de novo em alguns minutos.'
export const MSG_VALIDACAO = 'Confira os dados informados.'
export const MSG_INESPERADO = 'Algo não saiu como esperado. Tente de novo.'

/** Cancelamento pedido por quem chamou: nunca é erro para a pessoa. */
export function ehCancelamento(erro: unknown): boolean {
  return erro instanceof DOMException && erro.name === 'AbortError'
}

import {
  apiUrl,
  ehCancelamento,
  ErroApi,
  MSG_INDISPONIVEL,
  MSG_INESPERADO,
  MSG_REDE,
  MSG_TEMPO,
  MSG_VALIDACAO,
  type CampoInvalido,
  type TipoErro,
} from './base'
import { garantirAcordado } from './servidor'

export type OpcoesPedido = {
  metodo?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  corpo?: unknown
  consulta?: Record<string, string | number | undefined>
  sinal?: AbortSignal
  tempoMs?: number
  /** Só api/colaboracao.ts passa token: rota e geocode nunca se ligam a uma conta (LGPD). */
  token?: string
  /** Para quem precisa distinguir 200 de 201 (cadastro idempotente). */
  aoStatus?: (status: number) => void
  /** O servidor respondeu ao /health e o pedido vai sair: daqui em diante a demora é da operação. */
  aoSair?: () => void
  /** O texto buscado está na URL: `no-store` o mantém fora do cache do navegador. */
  cache?: RequestCache
}

export const TEMPO_PADRAO_MS = 30_000

const TIPO_POR_STATUS: Record<number, TipoErro> = {
  401: 'sessao',
  403: 'permissao',
  404: 'nao_encontrado',
  409: 'conflito',
  413: 'foto',
  415: 'foto',
  422: 'validacao',
  429: 'limite',
  503: 'indisponivel',
}

function montarUrl(caminho: string, consulta?: OpcoesPedido['consulta']): string {
  const parametros = new URLSearchParams()
  for (const [nome, valor] of Object.entries(consulta ?? {})) {
    if (valor !== undefined) parametros.set(nome, String(valor))
  }
  const texto = parametros.toString()
  return apiUrl(caminho) + (texto ? `?${texto}` : '')
}

async function lerJson(resposta: Response): Promise<unknown | undefined> {
  if (!resposta.headers.get('content-type')?.includes('json')) return undefined
  try {
    return await resposta.json()
  } catch (erro) {
    // só JSON inválido é "o serviço não respondeu"; abortar e perder a conexão têm tratamento próprio
    if ((erro as Error)?.name !== 'SyntaxError') throw erro
    return undefined
  }
}

function erroDeResposta(status: number, corpo: unknown): ErroApi {
  if (corpo === undefined) return new ErroApi('indisponivel', MSG_INDISPONIVEL, status)
  const tipo = TIPO_POR_STATUS[status] ?? (status >= 500 ? 'indisponivel' : 'inesperado')
  const detalhe = (corpo as { detail?: unknown }).detail
  if (typeof detalhe === 'string') return new ErroApi(tipo, detalhe, status)
  if (Array.isArray(detalhe)) {
    // lista do Pydantic: o msg vem em inglês e nunca vai para a tela
    const campos: CampoInvalido[] = detalhe.map((d: { loc?: unknown[]; type?: string }) => ({
      campo: String(d.loc?.at(-1) ?? ''),
      codigo: String(d.type ?? ''),
    }))
    return new ErroApi('validacao', MSG_VALIDACAO, status, campos)
  }
  return new ErroApi(tipo, MSG_INESPERADO, status)
}

/** Único ponto de saída para a API: espera o servidor acordar, aplica o teto e traduz os erros. */
export async function pedir<T>(caminho: string, opcoes: OpcoesPedido = {}): Promise<T> {
  const { metodo = 'GET', corpo, consulta, sinal, tempoMs = TEMPO_PADRAO_MS, token, aoStatus, aoSair, cache } = opcoes
  await garantirAcordado(sinal)
  aoSair?.()

  const controle = new AbortController()
  let expirou = false
  const limite = setTimeout(() => {
    expirou = true
    controle.abort()
  }, tempoMs)
  const repassar = () => controle.abort()
  if (sinal?.aborted) repassar()
  sinal?.addEventListener('abort', repassar, { once: true })

  const cabecalhos: Record<string, string> = {}
  if (token) cabecalhos.Authorization = `Bearer ${token}`
  const multipart = corpo instanceof FormData
  // FormData define o próprio Content-Type, com o boundary
  if (corpo !== undefined && !multipart) cabecalhos['Content-Type'] = 'application/json'

  try {
    const resposta = await fetch(montarUrl(caminho, consulta), {
      method: metodo,
      headers: cabecalhos,
      body: corpo === undefined ? undefined : multipart ? corpo : JSON.stringify(corpo),
      signal: controle.signal,
      ...(cache ? { cache } : {}),
    })
    const dados = await lerJson(resposta)
    if (!resposta.ok) throw erroDeResposta(resposta.status, dados)
    // 200 com HTML: proxy do Render, não a API
    if (dados === undefined) throw new ErroApi('indisponivel', MSG_INDISPONIVEL, resposta.status)
    aoStatus?.(resposta.status)
    return dados as T
  } catch (erro) {
    if (erro instanceof ErroApi) throw erro
    if (sinal?.aborted) throw new DOMException('Cancelado', 'AbortError')
    if (expirou) throw new ErroApi('tempo', MSG_TEMPO)
    if (ehCancelamento(erro)) throw erro
    throw new ErroApi('rede', MSG_REDE)
  } finally {
    clearTimeout(limite)
    sinal?.removeEventListener('abort', repassar)
  }
}

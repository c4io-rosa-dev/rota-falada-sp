import type { AuthClient } from '@supabase/auth-js'
import { ErroApi } from '../api/base'
import { lerConfigAuth } from './config'
import { MSG_ABRIR_LOGIN, MSG_REDE_AUTH, MSG_TEMPO_AUTH } from './erros'

/** Só a presença desta chave decide "Entrar" ou "Conta" no menu, sem carregar a biblioteca. */
export const CHAVE_SESSAO = 'rf-sessao'

/** O auth-js não tem teto de tempo: com a conexão travada, a tela ficaria esperando para sempre. */
export const TETO_AUTH_MS = 30_000
const TETO_SAIR_MS = 5_000

type ClienteAuth = InstanceType<typeof AuthClient>

let cliente: Promise<ClienteAuth> | null = null

/**
 * Import dinâmico: quem nunca entra não baixa os 25 KB de auth-js. Só /auth/v1, nada de Data
 * API. A rejeição não fica guardada: com sinal ruim, a próxima tentativa precisa importar de novo.
 */
function obterCliente(): Promise<ClienteAuth> {
  const config = lerConfigAuth()
  if (!config) return Promise.reject(new Error('login indisponível'))
  cliente ??= import('@supabase/auth-js')
    .then(
      ({ AuthClient }) =>
        new AuthClient({
          url: `${config.url}/auth/v1`,
          headers: { apikey: config.chave },
          storageKey: CHAVE_SESSAO,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false, // login por código não passa nada na URL
        }),
    )
    .catch(() => {
      cliente = null
      throw new ErroApi('rede', MSG_ABRIR_LOGIN)
    })
  return cliente
}

function comTeto<T>(promessa: Promise<T>, ms = TETO_AUTH_MS): Promise<T> {
  return new Promise<T>((resolver, rejeitar) => {
    const limite = setTimeout(() => rejeitar(new ErroApi('tempo', MSG_TEMPO_AUTH)), ms)
    promessa.then(resolver, rejeitar).finally(() => clearTimeout(limite))
  })
}

/** Refresh que falha por rede ou 5xx deixa a sessão salva: é falta de conexão, não "deslogado". */
function lancarSeTransitorio(erro: { name?: string } | null): void {
  if (erro?.name === 'AuthRetryableFetchError') throw new ErroApi('rede', MSG_REDE_AUTH)
}

export function temSessaoSalva(): boolean {
  try {
    return localStorage.getItem(CHAVE_SESSAO) !== null
  } catch {
    return false
  }
}

export function enviarCodigo(email: string): Promise<void> {
  return comTeto(
    (async () => {
      const c = await obterCliente()
      const { error } = await c.signInWithOtp({ email, options: { shouldCreateUser: true } })
      if (error) throw error
    })(),
  )
}

export function verificarCodigo(email: string, codigo: string): Promise<void> {
  return comTeto(
    (async () => {
      const c = await obterCliente()
      const { error } = await c.verifyOtp({ email, token: codigo, type: 'email' })
      if (error) throw error
    })(),
  )
}

/** Token de acesso válido (renova se preciso), ou null sem sessão. Falha de rede lança ErroApi. */
export async function obterToken(): Promise<string | null> {
  if (!temSessaoSalva()) return null
  return comTeto(
    (async () => {
      const c = await obterCliente()
      const { data, error } = await c.getSession()
      lancarSeTransitorio(error)
      return data.session?.access_token ?? null
    })(),
  )
}

export function renovarToken(): Promise<string | null> {
  return comTeto(
    (async () => {
      const c = await obterCliente()
      const { data, error } = await c.refreshSession()
      lancarSeTransitorio(error)
      return error ? null : (data.session?.access_token ?? null)
    })(),
  )
}

export async function lerConta(): Promise<{ id: string; email: string } | null> {
  if (!temSessaoSalva()) return null
  return comTeto(
    (async () => {
      const c = await obterCliente()
      const { data, error } = await c.getSession()
      lancarSeTransitorio(error)
      const usuario = data.session?.user
      return usuario ? { id: usuario.id, email: usuario.email ?? '' } : null
    })(),
  )
}

/** Sair deste aparelho nunca depende de rede nem da biblioteca ter carregado. */
export async function sair(): Promise<void> {
  try {
    await comTeto(
      (async () => {
        const c = await obterCliente()
        await c.signOut({ scope: 'local' })
      })(),
      TETO_SAIR_MS,
    )
  } catch {
    try {
      localStorage.removeItem(CHAVE_SESSAO)
    } catch {
      // sem armazenamento, não há sessão salva a remover
    }
  }
}

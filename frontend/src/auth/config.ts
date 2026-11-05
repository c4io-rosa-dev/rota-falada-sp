export type ConfigAuth = { url: string; chave: string }

type Ambiente = { VITE_SUPABASE_URL?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string }

/**
 * A publishable key é pública por desenho e fica no bundle. Quem barra chave secreta ou JWT é o
 * build (guardaChaves.ts, em vite.config.ts), porque aqui o valor já estaria publicado; esta
 * conferência só desliga o login num bundle feito sem aquela guarda. Cada variável é lida pelo
 * nome: passar o objeto de ambiente inteiro faria o Vite embutir toda variável VITE_ no bundle.
 */
export function lerConfigAuth(
  ambiente: Ambiente = {
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  },
): ConfigAuth | null {
  const url = ambiente.VITE_SUPABASE_URL
  const chave = ambiente.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !chave || !chave.startsWith('sb_publishable_')) return null
  return { url, chave }
}

export const MSG_LOGIN_DESLIGADO =
  'O login não está disponível neste ambiente. Você pode planejar rotas e ver barreiras sem conta.'

/**
 * `volta` só aceita caminho interno. Quem decide é o parser do navegador, com a origem:
 * comparar o texto deixaria passar barra invertida, tab e quebra de linha, que ele normaliza.
 */
export function voltaSegura(valor: string | null): string {
  if (!valor?.startsWith('/')) return '/conta'
  try {
    const url = new URL(valor, window.location.origin)
    if (url.origin !== window.location.origin) return '/conta'
    // "/.//host" passa pela origem e normaliza para "//host", relativo ao protocolo
    return url.pathname.startsWith('//') ? '/conta' : url.pathname + url.search + url.hash
  } catch {
    return '/conta'
  }
}

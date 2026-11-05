const PREFIXO_PUBLICO = 'sb_publishable_'
const CARA_DE_SEGREDO = /^(sb_secret_|eyJ)/

/**
 * Roda no build (vite.config.ts): tudo o que começa com VITE_ pode acabar no JS público, e a
 * conferência em tempo de execução chegaria tarde. A mensagem nunca repete o valor, porque o log
 * do build também fica guardado.
 */
export function conferirChaves(ambiente: Record<string, string | undefined>): void {
  const chave = ambiente.VITE_SUPABASE_PUBLISHABLE_KEY
  if (chave && !chave.startsWith(PREFIXO_PUBLICO)) {
    throw new Error(`VITE_SUPABASE_PUBLISHABLE_KEY precisa começar com ${PREFIXO_PUBLICO}. O build parou para não publicar o valor.`)
  }
  for (const [nome, valor] of Object.entries(ambiente)) {
    if (nome.startsWith('VITE_') && valor && CARA_DE_SEGREDO.test(valor)) {
      throw new Error(`${nome} parece uma chave secreta ou um JWT. O build parou para não publicar o valor.`)
    }
  }
}

import { vi } from 'vitest'

/** Substitui auth/cliente nos testes: nenhuma rede e nenhum import de auth-js. */
export const CHAVE_SESSAO = 'rf-sessao'
export const temSessaoSalva = vi.fn(() => false)
export const obterToken = vi.fn(async (): Promise<string | null> => null)
export const renovarToken = vi.fn(async (): Promise<string | null> => null)
export const lerConta = vi.fn(async (): Promise<{ id: string; email: string } | null> => null)
export const enviarCodigo = vi.fn(async (): Promise<void> => {})
export const verificarCodigo = vi.fn(async (): Promise<void> => {})
export const sair = vi.fn(async (): Promise<void> => {})

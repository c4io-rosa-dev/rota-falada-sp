import type { components } from './types.gen'

export type Fonte = components['schemas']['FonteOut']

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export function apiUrl(caminho: string): string {
  return BASE + caminho
}

export async function listarFontes(): Promise<Fonte[]> {
  const resposta = await fetch(apiUrl('/api/fontes'))
  if (!resposta.ok) {
    throw new Error(`Não foi possível carregar as fontes (HTTP ${resposta.status}).`)
  }
  return resposta.json()
}

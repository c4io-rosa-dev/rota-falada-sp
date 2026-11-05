import { vi } from 'vitest'

type Saida = Response | (() => Response | Promise<Response>)

function responder(saida: Saida): Promise<Response> | Response {
  return typeof saida === 'function' ? saida() : saida.clone()
}

/**
 * fetch falso por tabela: 'GET /api/geocode' -> resposta. `/health` responde ok salvo
 * indicação. Rota fora da tabela lança erro, para o teste não passar por acidente. O
 * falso respeita o `signal`, como o de verdade.
 */
export function apiFalsa(tabela: Record<string, Saida>) {
  const chamadas: { metodo: string; caminho: string; url: string; init: RequestInit }[] = []
  const falso = vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url)
    const metodo = init.method ?? 'GET'
    const chave = `${metodo} ${u.pathname}`
    chamadas.push({ metodo, caminho: u.pathname, url, init })
    if (init.signal?.aborted) throw new DOMException('Cancelado', 'AbortError')
    if (chave === 'GET /health' && !tabela[chave]) return Response.json({ status: 'ok', banco: 'ok' })
    const saida = tabela[chave]
    if (!saida) throw new Error(`apiFalsa: rota não prevista: ${chave}`)
    return responder(saida)
  })
  vi.stubGlobal('fetch', falso)
  return { chamadas, falso, de: (chave: string) => chamadas.filter((c) => `${c.metodo} ${c.caminho}` === chave) }
}

export function erroApi(status: number, detail: unknown) {
  return Response.json({ detail }, { status })
}

import { interpretarRange } from './range'
import type { Env, MetadadosMapa, ObjetoMapa } from './tipos'

// Só o arquivo versionado do mapa; nada de listagem, de query string nem de caminho relativo.
const CAMINHO_MAPA = /^\/mapa\/(rota-falada-sp-\d{8}\.pmtiles)$/

const CACHE_LONGO = 'public, max-age=31536000, immutable, no-transform'

function cabecalhosDoArquivo(objeto: ObjetoMapa): Headers {
  return new Headers({
    'Content-Type': 'application/octet-stream',
    'Cache-Control': CACHE_LONGO,
    'Accept-Ranges': 'bytes',
    ETag: objeto.httpEtag,
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  })
}

function erro(status: number, extras: Record<string, string> = {}): Response {
  return new Response(null, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      ...extras,
    },
  })
}

/** Separa uma lista de ETags (`"a", W/"b"`) e devolve as etiquetas sem o prefixo fraco. */
function etiquetas(valor: string): string[] {
  return valor
    .split(',')
    .map((parte) => parte.trim())
    .filter((parte) => parte !== '')
    .map((parte) => (parte.startsWith('W/') ? parte.slice(2) : parte))
}

function casaNoneMatch(valor: string, etag: string): boolean {
  const lista = etiquetas(valor)
  return lista.includes('*') || lista.includes(etag)
}

function casaMatch(valor: string, etag: string): boolean {
  // If-Match usa comparação forte: uma etiqueta fraca nunca casa
  const lista = valor
    .split(',')
    .map((parte) => parte.trim())
    .filter((parte) => parte !== '')
  return lista.includes('*') || lista.includes(etag)
}

/**
 * If-Range (RFC 9110, 13.1.5): o Range só vale se a etiqueta for exatamente a ETag forte atual.
 * Uma data (o arquivo não tem Last-Modified) ou uma etiqueta fraca nunca casa: serve o arquivo inteiro.
 */
function rangeValeComIfRange(valor: string | null, etag: string): boolean {
  if (valor === null) return true
  const etiqueta = valor.trim()
  return !etiqueta.startsWith('W/') && etiqueta === etag
}

/**
 * Atende /mapa/<arquivo>.pmtiles a partir do R2, com Range, ETag e cache longo.
 * Não registra nada: o caminho e o Range de um pedido de mapa indicam a região que a pessoa olha.
 *
 * Ordem: 405, 403, 404 (nome), 503 (sem binding), metadados em memória (head só na primeira vez),
 * 412 (If-Match), 304 (If-None-Match), If-Range, 416, HEAD, 206 e 200 (RFC 9110, 13.2.2).
 */
export function responderMapa(pedido: Request, env: Env, metadados: MetadadosMapa): Promise<Response> {
  return atender(pedido, env, metadados, false)
}

async function atender(pedido: Request, env: Env, metadados: MetadadosMapa, refeito: boolean): Promise<Response> {
  const metodo = pedido.method
  if (metodo !== 'GET' && metodo !== 'HEAD') return erro(405, { Allow: 'GET, HEAD' })

  if (pedido.headers.get('Sec-Fetch-Site') === 'cross-site') return erro(403)

  const url = new URL(pedido.url)
  const casou = CAMINHO_MAPA.exec(url.pathname)
  if (!casou || pedido.url.includes('?')) return erro(404)
  const chave = casou[1]

  const bucket = env.MAPAS
  if (!bucket) return erro(503)

  try {
    let objeto = metadados.get(chave)
    if (!objeto) {
      const cabeca = await bucket.head(chave)
      if (!cabeca) return erro(404)
      objeto = { size: cabeca.size, httpEtag: cabeca.httpEtag }
      metadados.set(chave, objeto)
    }

    const cabecalhos = cabecalhosDoArquivo(objeto)

    const ifMatch = pedido.headers.get('If-Match')
    if (ifMatch !== null && !casaMatch(ifMatch, objeto.httpEtag)) return erro(412)

    const ifNoneMatch = pedido.headers.get('If-None-Match')
    if (ifNoneMatch !== null && casaNoneMatch(ifNoneMatch, objeto.httpEtag)) {
      return new Response(null, { status: 304, headers: cabecalhos })
    }

    const range = rangeValeComIfRange(pedido.headers.get('If-Range'), objeto.httpEtag) ? pedido.headers.get('Range') : null
    const intervalo = interpretarRange(range, objeto.size)
    if (intervalo === 'invalido') {
      // erro não vai para cache nenhum; o Content-Range com o tamanho é o que o pmtiles lê
      return erro(416, { 'Content-Range': `bytes */${objeto.size}` })
    }

    if (metodo === 'HEAD') {
      cabecalhos.set('Content-Length', String(objeto.size))
      return new Response(null, { status: 200, headers: cabecalhos })
    }

    const resultado = intervalo ? await bucket.get(chave, { range: intervalo }) : await bucket.get(chave)
    if (!resultado) {
      metadados.delete(chave)
      return erro(404)
    }

    // Arquivo trocado no bucket com o mesmo nome: o tamanho e a ETag guardados ficaram velhos.
    // Refaz uma vez a partir do head; se mudar de novo no meio, 503 (nunca mistura as duas versões).
    if (resultado.httpEtag !== objeto.httpEtag || resultado.size !== objeto.size) {
      await resultado.body.cancel()
      metadados.delete(chave)
      return refeito ? erro(503) : atender(pedido, env, metadados, true)
    }

    if (intervalo) {
      const fim = intervalo.offset + intervalo.length - 1
      cabecalhos.set('Content-Range', `bytes ${intervalo.offset}-${fim}/${objeto.size}`)
      cabecalhos.set('Content-Length', String(intervalo.length))
      return new Response(resultado.body, { status: 206, headers: cabecalhos })
    }

    cabecalhos.set('Content-Length', String(objeto.size))
    return new Response(resultado.body, { status: 200, headers: cabecalhos })
  } catch {
    // um erro do R2 pode vir de um arquivo trocado: o próximo pedido relê o head
    metadados.delete(chave)
    return erro(503)
  }
}

import type { BrowserContext } from '@playwright/test'
import { bucketDoArquivo, gerarPmtilesFalso, tileDoPonto, type Limites } from '../src/test/pmtilesFalso'
import { responderMapa } from '../worker/servirMapa'
import type { MetadadosMapa } from '../worker/tipos'
import { ROTA_NAVEGAVEL } from './apoioNavegacao'

/** O próprio site (vite preview). Toda outra origem é terceiro. */
const SITE = 'http://localhost:4173'
/**
 * O zoom do único tile da fixture. Tem de ser 15, o maxzoom da fonte no estilo (e do arquivo real):
 * o maxzoom do estilo vence o do cabeçalho, então o MapLibre pede tiles z15 e amplia até o 17. Com
 * um tile z14, nenhum tile casaria e o mapa ficaria vazio sem erro nenhum.
 */
const ZOOM_FIXTURE = 15

/** [oeste, sul, leste, norte] da rota em L de apoioNavegacao.ts. */
function caixaDaRota(): Limites {
  const coords = ROTA_NAVEGAVEL.geometria.coordinates as [number, number][] // [lon, lat]
  const lons = coords.map((c) => c[0])
  const lats = coords.map((c) => c[1])
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]
}

const CAIXA = caixaDaRota()
/** O tile z15 que cobre o começo da rota (A). */
const TILE = tileDoPonto(ROTA_NAVEGAVEL.geometria.coordinates[0][1], ROTA_NAVEGAVEL.geometria.coordinates[0][0], ZOOM_FIXTURE)
const ARQUIVO = gerarPmtilesFalso({ z: ZOOM_FIXTURE, x: TILE.x, y: TILE.y, limites: CAIXA })

export type PedidoMapa = { url: string; caminho: string; metodo: string; range: string | null }

/**
 * Serve /mapa/* com o código de verdade do Worker (worker/servirMapa.ts: Range, ETag, 304, 412,
 * 416, Cache-Control, CORP, 403 de outro site) sobre um bucket R2 falso com o PMTiles mínimo da
 * fixture; com status404, o bucket fica vazio. É context.route, não page.route: só ele pega também
 * os pedidos do Web Worker do MapLibre. O `vite preview` devolveria o index.html em /mapa/*, então
 * nada aqui chega a ele. O que este apoio NÃO prova (workerd, assets.run_worker_first, binding do
 * R2): a prévia por branch do Workers Builds, antes do merge (scripts/mapa/LEIAME.md).
 */
export async function servirMapaFalso(context: BrowserContext, opcoes: { status404?: boolean } = {}) {
  const pedidos: PedidoMapa[] = []
  const bucket = bucketDoArquivo(ARQUIVO, { vazio: opcoes.status404 })
  // como num isolate do Worker: os metadados ficam em memória entre os pedidos deste contexto
  const metadados: MetadadosMapa = new Map()
  await context.route('**/mapa/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.origin !== SITE) return route.fallback()
    const todos = await req.allHeaders()
    const range = todos['range'] ?? null
    pedidos.push({ url: req.url(), caminho: url.pathname, metodo: req.method(), range })
    // pseudo-cabeçalhos do HTTP/2 (":authority") não cabem num Request
    const cabecalhos = Object.fromEntries(Object.entries(todos).filter(([nome]) => !nome.startsWith(':')))
    const resposta = await responderMapa(new Request(req.url(), { method: req.method(), headers: cabecalhos }), { MAPAS: bucket }, metadados)
    const saida: Record<string, string> = {}
    resposta.headers.forEach((valor, nome) => {
      saida[nome] = valor
    })
    return route.fulfill({ status: resposta.status, headers: saida, body: Buffer.from(await resposta.arrayBuffer()) })
  })
  return { pedidos }
}

/**
 * Aborta e registra todo pedido cuja origem não seja o próprio site; os do site seguem
 * (inclusive para servirMapaFalso). `todos` guarda cada URL que passou pelo contexto, na ordem.
 * Rotas de página (page.route da API simulada) têm precedência e não passam por aqui.
 */
export async function bloquearTerceiros(context: BrowserContext) {
  const externos: string[] = []
  const todos: string[] = []
  await context.route('**/*', (route) => {
    const url = route.request().url()
    todos.push(url)
    if (new URL(url).origin === SITE) return route.fallback()
    externos.push(url)
    return route.abort('blockedbyclient')
  })
  return { externos, todos }
}

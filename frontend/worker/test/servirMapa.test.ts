// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { responderMapa } from '../servirMapa'
import type { BucketMapa, Env, ObjetoMapa, ObjetoMapaComCorpo } from '../tipos'

const CHAVE = 'rota-falada-sp-20261109.pmtiles'
const URL_MAPA = `https://rota-falada-sp.exemplo.dev/mapa/${CHAVE}`
const ETAG = '"etag-do-arquivo"'
const DADOS = Uint8Array.from({ length: 100 }, (_, i) => i)

type Chamada =
  | { tipo: 'head'; chave: string }
  | { tipo: 'get'; chave: string; opcoes?: { range?: { offset: number; length: number } } }

function corpoDe(bytes: Uint8Array<ArrayBuffer>): ReadableStream {
  return new Response(bytes).body as ReadableStream
}

function r2Falso(
  opcoes: { vazio?: boolean; getNulo?: boolean; getLanca?: boolean; headLanca?: boolean; getEtag?: string } = {},
) {
  const chamadas: Chamada[] = []
  /** O arquivo no bucket agora (um teste pode trocá-lo, como um reenvio com o mesmo nome). */
  const arquivo = { httpEtag: ETAG, dados: DADOS }
  const bucket: BucketMapa = {
    async head(chave) {
      chamadas.push({ tipo: 'head', chave })
      if (opcoes.headLanca) throw new Error('falha do R2')
      if (opcoes.vazio || chave !== CHAVE) return null
      const objeto: ObjetoMapa = { size: arquivo.dados.length, httpEtag: arquivo.httpEtag }
      return objeto
    },
    async get(chave, op) {
      chamadas.push({ tipo: 'get', chave, opcoes: op })
      if (opcoes.getLanca) throw new Error('falha do R2')
      if (opcoes.getNulo || opcoes.vazio || chave !== CHAVE) return null
      const r = op?.range
      const fatia = r ? arquivo.dados.slice(r.offset, r.offset + r.length) : arquivo.dados
      const objeto: ObjetoMapaComCorpo = {
        size: arquivo.dados.length,
        httpEtag: opcoes.getEtag ?? arquivo.httpEtag,
        body: corpoDe(fatia),
      }
      return objeto
    },
  }
  return { bucket, chamadas, arquivo }
}

function pedido(caminho = `/mapa/${CHAVE}`, init: RequestInit = {}): Request {
  return new Request(new URL(caminho, URL_MAPA).toString(), init)
}

const FIXOS_SUCESSO = {
  'content-type': 'application/octet-stream',
  'cache-control': 'public, max-age=31536000, immutable, no-transform',
  'accept-ranges': 'bytes',
  etag: ETAG,
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
}

function cabecalhos(resposta: Response): Record<string, string> {
  const saida: Record<string, string> = {}
  resposta.headers.forEach((valor, nome) => {
    saida[nome] = valor
  })
  return saida
}

function semCors(resposta: Response) {
  const nomes = Object.keys(cabecalhos(resposta))
  expect(nomes.filter((n) => n.startsWith('access-control-'))).toEqual([])
}

function esperaErro(resposta: Response, status: number) {
  expect(resposta.status).toBe(status)
  expect(resposta.headers.get('cache-control')).toBe('no-store')
  expect(resposta.headers.get('x-content-type-options')).toBe('nosniff')
  semCors(resposta)
}

async function bytesDe(resposta: Response): Promise<number[]> {
  return [...new Uint8Array(await resposta.arrayBuffer())]
}

describe('responderMapa', () => {
  it('405 para método diferente de GET e HEAD, com Allow', async () => {
    for (const metodo of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
      const { bucket, chamadas } = r2Falso()
      const resposta = await responderMapa(pedido(undefined, { method: metodo }), { MAPAS: bucket }, new Map())
      esperaErro(resposta, 405)
      expect(resposta.headers.get('allow')).toBe('GET, HEAD')
      expect(chamadas).toEqual([])
    }
  })

  it('403 para pedido de outro site', async () => {
    const { bucket, chamadas } = r2Falso()
    const resposta = await responderMapa(
      pedido(undefined, { headers: { 'Sec-Fetch-Site': 'cross-site' } }),
      { MAPAS: bucket },
      new Map(),
    )
    esperaErro(resposta, 403)
    expect(chamadas).toEqual([])
  })

  it('aceita pedido da mesma origem e pedido sem Sec-Fetch-Site', async () => {
    for (const headers of [{ 'Sec-Fetch-Site': 'same-origin' }, {}] as Record<string, string>[]) {
      const { bucket } = r2Falso()
      const resposta = await responderMapa(pedido(undefined, { headers }), { MAPAS: bucket }, new Map())
      expect(resposta.status).toBe(200)
    }
  })

  it.each([
    ['/mapa/'],
    ['/mapa'],
    ['/mapa/../index.html'],
    ['/mapa/%2e%2e/index.html'],
    ['/mapa/%2E%2E/segredo'],
    ['/mapa/..%2findex.html'],
    ['/mapa/outro-arquivo.pmtiles'],
    ['/mapa/rota-falada-sp-2026110.pmtiles'],
    ['/mapa/rota-falada-sp-202611091.pmtiles'],
    ['/mapa/rota-falada-sp-20261109.pmtiles.bak'],
    ['/mapa//rota-falada-sp-20261109.pmtiles'],
    ['/mapa/sub/rota-falada-sp-20261109.pmtiles'],
    [`/mapa/${CHAVE}?x=1`],
    [`/mapa/${CHAVE}?`],
    ['/outra/rota-falada-sp-20261109.pmtiles'],
  ])('404 com corpo vazio para %s', async (caminho) => {
    const { bucket, chamadas } = r2Falso()
    const resposta = await responderMapa(pedido(caminho), { MAPAS: bucket }, new Map())
    esperaErro(resposta, 404)
    expect(await resposta.text()).toBe('')
    expect(chamadas).toEqual([])
  })

  it('503 sem o binding do R2', async () => {
    const env: Env = {}
    const resposta = await responderMapa(pedido(), env, new Map())
    esperaErro(resposta, 503)
  })

  it('404 sem cache quando o arquivo não existe no R2', async () => {
    const { bucket } = r2Falso({ vazio: true })
    const metadados = new Map()
    const resposta = await responderMapa(pedido(), { MAPAS: bucket }, metadados)
    esperaErro(resposta, 404)
    expect(metadados.size).toBe(0)
  })

  it('503 quando o head do R2 lança', async () => {
    const { bucket } = r2Falso({ headLanca: true })
    esperaErro(await responderMapa(pedido(), { MAPAS: bucket }, new Map()), 503)
  })

  it('503 quando o get do R2 lança', async () => {
    const { bucket } = r2Falso({ getLanca: true })
    esperaErro(await responderMapa(pedido(), { MAPAS: bucket }, new Map()), 503)
  })

  it('200 sem Range com o arquivo inteiro e os cabeçalhos exatos', async () => {
    const { bucket, chamadas } = r2Falso()
    const resposta = await responderMapa(pedido(), { MAPAS: bucket }, new Map())
    expect(resposta.status).toBe(200)
    expect(cabecalhos(resposta)).toEqual({ ...FIXOS_SUCESSO, 'content-length': '100' })
    expect(await bytesDe(resposta)).toEqual([...DADOS])
    expect(chamadas).toEqual([
      { tipo: 'head', chave: CHAVE },
      { tipo: 'get', chave: CHAVE, opcoes: undefined },
    ])
  })

  it('206 com Range: o R2 recebe offset e length, nunca os cabeçalhos', async () => {
    const { bucket, chamadas } = r2Falso()
    const resposta = await responderMapa(
      pedido(undefined, { headers: { Range: 'bytes=10-19' } }),
      { MAPAS: bucket },
      new Map(),
    )
    expect(resposta.status).toBe(206)
    expect(cabecalhos(resposta)).toEqual({
      ...FIXOS_SUCESSO,
      'content-range': 'bytes 10-19/100',
      'content-length': '10',
    })
    expect(await bytesDe(resposta)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
    expect(chamadas[1]).toEqual({ tipo: 'get', chave: CHAVE, opcoes: { range: { offset: 10, length: 10 } } })
  })

  it('206 com sufixo e fim preso ao tamanho', async () => {
    const { bucket } = r2Falso()
    const sufixo = await responderMapa(pedido(undefined, { headers: { Range: 'bytes=-5' } }), { MAPAS: bucket }, new Map())
    expect(sufixo.headers.get('content-range')).toBe('bytes 95-99/100')
    expect(await bytesDe(sufixo)).toEqual([95, 96, 97, 98, 99])
    const preso = await responderMapa(
      pedido(undefined, { headers: { Range: 'bytes=98-500' } }),
      { MAPAS: bucket },
      new Map(),
    )
    expect(preso.headers.get('content-range')).toBe('bytes 98-99/100')
    expect(preso.headers.get('content-length')).toBe('2')
  })

  it('416 para Range que não cabe, sem cache, com Content-Range bytes */tamanho e sem get', async () => {
    const { bucket, chamadas } = r2Falso()
    const resposta = await responderMapa(
      pedido(undefined, { headers: { Range: 'bytes=100-' } }),
      { MAPAS: bucket },
      new Map(),
    )
    esperaErro(resposta, 416)
    expect(resposta.headers.get('content-range')).toBe('bytes */100')
    expect(resposta.headers.get('cache-control')).not.toMatch(/immutable|max-age/)
    expect(chamadas.some((c) => c.tipo === 'get')).toBe(false)
  })

  it.each([['vários intervalos', 'bytes=0-1,4-5'], ['outra unidade', 'items=0-1'], ['mal formado', 'bytes=lixo']])(
    'Range ignorável (%s) serve 200 com o arquivo inteiro',
    async (_nome, range) => {
      const { bucket } = r2Falso()
      const resposta = await responderMapa(pedido(undefined, { headers: { Range: range } }), { MAPAS: bucket }, new Map())
      expect(resposta.status).toBe(200)
      expect(await bytesDe(resposta)).toEqual([...DADOS])
    },
  )

  it('HEAD responde 200 sem corpo e sem chamar get', async () => {
    const { bucket, chamadas } = r2Falso()
    const resposta = await responderMapa(pedido(undefined, { method: 'HEAD' }), { MAPAS: bucket }, new Map())
    expect(resposta.status).toBe(200)
    expect(cabecalhos(resposta)).toEqual({ ...FIXOS_SUCESSO, 'content-length': '100' })
    expect(resposta.body).toBeNull()
    expect(chamadas).toEqual([{ tipo: 'head', chave: CHAVE }])
  })

  it.each([[ETAG], ['*'], [`"outro", ${ETAG}`], [`W/${ETAG}`]])(
    '304 sem get quando If-None-Match é %s',
    async (valor) => {
      const { bucket, chamadas } = r2Falso()
      const resposta = await responderMapa(
        pedido(undefined, { headers: { 'If-None-Match': valor } }),
        { MAPAS: bucket },
        new Map(),
      )
      expect(resposta.status).toBe(304)
      expect(cabecalhos(resposta)).toEqual(FIXOS_SUCESSO)
      expect(resposta.body).toBeNull()
      expect(chamadas.some((c) => c.tipo === 'get')).toBe(false)
    },
  )

  it('If-None-Match diferente segue para 200', async () => {
    const { bucket } = r2Falso()
    const resposta = await responderMapa(
      pedido(undefined, { headers: { 'If-None-Match': '"velho"' } }),
      { MAPAS: bucket },
      new Map(),
    )
    expect(resposta.status).toBe(200)
  })

  it('412 sem get quando If-Match é diferente', async () => {
    const { bucket, chamadas } = r2Falso()
    const resposta = await responderMapa(
      pedido(undefined, { headers: { 'If-Match': '"velho"', Range: 'bytes=0-9' } }),
      { MAPAS: bucket },
      new Map(),
    )
    esperaErro(resposta, 412)
    expect(chamadas.some((c) => c.tipo === 'get')).toBe(false)
  })

  it.each([[ETAG], ['*']])('If-Match %s segue para 206', async (valor) => {
    const { bucket } = r2Falso()
    const resposta = await responderMapa(
      pedido(undefined, { headers: { 'If-Match': valor, Range: 'bytes=0-9' } }),
      { MAPAS: bucket },
      new Map(),
    )
    expect(resposta.status).toBe(206)
  })

  it('guarda os metadados: o segundo pedido não chama head', async () => {
    const { bucket, chamadas } = r2Falso()
    const metadados = new Map()
    await responderMapa(pedido(undefined, { headers: { Range: 'bytes=0-9' } }), { MAPAS: bucket }, metadados)
    await responderMapa(pedido(undefined, { headers: { Range: 'bytes=10-19' } }), { MAPAS: bucket }, metadados)
    expect(chamadas.filter((c) => c.tipo === 'head')).toHaveLength(1)
    expect(chamadas.filter((c) => c.tipo === 'get')).toHaveLength(2)
    expect(metadados.get(CHAVE)).toEqual({ size: 100, httpEtag: ETAG })
  })

  it('If-Match que não casa vence o If-None-Match que casa: 412, não 304 (RFC 9110, 13.2.2)', async () => {
    const { bucket } = r2Falso()
    const resposta = await responderMapa(
      pedido(undefined, { headers: { 'If-Match': '"velho"', 'If-None-Match': ETAG } }),
      { MAPAS: bucket },
      new Map(),
    )
    esperaErro(resposta, 412)
  })

  it('If-Range igual à ETag forte mantém o Range (206)', async () => {
    const { bucket } = r2Falso()
    const resposta = await responderMapa(
      pedido(undefined, { headers: { Range: 'bytes=0-9', 'If-Range': ETAG } }),
      { MAPAS: bucket },
      new Map(),
    )
    expect(resposta.status).toBe(206)
  })

  it.each([['outra versão', '"velho"'], ['etiqueta fraca', `W/${ETAG}`], ['data', 'Mon, 09 Nov 2026 12:00:00 GMT']])(
    'If-Range com %s ignora o Range e serve o arquivo inteiro (200)',
    async (_nome, valor) => {
      const { bucket, chamadas } = r2Falso()
      const resposta = await responderMapa(
        pedido(undefined, { headers: { Range: 'bytes=0-9', 'If-Range': valor } }),
        { MAPAS: bucket },
        new Map(),
      )
      expect(resposta.status).toBe(200)
      expect(resposta.headers.get('content-range')).toBeNull()
      expect(await bytesDe(resposta)).toEqual([...DADOS])
      expect(chamadas.filter((c) => c.tipo === 'get')).toEqual([{ tipo: 'get', chave: CHAVE, opcoes: undefined }])
    },
  )

  it('arquivo reenviado com o mesmo nome: a ETag do get não bate, relê o head e responde com a versão nova', async () => {
    const { bucket, chamadas, arquivo } = r2Falso()
    const metadados = new Map()
    await responderMapa(pedido(undefined, { method: 'HEAD' }), { MAPAS: bucket }, metadados)
    // reenvio: outro conteúdo e outro tamanho, mesmo nome
    arquivo.httpEtag = '"etag-nova"'
    arquivo.dados = Uint8Array.from({ length: 50 }, (_, i) => 200 - i)
    const resposta = await responderMapa(pedido(undefined, { headers: { Range: 'bytes=0-9' } }), { MAPAS: bucket }, metadados)
    expect(resposta.status).toBe(206)
    expect(resposta.headers.get('etag')).toBe('"etag-nova"')
    expect(resposta.headers.get('content-range')).toBe('bytes 0-9/50')
    expect(await bytesDe(resposta)).toEqual([...arquivo.dados.slice(0, 10)])
    expect(chamadas.filter((c) => c.tipo === 'head')).toHaveLength(2)
    expect(metadados.get(CHAVE)).toEqual({ size: 50, httpEtag: '"etag-nova"' })
  })

  it('se a ETag do get continua diferente depois de reler, 503 e o metadado é limpo', async () => {
    const { bucket } = r2Falso({ getEtag: '"outra"' })
    const metadados = new Map()
    const resposta = await responderMapa(pedido(undefined, { headers: { Range: 'bytes=0-9' } }), { MAPAS: bucket }, metadados)
    esperaErro(resposta, 503)
    expect(metadados.has(CHAVE)).toBe(false)
  })

  it('um erro do R2 limpa o metadado guardado', async () => {
    const { bucket } = r2Falso({ getLanca: true })
    const metadados = new Map([[CHAVE, { size: 100, httpEtag: ETAG }]])
    esperaErro(await responderMapa(pedido(), { MAPAS: bucket }, metadados), 503)
    expect(metadados.has(CHAVE)).toBe(false)
  })

  it('get nulo limpa o metadado e devolve 404', async () => {
    const { bucket } = r2Falso({ getNulo: true })
    const metadados = new Map([[CHAVE, { size: 100, httpEtag: ETAG }]])
    const resposta = await responderMapa(pedido(), { MAPAS: bucket }, metadados)
    esperaErro(resposta, 404)
    expect(metadados.has(CHAVE)).toBe(false)
  })

  it('nenhuma resposta tem cabeçalho CORS, nem com Origin no pedido', async () => {
    const { bucket } = r2Falso()
    const casos: Request[] = [
      pedido(undefined, { headers: { Origin: 'https://outro.exemplo' } }),
      pedido(undefined, { headers: { Range: 'bytes=0-1', Origin: 'https://outro.exemplo' } }),
      pedido(undefined, { method: 'OPTIONS', headers: { Origin: 'https://outro.exemplo' } }),
      pedido(undefined, { method: 'HEAD' }),
      pedido('/mapa/'),
    ]
    for (const p of casos) semCors(await responderMapa(p, { MAPAS: bucket }, new Map()))
  })
})

describe('worker/index.ts', () => {
  it('o fetch padrão atende o mapa e guarda os metadados entre pedidos', async () => {
    const { default: worker } = await import('../index')
    const { bucket, chamadas } = r2Falso()
    expect((await worker.fetch(pedido(undefined, { method: 'HEAD' }), { MAPAS: bucket })).status).toBe(200)
    expect((await worker.fetch(pedido(undefined, { method: 'HEAD' }), { MAPAS: bucket })).status).toBe(200)
    expect(chamadas.filter((c) => c.tipo === 'head')).toHaveLength(1)
    expect((await worker.fetch(pedido('/mapa/'), { MAPAS: bucket })).status).toBe(404)
  })
})

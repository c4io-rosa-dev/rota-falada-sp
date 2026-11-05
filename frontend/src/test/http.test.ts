import { act, renderHook, waitFor } from '@testing-library/react'
import { ehCancelamento, ErroApi, MSG_INDISPONIVEL, MSG_REDE, MSG_TEMPO } from '../api/base'
import { calcularRota, MSG_ROTA_INDISPONIVEL, type RotaIn } from '../api/client'
import { pedir } from '../api/http'
import { useConsulta } from '../api/useConsulta'
import { apiFalsa, erroApi } from './apiFalsa'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function erroDe(p: Promise<unknown>): Promise<ErroApi> {
  try {
    await p
  } catch (e) {
    return e as ErroApi
  }
  throw new Error('deveria ter falhado')
}

describe('pedir', () => {
  it.each([
    [401, 'sessao'],
    [403, 'permissao'],
    [404, 'nao_encontrado'],
    [409, 'conflito'],
    [413, 'foto'],
    [415, 'foto'],
    [429, 'limite'],
    [503, 'indisponivel'],
  ])('traduz %i com detail em texto para o tipo %s', async (status, tipo) => {
    apiFalsa({ 'GET /x': erroApi(status, 'Mensagem do domínio.') })
    const e = await erroDe(pedir('/x'))
    expect(e).toBeInstanceOf(ErroApi)
    expect(e.tipo).toBe(tipo)
    expect(e.message).toBe('Mensagem do domínio.')
    expect(e.status).toBe(status)
  })

  it('422 com detail em texto usa o texto; com lista nunca mostra o inglês do Pydantic', async () => {
    apiFalsa({ 'GET /x': erroApi(422, 'Fora da área.') })
    expect((await erroDe(pedir('/x'))).message).toBe('Fora da área.')
    apiFalsa({ 'GET /x': erroApi(422, [{ loc: ['body', 'categoria'], msg: 'Field required', type: 'missing' }]) })
    const e = await erroDe(pedir('/x'))
    expect(e.tipo).toBe('validacao')
    expect(e.message).toBe('Confira os dados informados.')
    expect(e.campos).toEqual([{ campo: 'categoria', codigo: 'missing' }])
  })

  it('5xx sem JSON e 200 com HTML viram indisponível', async () => {
    apiFalsa({ 'GET /a': new Response('<html>', { status: 502 }) })
    expect(await erroDe(pedir('/a'))).toMatchObject({ tipo: 'indisponivel', message: MSG_INDISPONIVEL })
    apiFalsa({ 'GET /b': new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }) })
    expect(await erroDe(pedir('/b'))).toMatchObject({ tipo: 'indisponivel', message: MSG_INDISPONIVEL })
  })

  it('TypeError do fetch vira erro de rede', async () => {
    apiFalsa({
      'GET /x': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    expect(await erroDe(pedir('/x'))).toMatchObject({ tipo: 'rede', message: MSG_REDE })
  })

  it('cancelar não vira erro para a pessoa', async () => {
    apiFalsa({ 'GET /x': Response.json({}) })
    const controle = new AbortController()
    controle.abort()
    expect(ehCancelamento(await erroDe(pedir('/x', { sinal: controle.signal })))).toBe(true)
  })

  it('estoura o teto com erro de tempo', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (url.endsWith('/health')) return Response.json({ banco: 'ok' })
        return new Promise((_r, rejeitar) => {
          init.signal?.addEventListener('abort', () => rejeitar(new DOMException('x', 'AbortError')))
        })
      }),
    )
    const pendente = erroDe(pedir('/lento', { tempoMs: 1000 }))
    await vi.advanceTimersByTimeAsync(1001)
    expect(await pendente).toMatchObject({ tipo: 'tempo', message: MSG_TEMPO })
  })

  it('monta a consulta, anexa token só quando pedido e deixa o FormData definir o Content-Type', async () => {
    const api = apiFalsa({ 'GET /a': Response.json([]), 'POST /b': Response.json({}), 'POST /c': Response.json({}) })
    await pedir('/a', { consulta: { q: 'rua x', nada: undefined } })
    expect(api.de('GET /a')[0].url).toBe('http://localhost:8000/a?q=rua+x')
    expect(api.de('GET /a')[0].init.headers).toEqual({})
    await pedir('/b', { metodo: 'POST', corpo: { a: 1 }, token: 'tkn' })
    expect(api.de('POST /b')[0].init.headers).toEqual({ Authorization: 'Bearer tkn', 'Content-Type': 'application/json' })
    await pedir('/c', { metodo: 'POST', corpo: new FormData() })
    expect(api.de('POST /c')[0].init.headers).toEqual({})
  })
})

describe('calcularRota', () => {
  const pedido = {} as RotaIn

  it('503 nunca mostra o detail, que repete o texto do 404', async () => {
    apiFalsa({ 'POST /api/rotas': erroApi(503, 'Não encontramos rota acessível entre esses pontos.') })
    expect(await erroDe(calcularRota(pedido))).toMatchObject({ tipo: 'indisponivel', message: MSG_ROTA_INDISPONIVEL })
  })

  it('404 mantém o detail do backend', async () => {
    apiFalsa({ 'POST /api/rotas': erroApi(404, 'Não encontramos rota acessível entre esses pontos.') })
    expect(await erroDe(calcularRota(pedido))).toMatchObject({
      tipo: 'nao_encontrado',
      message: 'Não encontramos rota acessível entre esses pontos.',
    })
  })
})

describe('useConsulta', () => {
  it('trocar a chave nunca mostra os dados da chave anterior, nem por um commit', async () => {
    const vistos: { chave: string; dados: string | null }[] = []
    const buscas: Record<string, (v: string) => void> = {}
    const { result, rerender } = renderHook(
      ({ chave }) => {
        const c = useConsulta<string>(chave, () => new Promise((r) => (buscas[chave] = r)))
        vistos.push({ chave, dados: c.dados })
        return c
      },
      { initialProps: { chave: 'a' } },
    )
    await act(async () => buscas.a('dados de a'))
    expect(result.current.dados).toBe('dados de a')
    vistos.length = 0
    rerender({ chave: 'b' })
    expect(vistos.filter((v) => v.chave === 'b' && v.dados !== null)).toEqual([])
    expect(result.current.carregando).toBe(true)
  })

  it('chave nula não guarda nada: sem dados, sem erro e sem "carregando"', async () => {
    let chamadas = 0
    const { result, rerender } = renderHook(({ chave }: { chave: string | null }) => useConsulta<string>(chave, () => Promise.resolve(`v${++chamadas}`)), {
      initialProps: { chave: 'a' as string | null },
    })
    await waitFor(() => expect(result.current.dados).toBe('v1'))
    rerender({ chave: null })
    expect(result.current).toMatchObject({ dados: null, erro: null, carregando: false })
  })

  it('resposta de consulta cancelada é descartada, mesmo se a promessa resolver', async () => {
    const buscas: Record<string, (v: string) => void> = {}
    const { result, rerender } = renderHook(({ chave }) => useConsulta<string>(chave, () => new Promise((r) => (buscas[chave] = r))), {
      initialProps: { chave: 'a' },
    })
    rerender({ chave: 'b' })
    await act(async () => buscas.b('nova'))
    expect(result.current.dados).toBe('nova')
    await act(async () => buscas.a('velha'))
    expect(result.current).toMatchObject({ dados: 'nova', carregando: false })
  })
})

import { act, render, screen } from '@testing-library/react'
import { ErroApi, MSG_SEM_INTERNET, MSG_SEM_RESPOSTA } from '../api/base'
import { aquecerServidor, garantirAcordado, TETO_ACORDAR_MS, useEstadoServidor, VALIDADE_CONTATO_MS } from '../api/servidor'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { TEXTO_ACORDANDO, TEXTO_DEMORANDO, useEsperaServidor } from '../componentes/useEsperaServidor'

function saude(banco = 'ok') {
  return Response.json({ status: 'ok', banco })
}

function pendurado() {
  return vi.fn(
    (_url: string, init: RequestInit = {}) =>
      new Promise<Response>((_r, rejeitar) => {
        init.signal?.addEventListener('abort', () => rejeitar(new DOMException('x', 'AbortError')))
      }),
  )
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('garantirAcordado', () => {
  it('faz uma só espera para vários pedidos e não refaz logo em seguida', async () => {
    const f = vi.fn(async () => saude())
    vi.stubGlobal('fetch', f)
    await Promise.all([garantirAcordado(), garantirAcordado()])
    await garantirAcordado()
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('reconfere depois de 10 minutos sem contato', async () => {
    const f = vi.fn(async () => saude())
    vi.stubGlobal('fetch', f)
    await garantirAcordado()
    vi.setSystemTime(Date.now() + VALIDADE_CONTATO_MS + 1)
    await garantirAcordado()
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('tolera HTML com 200, 502 e TypeError até a API responder', async () => {
    const respostas = [
      () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
      () => new Response('x', { status: 502 }),
      () => {
        throw new TypeError('rede')
      },
      () => saude(),
    ]
    const f = vi.fn(async () => respostas.shift()!())
    vi.stubGlobal('fetch', f)
    const espera = garantirAcordado()
    await vi.advanceTimersByTimeAsync(16_000)
    await espera
    expect(f).toHaveBeenCalledTimes(4)
  })

  it('200 com banco indisponível é serviço fora, sem repetir', async () => {
    const f = vi.fn(async () => saude('indisponivel'))
    vi.stubGlobal('fetch', f)
    await expect(garantirAcordado()).rejects.toMatchObject({ tipo: 'indisponivel' })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('desiste no teto de 120 s', async () => {
    vi.stubGlobal('fetch', pendurado())
    const espera = garantirAcordado().catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(TETO_ACORDAR_MS + 40_000)
    const erro = await espera
    expect(erro).toBeInstanceOf(ErroApi)
    expect(erro).toMatchObject({ tipo: 'indisponivel', message: MSG_SEM_RESPOSTA })
  })

  it('perder a rede durante a espera diz que falta conexão, sem chamar de servidor dormindo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('rede')
    }))
    const espera = garantirAcordado().catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1_000)
    vi.stubGlobal('navigator', { onLine: false })
    await vi.advanceTimersByTimeAsync(6_000)
    expect(await espera).toMatchObject({ tipo: 'rede', message: MSG_SEM_INTERNET })
  })

  it('o texto de espera não afirma a causa que não sabe', () => {
    expect(TEXTO_ACORDANDO).not.toMatch(/estava dormindo/)
    expect(TEXTO_ACORDANDO).toMatch(/pode estar acordando/)
    expect(TEXTO_ACORDANDO).toMatch(/sinal pode estar fraco/)
  })

  it('cancelar solta quem chamou, sem derrubar a espera dos outros', async () => {
    let responder: (r: Response) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => (responder = r))))
    const controle = new AbortController()
    const cancelada = garantirAcordado(controle.signal).catch((e: unknown) => e)
    const outra = garantirAcordado()
    controle.abort()
    expect(await cancelada).toBeInstanceOf(DOMException)
    responder(saude())
    await expect(outra).resolves.toBeUndefined()
  })

  it('offline falha na hora, sem chamar a rede', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    vi.stubGlobal('navigator', { onLine: false })
    await expect(garantirAcordado()).rejects.toMatchObject({ tipo: 'rede' })
    expect(f).not.toHaveBeenCalled()
  })
})

function Espera({ ativo }: { ativo: boolean }) {
  const texto = useEsperaServidor(ativo)
  const estado = useEstadoServidor()
  return (
    <p data-testid="saida" data-estado={estado}>
      {texto ?? 'sem aviso'}
    </p>
  )
}

describe('useEsperaServidor', () => {
  it('aquecer em silêncio: nada aparece nem é anunciado sem ação da pessoa', async () => {
    vi.stubGlobal('fetch', pendurado())
    aquecerServidor()
    render(
      <RegiaoViva>
        <Espera ativo={false} />
      </RegiaoViva>,
    )
    await act(() => vi.advanceTimersByTimeAsync(4_100))
    expect(screen.getByTestId('saida')).toHaveTextContent('sem aviso')
    expect(screen.getByTestId('saida')).toHaveAttribute('data-estado', 'acordando')
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('mostra os dois estágios para quem espera e escreve na região única', async () => {
    vi.stubGlobal('fetch', pendurado())
    aquecerServidor()
    render(
      <RegiaoViva>
        <Espera ativo />
      </RegiaoViva>,
    )
    await act(() => vi.advanceTimersByTimeAsync(4_200))
    expect(screen.getByTestId('saida')).toHaveTextContent(TEXTO_ACORDANDO)
    expect(screen.getByRole('status')).toHaveTextContent(TEXTO_ACORDANDO)
    await act(() => vi.advanceTimersByTimeAsync(36_200))
    expect(screen.getByTestId('saida')).toHaveTextContent(TEXTO_DEMORANDO)
    expect(screen.getByRole('status')).toHaveTextContent(TEXTO_DEMORANDO)
  })
})

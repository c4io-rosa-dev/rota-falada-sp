import { act, fireEvent, render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { CampoEndereco } from '../componentes/CampoEndereco'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { DEBOUNCE_MS, useBuscaEndereco } from '../componentes/useBuscaEndereco'
import { apiFalsa, erroApi } from './apiFalsa'
import { endereco } from './fixturasRota'

const A = endereco(1, 'Rua A, 1 · Vila Mariana')
const B = endereco(2, 'Rua B, 2 · Vila Mariana')

function Formulario({ aoEnviar = () => {} }: { aoEnviar?: () => void }) {
  const busca = useBuscaEndereco('Origem')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        aoEnviar()
      }}
    >
      <CampoEndereco id="origem" rotulo="Origem" busca={busca} />
      <p data-testid="escolha">{busca.escolha?.rotulo ?? 'nada'}</p>
    </form>
  )
}

function montar(aoEnviar?: () => void) {
  render(
    <RegiaoViva>
      <main>
        <Formulario aoEnviar={aoEnviar} />
      </main>
    </RegiaoViva>,
  )
  return screen.getByRole('combobox', { name: 'Origem' }) as HTMLInputElement
}

async function digitar(campo: HTMLInputElement, texto: string) {
  fireEvent.change(campo, { target: { value: texto } })
  await act(() => vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1))
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('CampoEndereco', () => {
  it('não busca com menos de 3 letras nem antes do debounce', async () => {
    const api = apiFalsa({ 'GET /api/geocode': Response.json([A]) })
    const campo = montar()
    await digitar(campo, 'ru')
    expect(api.de('GET /api/geocode')).toHaveLength(0)
    fireEvent.change(campo, { target: { value: 'rua' } })
    await act(() => vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1))
    expect(api.de('GET /api/geocode')).toHaveLength(0)
    await act(() => vi.advanceTimersByTimeAsync(2))
    expect(api.de('GET /api/geocode')).toHaveLength(1)
    expect(new URL(api.de('GET /api/geocode')[0].url).searchParams.get('q')).toBe('rua')
  })

  it('cada tecla aborta a busca anterior', async () => {
    const sinais: AbortSignal[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit = {}) => {
        if (url.endsWith('/health')) return Promise.resolve(Response.json({ banco: 'ok' }))
        sinais.push(init.signal!)
        return new Promise<Response>(() => {})
      }),
    )
    const campo = montar()
    await digitar(campo, 'rua')
    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(sinais).toHaveLength(1)
    fireEvent.change(campo, { target: { value: 'rua a' } })
    expect(sinais[0].aborted).toBe(true)
  })

  it('composição (acentos) suspende o debounce', async () => {
    const api = apiFalsa({ 'GET /api/geocode': Response.json([A]) })
    const campo = montar()
    fireEvent.compositionStart(campo)
    await digitar(campo, 'rua á')
    expect(api.de('GET /api/geocode')).toHaveLength(0)
    fireEvent.compositionEnd(campo, { target: { value: 'rua á' } })
    await act(() => vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1))
    expect(api.de('GET /api/geocode')).toHaveLength(1)
  })

  it('segue a tabela de teclas: setas, Enter sem ativo não escolhe às cegas, Esc mantém o texto', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A, B]) })
    const campo = montar()
    await digitar(campo, 'rua')
    expect(campo).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('option')).toHaveLength(2)

    fireEvent.keyDown(campo, { key: 'Enter' })
    expect(screen.getByTestId('escolha')).toHaveTextContent('nada')
    expect(campo).toHaveAttribute('aria-activedescendant', 'origem-op-0')

    fireEvent.keyDown(campo, { key: 'ArrowDown' })
    expect(campo).toHaveAttribute('aria-activedescendant', 'origem-op-1')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(campo, { key: 'Escape' })
    expect(campo).toHaveAttribute('aria-expanded', 'false')
    expect(campo.value).toBe('rua')

    fireEvent.keyDown(campo, { key: 'ArrowDown' })
    expect(campo).toHaveAttribute('aria-activedescendant', 'origem-op-0')
    fireEvent.keyDown(campo, { key: 'Enter' })
    expect(screen.getByTestId('escolha')).toHaveTextContent('Rua A, 1')
    expect(campo.value).toBe(A.rotulo)
  })

  it('Enter nunca envia o formulário sem escolha; escolhido sem edição envia', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A]) })
    const aoEnviar = vi.fn()
    const campo = montar(aoEnviar)
    fireEvent.change(campo, { target: { value: 'ru' } })
    // fireEvent não dispara o submit implícito; o preventDefault é o que o impede
    expect(fireEvent.keyDown(campo, { key: 'Enter' })).toBe(false)
    await act(() => vi.advanceTimersByTimeAsync(150))
    expect(screen.getByRole('status')).toHaveTextContent('Digite ao menos 3 letras.')
    fireEvent.change(campo, { target: { value: 'rua' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(campo, { key: 'ArrowDown' })
    fireEvent.keyDown(campo, { key: 'Enter' })
    expect(fireEvent.keyDown(campo, { key: 'Enter' })).toBe(true)
  })

  it('Enter busca na hora, sem esperar o debounce', async () => {
    const api = apiFalsa({ 'GET /api/geocode': Response.json([A]) })
    const campo = montar()
    fireEvent.change(campo, { target: { value: 'rua' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(api.de('GET /api/geocode')).toHaveLength(1)
  })

  it('Tab fecha sem escolher', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A]) })
    const campo = montar()
    await digitar(campo, 'rua')
    fireEvent.keyDown(campo, { key: 'ArrowDown' })
    fireEvent.keyDown(campo, { key: 'Tab' })
    expect(campo).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('escolha')).toHaveTextContent('nada')
  })

  it('anuncia a contagem pela região única e diz "fora da área" na lista vazia', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A, B]) })
    const campo = montar()
    await digitar(campo, 'rua')
    await act(() => vi.advanceTimersByTimeAsync(150))
    expect(screen.getByRole('status')).toHaveTextContent('2 endereços para Origem. Seta para baixo para escolher.')
    apiFalsa({ 'GET /api/geocode': Response.json([]) })
    await digitar(campo, 'rua inexistente')
    await act(() => vi.advanceTimersByTimeAsync(150))
    expect(screen.getByRole('status')).toHaveTextContent('na área piloto')
    expect(document.getElementById('origem-retorno')).toHaveTextContent('fora dessa área')
    expect(document.querySelectorAll('[aria-live],[role=status],[role=alert]')).toHaveLength(1)
  })

  it('opção aproximada diz isso e nunca é escolhida sozinha', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([{ ...A, aproximado: true }]) })
    const campo = montar()
    await digitar(campo, 'rua a 99')
    expect(screen.getByRole('option')).toHaveTextContent('número aproximado')
    expect(screen.getByTestId('escolha')).toHaveTextContent('nada')
  })

  it('503 mostra a mensagem do servidor e permite tentar com Enter', async () => {
    const api = apiFalsa({ 'GET /api/geocode': erroApi(503, 'Busca de endereços indisponível no momento.') })
    const campo = montar()
    await digitar(campo, 'rua')
    expect(document.getElementById('origem-retorno')).toHaveTextContent('Busca de endereços indisponível')
    fireEvent.keyDown(campo, { key: 'Enter' })
    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(api.de('GET /api/geocode')).toHaveLength(2)
  })

  it('clique escolhe e não tira o foco do campo', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A]) })
    const campo = montar()
    await digitar(campo, 'rua')
    const opcao = screen.getByRole('option')
    expect(fireEvent.mouseDown(opcao)).toBe(false)
    fireEvent.click(opcao)
    expect(screen.getByTestId('escolha')).toHaveTextContent('Rua A')
  })

  it('passa no axe com a lista aberta', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A, B]) })
    const campo = montar()
    await digitar(campo, 'rua')
    vi.useRealTimers()
    expect(await axe(document.body)).toHaveNoViolations()
    expect(campo).toHaveAttribute('aria-expanded', 'true')
  })
})

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { useAnuncio, useCancelarAnuncio } from '../componentes/useAnuncio'

function Anunciante({ texto }: { texto: string }) {
  const anunciar = useAnuncio()
  return (
    <button type="button" onClick={() => anunciar(texto)}>
      Anunciar
    </button>
  )
}

describe('RegiaoViva', () => {
  it('monta uma única região viva educada e atômica', async () => {
    const { container } = render(
      <RegiaoViva>
        <p>conteúdo</p>
      </RegiaoViva>,
    )
    const regioes = screen.getAllByRole('status')
    expect(regioes).toHaveLength(1)
    expect(regioes[0]).toHaveAttribute('aria-live', 'polite')
    expect(regioes[0]).toHaveAttribute('aria-atomic', 'true')
    expect(screen.getByText('conteúdo')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('useAnuncio escreve a mensagem na região, inclusive quando ela se repete', async () => {
    render(
      <RegiaoViva>
        <Anunciante texto="Leitura interrompida." />
      </RegiaoViva>,
    )
    const regiao = screen.getByRole('status')
    await userEvent.click(screen.getByRole('button', { name: 'Anunciar' }))
    await waitFor(() => expect(regiao).toHaveTextContent('Leitura interrompida.'))
    // a repetição esvazia a região antes de reescrever, para o leitor de tela anunciar de novo
    await userEvent.click(screen.getByRole('button', { name: 'Anunciar' }))
    expect(regiao.textContent).toBe('')
    await waitFor(() => expect(regiao).toHaveTextContent('Leitura interrompida.'))
  })

  it('useAnuncio fora da região não quebra', async () => {
    render(<Anunciante texto="nada" />)
    await userEvent.click(screen.getByRole('button', { name: 'Anunciar' }))
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('RegiaoViva com chave', () => {
  afterEach(() => vi.useRealTimers())

  function Contagem() {
    const anunciar = useAnuncio()
    const cancelar = useCancelarAnuncio()
    return (
      <>
        <button type="button" onClick={() => anunciar('sem chave')}>
          sem chave
        </button>
        <button type="button" onClick={() => cancelar('c')}>
          cancelar
        </button>
        <button type="button" onClick={() => anunciar('um', { chave: 'c', intervaloMs: 3000 })}>
          um
        </button>
        <button type="button" onClick={() => anunciar('dois', { chave: 'c', intervaloMs: 3000 })}>
          dois
        </button>
      </>
    )
  }

  it('no máximo um anúncio por intervalo, e vale o último', () => {
    vi.useFakeTimers()
    render(
      <RegiaoViva>
        <Contagem />
      </RegiaoViva>,
    )
    const regiao = screen.getByRole('status')
    fireEvent.click(screen.getByRole('button', { name: 'um' }))
    act(() => void vi.advanceTimersByTime(150))
    expect(regiao).toHaveTextContent('um')
    fireEvent.click(screen.getByRole('button', { name: 'dois' }))
    act(() => void vi.advanceTimersByTime(1000))
    expect(regiao).toHaveTextContent('um')
    act(() => void vi.advanceTimersByTime(2100))
    expect(regiao).toHaveTextContent('dois')
  })

  it('anúncio sem chave cancela a contagem pendente: nada de lista depois da escolha', () => {
    vi.useFakeTimers()
    render(
      <RegiaoViva>
        <Contagem />
      </RegiaoViva>,
    )
    const regiao = screen.getByRole('status')
    fireEvent.click(screen.getByRole('button', { name: 'um' }))
    act(() => void vi.advanceTimersByTime(150))
    fireEvent.click(screen.getByRole('button', { name: 'dois' }))
    fireEvent.click(screen.getByRole('button', { name: 'sem chave' }))
    act(() => void vi.advanceTimersByTime(4000))
    expect(regiao).toHaveTextContent('sem chave')
  })

  it('cancelar a chave cala o pendente, inclusive o que estava na pausa antes de escrever', () => {
    vi.useFakeTimers()
    render(
      <RegiaoViva>
        <Contagem />
      </RegiaoViva>,
    )
    const regiao = screen.getByRole('status')
    fireEvent.click(screen.getByRole('button', { name: 'um' }))
    fireEvent.click(screen.getByRole('button', { name: 'cancelar' }))
    act(() => void vi.advanceTimersByTime(4000))
    expect(regiao.textContent).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'dois' }))
    fireEvent.click(screen.getByRole('button', { name: 'cancelar' }))
    act(() => void vi.advanceTimersByTime(4000))
    expect(regiao.textContent).toBe('')
  })
})

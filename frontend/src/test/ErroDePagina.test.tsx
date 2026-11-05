import { render, screen } from '@testing-library/react'
import { ErroDePagina } from '../componentes/ErroDePagina'

function Quebra(): never {
  throw new Error('chunk')
}

describe('ErroDePagina', () => {
  afterEach(() => vi.restoreAllMocks())

  it('não afirma a causa, leva o foco ao h1 e troca o título da aba', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErroDePagina>
        <Quebra />
      </ErroDePagina>,
    )
    const titulo = screen.getByRole('heading', { level: 1, name: 'Instabilidade no sistema' })
    expect(titulo).toHaveFocus()
    expect(document.title).toBe('Instabilidade no sistema · Rota Falada SP')
    expect(screen.getByText(/Recarregue a página em alguns minutos/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/recebeu uma versão nova/)
    expect(screen.getByRole('button', { name: 'Recarregar a página' })).toBeInTheDocument()
  })
})

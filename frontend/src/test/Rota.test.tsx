import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { axe } from 'vitest-axe'
import App from '../App'

describe('página /rota (esqueleto)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('tem origem, destino, exigência e degraus, com o cálculo ainda desabilitado', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(
      <MemoryRouter initialEntries={['/rota']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Planejar rota' })).toBeInTheDocument()
    expect(document.title).toBe('Planejar rota · Rota Falada SP')
    expect(screen.getByRole('textbox', { name: 'Origem' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Destino' })).toBeInTheDocument()

    const exigencia = screen.getByRole('group', { name: 'Exigência' })
    const radios = within(exigencia).getAllByRole('radio')
    expect(radios.map((r) => r.closest('label')?.textContent)).toEqual([
      'até 3%',
      'até 6%',
      'até 10%',
      'qualquer inclinação',
    ])
    expect(within(exigencia).getByRole('radio', { name: 'até 6%' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Evitar degraus' })).toBeChecked()

    const calcular = screen.getByRole('button', { name: 'Calcular rota' })
    // aria-disabled em vez de disabled: o botão continua na ordem de Tab e anuncia a descrição
    expect(calcular).not.toBeDisabled()
    expect(calcular).toHaveAttribute('aria-disabled', 'true')
    expect(calcular).toHaveAttribute('aria-describedby', 'calculo-em-breve')
    expect(calcular).toHaveAccessibleDescription(
      'O cálculo abre em breve para a área piloto (Vila Mariana, Lapa e Ipiranga).',
    )
    calcular.focus()
    expect(calcular).toHaveFocus()

    // o aviso vem antes do primeiro campo
    const aviso = screen.getByText('O cálculo abre em breve para a área piloto (Vila Mariana, Lapa e Ipiranga).')
    const origem = screen.getByRole('textbox', { name: 'Origem' })
    expect(aviso.compareDocumentPosition(origem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // submeter não faz nada: evento cancelado, nenhuma chamada, mesma página
    const formulario = screen.getByRole('form', { name: 'Planejar rota' })
    expect(fireEvent.submit(formulario)).toBe(false)
    await userEvent.click(calcular)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { level: 1, name: 'Planejar rota' })).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })
})

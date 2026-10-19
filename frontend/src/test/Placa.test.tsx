import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { axe } from 'vitest-axe'
import { Placa } from '../componentes/Placa'

describe('Placa', () => {
  it('com destino vira link de ação', async () => {
    const { container } = render(
      <MemoryRouter>
        <Placa para="/rota" variante="acao" pictograma="siga">
          Planejar rota
        </Placa>
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: 'Planejar rota' })
    expect(link).toHaveAttribute('href', '/rota')
    expect(link).toHaveClass('placa', 'placa--acao')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('sem destino vira botão neutro que executa a ação', async () => {
    const aoClicar = vi.fn()
    const { container } = render(
      <Placa onClick={aoClicar} aria-pressed={false}>
        Ouvir o exemplo
      </Placa>,
    )
    const botao = screen.getByRole('button', { name: 'Ouvir o exemplo' })
    expect(botao).toHaveAttribute('type', 'button')
    expect(botao).toHaveClass('placa', 'placa--neutra')
    expect(botao).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(botao)
    expect(aoClicar).toHaveBeenCalledTimes(1)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('respeita disabled e aria-describedby', () => {
    render(
      <>
        <Placa type="submit" disabled aria-describedby="nota">
          Calcular rota
        </Placa>
        <p id="nota">Em breve.</p>
      </>,
    )
    const botao = screen.getByRole('button', { name: 'Calcular rota' })
    expect(botao).toBeDisabled()
    expect(botao).toHaveAttribute('type', 'submit')
    expect(botao).toHaveAccessibleDescription('Em breve.')
  })
})

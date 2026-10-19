import { render, screen, within } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { Elevacao } from '../componentes/Elevacao'
import { ROTA_EXEMPLO } from '../dados/rotaExemplo'

describe('Elevacao', () => {
  function renderizar(ativo: number | null = null) {
    return render(
      <Elevacao
        passos={ROTA_EXEMPLO.passos}
        passoAtivo={ativo}
        rotuloLista="Passos da rota de exemplo"
        origem={<h1>A rota é um texto.</h1>}
        destino={<p>Chegada no destino</p>}
      />,
    )
  }

  it('é uma lista ordenada real, com um item por passo, entre as duas torres', async () => {
    const { container } = renderizar()
    const lista = screen.getByRole('list', { name: 'Passos da rota de exemplo' })
    expect(lista.tagName).toBe('OL')
    expect(within(lista).getAllByRole('listitem')).toHaveLength(11)
    // na elevação, só rua e distância; os demais campos ficam na tabela da seção 4
    expect(lista).not.toHaveTextContent('largura')
    expect(lista).not.toHaveTextContent('declividade')
    expect(screen.getByRole('heading', { level: 1, name: 'A rota é um texto.' })).toBeInTheDocument()
    expect(screen.getByText('Chegada no destino')).toBeInTheDocument()
    expect(container.querySelectorAll('.torre')).toHaveLength(2)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('a ordem do DOM é origem, passos, destino', () => {
    const { container } = renderizar()
    const h1 = screen.getByRole('heading', { level: 1 })
    const lista = screen.getByRole('list')
    const destino = screen.getByText('Chegada no destino')
    expect(h1.compareDocumentPosition(lista) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(lista.compareDocumentPosition(destino) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelector('.elevacao__desenho')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('.elevacao__poco')).toHaveAttribute('aria-hidden', 'true')
  })

  it('acende só a passarela do passo ativo', () => {
    renderizar(4)
    const itens = screen.getAllByRole('listitem')
    expect(itens.filter((i) => i.getAttribute('aria-current') === 'step')).toHaveLength(1)
    expect(itens[3]).toHaveAttribute('aria-current', 'step')
  })
})

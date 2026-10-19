import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { Passarela } from '../componentes/Passarela'
import { ROTA_EXEMPLO } from '../dados/rotaExemplo'

const [, p2, , p4] = ROTA_EXEMPLO.passos

function emLista(no: ReactNode) {
  return render(<ol>{no}</ol>)
}

describe('Passarela', () => {
  it('mostra só o número, o nome da rua em letreiro e a distância', async () => {
    const { container } = emLista(<Passarela passo={p2} />)
    const item = screen.getByRole('listitem')
    expect(within(item).getByText('Rua Helen Keller')).toHaveClass('letreiro')
    expect(within(item).getByText('48,0 m')).toHaveClass('passarela__distancia')
    expect(item).toHaveTextContent(/^2\s*Rua Helen Keller\s*48,0 m$/)
    // a cota técnica completa vive na tabela da seção 4, não no vão
    expect(item.querySelector('.cota')).toBeNull()
    expect(item.querySelector('.passarela__acao')).toBeNull()
    expect(item).not.toHaveTextContent('largura')
    expect(item).not.toHaveAttribute('aria-current')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('sem rua, o nome gravado é a própria instrução, e nenhum pictograma entra no vão', () => {
    const { container } = emLista(<Passarela passo={p4} />)
    expect(screen.getByText('Vire à direita')).toHaveClass('letreiro')
    expect(screen.getByText('13,1 m')).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('o estado ativo acende o guarda-corpo e marca o passo atual', () => {
    emLista(<Passarela passo={p2} ativo />)
    const item = screen.getByRole('listitem')
    expect(item).toHaveAttribute('aria-current', 'step')
    expect(item).toHaveClass('passarela--ativa')
  })
})

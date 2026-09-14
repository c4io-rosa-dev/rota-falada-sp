import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { axe } from 'vitest-axe'
import App from '../App'

function renderizar(rota = '/') {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <App />
    </MemoryRouter>,
  )
}

describe('layout acessível', () => {
  it('tem skip link como primeiro elemento focável, apontando para o conteúdo', async () => {
    renderizar()
    // a página foca o h1 ao montar; volta o foco ao body para testar a ordem de Tab do zero
    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.tab()
    const skip = screen.getByRole('link', { name: 'Pular para o conteúdo' })
    expect(skip).toHaveFocus()
    expect(skip).toHaveAttribute('href', '#conteudo')
    expect(document.getElementById('conteudo')).not.toBeNull()
  })

  it('define o título da aba e foca o h1 ao abrir a página inicial', async () => {
    renderizar('/')
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Rota Falada SP' })
    expect(document.title).toBe('Início · Rota Falada SP')
    expect(h1).toHaveFocus()
  })

  it('tem navegação principal com os três links', () => {
    renderizar()
    const nav = screen.getByRole('navigation', { name: 'Principal' })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Início' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Fontes' })).toHaveAttribute('href', '/fontes')
    expect(screen.getByRole('link', { name: 'Acessibilidade' })).toHaveAttribute('href', '/acessibilidade')
  })

  it('não tem violações de acessibilidade na página inicial', async () => {
    const { container } = renderizar('/')
    expect(await axe(container)).toHaveNoViolations()
  })
})

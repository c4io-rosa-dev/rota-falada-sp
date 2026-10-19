import { render, screen, within } from '@testing-library/react'
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
  afterEach(() => vi.unstubAllGlobals())

  it('tem skip link como primeiro elemento focável, apontando para o conteúdo', async () => {
    renderizar()
    await userEvent.tab()
    const skip = screen.getByRole('link', { name: 'Pular para o conteúdo' })
    expect(skip).toHaveFocus()
    expect(skip).toHaveAttribute('href', '#conteudo')
    expect(document.getElementById('conteudo')).not.toBeNull()
  })

  it('define o título da aba e não rouba o foco na primeira carga', async () => {
    renderizar('/')
    const h1 = await screen.findByRole('heading', { level: 1, name: 'A rota é um texto.' })
    expect(document.title).toBe('Início · Rota Falada SP')
    expect(h1).not.toHaveFocus()
    expect(document.body).toHaveFocus()
  })

  it('navegar para outra página foca o h1 dela', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
    renderizar('/')
    const nav = screen.getByRole('navigation', { name: 'Principal' })
    await userEvent.click(within(nav).getByRole('link', { name: 'Fontes' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Fontes de dados e licenças' })).toHaveFocus()
    expect(document.title).toBe('Fontes de dados e licenças · Rota Falada SP')

    await userEvent.click(within(nav).getByRole('link', { name: 'Início' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'A rota é um texto.' })).toHaveFocus()
  })

  it('tem a marca ligada ao início e a navegação principal com os três links', () => {
    renderizar()
    const cabecalho = screen.getByRole('banner')
    expect(within(cabecalho).getByRole('link', { name: 'Rota Falada SP' })).toHaveAttribute('href', '/')
    const nav = screen.getByRole('navigation', { name: 'Principal' })
    expect(within(nav).getByRole('link', { name: 'Início' })).toHaveAttribute('href', '/')
    expect(within(nav).getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Fontes' })).toHaveAttribute('href', '/fontes')
    expect(within(nav).getByRole('link', { name: 'Acessibilidade' })).toHaveAttribute('href', '/acessibilidade')
  })

  it('mantém o rodapé de atribuição e uma única região viva', () => {
    renderizar()
    const rodape = screen.getByRole('contentinfo')
    expect(rodape).toHaveTextContent('Dados do mapa © colaboradores do OpenStreetMap. Veja todas as fontes e licenças.')
    expect(within(rodape).getByRole('link', { name: 'todas as fontes e licenças' })).toHaveAttribute('href', '/fontes')
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('abre /rota pelo CTA da página inicial', async () => {
    renderizar('/')
    await userEvent.click(screen.getByRole('link', { name: 'Planejar rota' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Planejar rota' })).toHaveFocus()
  })

  it('não tem violações de acessibilidade na página inicial', async () => {
    const { container } = renderizar('/')
    expect(await axe(container)).toHaveNoViolations()
  })
})

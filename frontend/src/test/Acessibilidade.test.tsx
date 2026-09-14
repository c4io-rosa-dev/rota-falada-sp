import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { axe } from 'vitest-axe'
import App from '../App'

describe('página /acessibilidade', () => {
  it('declara a meta WCAG 2.2 AA, os recursos, as limitações e o contato', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/acessibilidade']}>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'Declaração de acessibilidade' })).toHaveFocus()
    expect(screen.getByRole('heading', { level: 2, name: 'Meta de conformidade' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Recursos disponíveis' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Limitações conhecidas' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Como relatar um problema' })).toBeInTheDocument()
    expect(screen.getByText(/WCAG 2\.2 nível AA/)).toBeInTheDocument()
    expect(document.title).toBe('Declaração de acessibilidade · Rota Falada SP')
    expect(await axe(container)).toHaveNoViolations()
  })
})

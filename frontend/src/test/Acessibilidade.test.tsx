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
    // primeira carga da aplicação: o h1 existe, mas o foco fica com o navegador
    expect(await screen.findByRole('heading', { level: 1, name: 'Declaração de acessibilidade' })).not.toHaveFocus()
    expect(screen.getByRole('heading', { level: 2, name: 'Meta de conformidade' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Recursos disponíveis' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Limitações conhecidas' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Como relatar um problema' })).toBeInTheDocument()
    expect(screen.getByText(/WCAG 2\.2 nível AA/)).toBeInTheDocument()
    // privacidade da navegação guiada (spec 8)
    expect(
      screen.getByText(
        'Navegação guiada: a sua localização é usada só no aparelho, enquanto a navegação está ligada. Se você tocar em Recalcular, a posição arredondada (cerca de 11 m) vai ao nosso servidor, que calcula a rota com um serviço de rotas, e a rota calculada fica guardada sem identificação por até 6 horas, como qualquer rota.',
      ),
    ).toBeInTheDocument()
    expect(document.title).toBe('Declaração de acessibilidade · Rota Falada SP')
    expect(await axe(container)).toHaveNoViolations()
  })
})

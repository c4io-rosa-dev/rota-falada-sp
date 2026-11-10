import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { axe } from 'vitest-axe'
import App from '../App'
import { AVISO_PRIVACIDADE, TEXTO_MAPA_PRIVACIDADE } from '../componentes/navegacao/textosNavegacao'

const TEXTO_MAPA =
  'O mapa é opcional e vem do próprio site, num arquivo só da área coberta. Para desenhar a região em volta de você, o aparelho pede ao site pedaços desse arquivo, e esses pedidos indicam a região. O site não registra esses pedidos e nenhum outro serviço recebe pedido de mapa. A Cloudflare, que hospeda o site, recebe esses pedidos para entregá-los, como qualquer acesso ao site. O mapa pede esses pedaços sem guardá-los no cache do navegador: o que foi visto some quando a aba fecha. As escolhas de mostrar e girar o mapa ficam só nesta aba.'

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
    // privacidade do mapa da navegação (spec mapa próprio 11)
    expect(screen.getByText(`Mapa da navegação guiada: ${TEXTO_MAPA}`)).toBeInTheDocument()
    expect(document.title).toBe('Declaração de acessibilidade · Rota Falada SP')
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('textos de privacidade do mapa', () => {
  it('o texto do mapa é o da spec, sem promessa de garantia, e fecha o aviso de privacidade', () => {
    expect(TEXTO_MAPA_PRIVACIDADE).toBe(TEXTO_MAPA)
    expect(TEXTO_MAPA_PRIVACIDADE).not.toMatch(/garant/i)
    expect(AVISO_PRIVACIDADE.endsWith(` ${TEXTO_MAPA_PRIVACIDADE}`)).toBe(true)
    expect(AVISO_PRIVACIDADE.startsWith('Sua localização fica só neste aparelho enquanto você navega.')).toBe(true)
  })
})

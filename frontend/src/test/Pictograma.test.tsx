import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { Pictograma } from '../componentes/Pictograma'
import { NOMES_PICTOGRAMA } from '../componentes/pictogramas'

describe('Pictograma', () => {
  it('com título vira imagem com nome acessível', async () => {
    const { container } = render(<Pictograma nome="guia-alta" titulo="Guia não rebaixada" />)
    const img = screen.getByRole('img', { name: 'Guia não rebaixada' })
    expect(img.tagName.toLowerCase()).toBe('svg')
    expect(img.querySelector('title')).toHaveTextContent('Guia não rebaixada')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('sem título é decorativo e sai da árvore de acessibilidade', () => {
    const { container } = render(<Pictograma nome="ouvir" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('desenha todos os nomes mínimos na grade 24 com um só peso de traço', () => {
    expect(NOMES_PICTOGRAMA).toEqual(
      expect.arrayContaining(['guia-rebaixada', 'guia-alta', 'largura', 'rampa', 'degrau', 'ouvir', 'parar', 'siga', 'fonte']),
    )
    for (const nome of NOMES_PICTOGRAMA) {
      const { container, unmount } = render(<Pictograma nome={nome} />)
      const svg = container.querySelector('svg')!
      expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
      expect(svg).toHaveAttribute('stroke-width', '2')
      expect(svg.querySelectorAll('path').length).toBeGreaterThan(0)
      unmount()
    }
  })
})

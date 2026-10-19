import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { Janela, Torre } from '../componentes/Torre'

describe('Torre', () => {
  it('é um plano liso de concreto cujas janelas emolduram o conteúdo', async () => {
    const { container } = render(
      <Torre variante="origem" base="Rua Helen Keller">
        <Janela area="titulo">
          <h1>A rota é um texto.</h1>
        </Janela>
        <Janela area="acoes">
          <button type="button">Ouvir</button>
        </Janela>
      </Torre>,
    )
    const torre = container.querySelector('.torre')!
    expect(torre).toHaveClass('torre--origem')
    expect(screen.getByRole('heading', { level: 1 }).closest('.janela')).toHaveClass('janela--titulo')
    expect(screen.getByRole('button', { name: 'Ouvir' }).closest('.janela')).toHaveClass('janela--acoes')
    expect(screen.getByText('Rua Helen Keller')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('nenhuma variante desenha janelas decorativas (concreto limpo)', () => {
    for (const variante of ['origem', 'destino', 'fachada', 'anexo'] as const) {
      const { container, unmount } = render(
        <Torre variante={variante}>
          <Janela area="a">
            <p>texto</p>
          </Janela>
        </Torre>,
      )
      expect(container.querySelectorAll('.janela')).toHaveLength(1)
      expect(container.querySelector('.janela--vazia, .janela--caixilho, [aria-hidden="true"]')).toBeNull()
      unmount()
    }
  })

  it('sem base não grava letreiro no embasamento', () => {
    const { container } = render(
      <Torre variante="fachada">
        <Janela area="a">
          <p>texto</p>
        </Janela>
      </Torre>,
    )
    expect(container.querySelector('.torre__base')).toBeNull()
  })
})

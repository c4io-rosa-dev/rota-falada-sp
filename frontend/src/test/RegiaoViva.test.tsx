import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { useAnuncio } from '../componentes/useAnuncio'

function Anunciante({ texto }: { texto: string }) {
  const anunciar = useAnuncio()
  return (
    <button type="button" onClick={() => anunciar(texto)}>
      Anunciar
    </button>
  )
}

describe('RegiaoViva', () => {
  it('monta uma única região viva educada e atômica', async () => {
    const { container } = render(
      <RegiaoViva>
        <p>conteúdo</p>
      </RegiaoViva>,
    )
    const regioes = screen.getAllByRole('status')
    expect(regioes).toHaveLength(1)
    expect(regioes[0]).toHaveAttribute('aria-live', 'polite')
    expect(regioes[0]).toHaveAttribute('aria-atomic', 'true')
    expect(screen.getByText('conteúdo')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('useAnuncio escreve a mensagem na região, inclusive quando ela se repete', async () => {
    render(
      <RegiaoViva>
        <Anunciante texto="Leitura interrompida." />
      </RegiaoViva>,
    )
    const regiao = screen.getByRole('status')
    await userEvent.click(screen.getByRole('button', { name: 'Anunciar' }))
    await waitFor(() => expect(regiao).toHaveTextContent('Leitura interrompida.'))
    // a repetição esvazia a região antes de reescrever, para o leitor de tela anunciar de novo
    await userEvent.click(screen.getByRole('button', { name: 'Anunciar' }))
    expect(regiao.textContent).toBe('')
    await waitFor(() => expect(regiao).toHaveTextContent('Leitura interrompida.'))
  })

  it('useAnuncio fora da região não quebra', async () => {
    render(<Anunciante texto="nada" />)
    await userEvent.click(screen.getByRole('button', { name: 'Anunciar' }))
    expect(screen.queryByRole('status')).toBeNull()
  })
})

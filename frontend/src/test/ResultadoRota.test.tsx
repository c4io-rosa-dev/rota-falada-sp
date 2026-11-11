import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { MemoryRouter } from 'react-router'
import { axe } from 'vitest-axe'
import type { RotaOut } from '../api/client'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { ResultadoRota } from '../componentes/ResultadoRota'
import { guardarPassoDeRetorno } from '../dados/retornoPasso'
import { passo, ROTA } from './fixturasRota'

const ROTA_COM_PROBLEMAS: RotaOut = {
  ...ROTA,
  passos: [passo(1), passo(2, { is_degrau: true, declividade_pct: 9.15 }), passo(3, { largura_m: 0.7 })],
  distancia_m: 300,
  nivel_exigencia_atendido: 'any',
}

function renderizar(rota: RotaOut = ROTA_COM_PROBLEMAS) {
  return render(
    <MemoryRouter>
      <RegiaoViva>
        <ResultadoRota
          rota={rota}
          origem="Rua A"
          destino="Rua B"
          exigenciaPedida={6}
          calculadaEm="2026-11-09T12:00:00Z"
          desatualizada={false}
          tituloRef={createRef()}
        />
      </RegiaoViva>
    </MemoryRouter>,
  )
}

describe('resultado da rota', () => {
  afterEach(() => sessionStorage.clear())

  it('títulos levam direto aos avisos e aos passos', () => {
    renderizar()
    expect(screen.getByRole('heading', { level: 3, name: 'Avisos' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Passos' })).toBeInTheDocument()
  })

  it('a contagem do título é a mesma dos avisos na tela, e o degrau vem primeiro', () => {
    const { container } = renderizar()
    const avisos = container.querySelectorAll('.ficha .aviso')
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(`${avisos.length} avisos`)
    expect(avisos[0]).toHaveTextContent(/^Degrau no passo 2\./)
    expect(avisos[0]).toHaveClass('aviso--grave')
    expect(screen.queryByText(/no passos/)).toBeNull()
  })

  it('o link do aviso leva o foco ao passo', async () => {
    renderizar()
    const [aviso] = screen.getAllByText(/^Degrau no passo 2\./)
    await userEvent.click(within(aviso.closest('p')!).getByRole('link', { name: 'passo 2' }))
    expect(document.activeElement).toBe(document.getElementById('passo-2'))
  })

  it('o passo diz em texto o que passa do pedido', () => {
    renderizar()
    const p2 = document.getElementById('passo-2')!
    expect(p2).toHaveTextContent('9,15% (GeoSampa) · acima do pedido')
    expect(document.getElementById('passo-3')).toHaveTextContent('0,7 m · estreita')
    expect(document.getElementById('passo-1')).not.toHaveTextContent('acima do pedido')
  })

  it('a linha da inclinação diz em palavras se o pedido foi cumprido', () => {
    renderizar()
    expect(screen.getByText('Pedido: até 6%. A rota passa disso em 1 passo.')).toBeInTheDocument()
  })

  it('quem volta das barreiras de um passo volta para aquele passo', async () => {
    guardarPassoDeRetorno(3)
    renderizar()
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('passo-3')))
    expect(sessionStorage.getItem('rf-voltar-passo')).toBeNull()
  })

  it('sem violações de acessibilidade', async () => {
    const { container } = renderizar()
    expect(await axe(container)).toHaveNoViolations()
  })
})

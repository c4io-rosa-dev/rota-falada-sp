import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MapaRota } from '../componentes/mapa/MapaRota'
import { opcoesMapa } from '../componentes/mapa/opcoesMapa'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { ROTA } from './fixturasRota'

const chunk = vi.hoisted(() => ({ falhar: true }))

vi.mock('../componentes/mapa/MapaLeaflet', () => {
  if (chunk.falhar) {
    chunk.falhar = false
    throw new Error('chunk')
  }
  return { default: ({ descricao }: { descricao: string }) => <div role="img" aria-label={descricao} /> }
})

function Tela() {
  const [aberto, setAberto] = useState(false)
  return (
    <RegiaoViva>
      <MapaRota rota={ROTA} origem="Rua A" destino="Rua B" aberto={aberto} aoAlternar={setAberto} passoSelecionado={null} rodadaPasso={0} passoEmLeitura={null} />
    </RegiaoViva>
  )
}

describe('opcoesMapa', () => {
  it('nada focável, nenhum movimento e arrastar só com ponteiro fino', () => {
    expect(opcoesMapa(false)).toMatchObject({
      keyboard: false,
      attributionControl: false,
      zoomControl: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      inertia: false,
      scrollWheelZoom: false,
      touchZoom: false,
      dragging: false,
    })
    expect(opcoesMapa(true).dragging).toBe(true)
  })
})

describe('MapaRota', () => {
  // o primeiro import do arquivo falha: vi.hoisted acima
  it('chunk que falha: o mapa não fica "aberto", e tentar de novo leva o foco ao botão do mapa', async () => {
    const aoAlternar = vi.fn()
    render(
      <RegiaoViva>
        <MapaRota rota={ROTA} origem="Rua A" destino="Rua B" aberto={false} aoAlternar={aoAlternar} passoSelecionado={null} rodadaPasso={0} passoEmLeitura={null} />
      </RegiaoViva>,
    )
    const botao = screen.getByRole('button', { name: 'Mostrar mapa' })
    await userEvent.click(botao)
    expect(await screen.findByText(/Não foi possível abrir o mapa/)).toBeInTheDocument()
    expect(aoAlternar).not.toHaveBeenCalledWith(true)
    expect(botao).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(botao).toHaveFocus()
    await waitFor(() => expect(aoAlternar).toHaveBeenCalledWith(true))
  })

  it('anuncia a abertura enquanto o chunk não chega', async () => {
    render(<Tela />)
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar mapa' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Abrindo o mapa\.|Mapa aberto\./))
  })

  it('Aproximar, Afastar e Rota inteira falam: o botão não muda depois de pressionado', async () => {
    render(<Tela />)
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar mapa' }))
    const aproximar = await screen.findByRole('button', { name: 'Aproximar' })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Mapa aberto.'))
    await userEvent.click(aproximar)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Mapa aproximado.'))
    await userEvent.click(screen.getByRole('button', { name: 'Afastar' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Mapa afastado.'), { timeout: 3000 })
    await userEvent.click(screen.getByRole('button', { name: 'Rota inteira' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Mapa mostra a rota inteira.'), { timeout: 3000 })
  })

  it('nada carrega antes do clique; ao abrir, anuncia e fica role=img com a atribuição fora dele', async () => {
    render(<Tela />)
    expect(screen.queryByRole('img')).toBeNull()
    const botao = screen.getByRole('button', { name: 'Mostrar mapa' })
    expect(botao).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(botao)
    const mapa = await screen.findByRole('img', { name: /Mapa ilustrativo da rota de Rua A até Rua B, 200,0 m em 2 passos/ })
    expect(botao).toHaveAttribute('aria-pressed', 'true')
    const link = screen.getByRole('link', { name: 'OpenStreetMap' })
    expect(mapa).not.toContainElement(link)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Mapa aberto.'))
    expect(screen.getByRole('link', { name: 'Ir para a lista de passos' })).toHaveAttribute('href', '#lista-passos')
    await userEvent.click(botao)
    expect(screen.queryByRole('img')).toBeNull()
  })
})

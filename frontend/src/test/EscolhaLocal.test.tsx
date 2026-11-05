import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { EscolhaLocal } from '../componentes/EscolhaLocal'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { FORA_DA_AREA } from '../dados/localizacao'
import { AVISO_MEIO_DA_RUA, type LocalEscolhido } from '../dados/rascunho'
import { apiFalsa, erroApi } from './apiFalsa'
import { endereco } from './fixturasRota'

const chunk = vi.hoisted(() => ({ falhar: true }))

vi.mock('../componentes/mapa/PontoNoMapa', () => {
  if (chunk.falhar) {
    chunk.falhar = false
    throw new Error('chunk')
  }
  return { default: () => <p>Mapa de escolher ponto</p> }
})

const A = endereco(1, 'Rua A, 1 · Vila Mariana')
let ultimo: LocalEscolhido | null = null

function Tela({ erro }: { erro?: string }) {
  const [local, setLocal] = useState<LocalEscolhido | null>(null)
  return (
    <RegiaoViva>
      <EscolhaLocal
        id="local"
        erro={erro}
        local={local}
        aoEscolher={(l) => {
          ultimo = l
          setLocal(l)
        }}
      />
    </RegiaoViva>
  )
}

function comGps(accuracy = 20) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: -23.5901234, longitude: -46.6359876, accuracy } } as GeolocationPosition),
    },
  })
}

beforeEach(() => {
  ultimo = null
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (navigator as unknown as { geolocation?: unknown }).geolocation
})

describe('EscolhaLocal', () => {
  it('mapa: avisa do IP antes; chunk que falha fica aqui, sem derrubar a página', async () => {
    // o primeiro import do arquivo falha: vi.hoisted acima
    apiFalsa({})
    render(<Tela />)
    const botao = screen.getByRole('button', { name: 'Escolher no mapa' })
    expect(botao).toHaveAccessibleDescription(expect.stringContaining('recebe o endereço IP'))
    await userEvent.click(botao)
    expect(await screen.findByText(/Não foi possível abrir o mapa/)).toBeInTheDocument()
    expect(botao).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('combobox', { name: 'Endereço' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(botao).toHaveFocus()
    expect(await screen.findByText('Mapa de escolher ponto')).toBeInTheDocument()
  })

  it('por teclado na busca: logradouro avisa que é o meio da rua', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([endereco(1, 'Rua A · Vila Mariana', { tipo: 'logradouro' })]) })
    render(<Tela />)
    const campo = screen.getByRole('combobox', { name: 'Endereço' })
    fireEvent.change(campo, { target: { value: 'rua' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    await screen.findByRole('option')
    fireEvent.keyDown(campo, { key: 'ArrowDown' })
    fireEvent.keyDown(campo, { key: 'Enter' })
    expect(await screen.findByText(AVISO_MEIO_DA_RUA)).toBeInTheDocument()
    expect(ultimo).toMatchObject({ origem: 'busca', rotulo: 'Rua A · Vila Mariana' })
  })

  it('a barreira usa a coordenada do GPS, não a do endereço devolvido', async () => {
    const api = apiFalsa({ 'GET /api/geocode/reverso': Response.json(A) })
    comGps()
    render(<Tela />)
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    await waitFor(() => expect(ultimo).not.toBeNull())
    expect(ultimo).toMatchObject({ lat: -23.5901234, lon: -46.6359876, rotulo: A.rotulo, origem: 'gps' })
    expect(new URL(api.de('GET /api/geocode/reverso')[0].url).searchParams.get('lat')).toBe('-23.5901')
    expect(screen.getByText(/perto de Rua A, 1/)).toBeInTheDocument()
  })

  it('GPS impreciso avisa, sem bloquear', async () => {
    apiFalsa({ 'GET /api/geocode/reverso': Response.json(A) })
    comGps(300)
    render(<Tela />)
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    expect(await screen.findByText(/A margem do GPS é de cerca de 300 m/)).toBeInTheDocument()
  })

  it('nada a 50 m ainda pode registrar; fora da área não', async () => {
    apiFalsa({ 'GET /api/geocode/reverso': erroApi(404, 'Nenhum endereço conhecido a até 50 metros deste ponto.') })
    comGps()
    const { unmount } = render(<Tela />)
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    expect(await screen.findByText(/pode registrar neste ponto/)).toBeInTheDocument()
    expect(ultimo).toMatchObject({ rotulo: null, origem: 'gps' })
    unmount()

    ultimo = null
    apiFalsa({ 'GET /api/geocode/reverso': erroApi(404, FORA_DA_AREA) })
    render(<Tela />)
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    expect(await screen.findByText(FORA_DA_AREA)).toBeInTheDocument()
    expect(ultimo).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Endereço' })).toHaveFocus()
  })

  it('permissão negada leva o foco à busca', async () => {
    apiFalsa({})
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_ok: PositionCallback, erro: PositionErrorCallback) => erro({ code: 1 } as GeolocationPositionError) },
    })
    render(<Tela />)
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    expect(await screen.findByText(/não autorizou a localização/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Endereço' })).toHaveFocus()
  })

  it('escolher pela lista leva o foco ao local marcado, sem anunciar por cima', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A]) })
    render(<Tela />)
    const campo = screen.getByRole('combobox', { name: 'Endereço' })
    campo.focus()
    fireEvent.change(campo, { target: { value: 'rua' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    await screen.findByRole('option')
    fireEvent.keyDown(campo, { key: 'ArrowDown' })
    fireEvent.keyDown(campo, { key: 'Enter' })
    const marcado = await screen.findByText(/perto de Rua A, 1/)
    expect(marcado.closest('p')).toHaveFocus()
    await new Promise((r) => setTimeout(r, 150))
    expect(screen.getByRole('status')).not.toHaveTextContent('Endereço: Rua A')
  })

  it('GPS: o botão some e o foco vai ao local marcado; "Trocar o local" leva à busca', async () => {
    apiFalsa({ 'GET /api/geocode/reverso': Response.json(A) })
    comGps()
    render(<Tela />)
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    const marcado = await screen.findByText(/perto de Rua A, 1/)
    await waitFor(() => expect(marcado.closest('p')).toHaveFocus())
    await userEvent.click(screen.getByRole('button', { name: 'Trocar o local' }))
    expect(screen.getByRole('combobox', { name: 'Endereço' })).toHaveFocus()
  })

  it('se a pessoa saiu dali durante a espera, o foco fica e a região diz o local', async () => {
    let responder: PositionCallback = () => {}
    apiFalsa({ 'GET /api/geocode/reverso': Response.json(A) })
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok: PositionCallback) => (responder = ok) } })
    render(
      <>
        <button type="button">fora</button>
        <Tela />
      </>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    const fora = screen.getByRole('button', { name: 'fora' })
    fora.focus()
    await act(async () => responder({ coords: { latitude: -23.59, longitude: -46.63, accuracy: 20 } } as GeolocationPosition))
    await screen.findByText(/perto de Rua A, 1/)
    expect(fora).toHaveFocus()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Local marcado perto de Rua A, 1'))
  })

  it('sem sinal para o reverso, a coordenada fica no rascunho; fora da área continua recusado', async () => {
    apiFalsa({
      'GET /api/geocode/reverso': () => {
        throw new TypeError('rede')
      },
    })
    comGps()
    render(<Tela />)
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    expect(await screen.findByText('Ponto guardado. Não conseguimos confirmar o endereço agora.')).toBeInTheDocument()
    expect(ultimo).toMatchObject({ lat: -23.5901234, lon: -46.6359876, rotulo: null, origem: 'gps' })
  })

  it('acionar anuncia a busca; aria-disabled bloqueia de verdade; digitar descarta o GPS', async () => {
    let responder: PositionCallback = () => {}
    const getCurrentPosition = vi.fn((ok: PositionCallback) => (responder = ok))
    apiFalsa({ 'GET /api/geocode/reverso': Response.json(A) })
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } })
    render(<Tela />)
    const botao = screen.getByRole('button', { name: 'Usar minha localização' })
    await userEvent.click(botao)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Buscando sua localização.'))
    await userEvent.click(botao)
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    await userEvent.type(screen.getByRole('combobox', { name: 'Endereço' }), 'r')
    await act(async () => responder({ coords: { latitude: -23.59, longitude: -46.63, accuracy: 20 } } as GeolocationPosition))
    await new Promise((r) => setTimeout(r, 20))
    expect(ultimo).toBeNull()
  })

  it('o erro recebido fica ligado ao campo de busca', () => {
    apiFalsa({})
    render(<Tela erro="Diga onde está a barreira." />)
    const campo = screen.getByRole('combobox', { name: 'Endereço' })
    expect(campo).toHaveAttribute('aria-invalid', 'true')
    expect(campo).toHaveAccessibleDescription(expect.stringContaining('Diga onde está a barreira.'))
  })
})

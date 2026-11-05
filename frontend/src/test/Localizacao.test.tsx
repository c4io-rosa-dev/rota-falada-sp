import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { Endereco } from '../api/client'
import { BotaoMinhaLocalizacao } from '../componentes/BotaoMinhaLocalizacao'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { arredondar4, FORA_DA_AREA } from '../dados/localizacao'
import { apiFalsa, erroApi } from './apiFalsa'
import { endereco } from './fixturasRota'

const A = endereco(1, 'Rua A, 1 · Vila Mariana')

function comGps(implementacao: (ok: PositionCallback, erro: PositionErrorCallback, op?: PositionOptions) => void) {
  const getCurrentPosition = vi.fn(implementacao)
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } })
  return getCurrentPosition
}

function posicao(accuracy = 20) {
  return (ok: PositionCallback) => ok({ coords: { latitude: -23.590123456, longitude: -46.635987654, accuracy } } as GeolocationPosition)
}

function Tela({ aoEscolher }: { aoEscolher: (e: Endereco) => void }) {
  const [valor, setValor] = useState('')
  return (
    <RegiaoViva>
      <input aria-label="Origem" id="campo" value={valor} onChange={(e) => setValor(e.target.value)} />
      <BotaoMinhaLocalizacao idCampo="campo" valorCampo={valor} aoEscolher={aoEscolher} />
    </RegiaoViva>
  )
}

function montar() {
  const aoEscolher = vi.fn()
  render(<Tela aoEscolher={aoEscolher} />)
  return aoEscolher
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete (navigator as unknown as { geolocation?: unknown }).geolocation
})

describe('Usar minha localização', () => {
  it('sem suporte, vira uma frase', () => {
    montar()
    expect(screen.getByText(/não informa a localização. Digite o endereço/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('só pede permissão no clique, arredonda a 4 casas e usa o endereço devolvido', async () => {
    const api = apiFalsa({ 'GET /api/geocode/reverso': Response.json(A) })
    const gps = comGps(posicao())
    const aoEscolher = montar()
    expect(gps).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    await waitFor(() => expect(aoEscolher).toHaveBeenCalledWith(A))
    expect(gps.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 })
    const url = new URL(api.de('GET /api/geocode/reverso')[0].url)
    expect(url.searchParams.get('lat')).toBe('-23.5901')
    expect(url.searchParams.get('lon')).toBe('-46.636')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Confira se é onde você está.'))
    expect(arredondar4(-23.590123456)).toBe(-23.5901)
  })

  it('impreciso não preenche sozinho', async () => {
    apiFalsa({ 'GET /api/geocode/reverso': Response.json(A) })
    comGps(posicao(350))
    const aoEscolher = montar()
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    expect(await screen.findByText(/a margem é de cerca de 350 m/)).toBeInTheDocument()
    expect(aoEscolher).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Usar este endereço' }))
    expect(aoEscolher).toHaveBeenCalledWith(A)
    // o botão sumiu: o foco vai ao campo preenchido, não ao body
    expect(screen.getByRole('textbox', { name: 'Origem' })).toHaveFocus()
  })

  it('acionar diz que está buscando, porque o GPS leva até 15 s', async () => {
    comGps(() => {})
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Buscando sua localização.'))
  })

  it('aria-disabled bloqueia de verdade: a segunda pressão não dispara outra busca', async () => {
    const gps = comGps(() => {})
    montar()
    const botao = screen.getByRole('button', { name: 'Usar minha localização' })
    await userEvent.click(botao)
    await userEvent.click(botao)
    expect(gps).toHaveBeenCalledTimes(1)
  })

  it('GPS que responde depois de a pessoa digitar é descartado: nada se perde', async () => {
    let responder: PositionCallback = () => {}
    apiFalsa({ 'GET /api/geocode/reverso': Response.json(A) })
    comGps((ok) => {
      responder = ok
    })
    const aoEscolher = montar()
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Origem' }), 'rua')
    expect(screen.queryByText('Buscando sua localização…')).toBeNull()
    await act(async () => responder({ coords: { latitude: -23.59, longitude: -46.63, accuracy: 20 } } as GeolocationPosition))
    await new Promise((r) => setTimeout(r, 20))
    expect(aoEscolher).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Origem' })).toHaveValue('rua')
  })

  it('reverso pendente ao digitar é cancelado', async () => {
    const api = apiFalsa({ 'GET /api/geocode/reverso': () => new Promise<Response>(() => {}) })
    comGps(posicao())
    const aoEscolher = montar()
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    await waitFor(() => expect(api.de('GET /api/geocode/reverso')).toHaveLength(1))
    await userEvent.type(screen.getByRole('textbox', { name: 'Origem' }), 'r')
    expect(api.de('GET /api/geocode/reverso')[0].init.signal?.aborted).toBe(true)
    expect(aoEscolher).not.toHaveBeenCalled()
  })

  it.each([
    [1, /não autorizou a localização. Digite o endereço; a rota funciona igual/],
    [2, /Não conseguimos sua localização agora/],
    [3, /Não conseguimos sua localização agora/],
  ])('erro %i do GPS orienta a digitar', async (codigo, texto) => {
    comGps((_ok, erro) => erro({ code: codigo } as GeolocationPositionError))
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    expect(await screen.findByText(texto)).toBeInTheDocument()
  })

  it('404 do reverso usa o detail do backend, fora da área inclusive', async () => {
    apiFalsa({ 'GET /api/geocode/reverso': erroApi(404, FORA_DA_AREA) })
    comGps(posicao())
    const aoEscolher = montar()
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    expect(await screen.findByText(`${FORA_DA_AREA} Digite o endereço.`)).toBeInTheDocument()
    expect(aoEscolher).not.toHaveBeenCalled()
  })
})

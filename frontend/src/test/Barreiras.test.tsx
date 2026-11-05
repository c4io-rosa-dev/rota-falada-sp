import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { apiFalsa } from './apiFalsa'
import { A, abrir, ficha, prepararColaboracao } from './apoioColaboracao'

vi.mock('../auth/cliente', () => import('./clienteFalso'))

prepararColaboracao()

describe('/barreiras', () => {
  it('vindo de um passo usa o ponto do state e mostra a lista só com endereços prontos; nada na URL', async () => {
    const api = apiFalsa({ 'GET /api/barreiras': Response.json([ficha(), ficha({ id: 6, categoria: 'buraco', severidade: 'dificulta' })]), 'GET /api/geocode/reverso': Response.json(A) })
    const { container } = abrir('/barreiras', { ponto: [-23.59, -46.635], rotuloPonto: 'Meio do passo 3' })
    const lista = (await screen.findByRole('heading', { level: 3, name: 'Escada' })).closest('ol')!
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2)
    expect(within(lista).getAllByText(/perto de Rua A, 1/)).toHaveLength(2)
    expect(within(lista).getByRole('heading', { level: 3, name: 'Escada' })).toBeInTheDocument()
    expect(new URL(api.de('GET /api/barreiras')[0].url).searchParams.get('raio_m')).toBe('200')
    expect(screen.getByRole('link', { name: 'Registrar barreira neste ponto' })).toHaveAttribute('href', '/barreiras/nova')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 barreiras a até 200 metros.'))
    expect(await axe(container)).toHaveNoViolations()
  })

  it('lista vazia não diz que não há barreira; dá para ampliar o raio', async () => {
    const api = apiFalsa({ 'GET /api/barreiras': Response.json([]) })
    const user = userEvent.setup()
    abrir('/barreiras', { ponto: [-23.59, -46.635] })
    expect(await screen.findByText('Nenhuma barreira registrada a até 200 m. Isso não quer dizer que não haja.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ver até 500 m' }))
    await waitFor(() => expect(api.de('GET /api/barreiras')).toHaveLength(2))
    expect(new URL(api.de('GET /api/barreiras')[1].url).searchParams.get('raio_m')).toBe('500')
  })

  it('trocar o raio não anuncia a contagem antiga com o raio novo; o foco não cai', async () => {
    let responder: (r: Response) => void = () => {}
    let vez = 0
    apiFalsa({ 'GET /api/barreiras': () => (++vez === 1 ? Response.json([ficha()]) : new Promise<Response>((r) => (responder = r))), 'GET /api/geocode/reverso': Response.json(A) })
    const user = userEvent.setup()
    abrir('/barreiras', { ponto: [-23.59, -46.635] })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 barreira a até 200 metros.'))
    await user.click(screen.getByRole('button', { name: 'Ver até 500 m' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Registradas aqui' })).toHaveFocus()
    await new Promise((r) => setTimeout(r, 200))
    expect(screen.getByRole('status')).not.toHaveTextContent('a até 500 metros')
    expect(screen.queryByRole('heading', { level: 3, name: 'Escada' })).toBeNull()
    responder(Response.json([]))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Nenhuma barreira registrada a até 500 metros.'))
  })

  it('trocar o local apaga a lista antiga e nada da consulta cancelada é anunciado', async () => {
    apiFalsa({ 'GET /api/barreiras': Response.json([]), 'GET /api/geocode/reverso': Response.json(A) })
    const user = userEvent.setup()
    abrir('/barreiras', { ponto: [-23.59, -46.635], rotuloPonto: 'Meio do passo 3' })
    await screen.findByText(/Isso não quer dizer que não haja/)
    await user.click(screen.getByRole('button', { name: 'Trocar o local' }))
    expect(screen.queryByText(/Isso não quer dizer que não haja/)).toBeNull()
    expect(screen.getByText('Escolha um ponto para ver as barreiras registradas perto dele.')).toBeInTheDocument()
    expect(screen.queryByText('Buscando barreiras…')).toBeNull()
  })

  it('"Tentar de novo" some, e o foco vai ao título da lista', async () => {
    let vez = 0
    apiFalsa({ 'GET /api/barreiras': () => (++vez === 1 ? new Response('x', { status: 503 }) : Response.json([])) })
    const user = userEvent.setup()
    abrir('/barreiras', { ponto: [-23.59, -46.635] })
    await user.click(await screen.findByRole('button', { name: 'Tentar de novo' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Registradas aqui' })).toHaveFocus()
  })
})

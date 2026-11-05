import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { gravarSessaoRota, PERFIL_FORM_PADRAO } from '../dados/sessaoRota'
import { montarPedido } from '../pages/rotaEstado'
import { apiFalsa } from './apiFalsa'
import { abrir, logar, prepararColaboracao } from './apoioColaboracao'
import { endereco, ROTA } from './fixturasRota'

vi.mock('../auth/cliente', () => import('./clienteFalso'))

prepararColaboracao()

const A = endereco(1, 'Rua A, 1 · Vila Mariana')
const B = endereco(2, 'Rua B, 2 · Vila Mariana')

function barreira(id: number, origem: 'oficial' | 'colaborativa') {
  return { id, origem, categoria: 'buraco', severidade: 'dificulta', distancia_m: 12, confirmacoes: origem === 'colaborativa' ? 1 : null, data_referencia: '2026-11-03' }
}

function comRotaSalva(rota = ROTA) {
  gravarSessaoRota({
    versao: 1,
    origem: A,
    destino: B,
    perfil: PERFIL_FORM_PADRAO,
    rota,
    rotaDe: { pedido: montarPedido(A, B, PERFIL_FORM_PADRAO), origem: A.rotulo, destino: B.rotulo },
    calculadaEm: new Date().toISOString(),
  })
}

describe('rota e colaboração', () => {
  it('colaborativa leva à ficha, oficial não: os ids colidem entre as duas tabelas', async () => {
    apiFalsa({})
    comRotaSalva({ ...ROTA, passos: [{ ...ROTA.passos[0], barreiras_proximas: [barreira(9, 'colaborativa'), barreira(9, 'oficial')] }] })
    abrir('/rota')
    const lista = await screen.findByRole('list', { name: 'Os 1 passos da rota' })
    const links = within(lista).getAllByRole('link', { name: 'Ver e votar: Buraco, a 12 m' })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', '/barreiras/9')
    expect(links[0]).toHaveClass('alvo')
  })

  it('cada passo leva às barreiras perto dele, com o ponto no state e nada na URL; a volta restaura a rota', async () => {
    const api = apiFalsa({ 'GET /api/barreiras': Response.json([]) })
    comRotaSalva()
    const user = userEvent.setup()
    abrir('/rota')
    const link = await screen.findByRole('link', { name: 'Barreiras perto do passo 2' })
    expect(link).toHaveAttribute('href', '/barreiras')
    await user.click(link)
    await screen.findByText(/Isso não quer dizer que não haja/)
    const url = new URL(api.de('GET /api/barreiras')[0].url)
    expect(Number(url.searchParams.get('lat'))).toBeCloseTo(-23.59)
    await user.click(within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('link', { name: 'Planejar rota' }))
    expect(await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })).toBeInTheDocument()
    expect(api.de('POST /api/rotas')).toHaveLength(0)
  })

  it('LGPD: com login, geocode e rota continuam sem Authorization', async () => {
    const api = apiFalsa({ ...logar(), 'GET /api/geocode': Response.json([A, B]), 'POST /api/rotas': Response.json(ROTA) })
    const user = userEvent.setup()
    abrir('/rota')
    for (const [nome, setas] of [
      ['Origem', '{ArrowDown}'],
      ['Destino', '{ArrowDown}{ArrowDown}'],
    ] as const) {
      await user.click(await screen.findByRole('combobox', { name: nome }))
      await user.keyboard('rua{Enter}')
      await screen.findAllByRole('option')
      await user.keyboard(`${setas}{Enter}`)
    }
    await user.click(screen.getByRole('button', { name: 'Calcular rota' }))
    await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })
    expect(api.de('POST /api/rotas')[0].init.headers).toEqual({ 'Content-Type': 'application/json' })
    for (const c of api.de('GET /api/geocode')) expect(c.init.headers).toEqual({})
  })
})

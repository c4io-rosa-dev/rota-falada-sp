import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Barreira } from '../api/colaboracao'
import App from '../App'
import * as cliente from '../auth/cliente'
import * as config from '../auth/config'
import { endereco } from './fixturasRota'

export const mocks = vi.mocked(cliente)
export const A = endereco(1, 'Rua A, 1 · Vila Mariana')
export const CONTA = { id: '3f2a91b0-1111-2222-3333-444455556666', email: 'pessoa@exemplo.org' }

export function ficha(extras: Partial<Barreira> = {}): Barreira {
  return {
    id: 5,
    categoria: 'escada',
    severidade: 'intransponivel',
    status: 'pendente',
    votos: { confirma: 1, contesta: 0, resolvida: 0 },
    descricao: null,
    lat: -23.59,
    lon: -46.635,
    criada_em: '2026-11-03T12:00:00+00:00',
    ultima_confirmacao_em: null,
    foto_url: null,
    foto_descricao: null,
    ...extras,
  }
}

export function logar(papel: 'colaborador' | 'admin' = 'colaborador') {
  mocks.temSessaoSalva.mockReturnValue(true)
  mocks.obterToken.mockResolvedValue('tkn')
  mocks.lerConta.mockResolvedValue(CONTA)
  return { 'GET /api/eu': Response.json({ papel }) }
}

export function abrir(rota: string, state?: unknown) {
  const [pathname, busca] = rota.split('?')
  return render(
    <MemoryRouter initialEntries={[{ pathname, search: busca ? `?${busca}` : '', state }]}>
      <App />
    </MemoryRouter>,
  )
}

export const regioes = () => document.querySelectorAll('[aria-live],[role=status],[role=alert]')

/** Cada arquivo chama isto: login configurado, sem sessão. */
export function prepararColaboracao() {
  beforeEach(() => {
    vi.spyOn(config, 'lerConfigAuth').mockReturnValue({ url: 'https://x.supabase.co', chave: 'sb_publishable_x' })
    mocks.temSessaoSalva.mockReturnValue(false)
    mocks.obterToken.mockResolvedValue(null)
    mocks.renovarToken.mockResolvedValue(null)
    mocks.lerConta.mockResolvedValue(null)
    mocks.enviarCodigo.mockReset().mockResolvedValue(undefined)
    mocks.verificarCodigo.mockReset().mockResolvedValue(undefined)
    mocks.sair.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
}

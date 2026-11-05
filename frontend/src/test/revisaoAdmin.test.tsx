import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { apiFalsa, erroApi } from './apiFalsa'
import { abrir, ficha, logar, mocks, prepararColaboracao } from './apoioColaboracao'

vi.mock('../auth/cliente', () => import('./clienteFalso'))
prepararColaboracao()

const MSG_SEM_PERMISSAO = 'Esta área é só para a equipe de moderação.'

function adiado<T>() {
  let resolver!: (v: T) => void
  const promessa = new Promise<T>((r) => (resolver = r))
  return { promessa, resolver }
}

const lote = (de: number, n = 50) => Array.from({ length: n }, (_, i) => ficha({ id: de - i }))
const filtros = () => within(screen.getByRole('navigation', { name: 'Filtrar por status' }))
const pausa = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

describe('fila: voltar a um filtro', () => {
  function fila(responder: (url: URL) => Response) {
    const api = apiFalsa({
      ...logar('admin'),
      'GET /api/admin/barreiras': () => responder(new URL(api.chamadas.at(-1)!.url)),
    })
    return api
  }

  it('recomeça do 1º lote: nada de item repetido nem inalcançável', async () => {
    let primeiro = lote(100)
    fila((url) => {
      const status = url.searchParams.get('status')
      if (status !== 'pendente') return Response.json([])
      return Response.json(url.searchParams.get('antes_de') ? lote(50) : primeiro)
    })
    const user = userEvent.setup()
    abrir('/admin')
    await screen.findByRole('link', { name: 'Nº 100, Escada' })
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }))
    await screen.findByRole('link', { name: 'Nº 1, Escada' })
    await user.click(filtros().getByRole('link', { name: 'Confirmada' }))
    await screen.findByText('Nenhuma barreira neste status.')
    // a barreira 100 saiu da fila enquanto a pessoa via outro filtro
    primeiro = lote(99)
    await user.click(filtros().getByRole('link', { name: 'Aguardando confirmação' }))
    await screen.findByRole('link', { name: 'Nº 99, Escada' })
    expect(screen.getAllByRole('link', { name: 'Nº 50, Escada' })).toHaveLength(1)
    expect(screen.queryByRole('link', { name: 'Nº 49, Escada' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Carregar mais' })).toBeInTheDocument()
  })

  it('itens de outro status não entram no filtro atual enquanto o 1º lote carrega', async () => {
    const segundo = adiado<Response>()
    let vezConfirmada = 0
    fila((url) => {
      if (url.searchParams.get('status') === 'validada') return vezConfirmada++ === 0 ? (segundo.promessa as unknown as Response) : Response.json([])
      return Response.json(url.searchParams.get('antes_de') ? lote(50, 1) : lote(100))
    })
    const user = userEvent.setup()
    abrir('/admin')
    await screen.findByRole('link', { name: 'Nº 100, Escada' })
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }))
    await screen.findByRole('link', { name: 'Nº 50, Escada' })
    await user.click(filtros().getByRole('link', { name: 'Confirmada' }))
    await act(async () => segundo.resolver(Response.json([ficha({ id: 700, status: 'validada' })])))
    await screen.findByRole('link', { name: 'Nº 700, Escada' })
    expect(screen.queryByRole('link', { name: 'Nº 50, Escada' })).toBeNull()
  })
})

describe('fila: erro de carga', () => {
  it('filtro que dá 503: o foco não cai, a região diz, os filtros ficam', async () => {
    let vez = 0
    apiFalsa({ ...logar('admin'), 'GET /api/admin/barreiras': () => (++vez === 1 ? Response.json([ficha()]) : erroApi(503, 'Fora do ar agora.')) })
    const user = userEvent.setup()
    abrir('/admin')
    await screen.findByRole('link', { name: 'Nº 5, Escada' })
    const confirmada = filtros().getByRole('link', { name: 'Confirmada' })
    await user.click(confirmada)
    expect(await screen.findByText('Fora do ar agora.')).toBeInTheDocument()
    expect(document.activeElement).not.toBe(document.body)
    expect(filtros().getByRole('link', { name: 'Confirmada' })).toHaveFocus()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Fora do ar agora.'))
  })

  it('403 anuncia a frase', async () => {
    apiFalsa({ ...logar(), 'GET /api/admin/barreiras': erroApi(403, 'Você não tem permissão para esta ação.') })
    abrir('/admin')
    await screen.findByText(MSG_SEM_PERMISSAO)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(MSG_SEM_PERMISSAO))
  })

  it('403 depois de um filtro: os filtros saem, e o foco vai ao h1', async () => {
    let vez = 0
    apiFalsa({ ...logar('admin'), 'GET /api/admin/barreiras': () => (++vez === 1 ? Response.json([ficha()]) : erroApi(403, 'Você não tem permissão para esta ação.')) })
    const user = userEvent.setup()
    abrir('/admin')
    await screen.findByRole('link', { name: 'Nº 5, Escada' })
    await user.click(filtros().getByRole('link', { name: 'Confirmada' }))
    await screen.findByText(MSG_SEM_PERMISSAO)
    expect(screen.getByRole('heading', { level: 1, name: 'Moderação' })).toHaveFocus()
  })

  it('"Cancelar" no portão vai a um destino fixo, sem sair do site', async () => {
    apiFalsa({})
    const user = userEvent.setup()
    abrir('/admin')
    await screen.findByRole('heading', { level: 2, name: 'Entre para continuar' })
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('heading', { level: 1, name: 'Moderação' })).toBeNull())
    expect(document.activeElement).not.toBe(document.body)
  })
})

describe('"Carregar mais"', () => {
  it('mostra, anuncia, fica aria-disabled e ignora a segunda pressão', async () => {
    const mais = adiado<Response>()
    let vez = 0
    const api = apiFalsa({ ...logar('admin'), 'GET /api/admin/barreiras': () => (++vez === 1 ? Response.json(lote(100)) : mais.promessa) })
    const user = userEvent.setup()
    abrir('/admin')
    const botao = await screen.findByRole('button', { name: 'Carregar mais' })
    await user.click(botao)
    expect(await screen.findByText('Carregando mais barreiras…')).toBeInTheDocument()
    expect(botao).toHaveAttribute('aria-disabled', 'true')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Carregando mais barreiras.'))
    await user.click(botao)
    expect(api.de('GET /api/admin/barreiras')).toHaveLength(2)
    await act(async () => mais.resolver(Response.json(lote(50))))
    expect(await screen.findByRole('link', { name: 'Nº 50, Escada' })).toHaveFocus()
    expect(screen.queryByText('Carregando mais barreiras…')).toBeNull()
  })
})

describe('decisão', () => {
  const FICHA = { 'GET /api/admin/barreiras/5': Response.json(ficha()), 'GET /api/admin/barreiras/5/eventos': Response.json([]) }

  it('id inválido não chama a API e diz que a barreira não está disponível', async () => {
    const api = apiFalsa(logar('admin'))
    abrir('/admin/barreiras/abc')
    expect(await screen.findByText('Esta barreira não está mais disponível.')).toBeInTheDocument()
    expect(api.chamadas.filter((c) => c.caminho.startsWith('/api/admin'))).toHaveLength(0)
    expect(screen.queryByText('Confira os dados informados.')).toBeNull()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Esta barreira não está mais disponível.'))
  })

  it('403 anuncia', async () => {
    apiFalsa({ ...logar(), 'GET /api/admin/barreiras/5': erroApi(403, 'Você não tem permissão para esta ação.') })
    abrir('/admin/barreiras/5')
    await screen.findByText(MSG_SEM_PERMISSAO)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(MSG_SEM_PERMISSAO))
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull()
  })

  it('503 anuncia e oferece tentar de novo, com o foco no h1', async () => {
    let vez = 0
    apiFalsa({ ...logar('admin'), 'GET /api/admin/barreiras/5': () => (++vez === 1 ? erroApi(503, 'Fora do ar agora.') : Response.json(ficha())), 'GET /api/admin/barreiras/5/eventos': Response.json([]) })
    const user = userEvent.setup()
    abrir('/admin/barreiras/5')
    await screen.findByText('Fora do ar agora.')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Fora do ar agora.'))
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Decisão da moderação' })).toHaveFocus()
    expect(await screen.findByRole('heading', { level: 2, name: 'Nº 5, Escada' })).toBeInTheDocument()
  })

  it('auditoria que falha anuncia e oferece tentar de novo', async () => {
    let vez = 0
    apiFalsa({ ...logar('admin'), 'GET /api/admin/barreiras/5': Response.json(ficha()), 'GET /api/admin/barreiras/5/eventos': () => (++vez === 1 ? erroApi(503, 'Auditoria fora.') : Response.json([])) })
    const user = userEvent.setup()
    abrir('/admin/barreiras/5')
    await screen.findByText('Auditoria fora.')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Auditoria fora.'))
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Auditoria' })).toHaveFocus()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull())
    expect(screen.getByRole('heading', { level: 2, name: 'Auditoria' }).parentElement).not.toHaveTextContent('Auditoria fora.')
  })

  it('registrar mostra e anuncia a espera', async () => {
    const post = adiado<Response>()
    apiFalsa({ ...logar('admin'), ...FICHA, 'POST /api/admin/barreiras/5/status': () => post.promessa })
    const user = userEvent.setup()
    abrir('/admin/barreiras/5')
    await user.type(await screen.findByRole('textbox', { name: 'Motivo' }), 'Vi no local')
    await user.click(screen.getByRole('button', { name: 'Registrar decisão' }))
    expect(await screen.findByText('Registrando a decisão…')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Registrando a decisão.'))
    await act(async () => post.resolver(Response.json(ficha({ status: 'validada' }))))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Status alterado para confirmada.'))
    expect(screen.queryByText('Registrando a decisão…')).toBeNull()
  })

  it('"Cancelar" no portão não usa o histórico', async () => {
    apiFalsa({})
    const user = userEvent.setup()
    abrir('/admin/barreiras/5')
    await screen.findByRole('heading', { level: 2, name: 'Entre para continuar' })
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('heading', { level: 1, name: 'Decisão da moderação' })).toBeNull())
  })

  it('dois portões abertos: nenhum id repetido, e cada rótulo aponta o próprio campo', async () => {
    apiFalsa({
      ...logar('admin'),
      'GET /api/admin/barreiras/5': Response.json(ficha()),
      'GET /api/admin/barreiras/5/eventos': erroApi(401, 'Faça login para continuar.'),
      'POST /api/admin/barreiras/5/status': erroApi(401, 'Faça login para continuar.'),
    })
    mocks.renovarToken.mockResolvedValue(null)
    const user = userEvent.setup()
    abrir('/admin/barreiras/5')
    await screen.findByRole('heading', { level: 2, name: 'Sua sessão terminou' })
    await user.type(screen.getByRole('textbox', { name: 'Motivo' }), 'Vi no local')
    await user.click(screen.getByRole('button', { name: 'Registrar decisão' }))
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 2, name: 'Sua sessão terminou' })).toHaveLength(2))
    await pausa(0)
    const ids = Array.from(document.querySelectorAll('[id]'), (e) => e.id).filter(Boolean)
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([])
    const emails = screen.getAllByRole('textbox', { name: 'E-mail' })
    expect(emails).toHaveLength(2)
    expect(emails[0]).not.toBe(emails[1])
  })
})

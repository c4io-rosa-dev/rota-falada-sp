import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { axe } from 'vitest-axe'
import App from '../App'
import { lerRascunho } from '../dados/rascunho'
import { apiFalsa, erroApi } from './apiFalsa'
import { A, abrir, ficha, logar, mocks, prepararColaboracao } from './apoioColaboracao'

vi.mock('../auth/cliente', () => import('./clienteFalso'))

prepararColaboracao()

const MSG_FALHA = 'Instabilidade no sistema. O rascunho fica só nesta aba: se você a fechar, ele se perde.'

describe('/barreiras/nova', () => {
  const LOCAL = { lat: -23.59, lon: -46.635, rotulo: 'Rua A, 1', origem: 'busca' }

  async function preencher(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('radio', { name: /^Escada/ }))
    await user.type(screen.getByRole('textbox', { name: 'Descrição (opcional)' }), 'Três degraus')
    await user.click(screen.getByRole('button', { name: 'Registrar barreira' }))
  }

  it('tem as 10 categorias, não pergunta severidade e valida com foco', async () => {
    apiFalsa({})
    const user = userEvent.setup()
    const { container } = abrir('/barreiras/nova')
    const grupo = await screen.findByRole('group', { name: 'Tipo de barreira' })
    expect(within(grupo).getAllByRole('radio')).toHaveLength(10)
    expect(screen.queryByText(/severidade/i)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Registrar barreira' }))
    expect(within(grupo).getAllByRole('radio')[0]).toHaveFocus()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('sem login, o portão aparece na própria página e o rascunho fica; depois do código, a mesma ação e a mesma chave', async () => {
    const api = apiFalsa({ 'GET /api/eu': Response.json({ papel: 'colaborador' }), 'POST /api/barreiras': Response.json(ficha(), { status: 201 }), 'GET /api/barreiras/5': Response.json(ficha()), 'GET /api/geocode/reverso': Response.json(A) })
    mocks.verificarCodigo.mockImplementation(async () => {
      mocks.temSessaoSalva.mockReturnValue(true)
      mocks.obterToken.mockResolvedValue('tkn')
    })
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await preencher(user)
    const titulo = await screen.findByRole('heading', { level: 2, name: 'Entre para continuar' })
    expect(titulo).toHaveFocus()
    expect(api.de('POST /api/barreiras')).toHaveLength(0)
    expect(screen.getByRole('textbox', { name: 'Descrição (opcional)' })).toHaveValue('Três degraus')
    const chave = lerRascunho().chave
    expect(chave).toBeTruthy()

    await user.type(screen.getByRole('textbox', { name: 'E-mail' }), 'p@e.org')
    await user.click(screen.getByRole('button', { name: 'Receber código' }))
    await user.type(await screen.findByRole('textbox', { name: 'Código de 6 dígitos' }), '123456')
    await user.click(screen.getByRole('button', { name: 'Confirmar código' }))

    await waitFor(() => expect(api.de('POST /api/barreiras')).toHaveLength(1))
    const corpo = JSON.parse(String(api.de('POST /api/barreiras')[0].init.body))
    expect(corpo).toMatchObject({ categoria: 'escada', lat: LOCAL.lat, lon: LOCAL.lon, descricao: 'Três degraus', chave_idempotencia: chave })
    expect(await screen.findByRole('heading', { level: 1, name: 'Barreira registrada' })).toHaveFocus()
    expect(lerRascunho()).toEqual({ descricao: '' })
  })

  it('cancelar o portão devolve o foco ao botão de origem', async () => {
    apiFalsa({})
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await preencher(user)
    await screen.findByRole('heading', { level: 2, name: 'Entre para continuar' })
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('button', { name: 'Registrar barreira' })).toHaveFocus()
  })

  it('401 renova o token e repete uma vez com a mesma chave', async () => {
    let tentativas = 0
    const api = apiFalsa({
      ...logar(),
      'POST /api/barreiras': () => (++tentativas === 1 ? erroApi(401, 'Faça login para continuar.') : Response.json(ficha(), { status: 201 })),
      'GET /api/barreiras/5': Response.json(ficha()),
      'GET /api/geocode/reverso': Response.json(A),
    })
    mocks.renovarToken.mockResolvedValue('novo')
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await preencher(user)
    await screen.findByRole('heading', { level: 1, name: 'Barreira registrada' })
    const [a, b] = api.de('POST /api/barreiras')
    expect(JSON.parse(String(a.init.body)).chave_idempotencia).toBe(JSON.parse(String(b.init.body)).chave_idempotencia)
    expect((b.init.headers as Record<string, string>).Authorization).toBe('Bearer novo')
  })

  it('sessão que não renova: "Sua sessão terminou", com o texto preservado', async () => {
    apiFalsa({ ...logar(), 'POST /api/barreiras': erroApi(401, 'Faça login para continuar.') })
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await preencher(user)
    expect(await screen.findByRole('heading', { level: 2, name: 'Sua sessão terminou' })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Descrição (opcional)' })).toHaveValue('Três degraus')
  })

  it('422 de fora da área mostra a mensagem do backend, ligada a "Trocar o local", que recebe o foco', async () => {
    apiFalsa({ ...logar(), 'POST /api/barreiras': erroApi(422, 'Este ponto está fora da área atendida pelo Rota Falada SP.') })
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await preencher(user)
    const trocar = await screen.findByRole('button', { name: 'Trocar o local' })
    await waitFor(() => expect(trocar).toHaveFocus())
    expect(trocar).toHaveAccessibleDescription(expect.stringContaining('fora da área atendida'))
    await new Promise((r) => setTimeout(r, 150))
    expect(screen.getByRole('status').textContent).toBe('')
    await user.click(trocar)
    expect(screen.getByRole('combobox', { name: 'Endereço' })).toHaveAccessibleDescription(expect.not.stringContaining('fora da área atendida'))
  })

  it('sem local, o erro fica ligado ao campo de busca', async () => {
    apiFalsa({})
    const user = userEvent.setup()
    abrir('/barreiras/nova')
    await user.click(await screen.findByRole('radio', { name: /^Escada/ }))
    await user.click(screen.getByRole('button', { name: 'Registrar barreira' }))
    const campo = screen.getByRole('combobox', { name: 'Endereço' })
    expect(campo).toHaveFocus()
    expect(campo).toHaveAttribute('aria-invalid', 'true')
    expect(campo).toHaveAccessibleDescription(expect.stringContaining('Diga onde está a barreira.'))
  })

  it('editar com o portão aberto vale: o POST sai com o texto novo e chave nova', async () => {
    const api = apiFalsa({ 'GET /api/eu': Response.json({ papel: 'colaborador' }), 'POST /api/barreiras': Response.json(ficha(), { status: 201 }), 'GET /api/barreiras/5': Response.json(ficha()), 'GET /api/geocode/reverso': Response.json(A) })
    mocks.verificarCodigo.mockImplementation(async () => {
      mocks.temSessaoSalva.mockReturnValue(true)
      mocks.obterToken.mockResolvedValue('tkn')
    })
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await preencher(user)
    await screen.findByRole('heading', { level: 2, name: 'Entre para continuar' })
    const chaveAntiga = lerRascunho().chave
    await user.type(screen.getByRole('textbox', { name: 'Descrição (opcional)' }), ' e sem corrimão')
    await user.type(screen.getByRole('textbox', { name: 'E-mail' }), 'p@e.org{Enter}')
    await user.type(await screen.findByRole('textbox', { name: 'Código de 6 dígitos' }), '123456{Enter}')
    await waitFor(() => expect(api.de('POST /api/barreiras')).toHaveLength(1))
    const corpo = JSON.parse(String(api.de('POST /api/barreiras')[0].init.body))
    expect(corpo.descricao).toBe('Três degraus e sem corrimão')
    expect(corpo.chave_idempotencia).not.toBe(chaveAntiga)
  })

  it('chegar com outro ponto gera chave nova; o state não sobrevive à recarga', async () => {
    sessionStorage.setItem('rf-rascunho', JSON.stringify({ descricao: 'x', categoria: 'escada', local: { ...LOCAL, lat: -23.6 }, chave: 'chave-velha' }))
    let estado: unknown = 'inicial'
    function Espia() {
      estado = useLocation().state
      return null
    }
    render(
      <MemoryRouter initialEntries={[{ pathname: '/barreiras/nova', state: { local: LOCAL } }]}>
        <App />
        <Espia />
      </MemoryRouter>,
    )
    await screen.findByRole('group', { name: 'Tipo de barreira' })
    expect(lerRascunho().chave).toBeUndefined()
    expect(lerRascunho().local).toMatchObject({ lat: LOCAL.lat })
    await waitFor(() => expect(estado).toBeNull())
  })

  it('chegar com o mesmo ponto mantém a chave da tentativa anterior', async () => {
    sessionStorage.setItem('rf-rascunho', JSON.stringify({ descricao: 'x', categoria: 'escada', local: LOCAL, chave: 'chave-velha' }))
    abrir('/barreiras/nova', { local: LOCAL })
    await screen.findByRole('group', { name: 'Tipo de barreira' })
    expect(lerRascunho().chave).toBe('chave-velha')
  })

  it('os textos dizem o que acontece, sem prometer anonimato nem número errado de votos', async () => {
    apiFalsa({})
    abrir('/barreiras/nova')
    expect(await screen.findByText(/Com as confirmações necessárias, a rota passa a evitar ou avisar/)).toBeInTheDocument()
    expect(screen.queryByText(/Outra pessoa confirma/)).toBeNull()
    expect(screen.getByText(/a moderação vê só um código da conta/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/não identifica você/)
  })

  it('429 mantém o rascunho; 503 é honesto sobre onde o rascunho vive', async () => {
    apiFalsa({ ...logar(), 'POST /api/barreiras': erroApi(429, 'Limite de 20 barreiras por dia.') })
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await preencher(user)
    expect(await screen.findByText('Limite de 20 barreiras por dia.')).toBeInTheDocument()
    expect(lerRascunho().descricao).toBe('Três degraus')
    apiFalsa({ 'GET /api/eu': Response.json({ papel: 'colaborador' }), 'POST /api/barreiras': new Response('x', { status: 503 }) })
    await user.click(screen.getByRole('button', { name: 'Registrar barreira' }))
    expect(await screen.findByText(MSG_FALHA)).toBeInTheDocument()
  })

  it('editar depois de falha gera chave nova; repetir sem editar mantém', async () => {
    const api = apiFalsa({ ...logar(), 'POST /api/barreiras': new Response('x', { status: 503 }) })
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await preencher(user)
    await screen.findByText(MSG_FALHA)
    await user.click(screen.getByRole('button', { name: 'Registrar barreira' }))
    await waitFor(() => expect(api.de('POST /api/barreiras')).toHaveLength(2))
    await user.type(screen.getByRole('textbox', { name: 'Descrição (opcional)' }), '!')
    await user.click(screen.getByRole('button', { name: 'Registrar barreira' }))
    await waitFor(() => expect(api.de('POST /api/barreiras')).toHaveLength(3))
    const chaves = api.de('POST /api/barreiras').map((c) => JSON.parse(String(c.init.body)).chave_idempotencia)
    expect(chaves[0]).toBe(chaves[1])
    expect(chaves[2]).not.toBe(chaves[1])
  })
})

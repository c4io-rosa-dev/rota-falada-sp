import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import * as config from '../auth/config'
import { lembrarMinha } from '../dados/rascunho'
import { apiFalsa, erroApi } from './apiFalsa'
import { CONTA, abrir, logar, mocks, regioes, prepararColaboracao } from './apoioColaboracao'

vi.mock('../auth/cliente', () => import('./clienteFalso'))

prepararColaboracao()

describe('sem as variáveis VITE_', () => {
  it('Entrar some, e a tela diz que o login não está disponível', async () => {
    vi.spyOn(config, 'lerConfigAuth').mockReturnValue(null)
    abrir('/entrar')
    expect(await screen.findByText(/O login não está disponível neste ambiente/)).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Principal' })
    expect(within(nav).queryByRole('link', { name: 'Entrar' })).toBeNull()
    expect(mocks.enviarCodigo).not.toHaveBeenCalled()
  })
})

describe('navegação e foco', () => {
  it('mostra Entrar ou Conta conforme a sessão, sem carregar a biblioteca', () => {
    abrir('/')
    expect(within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/entrar')
    expect(mocks.lerConta).not.toHaveBeenCalled()
  })

  it('rota inexistente tem página própria com h1', async () => {
    abrir('/nao-existe')
    expect(await screen.findByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeInTheDocument()
  })
})

describe('/entrar', () => {
  it('pede o e-mail, foca o código e entra; o código nunca é guardado', async () => {
    const user = userEvent.setup()
    const { container } = abrir('/entrar')
    const email = await screen.findByRole('textbox', { name: 'E-mail' })
    expect(email).toHaveAttribute('type', 'email')
    expect(email).toHaveAttribute('autocomplete', 'email')
    await user.type(email, 'pessoa@exemplo.org')
    await user.click(screen.getByRole('button', { name: 'Receber código' }))
    const codigo = await screen.findByRole('textbox', { name: 'Código de 6 dígitos' })
    expect(codigo).toHaveFocus()
    expect(codigo).toHaveAttribute('autocomplete', 'one-time-code')
    expect(codigo).toHaveAttribute('inputmode', 'numeric')
    expect(codigo).not.toHaveAttribute('maxlength')
    expect(codigo).toHaveAccessibleDescription(expect.stringContaining('Enviamos para pessoa@exemplo.org'))
    expect(sessionStorage.getItem('rf-login')).toContain('pessoa@exemplo.org')
    expect(await axe(container)).toHaveNoViolations()

    await user.type(codigo, '012 345')
    // o sexto dígito não envia sozinho (WCAG 3.2.2)
    expect(mocks.verificarCodigo).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirmar código' }))
    await waitFor(() => expect(mocks.verificarCodigo).toHaveBeenCalledWith('pessoa@exemplo.org', '012345'))
    expect(sessionStorage.getItem('rf-login')).toBeNull()
  })

  it('código curto e código errado explicam, com o foco no campo e sem role=alert', async () => {
    mocks.verificarCodigo.mockRejectedValue({ code: 'otp_expired' })
    sessionStorage.setItem('rf-login', JSON.stringify({ email: 'p@e.org', enviadoEm: Date.now(), reenvios: 0 }))
    const user = userEvent.setup()
    abrir('/entrar')
    const codigo = await screen.findByRole('textbox', { name: 'Código de 6 dígitos' })
    await user.type(codigo, '1234{Enter}')
    expect(codigo).toHaveAttribute('aria-invalid', 'true')
    expect(codigo).toHaveAccessibleDescription(expect.stringContaining('você digitou 4'))
    expect(codigo).toHaveFocus()
    await user.clear(codigo)
    await user.type(codigo, '123456{Enter}')
    expect(await screen.findByText('Código incorreto ou vencido. Confira os dígitos ou peça outro.')).toBeInTheDocument()
    expect(regioes()).toHaveLength(1)
  })

  it('reenviar antes da hora repete a frase, sem contador e sem perder o foco', async () => {
    sessionStorage.setItem('rf-login', JSON.stringify({ email: 'p@e.org', enviadoEm: Date.now(), reenvios: 0 }))
    const user = userEvent.setup()
    abrir('/entrar')
    const reenviar = await screen.findByRole('button', { name: 'Reenviar código' })
    expect(reenviar).toHaveAttribute('aria-disabled', 'true')
    // a hora de liberar já aparece sem precisar pressionar um botão que parece desativado
    expect(screen.getByText(/Você pode pedir outro código a partir das/)).toBeInTheDocument()
    await user.click(reenviar)
    expect(reenviar).toHaveFocus()
    expect(mocks.enviarCodigo).not.toHaveBeenCalled()
    expect(reenviar).toHaveAccessibleDescription(expect.stringContaining('Você pode pedir outro código a partir das'))
  })
})

describe('/conta', () => {
  it('sem login vai para /entrar', async () => {
    abrir('/conta')
    expect(await screen.findByRole('heading', { level: 1, name: 'Entrar' })).toBeInTheDocument()
  })

  it('o link do painel só aparece para admin; sair limpa "minhas"', async () => {
    apiFalsa(logar('admin'))
    lembrarMinha(CONTA.id, 5)
    const user = userEvent.setup()
    abrir('/conta')
    expect(await screen.findByText('E-mail: pessoa@exemplo.org')).toBeInTheDocument()
    const painel = await screen.findByRole('link', { name: 'Painel de moderação' })
    expect(painel).toHaveAttribute('href', '/admin')
    // o link chega depois: fica abaixo de "Sair" para não empurrar nada (D19)
    expect(screen.getByRole('button', { name: 'Sair' }).compareDocumentPosition(painel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Sair' }))
    await waitFor(() => expect(mocks.sair).toHaveBeenCalled())
    expect(localStorage.getItem(`rf:minhas:${CONTA.id}`)).toBeNull()
  })

  it('colaborador não vê o painel', async () => {
    apiFalsa(logar('colaborador'))
    abrir('/conta')
    await screen.findByText('E-mail: pessoa@exemplo.org')
    await waitFor(() => expect(mocks.obterToken).toHaveBeenCalled())
    expect(screen.queryByRole('link', { name: 'Painel de moderação' })).toBeNull()
  })
})

describe('/entrar: erros e espera', () => {
  it('Enter com o foco no campo: o foco não muda, então a região anuncia o erro', async () => {
    sessionStorage.setItem('rf-login', JSON.stringify({ email: 'p@e.org', enviadoEm: Date.now(), reenvios: 0 }))
    const user = userEvent.setup()
    abrir('/entrar')
    const codigo = await screen.findByRole('textbox', { name: 'Código de 6 dígitos' })
    await user.type(codigo, '1234{Enter}')
    expect(codigo).toHaveFocus()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('O código tem 6 dígitos; você digitou 4.'))
  })

  it('pelo botão o foco vai ao campo, que lê a descrição: sem anúncio por cima', async () => {
    sessionStorage.setItem('rf-login', JSON.stringify({ email: 'p@e.org', enviadoEm: Date.now(), reenvios: 0 }))
    const user = userEvent.setup()
    abrir('/entrar')
    const codigo = await screen.findByRole('textbox', { name: 'Código de 6 dígitos' })
    await user.type(codigo, '1234')
    await user.click(screen.getByRole('button', { name: 'Confirmar código' }))
    expect(codigo).toHaveFocus()
    await new Promise((r) => setTimeout(r, 150))
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('código vencido com Enter é falado', async () => {
    mocks.verificarCodigo.mockRejectedValue({ code: 'otp_expired' })
    sessionStorage.setItem('rf-login', JSON.stringify({ email: 'p@e.org', enviadoEm: Date.now(), reenvios: 0 }))
    const user = userEvent.setup()
    abrir('/entrar')
    await user.type(await screen.findByRole('textbox', { name: 'Código de 6 dígitos' }), '123456{Enter}')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Código incorreto ou vencido.'))
  })

  it('e-mail inválido com Enter é falado, e o aviso de envio aparece enquanto espera', async () => {
    let soltar: () => void = () => {}
    mocks.enviarCodigo.mockImplementation(() => new Promise<void>((r) => (soltar = r)))
    const user = userEvent.setup()
    abrir('/entrar')
    const email = await screen.findByRole('textbox', { name: 'E-mail' })
    await user.type(email, 'semarroba{Enter}')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Confira o e-mail digitado.'))
    await user.clear(email)
    await user.type(email, 'p@e.org{Enter}')
    expect(await screen.findByText('Enviando o código…')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Enviando o código.'))
    soltar()
    expect(await screen.findByRole('textbox', { name: 'Código de 6 dígitos' })).toHaveFocus()
  })

  it('"Reenviar código" libera sozinho na hora marcada, sem contador', async () => {
    sessionStorage.setItem('rf-login', JSON.stringify({ email: 'p@e.org', enviadoEm: Date.now() - 59_700, reenvios: 0 }))
    abrir('/entrar')
    const reenviar = await screen.findByRole('button', { name: 'Reenviar código' })
    expect(reenviar).toHaveAttribute('aria-disabled', 'true')
    await waitFor(() => expect(reenviar).not.toHaveAttribute('aria-disabled'), { timeout: 1500 })
    expect(screen.getByText('Você já pode pedir outro código.')).toBeInTheDocument()
  })

  it('não diz que enviou antes de enviar', async () => {
    abrir('/entrar')
    expect(await screen.findByText(/Enviaremos um código de 6 dígitos/)).toBeInTheDocument()
    expect(screen.queryByText(/^Enviamos um código/)).toBeNull()
  })
})

describe('/conta: falhas', () => {
  it('o e-mail é local: aparece mesmo com a API fora, ao lado do erro e de "Tentar de novo"', async () => {
    let vez = 0
    apiFalsa({ ...logar(), 'GET /api/eu': () => (++vez === 1 ? new Response('x', { status: 503 }) : Response.json({ papel: 'colaborador' })) })
    const user = userEvent.setup()
    abrir('/conta')
    expect(await screen.findByText('E-mail: pessoa@exemplo.org')).toBeInTheDocument()
    expect(screen.queryByText(/carregando…/)).toBeNull()
    await user.click(await screen.findByRole('button', { name: 'Tentar de novo' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Sua conta' })).toHaveFocus()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull())
  })

  it('espera do servidor aparece em /conta', async () => {
    const f = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', f)
    logar()
    abrir('/conta')
    expect(await screen.findByText('Carregando os dados da conta…')).toBeInTheDocument()
  })

  it('401 renova e repete; se não renovar, abre o portão em vez de uma frase sem saída', async () => {
    let vez = 0
    const api = apiFalsa({ ...logar(), 'GET /api/eu': () => (++vez === 1 ? erroApi(401, 'Faça login para continuar.') : Response.json({ papel: 'admin' })) })
    mocks.renovarToken.mockResolvedValue('novo')
    abrir('/conta')
    expect(await screen.findByRole('link', { name: 'Painel de moderação' })).toBeInTheDocument()
    expect((api.de('GET /api/eu')[1].init.headers as Record<string, string>).Authorization).toBe('Bearer novo')
  })

  it('401 sem renovação: portão "Sua sessão terminou"', async () => {
    apiFalsa({ ...logar(), 'GET /api/eu': erroApi(401, 'Faça login para continuar.') })
    abrir('/conta')
    expect(await screen.findByRole('heading', { level: 2, name: 'Sua sessão terminou' })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'E-mail' })).toBeInTheDocument()
  })

  it('sair antes de /api/eu responder apaga os rastros de autoria e o rascunho', async () => {
    const f = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', f)
    logar()
    lembrarMinha(CONTA.id, 5)
    lembrarMinha('outra-conta', 6)
    sessionStorage.setItem('rf-rascunho', JSON.stringify({ descricao: 'Três degraus' }))
    const user = userEvent.setup()
    abrir('/conta')
    await user.click(await screen.findByRole('button', { name: 'Sair' }))
    await waitFor(() => expect(mocks.sair).toHaveBeenCalled())
    expect(localStorage.getItem(`rf:minhas:${CONTA.id}`)).toBeNull()
    expect(localStorage.getItem('rf:minhas:outra-conta')).toBeNull()
    expect(sessionStorage.getItem('rf-rascunho')).toBeNull()
  })

  it('o texto de privacidade diz a verdade sobre a auditoria', async () => {
    apiFalsa(logar())
    abrir('/conta')
    expect(await screen.findByText(/a moderação vê um código da conta, nunca o e-mail/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/ninguém vê quem/i)
  })
})

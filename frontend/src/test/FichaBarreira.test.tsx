import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { axe } from 'vitest-axe'
import App from '../App'
import { lembrarMinha } from '../dados/rascunho'
import { apiFalsa, erroApi } from './apiFalsa'
import { A, CONTA, abrir, ficha, logar, mocks, prepararColaboracao } from './apoioColaboracao'

vi.mock('../auth/cliente', () => import('./clienteFalso'))

prepararColaboracao()

describe('/barreiras/:id', () => {
  const REVERSO = { 'GET /api/geocode/reverso': Response.json(A) }

  it('ficha pública diz status, efeito e fonte; o voto sem login abre o portão', async () => {
    const api = apiFalsa({ 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO })
    const user = userEvent.setup()
    const { container } = abrir('/barreiras/5')
    expect(await screen.findByRole('heading', { level: 1, name: 'Escada' })).toBeInTheDocument()
    expect(screen.getByText('Aguardando confirmação.')).toBeInTheDocument()
    expect(screen.getByText(/Ainda não muda a rota. Falta 1 confirmação./)).toBeInTheDocument()
    expect(screen.getByText(/relato de colaboradores, não verificado pela Prefeitura/)).toBeInTheDocument()
    // os botões só entram com o endereço pronto: nada desce depois (D3)
    expect(await screen.findByRole('button', { name: 'Confirmo' })).toHaveAccessibleDescription(expect.stringContaining('Com 2 confirmações, a rota passa a evitar'))
    expect(await axe(container)).toHaveNoViolations()
    await user.click(screen.getByRole('button', { name: 'Confirmo' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Entre para continuar' })).toHaveFocus()
    expect(api.de('PUT /api/barreiras/5/voto')).toHaveLength(0)
  })

  it('votar mantém o foco no botão, anuncia e marca aria-pressed', async () => {
    const api = apiFalsa({
      ...logar(),
      'GET /api/barreiras/5': Response.json(ficha()),
      ...REVERSO,
      'PUT /api/barreiras/5/voto': Response.json(ficha({ status: 'validada', votos: { confirma: 2, contesta: 0, resolvida: 0 } })),
    })
    const user = userEvent.setup()
    abrir('/barreiras/5')
    const confirmo = await screen.findByRole('button', { name: 'Confirmo' })
    await user.click(confirmo)
    await waitFor(() => expect(confirmo).toHaveAttribute('aria-pressed', 'true'))
    expect(confirmo).toHaveFocus()
    expect(JSON.parse(String(api.de('PUT /api/barreiras/5/voto')[0].init.body))).toEqual({ voto: 'confirma' })
    expect((api.de('PUT /api/barreiras/5/voto')[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tkn')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Voto registrado. Agora são 2 confirmações. A rota evita este ponto.'))
    expect(screen.getByText('Recalcule a rota para ver a mudança.')).toBeInTheDocument()
  })

  it('403 troca os botões, lembra a barreira e oferece a foto', async () => {
    apiFalsa({ ...logar(), 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO, 'PUT /api/barreiras/5/voto': erroApi(403, 'Quem cadastrou não vota.') })
    const user = userEvent.setup()
    abrir('/barreiras/5')
    await user.click(await screen.findByRole('button', { name: 'Confirmo' }))
    expect(await screen.findByText('Você cadastrou esta barreira; quem vota são outras pessoas.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmo' })).toBeNull()
    // os botões sumiram: o foco vai à frase, que se lê sozinha
    expect(screen.getByText('Você cadastrou esta barreira; quem vota são outras pessoas.')).toHaveFocus()
    expect(localStorage.getItem(`rf:minhas:${CONTA.id}`)).toBe('[5]')
    expect(screen.getByRole('heading', { level: 2, name: 'Foto (opcional)' })).toBeInTheDocument()
  })

  it('409 mostra a mensagem e relê a ficha', async () => {
    let leituras = 0
    apiFalsa({
      ...logar(),
      'GET /api/barreiras/5': () => Response.json(ficha(++leituras > 1 ? { status: 'contestada' } : {})),
      ...REVERSO,
      'PUT /api/barreiras/5/voto': erroApi(409, 'A votação desta barreira já encerrou.'),
    })
    const user = userEvent.setup()
    abrir('/barreiras/5')
    await user.click(await screen.findByRole('button', { name: 'Confirmo' }))
    expect(await screen.findByText(/Pessoas disseram que não existe/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmo' })).toBeNull()
  })

  it('status encerrado não mostra botões; 404 diz que não está disponível', async () => {
    apiFalsa({ 'GET /api/barreiras/5': Response.json(ficha({ status: 'expirada' })), ...REVERSO })
    const { unmount } = abrir('/barreiras/5')
    expect(await screen.findByText(/Ninguém confirmou no prazo/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmo' })).toBeNull()
    unmount()
    apiFalsa({ 'GET /api/barreiras/5': erroApi(404, 'Barreira não encontrada.') })
    abrir('/barreiras/5')
    expect(await screen.findByText('Esta barreira não está mais disponível.')).toBeInTheDocument()
  })

  it('foto: exige descrição, mostra a prévia com alt, manda multipart sem Content-Type e exibe com alt', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:previa')
    URL.revokeObjectURL = vi.fn()
    const comFoto = ficha({ foto_url: 'https://x.supabase.co/f.webp', foto_descricao: 'Escada de três degraus' })
    const api = apiFalsa({ ...logar(), 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO, 'POST /api/barreiras/5/foto': Response.json(comFoto) })
    lembrarMinha(CONTA.id, 5)
    const user = userEvent.setup()
    abrir('/barreiras/5')
    await screen.findByRole('heading', { level: 2, name: 'Foto (opcional)' })
    const arquivo = new File(['x'], 'a.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByLabelText('Arquivo da foto'), arquivo)
    expect(screen.getByRole('img', { name: 'Prévia da foto, ainda sem descrição' })).toHaveAttribute('src', 'blob:previa')
    await user.click(screen.getByRole('button', { name: 'Enviar foto' }))
    expect(screen.getByRole('textbox', { name: 'O que a foto mostra' })).toHaveFocus()
    expect(api.de('POST /api/barreiras/5/foto')).toHaveLength(0)
    await user.type(screen.getByRole('textbox', { name: 'O que a foto mostra' }), 'Escada de três degraus')
    await user.click(screen.getByRole('button', { name: 'Enviar foto' }))
    await waitFor(() => expect(api.de('POST /api/barreiras/5/foto')).toHaveLength(1))
    const { init } = api.de('POST /api/barreiras/5/foto')[0]
    expect(init.body).toBeInstanceOf(FormData)
    expect(init.headers).toEqual({ Authorization: 'Bearer tkn' })
    expect(await screen.findByRole('img', { name: 'Escada de três degraus' })).toHaveAttribute('src', comFoto.foto_url)
  })

  it('quando os dados chegam, a ficha é anunciada: o h1 focado mudou sem fala', async () => {
    apiFalsa({ 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO })
    abrir('/barreiras/5')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Escada. Aguardando confirmação. Ainda não muda a rota.'))
  })

  it('o voto que encerra a votação leva o foco ao efeito, sem anunciar por cima', async () => {
    apiFalsa({ ...logar(), 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO, 'PUT /api/barreiras/5/voto': Response.json(ficha({ status: 'contestada' })) })
    const user = userEvent.setup()
    abrir('/barreiras/5')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Escada.'))
    await user.click(await screen.findByRole('button', { name: 'Não existe' }))
    const efeito = await screen.findByText(/Pessoas disseram que não existe/)
    await waitFor(() => expect(efeito).toHaveFocus())
    await new Promise((r) => setTimeout(r, 150))
    expect(screen.getByRole('status')).not.toHaveTextContent('Voto registrado')
  })

  it('cancelar e concluir o portão devolvem o foco ao botão do voto', async () => {
    const api = apiFalsa({ 'GET /api/eu': Response.json({ papel: 'colaborador' }), 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO, 'PUT /api/barreiras/5/voto': Response.json(ficha({ votos: { confirma: 1, contesta: 1, resolvida: 0 } })) })
    mocks.verificarCodigo.mockImplementation(async () => {
      mocks.temSessaoSalva.mockReturnValue(true)
      mocks.obterToken.mockResolvedValue('tkn')
    })
    const user = userEvent.setup()
    abrir('/barreiras/5')
    const botao = await screen.findByRole('button', { name: 'Não existe' })
    await user.click(botao)
    await screen.findByRole('heading', { level: 2, name: 'Entre para continuar' })
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(botao).toHaveFocus()

    await user.click(botao)
    await screen.findByRole('heading', { level: 2, name: 'Entre para continuar' })
    await user.type(screen.getByRole('textbox', { name: 'E-mail' }), 'p@e.org{Enter}')
    await user.type(await screen.findByRole('textbox', { name: 'Código de 6 dígitos' }), '123456{Enter}')
    await waitFor(() => expect(api.de('PUT /api/barreiras/5/voto')).toHaveLength(1))
    expect(botao).toHaveFocus()
  })

  it('depois de um voto, um 409 ainda relê a ficha', async () => {
    let leituras = 0
    let votos = 0
    apiFalsa({
      ...logar(),
      'GET /api/barreiras/5': () => Response.json(ficha(++leituras > 1 ? { status: 'contestada' } : {})),
      ...REVERSO,
      'PUT /api/barreiras/5/voto': () => (++votos === 1 ? Response.json(ficha({ votos: { confirma: 2, contesta: 0, resolvida: 0 } })) : erroApi(409, 'Esta barreira não recebe mais votos.')),
    })
    const user = userEvent.setup()
    abrir('/barreiras/5')
    const confirmo = await screen.findByRole('button', { name: 'Confirmo' })
    await user.click(confirmo)
    await waitFor(() => expect(confirmo).toHaveAttribute('aria-pressed', 'true'))
    await user.click(screen.getByRole('button', { name: 'Não existe' }))
    expect(await screen.findByText(/Pessoas disseram que não existe/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmo' })).toBeNull()
  })

  it('endereço: "buscando" na carga, "indisponível" na falha, "50 m" só no 404', async () => {
    let soltar: (r: Response) => void = () => {}
    apiFalsa({ 'GET /api/barreiras/5': Response.json(ficha()), 'GET /api/geocode/reverso': () => new Promise<Response>((r) => (soltar = r)) })
    const { unmount } = abrir('/barreiras/5')
    expect(await screen.findByText('Buscando o endereço…')).toBeInTheDocument()
    expect(screen.queryByText(/a até 50 m/)).toBeNull()
    soltar(erroApi(404, 'Nenhum endereço conhecido a até 50 metros deste ponto.'))
    expect(await screen.findByText('Sem endereço conhecido a até 50 m.')).toBeInTheDocument()
    unmount()
    apiFalsa({ 'GET /api/barreiras/5': Response.json(ficha()), 'GET /api/geocode/reverso': new Response('x', { status: 503 }) })
    abrir('/barreiras/5')
    expect(await screen.findByText('Endereço indisponível agora.')).toBeInTheDocument()
  })

  it('"recém-criada" não sobrevive no histórico: outra conta não herda a autoria', async () => {
    apiFalsa({ 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO })
    let estado: unknown = 'inicial'
    function Espia() {
      estado = useLocation().state
      return null
    }
    render(
      <MemoryRouter initialEntries={[{ pathname: '/barreiras/5', state: { recemCriada: true, jaExistia: false } }]}>
        <App />
        <Espia />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'Barreira registrada' })).toBeInTheDocument()
    await waitFor(() => expect(estado).toBeNull())
    expect(screen.getByRole('heading', { level: 1, name: 'Barreira registrada' })).toBeInTheDocument()
  })

  it('ida à ficha e volta por "Ver outras barreiras" mantêm o ponto, sem URL', async () => {
    const api = apiFalsa({ 'GET /api/barreiras': Response.json([ficha()]), 'GET /api/barreiras/5': Response.json(ficha()), 'GET /api/geocode/reverso': Response.json(A) })
    const user = userEvent.setup()
    abrir('/barreiras', { ponto: [-23.59, -46.635], rotuloPonto: 'Meio do passo 3' })
    await user.click(await screen.findByRole('link', { name: /Ver e votar: Escada/ }))
    await user.click(await screen.findByRole('link', { name: 'Ver outras barreiras' }))
    await screen.findByRole('heading', { level: 1, name: 'Barreiras por perto' })
    await waitFor(() => expect(api.de('GET /api/barreiras')).toHaveLength(2))
    expect(screen.getByText(/Meio do passo 3/)).toBeInTheDocument()
    expect(screen.queryByText('Escolha um ponto para ver as barreiras registradas perto dele.')).toBeNull()
  })

  describe('foto: erros ligados ao campo', () => {
    function comoAutora() {
      URL.createObjectURL = vi.fn(() => 'blob:previa')
      URL.revokeObjectURL = vi.fn()
      lembrarMinha(CONTA.id, 5)
    }

    it('descrição curta marca o campo e liga a mensagem; Enviar sem arquivo também', async () => {
      comoAutora()
      apiFalsa({ ...logar(), 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO })
      const user = userEvent.setup()
      abrir('/barreiras/5')
      await screen.findByRole('heading', { level: 2, name: 'Foto (opcional)' })
      await user.click(screen.getByRole('button', { name: 'Enviar foto' }))
      const arquivo = screen.getByLabelText('Arquivo da foto')
      expect(arquivo).toHaveFocus()
      expect(arquivo).toHaveAttribute('aria-invalid', 'true')
      expect(arquivo).toHaveAccessibleDescription(expect.stringContaining('Escolha uma foto.'))
      await user.upload(arquivo, new File(['x'], 'a.jpg', { type: 'image/jpeg' }))
      await user.click(screen.getByRole('button', { name: 'Enviar foto' }))
      const descricao = screen.getByRole('textbox', { name: 'O que a foto mostra' })
      expect(descricao).toHaveFocus()
      expect(descricao).toHaveAttribute('aria-invalid', 'true')
      expect(descricao).toHaveAccessibleDescription(expect.stringContaining('Descreva a foto em 5 a 300 caracteres'))
    })

    it('arquivo inválido: com o foco no campo, a região anuncia', async () => {
      comoAutora()
      apiFalsa({ ...logar(), 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO })
      abrir('/barreiras/5')
      await screen.findByRole('heading', { level: 2, name: 'Foto (opcional)' })
      const arquivo = screen.getByLabelText('Arquivo da foto')
      // no navegador o campo segue focado quando o seletor de arquivos fecha; o user.upload simula um blur
      arquivo.focus()
      fireEvent.change(arquivo, { target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] } })
      expect(arquivo).toHaveFocus()
      expect(arquivo).toHaveAttribute('aria-invalid', 'true')
      expect(arquivo).toHaveAccessibleDescription(expect.stringContaining('Use uma foto em JPEG, PNG ou WebP.'))
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Use uma foto em JPEG, PNG ou WebP.'))
    })

    it('"Remover foto" some: o foco vai ao retorno, que se lê sozinho', async () => {
      comoAutora()
      const comFoto = ficha({ foto_url: 'https://x.supabase.co/f.webp', foto_descricao: 'Escada de três degraus' })
      apiFalsa({ ...logar(), 'GET /api/barreiras/5': Response.json(comFoto), ...REVERSO, 'DELETE /api/barreiras/5/foto': Response.json(ficha()) })
      const user = userEvent.setup()
      abrir('/barreiras/5')
      await user.click(await screen.findByRole('button', { name: 'Remover foto' }))
      const retorno = await screen.findByText('Foto removida.')
      await waitFor(() => expect(retorno).toHaveFocus())
    })
  })
})

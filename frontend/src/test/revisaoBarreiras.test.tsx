import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router'
import App from '../App'
import { FORA_DA_AREA } from '../dados/localizacao'
import { gravarRascunho, lerRascunho } from '../dados/rascunho'
import { apiFalsa, erroApi } from './apiFalsa'
import { A, abrir, ficha, logar, mocks, prepararColaboracao } from './apoioColaboracao'

vi.mock('../auth/cliente', () => import('./clienteFalso'))
prepararColaboracao()

const LOCAL = { lat: -23.59, lon: -46.635, rotulo: 'Rua A, 1', origem: 'busca' }
const REVERSO = { 'GET /api/geocode/reverso': Response.json(A) }

function adiado<T>() {
  let resolver!: (v: T) => void
  const promessa = new Promise<T>((r) => (resolver = r))
  return { promessa, resolver }
}

function gpsManual() {
  const controle: { responder: PositionCallback } = { responder: () => {} }
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (ok: PositionCallback) => (controle.responder = ok) },
  })
  return controle
}

const pausa = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

describe('editar o cadastro enquanto o GPS ou o mapa esperam', () => {
  it('o que foi preenchido durante a espera do GPS fica', async () => {
    apiFalsa(REVERSO)
    const gps = gpsManual()
    const user = userEvent.setup()
    abrir('/barreiras/nova')
    await user.click(await screen.findByRole('button', { name: 'Usar minha localização' }))
    await user.click(screen.getByRole('radio', { name: /^Escada/ }))
    await user.type(screen.getByRole('textbox', { name: 'Descrição (opcional)' }), 'Tres degraus')
    await act(async () => gps.responder({ coords: { latitude: -23.59, longitude: -46.635, accuracy: 10 } } as GeolocationPosition))
    await screen.findByText(/Local marcado:/)
    expect(screen.getByRole('textbox', { name: 'Descrição (opcional)' })).toHaveValue('Tres degraus')
    expect(screen.getByRole('radio', { name: /^Escada/ })).toBeChecked()
    expect(lerRascunho()).toMatchObject({ categoria: 'escada', descricao: 'Tres degraus', local: { rotulo: A.rotulo } })
  })

  it('mapa real: o que foi digitado enquanto o reverso de "Marcar" espera fica', async () => {
    const reverso = adiado<Response>()
    const api = apiFalsa({ 'GET /api/geocode/reverso': () => reverso.promessa })
    const user = userEvent.setup()
    abrir('/barreiras/nova')
    await user.click(await screen.findByRole('button', { name: 'Escolher no mapa' }))
    await user.click(await screen.findByRole('button', { name: 'Marcar o centro do mapa' }, { timeout: 8000 }))
    await waitFor(() => expect(api.de('GET /api/geocode/reverso')).toHaveLength(1))
    await user.type(screen.getByRole('textbox', { name: 'Descrição (opcional)' }), 'Tres degraus')
    await act(async () => reverso.resolver(Response.json(A)))
    await screen.findByText(/Local marcado:/)
    expect(screen.getByRole('textbox', { name: 'Descrição (opcional)' })).toHaveValue('Tres degraus')
  }, 15_000)
})

describe('sair da página com o POST a caminho', () => {
  async function registrarESair() {
    const post = adiado<Response>()
    const api = apiFalsa({ ...logar(), 'POST /api/barreiras': () => post.promessa, 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO, 'GET /api/fontes': Response.json([]) })
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await user.click(await screen.findByRole('radio', { name: /^Escada/ }))
    await user.click(screen.getByRole('button', { name: 'Registrar barreira' }))
    await waitFor(() => expect(api.de('POST /api/barreiras')).toHaveLength(1))
    await user.click(screen.getByRole('link', { name: 'Fontes' }))
    await screen.findByRole('heading', { level: 1, name: /Fontes|Dados/i })
    return post
  }

  it('a resposta tardia não leva a pessoa a outra página; a região avisa e o rascunho sai', async () => {
    const post = await registrarESair()
    await act(async () => post.resolver(Response.json(ficha(), { status: 201 })))
    await pausa(300)
    expect(screen.queryByRole('heading', { level: 1, name: 'Barreira registrada' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: /Fontes|Dados/i })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Barreira registrada.')
    expect(lerRascunho()).toEqual({ descricao: '' })
  })

  it('um rascunho novo, feito depois, não é apagado pela resposta tardia', async () => {
    const post = await registrarESair()
    gravarRascunho({ descricao: 'Outra barreira' })
    await act(async () => post.resolver(Response.json(ficha(), { status: 201 })))
    await pausa(50)
    expect(lerRascunho()).toEqual({ descricao: 'Outra barreira' })
  })
})

describe('voto que tira a ficha da tela (D27)', () => {
  it('404 do voto e da releitura: o foco vai à frase, nunca ao body', async () => {
    let leituras = 0
    apiFalsa({
      ...logar(),
      'GET /api/barreiras/5': () => (leituras++ === 0 ? Response.json(ficha()) : erroApi(404, 'Barreira não encontrada.')),
      ...REVERSO,
      'PUT /api/barreiras/5/voto': erroApi(404, 'Barreira não encontrada.'),
    })
    const user = userEvent.setup()
    abrir('/barreiras/5')
    await user.click(await screen.findByRole('button', { name: 'Confirmo' }))
    const frase = await screen.findByText('Esta barreira não está mais disponível.')
    expect(screen.queryByRole('button', { name: 'Confirmo' })).toBeNull()
    expect(frase).toHaveFocus()
  })

  it('409 e releitura que falha: o foco vai à frase, e dá para tentar de novo', async () => {
    let leituras = 0
    apiFalsa({
      ...logar(),
      'GET /api/barreiras/5': () => {
        leituras += 1
        if (leituras === 1) return Response.json(ficha())
        if (leituras === 2) return erroApi(503, 'Fora do ar agora.')
        return Response.json(ficha({ status: 'contestada' }))
      },
      ...REVERSO,
      'PUT /api/barreiras/5/voto': erroApi(409, 'A votação desta barreira já encerrou.'),
    })
    const user = userEvent.setup()
    abrir('/barreiras/5')
    await user.click(await screen.findByRole('button', { name: 'Confirmo' }))
    expect(await screen.findByText('Fora do ar agora.')).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
    expect(await screen.findByText(/Pessoas disseram que não existe/)).toBeInTheDocument()
  })

  it('primeira carga com erro não rouba o foco: só anuncia', async () => {
    apiFalsa({ 'GET /api/barreiras/5': erroApi(503, 'Fora do ar agora.') })
    abrir('/barreiras/5')
    const frase = await screen.findByText('Fora do ar agora.')
    expect(frase).not.toHaveFocus()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Fora do ar agora.'))
  })

  it('o voto que encerra leva o foco à frase e limpa o "Registrando o voto." da região', async () => {
    apiFalsa({
      ...logar(),
      'GET /api/barreiras/5': Response.json(ficha()),
      ...REVERSO,
      'PUT /api/barreiras/5/voto': Response.json(ficha({ status: 'contestada', votos: { confirma: 1, contesta: 2, resolvida: 0 } })),
    })
    const user = userEvent.setup()
    abrir('/barreiras/5')
    await user.click(await screen.findByRole('button', { name: 'Não existe' }))
    expect((await screen.findByText(/Pessoas disseram que não existe/)).closest('p')).toHaveFocus()
    await pausa(200)
    expect(screen.getByRole('status')).not.toHaveTextContent('Registrando o voto.')
  })
})

describe('foto', () => {
  const arquivo = () => new File(['x'], 'a.jpg', { type: 'image/jpeg' })

  beforeEach(() => {
    URL.createObjectURL = () => 'blob:x'
    URL.revokeObjectURL = () => {}
  })

  it('depois do envio, o seletor não mostra mais o arquivo enviado', async () => {
    apiFalsa({ ...logar(), 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO, 'POST /api/barreiras/5/foto': Response.json(ficha({ foto_url: 'https://x/y.webp', foto_descricao: 'Tres degraus' })) })
    const user = userEvent.setup()
    abrir('/barreiras/5', { recemCriada: true })
    const input = (await screen.findByLabelText('Arquivo da foto')) as HTMLInputElement
    await user.upload(input, arquivo())
    await user.type(screen.getByRole('textbox', { name: 'O que a foto mostra' }), 'Tres degraus')
    await user.click(screen.getByRole('button', { name: 'Enviar foto' }))
    await screen.findByRole('button', { name: 'Remover foto' })
    expect(input.files?.length ?? 0).toBe(0)
  })

  it('arquivo recusado também sai do seletor', async () => {
    apiFalsa({ ...logar(), 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO })
    const user = userEvent.setup({ applyAccept: false })
    abrir('/barreiras/5', { recemCriada: true })
    const input = (await screen.findByLabelText('Arquivo da foto')) as HTMLInputElement
    await user.upload(input, new File(['x'], 'a.txt', { type: 'text/plain' }))
    expect(await screen.findByText('Use uma foto em JPEG, PNG ou WebP.')).toBeInTheDocument()
    expect(input.files?.length ?? 0).toBe(0)
  })

  it('enviar mostra e anuncia a espera', async () => {
    const post = adiado<Response>()
    apiFalsa({ ...logar(), 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO, 'POST /api/barreiras/5/foto': () => post.promessa })
    const user = userEvent.setup()
    abrir('/barreiras/5', { recemCriada: true })
    await user.upload(await screen.findByLabelText('Arquivo da foto'), arquivo())
    await user.type(screen.getByRole('textbox', { name: 'O que a foto mostra' }), 'Tres degraus')
    await user.click(screen.getByRole('button', { name: 'Enviar foto' }))
    expect(await screen.findByText('Enviando a foto…')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Enviando a foto.'))
    await act(async () => post.resolver(Response.json(ficha({ foto_url: 'https://x/y.webp', foto_descricao: 'Tres degraus' }))))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Foto enviada.'))
    expect(screen.queryByText('Enviando a foto…')).toBeNull()
  })

  it('duplo clique em "Remover foto" manda um pedido só', async () => {
    const del = adiado<Response>()
    const api = apiFalsa({ ...logar(), 'GET /api/barreiras/5': Response.json(ficha({ foto_url: 'https://x/y.webp', foto_descricao: 'Tres degraus' })), ...REVERSO, 'DELETE /api/barreiras/5/foto': () => del.promessa })
    const user = userEvent.setup()
    abrir('/barreiras/5', { recemCriada: true })
    const remover = await screen.findByRole('button', { name: 'Remover foto' })
    await user.dblClick(remover)
    await pausa(50)
    expect(api.de('DELETE /api/barreiras/5/foto')).toHaveLength(1)
  })
})

describe('/barreiras com muitas barreiras', () => {
  it('diz que cortou, na tela e na região', async () => {
    const muitas = Array.from({ length: 25 }, (_, i) => ficha({ id: i + 1 }))
    const api = apiFalsa({ 'GET /api/barreiras': Response.json(muitas), ...REVERSO })
    abrir('/barreiras', { ponto: [-23.59, -46.635], rotuloPonto: 'Rua A' })
    expect(await screen.findByText('As 20 mais próximas de 25 barreiras a até 200 m.')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Ver e votar/ })).toHaveLength(20)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('As 20 mais próximas de 25 barreiras a até 200 metros.'))
    expect(api.de('GET /api/geocode/reverso')).toHaveLength(20)
  })

  it('com 20 ou menos, não fala em corte', async () => {
    apiFalsa({ 'GET /api/barreiras': Response.json(Array.from({ length: 20 }, (_, i) => ficha({ id: i + 1 }))), ...REVERSO })
    abrir('/barreiras', { ponto: [-23.59, -46.635], rotuloPonto: 'Rua A' })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('20 barreiras a até 200 metros.'))
    expect(screen.queryByText(/mais próximas/)).toBeNull()
  })
})

describe('ponto em /barreiras', () => {
  it('o GPS vai à URL com 4 casas', async () => {
    const api = apiFalsa({ 'GET /api/barreiras': Response.json([]), ...REVERSO })
    const gps = gpsManual()
    const user = userEvent.setup()
    abrir('/barreiras')
    await user.click(await screen.findByRole('button', { name: 'Usar minha localização' }))
    await act(async () => gps.responder({ coords: { latitude: -23.59012345, longitude: -46.63512345, accuracy: 10 } } as GeolocationPosition))
    await waitFor(() => expect(api.de('GET /api/barreiras')).toHaveLength(1))
    const url = new URL(api.de('GET /api/barreiras')[0].url)
    expect(url.searchParams.get('lat')).toBe('-23.5901')
    expect(url.searchParams.get('lon')).toBe('-46.6351')
  })

  it('o aviso do GPS está ligado ao botão', async () => {
    apiFalsa({})
    gpsManual()
    abrir('/barreiras/nova')
    expect(await screen.findByRole('button', { name: 'Usar minha localização' })).toHaveAccessibleDescription('Usa o GPS do aparelho uma vez, só quando você aciona.')
  })

  it('Voltar do navegador depois de "Ver e votar" mantém o ponto, sem pôr nada na URL', async () => {
    const api = apiFalsa({ 'GET /api/geocode': Response.json([A]), ...REVERSO, 'GET /api/barreiras': Response.json([ficha()]), 'GET /api/barreiras/5': Response.json(ficha()) })
    const user = userEvent.setup()
    window.history.pushState({}, '', '/barreiras')
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    )
    try {
      await user.click(await screen.findByRole('combobox', { name: 'Endereço' }))
      await user.keyboard('rua{Enter}')
      await screen.findAllByRole('option')
      await user.keyboard('{ArrowDown}{Enter}')
      await user.click(await screen.findByRole('link', { name: /Ver e votar/ }))
      await screen.findByText(/Aguardando confirmação/)
      await act(async () => {
        window.history.back()
        await new Promise((r) => setTimeout(r, 200))
      })
      await waitFor(() => expect(window.location.pathname).toBe('/barreiras'))
      expect(await screen.findByText(/Local marcado:/)).toBeInTheDocument()
      expect(window.location.search).toBe('')
      expect(api.de('GET /api/barreiras').length).toBeGreaterThan(0)
    } finally {
      window.history.pushState({}, '', '/')
    }
  })

  it('depois de registrar a partir de um ponto, "Ver outras barreiras" volta a ele', async () => {
    apiFalsa({ ...logar(), 'POST /api/barreiras': Response.json(ficha(), { status: 201 }), 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO, 'GET /api/barreiras': Response.json([]) })
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await user.click(await screen.findByRole('radio', { name: /^Escada/ }))
    await user.click(screen.getByRole('button', { name: 'Registrar barreira' }))
    await screen.findByRole('heading', { level: 1, name: 'Barreira registrada' })
    await user.click(screen.getByRole('link', { name: 'Ver outras barreiras' }))
    await screen.findByRole('heading', { level: 1, name: 'Barreiras por perto' })
    expect(screen.getByText(/Local marcado:/).closest('p')).toHaveTextContent('perto de Rua A, 1')
  })
})

describe('ficha', () => {
  it.each([
    ['intransponivel', true],
    ['dificulta', true],
    ['informativo', false],
  ] as const)('confirmada e %s: fala em recalcular? %s', async (severidade, fala) => {
    apiFalsa({ 'GET /api/barreiras/5': Response.json(ficha({ severidade, status: 'validada' })), ...REVERSO })
    abrir('/barreiras/5')
    await screen.findByText(/Confirmada\.|Informativa\./)
    expect(screen.queryByText('Recalcule a rota para ver a mudança.') !== null).toBe(fala)
  })

  it('os botões de voto só entram quando o endereço terminou: nada desce depois', async () => {
    const reverso = adiado<Response>()
    apiFalsa({ 'GET /api/barreiras/5': Response.json(ficha()), 'GET /api/geocode/reverso': () => reverso.promessa })
    abrir('/barreiras/5')
    await screen.findByText('Buscando o endereço…')
    expect(screen.queryByRole('button', { name: 'Confirmo' })).toBeNull()
    await act(async () => reverso.resolver(Response.json(A)))
    expect(await screen.findByRole('button', { name: 'Confirmo' })).toBeInTheDocument()
  })

  it('endereço que falha também libera o voto', async () => {
    apiFalsa({ 'GET /api/barreiras/5': Response.json(ficha()), 'GET /api/geocode/reverso': erroApi(503, 'Fora.') })
    abrir('/barreiras/5')
    expect(await screen.findByRole('button', { name: 'Confirmo' })).toBeInTheDocument()
    expect(screen.getByText('Endereço indisponível agora.')).toBeInTheDocument()
  })
})

describe('espera das ações', () => {
  it('o voto anuncia que está registrando, sem falar quando abre o portão', async () => {
    const put = adiado<Response>()
    apiFalsa({ ...logar(), 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO, 'PUT /api/barreiras/5/voto': () => put.promessa })
    const user = userEvent.setup()
    abrir('/barreiras/5')
    await user.click(await screen.findByRole('button', { name: 'Confirmo' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Registrando o voto.'))
    await act(async () => put.resolver(Response.json(ficha({ votos: { confirma: 2, contesta: 0, resolvida: 0 }, status: 'validada' }))))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Voto registrado. Agora são 2 confirmações.'))
  })

  it('sem sessão, o portão abre sem "Registrando o voto." na região', async () => {
    apiFalsa({ 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO })
    const user = userEvent.setup()
    abrir('/barreiras/5')
    await user.click(await screen.findByRole('button', { name: 'Confirmo' }))
    await screen.findByRole('heading', { level: 2, name: 'Entre para continuar' })
    await pausa(200)
    expect(screen.getByRole('status')).not.toHaveTextContent('Registrando o voto.')
  })

  it('o cadastro mostra e anuncia o envio', async () => {
    const post = adiado<Response>()
    apiFalsa({ ...logar(), 'POST /api/barreiras': () => post.promessa })
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await user.click(await screen.findByRole('radio', { name: /^Escada/ }))
    await user.click(screen.getByRole('button', { name: 'Registrar barreira' }))
    expect(await screen.findByText('Enviando a barreira…')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Enviando a barreira.'))
  })

  it('marcar o centro do mapa mostra e anuncia a espera, e recusa ponto fora da área', async () => {
    const reverso = adiado<Response>()
    apiFalsa({ 'GET /api/geocode/reverso': () => reverso.promessa })
    const user = userEvent.setup()
    abrir('/barreiras/nova')
    await user.click(await screen.findByRole('button', { name: 'Escolher no mapa' }))
    await user.click(await screen.findByRole('button', { name: 'Marcar o centro do mapa' }, { timeout: 8000 }))
    expect(await screen.findByText('Marcando o ponto…')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Marcando o ponto.'))
    await act(async () => reverso.resolver(erroApi(404, FORA_DA_AREA)))
    expect(await screen.findByText(FORA_DA_AREA)).toBeInTheDocument()
    expect(screen.queryByText(/Local marcado:/)).toBeNull()
    expect(lerRascunho().local).toBeUndefined()
  }, 15_000)
})

describe('portão aberto', () => {
  it('pressionar "Registrar barreira" de novo não apaga o e-mail digitado: só leva o foco ao portão', async () => {
    apiFalsa({})
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await user.click(await screen.findByRole('radio', { name: /^Escada/ }))
    await user.click(screen.getByRole('button', { name: 'Registrar barreira' }))
    const titulo = await screen.findByRole('heading', { level: 2, name: 'Entre para continuar' })
    await user.type(screen.getByRole('textbox', { name: 'E-mail' }), 'p@e.org')
    await user.click(screen.getByRole('button', { name: 'Registrar barreira' }))
    await pausa(50)
    expect(screen.getByRole('textbox', { name: 'E-mail' })).toHaveValue('p@e.org')
    expect(screen.getByRole('heading', { level: 2, name: 'Entre para continuar' })).toBe(titulo)
    expect(titulo).toHaveFocus()
    expect(mocks.enviarCodigo).not.toHaveBeenCalled()
  })

  it('o login refaz com o que está na tela, mesmo depois de pressionar de novo', async () => {
    const api = apiFalsa({ 'POST /api/barreiras': Response.json(ficha(), { status: 201 }), 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO, 'GET /api/eu': Response.json({ papel: 'colaborador' }) })
    mocks.verificarCodigo.mockImplementation(async () => {
      mocks.temSessaoSalva.mockReturnValue(true)
      mocks.obterToken.mockResolvedValue('tkn')
    })
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await user.click(await screen.findByRole('radio', { name: /^Escada/ }))
    await user.click(screen.getByRole('button', { name: 'Registrar barreira' }))
    await screen.findByRole('heading', { level: 2, name: 'Entre para continuar' })
    await user.type(screen.getByRole('textbox', { name: 'Descrição (opcional)' }), 'Corrigido')
    await user.click(screen.getByRole('button', { name: 'Registrar barreira' }))
    await user.type(screen.getByRole('textbox', { name: 'E-mail' }), 'p@e.org{Enter}')
    await user.type(await screen.findByRole('textbox', { name: 'Código de 6 dígitos' }), '123456{Enter}')
    await waitFor(() => expect(api.de('POST /api/barreiras')).toHaveLength(1))
    expect(JSON.parse(String(api.de('POST /api/barreiras')[0].init.body)).descricao).toBe('Corrigido')
  })
})

describe('dica de voto no anúncio', () => {
  it('"Não existe" fala do próprio voto na tela real', async () => {
    apiFalsa({ ...logar(), 'GET /api/barreiras/5': Response.json(ficha({ votos: { confirma: 0, contesta: 0, resolvida: 0 } })), ...REVERSO, 'PUT /api/barreiras/5/voto': Response.json(ficha({ votos: { confirma: 0, contesta: 1, resolvida: 0 } })) })
    const user = userEvent.setup()
    abrir('/barreiras/5')
    const secao = (await screen.findByRole('heading', { level: 2, name: 'Você passou por aqui?' })).closest('section')!
    await user.click(within(secao).getByRole('button', { name: 'Não existe' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Agora é 1 voto de que não existe.'))
    expect(screen.getByRole('status')).not.toHaveTextContent('confirmações')
  })
})

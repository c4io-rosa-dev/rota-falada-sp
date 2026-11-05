import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { axe } from 'vitest-axe'
import App from '../App'
import { gravarSessaoRota, PERFIL_FORM_PADRAO } from '../dados/sessaoRota'
import { montarPedido } from '../pages/rotaEstado'
import { apiFalsa, erroApi } from './apiFalsa'
import { endereco, ROTA } from './fixturasRota'

vi.mock('../componentes/mapa/MapaLeaflet', () => ({
  default: ({ descricao }: { descricao: string }) => <div role="img" aria-label={descricao} />,
}))

const A = endereco(1, 'Rua A, 1 · Vila Mariana')
const B = endereco(2, 'Rua B, 2 · Vila Mariana')
const C = endereco(3, 'Rua C, 3 · Lapa')
const INATIVO = { 'GET /api/geocode': Response.json([A, B]) }
const ROTA_DE = { pedido: montarPedido(A, B, PERFIL_FORM_PADRAO), origem: A.rotulo, destino: B.rotulo }

function abrir() {
  return render(
    <MemoryRouter initialEntries={['/rota']}>
      <App />
    </MemoryRouter>,
  )
}

/** Escolhe por teclado: digita, Enter busca na hora, seta e Enter escolhem. */
async function escolher(user: ReturnType<typeof userEvent.setup>, nome: 'Origem' | 'Destino', indice: number) {
  const campo = await screen.findByRole('combobox', { name: nome })
  await user.click(campo)
  await user.keyboard('rua{Enter}')
  await screen.findAllByRole('option')
  await user.keyboard('{ArrowDown}'.repeat(indice + 1) + '{Enter}')
}

async function preencher(user: ReturnType<typeof userEvent.setup>) {
  await escolher(user, 'Origem', 0)
  await escolher(user, 'Destino', 1)
}

const botaoCalcular = () => screen.findByRole('button', { name: 'Calcular rota' })

describe('página /rota', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('tem o formulário real e aquece o servidor sem aviso na tela', async () => {
    const api = apiFalsa(INATIVO)
    const { container } = abrir()
    expect(await screen.findByRole('heading', { level: 1, name: 'Planejar rota' })).toBeInTheDocument()
    expect(document.title).toBe('Planejar rota · Rota Falada SP')
    expect(screen.getByRole('combobox', { name: 'Origem' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Destino' })).toBeInTheDocument()
    const exigencia = screen.getByRole('group', { name: 'Exigência' })
    expect(within(exigencia).getByRole('radio', { name: 'até 6%' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Evitar degraus' })).toBeChecked()
    const calcular = await botaoCalcular()
    expect(calcular).not.toHaveAttribute('aria-disabled')
    await waitFor(() => expect(api.de('GET /health')).toHaveLength(1))
    expect(api.de('POST /api/rotas')).toHaveLength(0)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('calcular sem escolha foca o campo e nunca adivinha', async () => {
    const api = apiFalsa(INATIVO)
    const user = userEvent.setup()
    abrir()
    await user.click(await botaoCalcular())
    const origem = screen.getByRole('combobox', { name: 'Origem' })
    expect(origem).toHaveFocus()
    expect(origem).toHaveAttribute('aria-invalid', 'true')
    expect(origem).toHaveAccessibleDescription(expect.stringContaining('Escolha um endereço da lista.'))
    expect(api.de('POST /api/rotas')).toHaveLength(0)
  })

  it('origem igual ao destino é erro no destino', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A]) })
    const user = userEvent.setup()
    abrir()
    await escolher(user, 'Origem', 0)
    await escolher(user, 'Destino', 0)
    await user.click(await botaoCalcular())
    const destino = screen.getByRole('combobox', { name: 'Destino' })
    expect(destino).toHaveFocus()
    expect(destino).toHaveAccessibleDescription(expect.stringContaining('mesmo ponto'))
  })

  it('fluxo por teclado: POST no contrato, sem token, foco no h2 com o resumo e título sem rua', async () => {
    const api = apiFalsa({ ...INATIVO, 'POST /api/rotas': Response.json({ ...ROTA, avisos: [{ tipo: 'trecho_sem_dados', mensagem: 'Sem dados aqui.' }] }) })
    const user = userEvent.setup()
    const { container } = abrir()
    await preencher(user)
    await user.click(await botaoCalcular())

    const titulo = await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })
    expect(titulo).toHaveFocus()
    expect(titulo).toHaveTextContent('200,0 m em 2 passos, cerca de 4 minutos a pé, 1 aviso')
    expect(document.title).toBe('Rota calculada · Rota Falada SP')

    const [{ init }] = api.de('POST /api/rotas')
    const corpo = JSON.parse(String(init.body))
    expect(corpo.origem).toEqual({ lat: A.lat, lng: A.lon })
    expect(corpo.destino).toEqual({ lat: B.lat, lng: B.lon })
    expect(corpo.perfil.inclinacao_max).toBe(6)
    // LGPD: rota e geocode nunca levam Authorization, com ou sem login
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    for (const c of api.de('GET /api/geocode')) expect(c.init.headers).toEqual({})

    const lista = screen.getByRole('list', { name: 'Os 2 passos da rota' })
    expect(lista).toHaveAttribute('id', 'lista-passos')
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Sem dados aqui.')).toBeInTheDocument()
    expect(screen.getByText(/Pedida: até 6%. Atendida: até 6%./)).toBeInTheDocument()
    expect(screen.getByText('openrouteservice.org by HeiGIT')).toBeInTheDocument()
    expect(screen.getByText(/evita as barreiras confirmadas que bloqueiam a passagem e avisa das que só dificultam/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/garant/i)
    expect(document.querySelectorAll('[aria-live],[role=status],[role=alert]')).toHaveLength(1)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('se a pessoa saiu do botão durante a espera, o foco fica e a região anuncia', async () => {
    let responder: (r: Response) => void = () => {}
    apiFalsa({ ...INATIVO, 'POST /api/rotas': () => new Promise<Response>((r) => (responder = r)) })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    await user.click(await botaoCalcular())
    const limparOuLink = screen.getByRole('link', { name: 'Rota Falada SP' })
    limparOuLink.focus()
    responder(Response.json(ROTA))
    await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })
    expect(limparOuLink).toHaveFocus()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Rota encontrada. 200,0 m em 2 passos'))
  })

  it('cancelar volta o foco ao botão, anuncia e ignora a resposta', async () => {
    let responder: (r: Response) => void = () => {}
    apiFalsa({ ...INATIVO, 'POST /api/rotas': () => new Promise<Response>((r) => (responder = r)) })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    const calcular = await botaoCalcular()
    await user.click(calcular)
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }))
    expect(calcular).toHaveFocus()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Cálculo cancelado.'))
    responder(Response.json(ROTA))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('heading', { level: 2, name: /Rota encontrada/ })).toBeNull()
  })

  it('404 mostra o detail e o conselho honesto', async () => {
    apiFalsa({ ...INATIVO, 'POST /api/rotas': erroApi(404, 'Não encontramos rota acessível entre esses pontos.') })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    await user.click(await botaoCalcular())
    const titulo = await screen.findByRole('heading', { level: 2, name: 'Não encontramos rota' })
    expect(titulo).toHaveFocus()
    expect(screen.getByText('Não encontramos rota acessível entre esses pontos.')).toBeInTheDocument()
    expect(screen.getByText(/desmarque Evitar degraus; isso pode incluir degraus/)).toBeInTheDocument()
  })

  it('503 ignora o detail e oferece tentar de novo; o erro de rede também', async () => {
    const api = apiFalsa({ ...INATIVO, 'POST /api/rotas': erroApi(503, 'Não encontramos rota acessível entre esses pontos.') })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    await user.click(await botaoCalcular())
    expect(await screen.findByRole('heading', { level: 2, name: 'Não foi possível calcular agora' })).toHaveFocus()
    expect(screen.getByText(/Isso não quer dizer que a rota não existe/)).toBeInTheDocument()
    expect(screen.queryByText(/Não encontramos rota acessível/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(api.de('POST /api/rotas')).toHaveLength(2))
    // "Tentar de novo" sumiu: o foco não cai no body durante a espera
    expect(document.activeElement).not.toBe(document.body)
  })

  it('sob o pgRouting a ficha diz que não desvia das barreiras registradas', async () => {
    apiFalsa({ ...INATIVO, 'POST /api/rotas': Response.json({ ...ROTA, motor: 'pgrouting' }) })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    await user.click(await botaoCalcular())
    expect(await screen.findByText(/não desvia das barreiras registradas/)).toBeInTheDocument()
    expect(screen.queryByText(/evita as barreiras confirmadas/)).toBeNull()
  })

  it('Enter no campo escolhido envia e leva o foco ao resultado, como o botão', async () => {
    apiFalsa({ ...INATIVO, 'POST /api/rotas': Response.json(ROTA) })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })).toHaveFocus()
  })

  it('o campo escolhido troca a tecla do celular: Enter já não busca, envia', async () => {
    apiFalsa(INATIVO)
    const user = userEvent.setup()
    abrir()
    const origem = await screen.findByRole('combobox', { name: 'Origem' })
    expect(origem).toHaveAttribute('enterkeyhint', 'search')
    await escolher(user, 'Origem', 0)
    expect(origem).toHaveAttribute('enterkeyhint', 'go')
  })

  it('ponto repetido com Enter: o foco não muda, então a região anuncia o erro', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A]) })
    const user = userEvent.setup()
    abrir()
    await escolher(user, 'Origem', 0)
    await escolher(user, 'Destino', 0)
    await user.keyboard('{Enter}')
    expect(screen.getByRole('combobox', { name: 'Destino' })).toHaveFocus()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('A origem e o destino são o mesmo ponto'))
  })

  it('o erro de envio some ao digitar: fora da área e espera voltam a aparecer', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([]) })
    const user = userEvent.setup()
    abrir()
    await user.click(await botaoCalcular())
    const origem = screen.getByRole('combobox', { name: 'Origem' })
    expect(origem).toHaveAccessibleDescription(expect.stringContaining('Escolha um endereço da lista.'))
    await user.keyboard('xyz{Enter}')
    expect(await screen.findByText(/fora dessa área o Rota Falada SP ainda não atende/)).toBeInTheDocument()
    expect(origem).not.toHaveAccessibleDescription(expect.stringContaining('Escolha um endereço da lista.'))
    expect(origem).not.toHaveAttribute('aria-invalid')
  })

  it('cálculo lento troca o texto e anuncia uma vez', async () => {
    apiFalsa({ ...INATIVO, 'POST /api/rotas': () => new Promise<Response>(() => {}) })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    const calcular = await botaoCalcular()
    vi.useFakeTimers()
    try {
      fireEvent.click(calcular)
      await act(() => vi.advanceTimersByTimeAsync(15_200))
      expect(screen.getByText('Ainda calculando; o serviço de rotas está lento.')).toBeInTheDocument()
      await act(() => vi.advanceTimersByTimeAsync(200))
      expect(screen.getByRole('status')).toHaveTextContent('Ainda calculando; o serviço de rotas está lento.')
    } finally {
      vi.useRealTimers()
    }
  })

  it('mudar a exigência depois do resultado não recalcula: marca como desatualizada', async () => {
    const api = apiFalsa({ ...INATIVO, 'POST /api/rotas': Response.json(ROTA) })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    await user.click(await botaoCalcular())
    await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })
    await user.click(screen.getByRole('radio', { name: 'até 3%' }))
    expect(screen.getByText('Esta rota é da busca anterior. Calcule de novo.')).toBeInTheDocument()
    expect(api.de('POST /api/rotas')).toHaveLength(1)
    // única salvaguarda de 3.2.2 nesta tela: precisa chegar a quem usa leitor de tela
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Esta rota é da busca anterior. Calcule de novo.'))
    expect(screen.getByRole('heading', { level: 2, name: /Rota da busca anterior/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: /Rota encontrada/ })).toBeNull()
  })

  it('a ficha e o mapa falam da rota calculada, nunca dos campos vivos', async () => {
    apiFalsa({ ...INATIVO, 'POST /api/rotas': Response.json(ROTA) })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    await user.click(await botaoCalcular())
    await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })
    await user.click(screen.getByRole('combobox', { name: 'Destino' }))
    await user.keyboard('x')
    const ficha = screen.getByText('Até').closest('dl')!
    expect(within(ficha).getByText(B.rotulo)).toBeInTheDocument()
    expect(within(ficha).queryByText('sem dado')).toBeNull()
  })

  it('recarregar depois de trocar o destino mostra o aviso e os rótulos da rota antiga', async () => {
    apiFalsa(INATIVO)
    gravarSessaoRota({ versao: 1, origem: A, destino: C, perfil: PERFIL_FORM_PADRAO, rota: ROTA, rotaDe: ROTA_DE, calculadaEm: new Date().toISOString() })
    abrir()
    expect(await screen.findByText('Esta rota é da busca anterior. Calcule de novo.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Destino' })).toHaveValue(C.rotulo)
    const ficha = screen.getByText('Até').closest('dl')!
    expect(within(ficha).getByText(B.rotulo)).toBeInTheDocument()
    expect(within(ficha).queryByText(C.rotulo)).toBeNull()
  })

  it('recarregar restaura sem POST e sem mover o foco; Limpar apaga', async () => {
    const api = apiFalsa(INATIVO)
    gravarSessaoRota({ versao: 1, origem: A, destino: B, perfil: PERFIL_FORM_PADRAO, rota: ROTA, rotaDe: ROTA_DE, calculadaEm: new Date().toISOString() })
    const user = userEvent.setup()
    abrir()
    const titulo = await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })
    expect(titulo).not.toHaveFocus()
    expect(api.de('POST /api/rotas')).toHaveLength(0)
    expect(screen.getByRole('combobox', { name: 'Origem' })).toHaveValue(A.rotulo)
    await user.click(screen.getByRole('button', { name: 'Limpar busca' }))
    expect(screen.queryByRole('heading', { level: 2, name: /Rota encontrada/ })).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Origem' })).toHaveValue('')
    expect(screen.getByRole('combobox', { name: 'Origem' })).toHaveFocus()
    await waitFor(() => expect(sessionStorage.getItem('rf-busca')).not.toContain('Rua A'))
  })

  it('o trajeto nunca vai para URL nem localStorage', async () => {
    apiFalsa({ ...INATIVO, 'POST /api/rotas': Response.json(ROTA) })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    await user.click(await botaoCalcular())
    await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })
    expect(localStorage.length).toBe(0)
  })

  it('barreira do passo aparece em texto, em português', async () => {
    const barreira = { id: 9, origem: 'oficial', categoria: 'buraco', severidade: 'dificulta', distancia_m: 12, confirmacoes: null, data_referencia: '2026-11-03' }
    const rota = { ...ROTA, passos: [{ ...ROTA.passos[0], barreiras_proximas: [barreira] }] }
    apiFalsa({ ...INATIVO, 'POST /api/rotas': Response.json(rota) })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    await user.click(await botaoCalcular())
    await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })
    const lista = screen.getByRole('list', { name: 'Os 1 passos da rota' })
    expect(within(lista).getByText(/Buraco, a 12 m. Dificulta a passagem, não bloqueia a rota. Fonte: SP156, 03\/11\/2026./)).toBeInTheDocument()
  })

  describe('mapa', () => {
    it('só carrega por ação, avisa do IP e, aberto, cada passo dirige o mapa', async () => {
      apiFalsa({ ...INATIVO, 'POST /api/rotas': Response.json(ROTA) })
      const user = userEvent.setup()
      const { container } = abrir()
      await preencher(user)
      await user.click(await botaoCalcular())
      await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })

      const botao = screen.getByRole('button', { name: 'Mostrar mapa' })
      expect(botao).toHaveAttribute('aria-pressed', 'false')
      expect(botao).toHaveAccessibleDescription(expect.stringContaining('recebe o endereço IP'))
      expect(screen.queryByRole('img', { name: /Mapa ilustrativo/ })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Ver o passo 1 no mapa' })).toBeNull()

      await user.click(botao)
      const mapa = await screen.findByRole('img', { name: /Mapa ilustrativo da rota de Rua A, 1 · Vila Mariana até Rua B, 2 · Vila Mariana/ })
      expect(mapa).toHaveAccessibleName(expect.stringContaining('Tudo o que ele mostra está na lista de passos'))
      expect(botao).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright')

      const verPasso = screen.getByRole('button', { name: 'Ver o passo 2 no mapa' })
      await user.click(verPasso)
      expect(verPasso).toHaveAttribute('aria-current', 'true')
      expect(verPasso).not.toHaveAttribute('aria-pressed')
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Mapa no passo 2.'))
      // pressionar de novo não é mudo: enquadra e anuncia outra vez
      await user.click(verPasso)
      expect(screen.getByRole('status').textContent).toBe('')
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Mapa no passo 2.'))
      expect(within(screen.getByRole('list', { name: 'Mapa no passo 2' })).getByRole('listitem')).toHaveAttribute('aria-current', 'step')
      expect(screen.getByRole('link', { name: 'Voltar ao passo 2 na lista' })).toHaveAttribute('href', '#passo-2')
      expect(document.querySelectorAll('[aria-live],[role=status],[role=alert]')).toHaveLength(1)
      expect(await axe(container)).toHaveNoViolations()
    })

    it('geometria inválida: sem botão de mapa, a lista segue', async () => {
      apiFalsa({ ...INATIVO, 'POST /api/rotas': Response.json({ ...ROTA, geometria: {} }) })
      const user = userEvent.setup()
      abrir()
      await preencher(user)
      await user.click(await botaoCalcular())
      await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })
      expect(screen.queryByRole('button', { name: 'Mostrar mapa' })).toBeNull()
      expect(screen.getByRole('list', { name: 'Os 2 passos da rota' })).toBeInTheDocument()
    })
  })

  it('a contagem pendente não é falada depois de escolher a opção', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A, B]) })
    const user = userEvent.setup()
    abrir()
    await escolher(user, 'Origem', 0) // primeira busca: a contagem sai
    await user.click(screen.getByRole('combobox', { name: 'Destino' }))
    await user.keyboard('rua{Enter}')
    await screen.findAllByRole('option') // segunda busca, dentro dos 3 s: a contagem fica pendente
    await user.keyboard('{ArrowDown}{Enter}')
    await new Promise((r) => setTimeout(r, 3200))
    expect(screen.getByRole('status')).toHaveTextContent('Destino: Rua A, 1')
  }, 8000)
})

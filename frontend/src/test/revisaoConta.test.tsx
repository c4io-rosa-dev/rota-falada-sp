import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import App from '../App'
import { CarregandoPagina } from '../componentes/CarregandoPagina'
import { Pictograma } from '../componentes/Pictograma'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { gravarSessaoRota, PERFIL_FORM_PADRAO } from '../dados/sessaoRota'
import { apiFalsa } from './apiFalsa'
import { A, abrir, ficha, logar, mocks, prepararColaboracao } from './apoioColaboracao'

vi.mock('../auth/cliente', () => import('./clienteFalso'))
prepararColaboracao()

function adiado<T>() {
  let resolver!: (v: T) => void
  const promessa = new Promise<T>((r) => (resolver = r))
  return { promessa, resolver }
}

function sairDeVerdade() {
  mocks.sair.mockImplementation(async () => {
    mocks.temSessaoSalva.mockReturnValue(false)
    mocks.obterToken.mockResolvedValue(null)
    mocks.lerConta.mockResolvedValue(null)
  })
}

function OndeEstou() {
  const { pathname } = useLocation()
  const navegar = useNavigate()
  return (
    <>
      <span data-testid="caminho">{pathname}</span>
      <button onClick={() => navegar('/barreiras/5')}>saltar</button>
    </>
  )
}

function abrirConta() {
  return render(
    <MemoryRouter initialEntries={['/conta']}>
      <App />
      <OndeEstou />
    </MemoryRouter>,
  )
}

describe('"Sair"', () => {
  it('leva ao início, como o código pede, e anuncia', async () => {
    apiFalsa(logar())
    sairDeVerdade()
    const user = userEvent.setup()
    abrirConta()
    await user.click(await screen.findByRole('button', { name: 'Sair' }))
    await waitFor(() => expect(screen.getByTestId('caminho')).toHaveTextContent(/^\/$/))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Você saiu da conta.'))
    expect(document.activeElement).not.toBe(document.body)
  })

  it('quem chega a /conta sem sessão continua indo a /entrar', async () => {
    apiFalsa({})
    abrirConta()
    await waitFor(() => expect(screen.getByTestId('caminho')).toHaveTextContent('/entrar'))
  })

  it('apaga a busca e a rota da aba: o aparelho pode ser de outra pessoa', async () => {
    apiFalsa(logar())
    sairDeVerdade()
    gravarSessaoRota({ versao: 1, origem: A, destino: null, perfil: PERFIL_FORM_PADRAO, rota: null, rotaDe: null, calculadaEm: null })
    expect(sessionStorage.getItem('rf-busca')).not.toBeNull()
    const user = userEvent.setup()
    abrirConta()
    await user.click(await screen.findByRole('button', { name: 'Sair' }))
    await waitFor(() => expect(mocks.sair).toHaveBeenCalled())
    await waitFor(() => expect(sessionStorage.getItem('rf-busca')).toBeNull())
  })

  it('resposta de /api/eu que chega depois não devolve o papel de admin', async () => {
    const eu = adiado<Response>()
    logar('admin')
    apiFalsa({ 'GET /api/eu': () => eu.promessa, 'GET /api/barreiras/5': Response.json(ficha()), 'GET /api/geocode/reverso': Response.json(A) })
    sairDeVerdade()
    const user = userEvent.setup()
    abrirConta()
    await user.click(await screen.findByRole('button', { name: 'Sair' }))
    await waitFor(() => expect(mocks.sair).toHaveBeenCalled())
    await act(async () => eu.resolver(Response.json({ papel: 'admin' })))
    await user.click(screen.getByRole('button', { name: 'saltar' }))
    await screen.findByText(/Aguardando confirmação/)
    expect(screen.getByRole('link', { name: 'Entrar' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Moderar esta barreira' })).toBeNull()
  })
})

describe('/conta sem pular', () => {
  it('a espera fica depois de "Sair": sair dela não move o botão', async () => {
    const eu = adiado<Response>()
    logar()
    apiFalsa({ 'GET /api/eu': () => eu.promessa })
    abrir('/conta')
    const texto = await screen.findByText('Carregando os dados da conta…')
    const sair = screen.getByRole('button', { name: 'Sair' })
    expect(sair.compareDocumentPosition(texto) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('página em chunk lento', () => {
  function Montar() {
    return (
      <RegiaoViva>
        <CarregandoPagina />
      </RegiaoViva>
    )
  }

  it('o texto aparece na hora, e a fala só se a espera passar de 1 s', () => {
    vi.useFakeTimers()
    try {
      render(<Montar />)
      expect(screen.getByText('Carregando…')).toBeInTheDocument()
      act(() => void vi.advanceTimersByTime(900))
      expect(screen.getByRole('status').textContent).toBe('')
      act(() => void vi.advanceTimersByTime(300))
      expect(screen.getByRole('status')).toHaveTextContent('Carregando a página.')
    } finally {
      vi.useRealTimers()
    }
  })

  it('chunk rápido não fala nada', () => {
    vi.useFakeTimers()
    try {
      const { rerender } = render(<Montar />)
      rerender(<RegiaoViva>{null}</RegiaoViva>)
      act(() => void vi.advanceTimersByTime(2000))
      expect(screen.getByRole('status').textContent).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('traço único de 2 px', () => {
  it.each([24, 28, 36, 20])('tamanho %i desenha 2 px na tela', (tamanho) => {
    const { container } = render(<Pictograma nome="localizacao" tamanho={tamanho} />)
    const traco = Number(container.querySelector('svg')!.getAttribute('stroke-width'))
    expect((traco * tamanho) / 24).toBeCloseTo(2)
  })
})

describe('declaração de acessibilidade', () => {
  it('não diz que cálculo e voz faltam, lista o que existe e não afirma testes sem registro', async () => {
    abrir('/acessibilidade')
    await screen.findByRole('heading', { level: 1, name: 'Declaração de acessibilidade' })
    const texto = document.querySelector('main')!.textContent!
    expect(texto).not.toContain('ainda não estão disponíveis')
    expect(texto).not.toContain('VoiceOver foram feitos')
    expect(texto).toMatch(/Cálculo de rota/)
    expect(texto).toMatch(/Ouvir a rota/)
    expect(texto).toMatch(/código enviado por e-mail/)
    expect(texto).toMatch(/Cadastro e votação de barreiras/)
    expect(texto).toMatch(/NVDA/)
    expect(texto).toMatch(/TalkBack e VoiceOver/)
  })
})

describe('página não encontrada', () => {
  it('a única ação é um alvo de 44 px', async () => {
    abrir('/nao-existe')
    expect(await screen.findByRole('link', { name: 'Planejar uma rota' })).toHaveClass('alvo')
  })
})

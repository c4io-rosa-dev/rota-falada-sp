import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { axe } from 'vitest-axe'
import App from '../App'
import { textoFalado } from '../dados/passo'
import { ROTA_EXEMPLO } from '../dados/rotaExemplo'

function renderizar() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>,
  )
}

describe('página inicial', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('a dobra é a elevação: título, subtítulo, ações, 11 passarelas e o destino com proveniência', () => {
    renderizar()
    expect(screen.getByRole('heading', { level: 1, name: 'A rota é um texto.' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Rotas a pé em São Paulo que evitam escadas, calçadas estreitas e guias altas, descritas passo a passo com fonte e data.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Planejar rota' })).toHaveAttribute('href', '/rota')
    const elevacao = screen.getByRole('list', { name: 'Passos da rota de exemplo, em elevação' })
    expect(within(elevacao).getAllByRole('listitem')).toHaveLength(11)
    expect(within(elevacao).getAllByRole('listitem')[1]).toHaveTextContent('Rua Helen Keller')
    const destino = screen.getByText(/Exemplo gravado em 12\/10\/2026/)
    expect(destino).toHaveTextContent('Vila Mariana')
    expect(destino).toHaveTextContent('OpenStreetMap, GeoSampa')
  })

  it('tem as seções Como funciona, Para quem é e Exemplo de rota real', () => {
    renderizar()
    expect(screen.getByRole('heading', { level: 2, name: 'Como funciona' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Origem e destino' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Lista de passos com fonte e data' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Leia ou ouça' })).toBeInTheDocument()

    const laje1 = screen.getByRole('heading', { level: 3, name: 'Origem e destino' }).closest('li')!
    expect(laje1.querySelector('.placa-gravada')).toHaveTextContent(
      'Rua Helen Keller até Rua Ouvidor Peleja, até 6%, evitar degraus',
    )
    const laje3 = screen.getByRole('heading', { level: 3, name: 'Leia ou ouça' }).closest('li')!
    expect(laje3.querySelector('blockquote')).toHaveTextContent(textoFalado(ROTA_EXEMPLO.passos[3]))
    // nada de cartão de ícone: o pictograma só aparece dentro de um artefato, nunca como cabeçalho da laje
    expect(laje1.querySelector(':scope > svg')).toBeNull()
    expect(laje3.querySelector(':scope > svg')).toBeNull()

    expect(screen.getByRole('heading', { level: 2, name: 'Para quem é' })).toBeInTheDocument()
    for (const nome of ['Marcos', 'Dona Ivete', 'Sr. Antônio']) {
      expect(screen.getByRole('heading', { level: 3, name: nome })).toBeInTheDocument()
    }
    expect(screen.getByText(/Ouve a rota, navega só por teclado e digita com zoom de 400%/)).toBeInTheDocument()
    // concreto limpo: personas são colunas de texto, sem caixa nem pictograma
    const quem = screen.getByRole('heading', { level: 2, name: 'Para quem é' }).closest('section')!
    expect(quem.querySelector('.janela, .torre, svg')).toBeNull()
    for (const nome of ['Marcos', 'Dona Ivete', 'Sr. Antônio']) {
      expect(screen.getByRole('heading', { level: 3, name: nome }).closest('.persona')).not.toBeNull()
    }
    // a nota da banca sai da caixa: uma frase por assunto
    const notas = quem.querySelectorAll('.nota-banca')
    expect(notas).toHaveLength(2)
    expect(notas[0]).toHaveTextContent('semana 15')
    expect(notas[1]).toHaveTextContent('sem IA generativa')

    // a laje 2 diz a verdade sobre a amostra
    const laje2 = screen.getByRole('heading', { level: 3, name: 'Lista de passos com fonte e data' }).closest('li')!
    expect(laje2).toHaveTextContent(
      'Na elevação, cada passo mostra rua e distância; na lista completa, também largura, declividade, guia, degrau, fonte e data.',
    )

    // o h2 da seção 4 fica solto no chão, como os das outras seções
    expect(screen.getByRole('heading', { level: 2, name: 'Exemplo de rota real' }).closest('.ficha')).toBeNull()
  })

  it('lista os 11 passos reais com todos os campos', () => {
    renderizar()
    const lista = screen.getByRole('list', { name: 'Os 11 passos da rota de exemplo' })
    const itens = within(lista).getAllByRole('listitem')
    expect(itens).toHaveLength(11)
    // uma linha de cabeçalho de colunas, só visual; os <dt> continuam em cada linha para o leitor de tela
    const cabecalho = document.querySelector('.tabela-passos__cabecalho')!
    expect(cabecalho).toHaveAttribute('aria-hidden', 'true')
    expect(cabecalho.textContent).toBe('DistânciaLarguraDeclividadeGuiaDegrauFonteData')
    for (const item of itens) {
      for (const campo of ['Distância', 'Largura', 'Declividade', 'Guia', 'Degrau', 'Fonte', 'Data']) {
        expect(within(item).getByText(campo, { selector: 'dt' })).toBeInTheDocument()
      }
    }
    expect(itens[3]).toHaveTextContent('Vire à direita')
    expect(itens[3]).toHaveTextContent('1,67 m')
    expect(itens[3]).toHaveTextContent('não rebaixada')
    expect(itens[1]).toHaveTextContent('sem dado')
    expect(screen.getByText(/largura e declividade ficam sem dado nesses trechos/)).toBeInTheDocument()
  })

  it('sem síntese de voz, explica em texto em vez de mostrar o botão', () => {
    renderizar()
    expect(screen.queryByRole('button', { name: 'Ouvir o exemplo' })).toBeNull()
    expect(screen.getAllByText(/navegador não lê em voz alta/).length).toBeGreaterThan(0)
  })

  it('Ouvir o exemplo acende o mesmo passo na elevação e na lista', async () => {
    class Fala {
      text: string
      lang = ''
      voice: unknown = null
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(t: string) {
        this.text = t
      }
    }
    vi.stubGlobal('SpeechSynthesisUtterance', Fala)
    vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [] })
    renderizar()
    await userEvent.click(screen.getAllByRole('button', { name: 'Ouvir o exemplo' })[0])
    const elevacao = screen.getByRole('list', { name: 'Passos da rota de exemplo, em elevação' })
    const lista = screen.getByRole('list', { name: 'Os 11 passos da rota de exemplo' })
    expect(within(elevacao).getAllByRole('listitem')[0]).toHaveAttribute('aria-current', 'step')
    expect(within(lista).getAllByRole('listitem')[0]).toHaveAttribute('aria-current', 'step')
  })

  it('não tem violações de acessibilidade', async () => {
    const { container } = renderizar()
    expect(await axe(container)).toHaveNoViolations()
  })
})

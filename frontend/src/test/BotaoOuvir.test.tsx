import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { BotaoOuvir } from '../componentes/BotaoOuvir'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { ROTA_EXEMPLO } from '../dados/rotaExemplo'

class FalaFalsa {
  text: string
  lang = ''
  voice: unknown = null
  rate = 1
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(texto: string) {
    this.text = texto
  }
}

function instalarVoz() {
  const faladas: FalaFalsa[] = []
  const sintese = {
    speak: vi.fn((f: FalaFalsa) => {
      faladas.push(f)
      f.onstart?.()
    }),
    cancel: vi.fn(),
    getVoices: vi.fn(() => [{ lang: 'pt-BR', name: 'Voz pt' }]),
  }
  vi.stubGlobal('speechSynthesis', sintese)
  vi.stubGlobal('SpeechSynthesisUtterance', FalaFalsa)
  return { faladas, sintese }
}

function renderizar(aoMudarPasso = vi.fn()) {
  const r = render(
    <RegiaoViva>
      <BotaoOuvir passos={ROTA_EXEMPLO.passos} aoMudarPasso={aoMudarPasso} />
    </RegiaoViva>,
  )
  return { ...r, aoMudarPasso }
}

describe('BotaoOuvir', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sem síntese de voz, o botão some e um texto explica', async () => {
    vi.stubGlobal('speechSynthesis', undefined)
    const { container } = renderizar()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(/navegador não lê em voz alta/)).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('lê os passos em pt-BR um a um e marca o passo ativo', async () => {
    const { faladas } = instalarVoz()
    const { aoMudarPasso, container } = renderizar()
    const botao = screen.getByRole('button', { name: 'Ouvir o exemplo' })
    expect(botao).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(botao)
    expect(faladas).toHaveLength(1)
    expect(faladas[0].lang).toBe('pt-BR')
    expect(faladas[0].text).toMatch(/^Passo 1\. Siga para oeste\./)
    expect(aoMudarPasso).toHaveBeenLastCalledWith(1)
    // rótulo fixo (padrão APG de botão de alternância): só o estado e o pictograma mudam
    expect(screen.queryByRole('button', { name: /Parar/ })).toBeNull()
    const lendo = screen.getByRole('button', { name: 'Ouvir o exemplo' })
    expect(lendo).toHaveAttribute('aria-pressed', 'true')
    expect(lendo.querySelector('[data-pictograma="parar"]')).not.toBeNull()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Lendo a rota em voz alta.'))

    act(() => faladas[0].onend?.())
    expect(faladas).toHaveLength(2)
    expect(faladas[1].text).toMatch(/^Passo 2\./)
    expect(aoMudarPasso).toHaveBeenLastCalledWith(2)
    // a região viva anuncia o estado, nunca o texto do passo (a voz já o diz)
    expect(screen.getByRole('status')).not.toHaveTextContent('Passo')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('Parar cancela a fala, desmarca o passo e anuncia a interrupção', async () => {
    const { sintese, faladas } = instalarVoz()
    const { aoMudarPasso } = renderizar()
    await userEvent.click(screen.getByRole('button', { name: 'Ouvir o exemplo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Ouvir o exemplo', pressed: true }))
    expect(sintese.cancel).toHaveBeenCalled()
    expect(aoMudarPasso).toHaveBeenLastCalledWith(null)
    const parado = screen.getByRole('button', { name: 'Ouvir o exemplo' })
    expect(parado).toHaveAttribute('aria-pressed', 'false')
    expect(parado.querySelector('[data-pictograma="ouvir"]')).not.toBeNull()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Leitura interrompida.'))
    // eventos atrasados da fala cancelada não avançam a leitura
    act(() => faladas[0].onend?.())
    expect(faladas).toHaveLength(1)
  })

  it('ao fim do último passo volta ao estado inicial', async () => {
    const { faladas } = instalarVoz()
    const { aoMudarPasso } = renderizar()
    await userEvent.click(screen.getByRole('button', { name: 'Ouvir o exemplo' }))
    for (let i = 0; i < 11; i++) act(() => faladas[i].onend?.())
    expect(faladas).toHaveLength(11)
    expect(aoMudarPasso).toHaveBeenLastCalledWith(null)
    expect(screen.getByRole('button', { name: 'Ouvir o exemplo' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('cancela a fala ao desmontar', async () => {
    const { sintese } = instalarVoz()
    const { unmount } = renderizar()
    await userEvent.click(screen.getByRole('button', { name: 'Ouvir o exemplo' }))
    sintese.cancel.mockClear()
    unmount()
    expect(sintese.cancel).toHaveBeenCalled()
  })
})

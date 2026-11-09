import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BotaoOuvir } from '../componentes/BotaoOuvir'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { falasDaRota } from '../dados/narrador'
import { assumirLeitura } from '../dados/navegacao/voz'
import { ROTA_EXEMPLO } from '../dados/rotaExemplo'

class FalaFalsa {
  text: string
  lang = ''
  voice: unknown = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(texto: string) {
    this.text = texto
  }
}

/** O "Ouvir a rota" e a navegação guiada dividem o mesmo trinco de voz.ts (spec 7.5). */
describe('uma leitura por vez entre o "Ouvir a rota" e a navegação', () => {
  beforeEach(() => {
    vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [{ lang: 'pt-BR', name: 'remota' }] })
    vi.stubGlobal('SpeechSynthesisUtterance', FalaFalsa)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('quem assume pelo trinco para o "Ouvir a rota"', async () => {
    render(
      <RegiaoViva>
        <BotaoOuvir falas={falasDaRota(ROTA_EXEMPLO, 6)} rotulo="Ouvir a rota" />
      </RegiaoViva>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Ouvir a rota' }))
    expect(screen.getByRole('button', { name: 'Ouvir a rota' })).toHaveAttribute('aria-pressed', 'true')
    const pararNavegacao = vi.fn()
    let soltar: () => void = () => {}
    act(() => {
      soltar = assumirLeitura(pararNavegacao)
    })
    expect(screen.getByRole('button', { name: 'Ouvir a rota' })).toHaveAttribute('aria-pressed', 'false')

    // e o "Ouvir a rota" de novo para a navegação
    await userEvent.click(screen.getByRole('button', { name: 'Ouvir a rota' }))
    expect(pararNavegacao).toHaveBeenCalledTimes(1)
    soltar()
  })

  it('o "Ouvir a rota" continua usando qualquer voz em português, mesmo remota', async () => {
    const sintese = globalThis.speechSynthesis as unknown as { speak: ReturnType<typeof vi.fn> }
    render(
      <RegiaoViva>
        <BotaoOuvir falas={falasDaRota(ROTA_EXEMPLO, 6)} rotulo="Ouvir a rota" />
      </RegiaoViva>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Ouvir a rota' }))
    expect(sintese.speak).toHaveBeenCalledTimes(1)
    expect((sintese.speak.mock.calls[0][0] as FalaFalsa).voice).toMatchObject({ name: 'remota' })
  })
})

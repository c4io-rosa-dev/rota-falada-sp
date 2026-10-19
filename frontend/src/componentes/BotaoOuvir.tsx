import { useEffect, useRef, useState } from 'react'
import { textoFalado, type Passo } from '../dados/passo'
import { Placa } from './Placa'
import { useAnuncio } from './useAnuncio'

/** Só uma leitura por vez na página: quem começa para a anterior, sem anunciar. */
let pararLeituraAtual: (() => void) | null = null

function sintese(): SpeechSynthesis | undefined {
  const g = globalThis as { speechSynthesis?: SpeechSynthesis; SpeechSynthesisUtterance?: unknown }
  return g.speechSynthesis && typeof g.SpeechSynthesisUtterance === 'function' ? g.speechSynthesis : undefined
}

function vozPortugues(s: SpeechSynthesis): SpeechSynthesisVoice | undefined {
  const vozes = s.getVoices?.() ?? []
  const norm = (v: SpeechSynthesisVoice) => (v.lang ?? '').replace('_', '-').toLowerCase()
  return vozes.find((v) => norm(v) === 'pt-br') ?? vozes.find((v) => norm(v).startsWith('pt'))
}

type Props = {
  passos: Passo[]
  /** Recebe a ordem do passo em leitura, ou null quando a leitura acaba. */
  aoMudarPasso?: (ordem: number | null) => void
  rotulo?: string
  variante?: 'acao' | 'neutra'
  className?: string
}

/**
 * Lê os passos em voz alta com SpeechSynthesis (recurso progressivo). Botão de
 * alternância com rótulo fixo e aria-pressed; só o pictograma troca (ouvir/parar). A região viva
 * só anuncia o estado ("Lendo…", "Leitura interrompida."), nunca o texto do passo,
 * para não duplicar a voz.
 */
export function BotaoOuvir({ passos, aoMudarPasso, rotulo = 'Ouvir o exemplo', variante = 'neutra', className }: Props) {
  const [suporte] = useState(() => sintese() !== undefined)
  const [lendo, setLendo] = useState(false)
  const anunciar = useAnuncio()
  const sessao = useRef(0)
  const passosRef = useRef(passos)
  const aoMudarRef = useRef(aoMudarPasso)

  useEffect(() => {
    passosRef.current = passos
    aoMudarRef.current = aoMudarPasso
  })

  // encerra a leitura desta instância; o contador invalida eventos atrasados da fala cancelada.
  // Identidade estável: é ela que fica registrada em pararLeituraAtual.
  const [parar] = useState<() => void>(() => function pararEsta() {
    sessao.current++
    sintese()?.cancel()
    if (pararLeituraAtual === pararEsta) pararLeituraAtual = null
    setLendo(false)
    aoMudarRef.current?.(null)
  })

  useEffect(
    () => () => {
      if (pararLeituraAtual === parar) {
        sessao.current++
        pararLeituraAtual = null
        sintese()?.cancel()
      }
    },
    [parar],
  )

  function falar(indice: number, id: number) {
    const s = sintese()
    if (!s || id !== sessao.current) return
    const lista = passosRef.current
    if (indice >= lista.length) {
      parar()
      return
    }
    const fala = new SpeechSynthesisUtterance(textoFalado(lista[indice]))
    fala.lang = 'pt-BR'
    const voz = vozPortugues(s)
    if (voz) fala.voice = voz
    fala.onend = () => falar(indice + 1, id)
    fala.onerror = () => {
      if (id === sessao.current) parar()
    }
    aoMudarRef.current?.(lista[indice].ordem)
    s.speak(fala)
  }

  function alternar() {
    if (lendo) {
      parar()
      anunciar('Leitura interrompida.')
      return
    }
    pararLeituraAtual?.()
    sintese()?.cancel()
    const id = ++sessao.current
    pararLeituraAtual = parar
    setLendo(true)
    anunciar('Lendo a rota em voz alta.')
    falar(0, id)
  }

  if (!suporte) {
    return (
      <p className={['ouvir-sem-suporte', className].filter(Boolean).join(' ')}>
        Este navegador não lê em voz alta; a rota continua inteira em texto nesta página.
      </p>
    )
  }

  return (
    <Placa
      variante={variante}
      pictograma={lendo ? 'parar' : 'ouvir'}
      aria-pressed={lendo}
      onClick={alternar}
      className={className}
    >
      {rotulo}
    </Placa>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { Fala } from '../dados/narrador'
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
  /** O que dizer, na ordem: resumo (ordem nula) e passos. Ver dados/narrador.ts. */
  falas: Fala[]
  /** Recebe a ordem do passo em leitura, ou null quando a leitura acaba. */
  aoMudarPasso?: (ordem: number | null) => void
  rotulo?: string
  variante?: 'acao' | 'neutra'
  className?: string
}

/**
 * Lê a rota em voz alta com SpeechSynthesis (recurso progressivo). Botão de
 * alternância com rótulo fixo e aria-pressed; só o pictograma troca (ouvir/parar). A região viva
 * só anuncia o estado ("Lendo…", "Leitura interrompida."), nunca o texto do passo,
 * para não duplicar a voz. Durante a leitura, "Passo anterior" e "Próximo passo" pulam a fala,
 * para quem está na rua não ouvir tudo de novo.
 */
export function BotaoOuvir({ falas, aoMudarPasso, rotulo = 'Ouvir o exemplo', variante = 'neutra', className }: Props) {
  const [suporte] = useState(() => sintese() !== undefined)
  const [lendo, setLendo] = useState(false)
  const anunciar = useAnuncio()
  const sessao = useRef(0)
  const falasRef = useRef(falas)
  const indiceAtual = useRef(0)
  const aoMudarRef = useRef(aoMudarPasso)

  useEffect(() => {
    falasRef.current = falas
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
    const lista = falasRef.current
    if (indice >= lista.length) {
      parar()
      return
    }
    indiceAtual.current = indice
    const fala = new SpeechSynthesisUtterance(lista[indice].texto)
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

  /** Interrompe a fala atual e continua de outro ponto; a sessão nova ignora a fala cancelada. */
  function pular(delta: number) {
    const id = ++sessao.current
    sintese()?.cancel()
    falar(Math.min(Math.max(indiceAtual.current + delta, 0), falasRef.current.length - 1), id)
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
    <>
      <Placa
        variante={variante}
        pictograma={lendo ? 'parar' : 'ouvir'}
        aria-pressed={lendo}
        onClick={alternar}
        className={className}
      >
        {rotulo}
      </Placa>
      {lendo && (
        <div className="ouvir__controles" role="group" aria-label="Controles da leitura">
          <Placa variante="neutra" onClick={() => pular(-1)}>
            Passo anterior
          </Placa>
          <Placa variante="neutra" onClick={() => pular(1)}>
            Próximo passo
          </Placa>
        </div>
      )}
    </>
  )
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ContextoAnuncio, ContextoCancelarAnuncio, type OpcoesAnuncio } from './useAnuncio'

/** Intervalo entre esvaziar e reescrever a região, para repetir o mesmo anúncio. */
const PAUSA_MS = 100
const INTERVALO_PADRAO_MS = 3000

type Limite = { ultimo: number; pendente?: ReturnType<typeof setTimeout> }

/**
 * A única região viva do app: role=status, educada e atômica. Componentes anunciam
 * por useAnuncio(); ninguém mais cria aria-live, para os anúncios não competirem.
 */
export function RegiaoViva({ children }: { children: ReactNode }) {
  const [mensagem, setMensagem] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const chaveNaPausa = useRef<string | undefined>(undefined)
  const limites = useRef(new Map<string, Limite>())

  const escrever = useCallback((texto: string, chave?: string) => {
    clearTimeout(timer.current)
    chaveNaPausa.current = chave
    setMensagem('')
    timer.current = setTimeout(() => {
      chaveNaPausa.current = undefined
      setMensagem(texto)
    }, PAUSA_MS)
  }, [])

  const anunciar = useCallback(
    (texto: string, opcoes?: OpcoesAnuncio) => {
      if (!opcoes?.chave) {
        // um fato novo: nada que estava na fila com chave ainda vale
        limites.current.forEach((l) => clearTimeout(l.pendente))
        escrever(texto)
        return
      }
      const chave = opcoes.chave
      const intervalo = opcoes.intervaloMs ?? INTERVALO_PADRAO_MS
      const limite = limites.current.get(chave) ?? { ultimo: -Infinity }
      limites.current.set(chave, limite)
      clearTimeout(limite.pendente)
      const restante = limite.ultimo + intervalo - Date.now()
      if (restante <= 0) {
        limite.ultimo = Date.now()
        escrever(texto, chave)
        return
      }
      limite.pendente = setTimeout(() => {
        limite.ultimo = Date.now()
        escrever(texto, chave)
      }, restante)
    },
    [escrever],
  )

  const cancelar = useCallback((chave: string) => {
    clearTimeout(limites.current.get(chave)?.pendente)
    if (chaveNaPausa.current === chave) {
      clearTimeout(timer.current)
      chaveNaPausa.current = undefined
    }
  }, [])

  useEffect(() => {
    const mapa = limites.current
    return () => {
      clearTimeout(timer.current)
      mapa.forEach((l) => clearTimeout(l.pendente))
    }
  }, [])

  return (
    <ContextoAnuncio.Provider value={anunciar}>
      <ContextoCancelarAnuncio.Provider value={cancelar}>{children}</ContextoCancelarAnuncio.Provider>
      <div role="status" aria-live="polite" aria-atomic="true" className="visualmente-oculto">
        {mensagem}
      </div>
    </ContextoAnuncio.Provider>
  )
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ContextoAnuncio } from './useAnuncio'

/** Intervalo entre esvaziar e reescrever a região, para repetir o mesmo anúncio. */
const PAUSA_MS = 100

/**
 * A única região viva do app: role=status, educada e atômica. Componentes anunciam
 * por useAnuncio(); ninguém mais cria aria-live, para os anúncios não competirem.
 */
export function RegiaoViva({ children }: { children: ReactNode }) {
  const [mensagem, setMensagem] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const anunciar = useCallback((texto: string) => {
    clearTimeout(timer.current)
    setMensagem('')
    timer.current = setTimeout(() => setMensagem(texto), PAUSA_MS)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <ContextoAnuncio.Provider value={anunciar}>
      {children}
      <div role="status" aria-live="polite" aria-atomic="true" className="visualmente-oculto">
        {mensagem}
      </div>
    </ContextoAnuncio.Provider>
  )
}

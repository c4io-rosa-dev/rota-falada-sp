import { useEffect, useRef } from 'react'

const SUFIXO = ' · Rota Falada SP'

/**
 * Toda página chama este hook: define o título da aba e move o foco para o h1,
 * para que leitores de tela anunciem a troca de página (WCAG 2.4.2 e 2.4.3).
 * O h1 precisa ter tabIndex={-1} e receber a ref devolvida.
 */
export function usePaginaAcessivel(titulo: string) {
  const h1Ref = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => {
    document.title = titulo + SUFIXO
    h1Ref.current?.focus()
  }, [titulo])

  return h1Ref
}

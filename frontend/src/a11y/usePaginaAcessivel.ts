import { useEffect, useRef } from 'react'

const SUFIXO = ' · Rota Falada SP'

/**
 * Já houve uma página montada nesta carga da aplicação? Na primeira carga o foco
 * fica com o navegador (o leitor de tela já anuncia o título do documento e o skip
 * link continua sendo o primeiro Tab); só trocas de rota client-side movem o foco.
 */
let aplicacaoJaCarregou = false

/** Só para testes: faz o próximo render contar como primeira carga da aplicação. */
export function reiniciarEstadoDeNavegacao() {
  aplicacaoJaCarregou = false
}

/**
 * Toda página chama este hook: define o título da aba e, em toda troca de rota,
 * move o foco para o h1, para que leitores de tela anunciem a página nova
 * (WCAG 2.4.2 e 2.4.3). O h1 precisa ter tabIndex={-1} e receber a ref devolvida.
 */
export function usePaginaAcessivel(titulo: string) {
  const h1Ref = useRef<HTMLHeadingElement | null>(null)
  // a instância montada na primeira carga nunca rouba o foco, nem quando o
  // StrictMode reexecuta o efeito em desenvolvimento
  const ehPrimeiraPagina = useRef(false)

  useEffect(() => {
    document.title = titulo + SUFIXO
    if (!aplicacaoJaCarregou) {
      aplicacaoJaCarregou = true
      ehPrimeiraPagina.current = true
      return
    }
    if (ehPrimeiraPagina.current) return
    h1Ref.current?.focus()
  }, [titulo])

  return h1Ref
}

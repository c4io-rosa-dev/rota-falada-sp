import { createContext, useContext } from 'react'

export type OpcoesAnuncio = {
  /** Com chave, no máximo um anúncio por intervalo; vale o último. */
  chave?: string
  intervaloMs?: number
}

export type Anunciar = (mensagem: string, opcoes?: OpcoesAnuncio) => void

const nada: Anunciar = () => {}

/** Contexto da região viva única do app (montada uma vez em App.tsx). */
export const ContextoAnuncio = createContext<Anunciar>(nada)

/** Cancela o anúncio pendente de uma chave: o que ele diz deixou de ser verdade. */
export const ContextoCancelarAnuncio = createContext<(chave: string) => void>(() => {})

/** Devolve a função que escreve na região viva única. Fora dela, não faz nada. */
export function useAnuncio(): Anunciar {
  return useContext(ContextoAnuncio)
}

export function useCancelarAnuncio(): (chave: string) => void {
  return useContext(ContextoCancelarAnuncio)
}

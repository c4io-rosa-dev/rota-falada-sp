import { createContext, useContext } from 'react'

export type Anunciar = (mensagem: string) => void

const nada: Anunciar = () => {}

/** Contexto da região viva única do app (montada uma vez em App.tsx). */
export const ContextoAnuncio = createContext<Anunciar>(nada)

/** Devolve a função que escreve na região viva única. Fora dela, não faz nada. */
export function useAnuncio(): Anunciar {
  return useContext(ContextoAnuncio)
}

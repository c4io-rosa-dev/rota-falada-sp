import { useEffect } from 'react'
import { useAnuncio } from './useAnuncio'

/** Abaixo disto o h1 da página nova chega logo, e a fala atrapalharia. */
const FALA_DEPOIS_DE_MS = 1000

/** Página em chunk lento, com sinal fraco: quem usa leitor de tela também precisa saber que espera. */
export function CarregandoPagina() {
  const anunciar = useAnuncio()

  useEffect(() => {
    const fala = setTimeout(() => anunciar('Carregando a página.'), FALA_DEPOIS_DE_MS)
    return () => clearTimeout(fala)
  }, [anunciar])

  return <p className="carregando-pagina">Carregando…</p>
}

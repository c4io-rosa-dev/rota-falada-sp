import { useEffect } from 'react'
import { useEstadoServidor } from '../api/servidor'
import { useAnuncio } from './useAnuncio'

export const TEXTO_ACORDANDO =
  'Ainda sem resposta. O servidor gratuito pode estar acordando, o que leva cerca de 1 minuto, ou o sinal pode estar fraco. Você pode continuar preenchendo; nada se perde.'
export const TEXTO_DEMORANDO = 'Continuamos tentando. O pedido sai assim que o servidor responder.'

let ultimoAnunciado: string | null = null

/** Só para testes. */
export function reiniciarAnuncioDeEspera() {
  ultimoAnunciado = null
}

function textoDe(estado: string): string | null {
  if (estado === 'acordando') return TEXTO_ACORDANDO
  if (estado === 'demorando') return TEXTO_DEMORANDO
  return null
}

/**
 * Texto de espera para quem está de fato aguardando (`ativo`), anunciado uma vez por
 * estágio em toda a página. Sem spinner nem contador: o texto muda, nada se move.
 */
export function useEsperaServidor(ativo: boolean): string | null {
  const estado = useEstadoServidor()
  const anunciar = useAnuncio()
  const texto = ativo ? textoDe(estado) : null

  useEffect(() => {
    if (estado === 'acordado') ultimoAnunciado = null
    if (texto && texto !== ultimoAnunciado) {
      ultimoAnunciado = texto
      anunciar(texto)
    }
  }, [texto, estado, anunciar])

  return texto
}

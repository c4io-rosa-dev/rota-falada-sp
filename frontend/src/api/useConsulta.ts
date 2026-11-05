import { useCallback, useEffect, useRef, useState } from 'react'
import { ehCancelamento, ErroApi, MSG_INESPERADO } from './base'

type Estado<T> = { chave: string | null; dados: T | null; erro: ErroApi | null; carregando: boolean }

/**
 * Consulta de leitura: refaz quando `chave` muda, cancela a anterior e nunca refaz sozinha
 * (nada se move sem ação). `chave` nula não consulta. Dados e erro valem só para a chave
 * atual: no commit da troca, quem lê o hook já não vê o resultado da chave anterior.
 */
export function useConsulta<T>(chave: string | null, buscar: (sinal: AbortSignal) => Promise<T>) {
  const [estado, setEstado] = useState<Estado<T>>({ chave, dados: null, erro: null, carregando: chave !== null })
  const [rodada, setRodada] = useState(0)
  const buscarRef = useRef(buscar)
  useEffect(() => {
    buscarRef.current = buscar
  })

  useEffect(() => {
    if (chave === null) return
    const controle = new AbortController()
    setEstado((e) => ({ chave, dados: e.chave === chave ? e.dados : null, erro: null, carregando: true }))
    buscarRef
      .current(controle.signal)
      .then((dados) => {
        if (!controle.signal.aborted) setEstado({ chave, dados, erro: null, carregando: false })
      })
      .catch((erro: unknown) => {
        if (controle.signal.aborted || ehCancelamento(erro)) return
        const erroApi = erro instanceof ErroApi ? erro : new ErroApi('inesperado', MSG_INESPERADO)
        setEstado({ chave, dados: null, erro: erroApi, carregando: false })
      })
    return () => controle.abort()
  }, [chave, rodada])

  const recarregar = useCallback(() => setRodada((r) => r + 1), [])
  const atualizar = useCallback((dados: T) => setEstado((e) => ({ ...e, dados })), [])
  const atual = estado.chave === chave
  return {
    dados: atual ? estado.dados : null,
    erro: atual ? estado.erro : null,
    carregando: chave !== null && (!atual || estado.carregando),
    recarregar,
    atualizar,
  }
}

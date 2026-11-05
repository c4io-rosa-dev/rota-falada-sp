import { useCallback, useEffect, useRef, useState } from 'react'
import { ehCancelamento, ErroApi, MSG_INESPERADO } from '../api/base'
import { useAnuncio } from '../componentes/useAnuncio'
import { comSessao, motivoDoLogin, type MotivoLogin } from './comSessao'

export type EstadoAcao =
  | { fase: 'ocioso' }
  | { fase: 'enviando' }
  | { fase: 'login'; motivo: MotivoLogin }
  | { fase: 'erro'; erro: ErroApi }

type Pendente<A extends unknown[]> = { args: A }

type Opcoes<A extends unknown[], R> = {
  /**
   * Lê o formulário de novo na hora de refazer: enquanto espera o e-mail a pessoa pode corrigir
   * o texto, e o que vale é o que está na tela. Devolve null se o formulário ficou inválido;
   * nesse caso quem a passa mostra o erro, e o portão só fecha.
   */
  montarArgs?: () => A | null
  /** Dito quando o pedido sai de verdade: sem sessão, o portão abre e ninguém ouve uma espera falsa. */
  textoEnvio?: string
  /** A pessoa saiu da página antes da resposta: nada de levá-la de volta. */
  aoConcluirForaDaTela?: (resultado: R, args: A) => void
}

/**
 * Executa uma ação que exige login sem desmontar a página: o rascunho, a chave de
 * idempotência e a foto continuam na memória. Se precisar de login, abre o portão na própria
 * página, e concluirLogin refaz a ação. Com o portão aberto, pedir de novo só leva o foco a ele:
 * refazer desmontaria o portão e apagaria o e-mail digitado.
 */
export function useAcaoComLogin<A extends unknown[], R>(acao: (token: string, ...args: A) => Promise<R>, aoConcluir: (resultado: R) => void, opcoes: Opcoes<A, R> = {}) {
  const [estado, setEstado] = useState<EstadoAcao>({ fase: 'ocioso' })
  const pendente = useRef<Pendente<A> | null>(null)
  const ocupada = useRef(false)
  const montado = useRef(true)
  const refPortao = useRef<HTMLHeadingElement>(null)
  const anunciar = useAnuncio()
  const refs = useRef({ acao, aoConcluir, opcoes, estado })
  refs.current = { acao, aoConcluir, opcoes, estado }

  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])

  const rodar = useCallback(
    async (args: A) => {
      if (ocupada.current) return
      ocupada.current = true
      pendente.current = { args }
      setEstado({ fase: 'enviando' })
      try {
        const resultado = await comSessao((token) => {
          const texto = refs.current.opcoes.textoEnvio
          if (texto && montado.current) anunciar(texto)
          return refs.current.acao(token, ...args)
        })
        pendente.current = null
        if (!montado.current) {
          refs.current.opcoes.aoConcluirForaDaTela?.(resultado, args)
          return
        }
        setEstado({ fase: 'ocioso' })
        refs.current.aoConcluir(resultado)
      } catch (erro) {
        if (!montado.current) return
        if (ehCancelamento(erro)) {
          setEstado({ fase: 'ocioso' })
        } else if (erro instanceof ErroApi && erro.tipo === 'sessao') {
          anunciar('') // o portão leva o foco ao próprio título; a espera deixou de valer
          setEstado({ fase: 'login', motivo: motivoDoLogin(erro) })
        } else {
          anunciar('') // quem mostra o erro diz ou leva o foco a ele; a espera deixou de valer
          setEstado({ fase: 'erro', erro: erro instanceof ErroApi ? erro : new ErroApi('inesperado', MSG_INESPERADO) })
        }
      } finally {
        ocupada.current = false
      }
    },
    [anunciar],
  )

  const executar = useCallback(
    (...args: A): Promise<void> => {
      if (refs.current.estado.fase === 'login') {
        pendente.current = { args }
        refPortao.current?.focus()
        return Promise.resolve()
      }
      return rodar(args)
    },
    [rodar],
  )

  const concluirLogin = useCallback(() => {
    const p = pendente.current
    if (!p) return
    const montarArgs = refs.current.opcoes.montarArgs
    const args = montarArgs ? montarArgs() : p.args
    if (args) {
      void rodar(args)
    } else {
      pendente.current = null
      setEstado({ fase: 'ocioso' })
    }
  }, [rodar])

  const cancelarLogin = useCallback(() => {
    pendente.current = null
    setEstado({ fase: 'ocioso' })
  }, [])

  /** A pessoa mexeu no que o erro apontava: ele deixou de valer. */
  const limparErro = useCallback(() => {
    setEstado((e) => (e.fase === 'erro' ? { fase: 'ocioso' } : e))
  }, [])

  return { estado, executar, concluirLogin, cancelarLogin, limparErro, refPortao }
}

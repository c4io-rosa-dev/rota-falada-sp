import { useCallback, useEffect, useReducer, useRef, type KeyboardEvent } from 'react'
import { ehCancelamento, ErroApi, MSG_INESPERADO } from '../api/base'
import { buscarEnderecos, type Endereco } from '../api/client'
import {
  escolhaDoCampo,
  estadoInicialCampo,
  MINIMO_BUSCA,
  reduzirCampo,
  textoDaLista,
  textoDoCampo,
  textoForaDaArea,
  type ViaEscolha,
} from './campoEstado'
import { useAnuncio, useCancelarAnuncio } from './useAnuncio'

/** spec-mãe: 800 ms. Com 300 ms, o eco do NVDA atrapalha quem digita pausado. */
export const DEBOUNCE_MS = 800

/** A contagem espera na fila da região viva; escolher, digitar ou sair a torna falsa. */
const CHAVE_CONTAGEM = 'contagem'

/**
 * Quem passa `aoEscolher` responde pelo anúncio da escolha: em EscolhaLocal o campo sai da
 * tela e o foco é que lê o local. A via `gps` também: o botão sabe o que dizer.
 */

export function useBuscaEndereco(rotulo: string, inicial: Endereco | null = null, aoEscolher?: (escolha: Endereco) => void) {
  const [estado, despachar] = useReducer(reduzirCampo, inicial, estadoInicialCampo)
  const anunciar = useAnuncio()
  const cancelarAnuncio = useCancelarAnuncio()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const controle = useRef<AbortController | null>(null)
  const compondo = useRef(false)
  const jaInstruiu = useRef(false)
  const aoEscolherRef = useRef(aoEscolher)
  useEffect(() => {
    aoEscolherRef.current = aoEscolher
  })

  const interromper = useCallback(() => {
    clearTimeout(timer.current)
    controle.current?.abort()
    controle.current = null
    cancelarAnuncio(CHAVE_CONTAGEM)
  }, [cancelarAnuncio])

  useEffect(() => interromper, [interromper])

  const buscarAgora = useCallback(
    (texto: string) => {
      interromper()
      const pedido = new AbortController()
      controle.current = pedido
      despachar({ tipo: 'buscar', texto })
      buscarEnderecos(texto.trim(), pedido.signal)
        .then((opcoes) => {
          if (pedido.signal.aborted) return
          despachar({ tipo: 'resultado', texto, opcoes })
          if (opcoes.length === 0) {
            anunciar(textoForaDaArea(texto))
            return
          }
          anunciar(textoDaLista(opcoes, rotulo, !jaInstruiu.current), { chave: CHAVE_CONTAGEM, intervaloMs: 3000 })
          jaInstruiu.current = true
        })
        .catch((erro: unknown) => {
          if (pedido.signal.aborted || ehCancelamento(erro)) return
          const mensagem = erro instanceof ErroApi ? erro.message : MSG_INESPERADO
          despachar({ tipo: 'falhou', texto, mensagem })
          anunciar(mensagem)
        })
    },
    [anunciar, interromper, rotulo],
  )

  const aoDigitar = useCallback(
    (texto: string) => {
      interromper()
      despachar({ tipo: 'digitar', texto })
      if (compondo.current || texto.trim().length < MINIMO_BUSCA) return
      timer.current = setTimeout(() => buscarAgora(texto), DEBOUNCE_MS)
    },
    [buscarAgora, interromper],
  )

  const escolher = useCallback(
    (escolha: Endereco, via: ViaEscolha = 'lista') => {
      interromper()
      despachar({ tipo: 'escolher', escolha, via })
      if (via !== 'gps' && !aoEscolherRef.current) anunciar(`${rotulo}: ${escolha.rotulo}.`)
      aoEscolherRef.current?.(escolha)
    },
    [anunciar, interromper, rotulo],
  )

  const limpar = useCallback(() => {
    interromper()
    despachar({ tipo: 'limpar' })
  }, [interromper])

  /** Tab, clique em outro lugar: nada abre nem fala num campo que a pessoa já deixou (7.2, D3). */
  const aoSair = useCallback(() => {
    interromper()
    despachar({ tipo: 'sair' })
  }, [interromper])

  /** A tabela de teclas do spec, seção 7.2. */
  function aoTecla(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (estado.fase !== 'lista') return
      e.preventDefault()
      if (e.altKey) {
        despachar(e.key === 'ArrowDown' ? { tipo: 'abrir' } : { tipo: 'fechar' })
      } else if (!estado.aberta) {
        despachar({ tipo: 'abrir', ativo: e.key === 'ArrowDown' ? 'primeiro' : 'ultimo' })
      } else {
        despachar({ tipo: 'mover', passo: e.key === 'ArrowDown' ? 1 : -1 })
      }
    } else if (e.key === 'Escape') {
      if (estado.fase === 'lista' && estado.aberta) {
        e.preventDefault()
        despachar({ tipo: 'fechar' })
      }
    } else if (e.key === 'Enter') {
      if (estado.fase === 'escolhido') return // envia o formulário
      e.preventDefault()
      if (estado.fase === 'lista' && estado.aberta) {
        if (estado.ativo >= 0) escolher(estado.opcoes[estado.ativo])
        else despachar({ tipo: 'mover', passo: 1 })
        return
      }
      const texto = textoDoCampo(estado)
      if (texto.trim().length >= MINIMO_BUSCA) buscarAgora(texto)
      else anunciar(`Digite ao menos ${MINIMO_BUSCA} letras.`)
    } else if (e.key === 'Tab') {
      aoSair()
    }
  }

  return {
    estado,
    texto: textoDoCampo(estado),
    escolha: escolhaDoCampo(estado),
    aoDigitar,
    aoTecla,
    aoSair,
    escolher,
    limpar,
    aoComporInicio: () => {
      compondo.current = true
    },
    aoComporFim: (texto: string) => {
      compondo.current = false
      aoDigitar(texto)
    },
  }
}

export type BuscaEndereco = ReturnType<typeof useBuscaEndereco>

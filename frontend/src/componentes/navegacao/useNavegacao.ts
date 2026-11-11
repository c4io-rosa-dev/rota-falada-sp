import { useCallback, useEffect, useRef, useState } from 'react'
import { ehCancelamento, ErroApi } from '../../api/base'
import { calcularRota, type RotaIn, type RotaOut } from '../../api/client'
import { FORA_DA_AREA, vigiarPosicao, type LeituraPosicao } from '../../dados/localizacao'
import { FALAS_FIXAS, type FalaNavegacao } from '../../dados/navegacao/falasNavegacao'
import {
  estadoNavegacao,
  reduzirNavegacao,
  type Efeito,
  type EstadoNavegacao,
  type EventoNavegacao,
  type MotivoRecalculo,
} from '../../dados/navegacao/navegacao'
import { detectarRecursos } from '../../dados/navegacao/recursos'
import { criarTelaLigada } from '../../dados/navegacao/telaLigada'
import { assumirLeitura, criarVoz, type Voz } from '../../dados/navegacao/voz'
import { useAnuncio } from '../useAnuncio'

/** Mesma assinatura de vigiarPosicao: a simulação entra no lugar dela. */
export type Vigia = (aoMudar: (l: LeituraPosicao) => void, aoErrar: (codigo: number) => void) => () => void

const TIQUE_MS = 1000
/** A pausa da RegiaoViva antes de escrever (PAUSA_MS lá): dentro dela, o anúncio anterior ainda não saiu. */
const JUNTAR_ANUNCIOS_MS = 100

function motivoDoErro(erro: unknown): MotivoRecalculo {
  if (erro instanceof ErroApi && erro.message === FORA_DA_AREA) return 'fora_da_area'
  if (erro instanceof ErroApi && erro.tipo === 'nao_encontrado') return 'sem_rota'
  return 'falha'
}

/**
 * Liga o reducer da navegação ao navegador: GPS (ou a simulação), tela ligada, aba oculta, voz e
 * região viva. O executor de efeitos roda dentro do próprio despacho, de forma síncrona: assim o
 * toque em Começar chama a voz, a tela ligada e o GPS sem nenhum `await` antes (iOS e Chrome só
 * liberam a voz e a permissão dentro do gesto). O estado da tela é o do reducer, como num useReducer.
 *
 * Canal (spec 5): voz desligada, toda fala vai para a região viva, sem chave; voz ligada, as
 * instruções vão para a voz e os estados para a região. Quando a mesma mudança leva o foco a um
 * elemento que já diz o fato (a chegada, com a ressalva na descrição; a mensagem de permissão), a
 * região não anuncia. O título do painel ("Passo 1 de 5") não diz a instrução: com foco nele, a
 * fala vai para a região do mesmo jeito.
 */
export function useNavegacao(rota: RotaOut, pedido: RotaIn, vigiaSimulada: Vigia | null) {
  const anunciarNaRegiao = useAnuncio()
  const pendente = useRef<{ texto: string; em: number } | null>(null)
  // A região espera uma pausa curta antes de escrever, e um anúncio novo nesse meio-tempo apaga o
  // anterior. Dois fatos colados (ex.: "Navegação retomada." e a situação do primeiro reencaixe)
  // saem juntos, num anúncio só.
  const anunciar = useCallback(
    (texto: string) => {
      const agora = Date.now()
      const anterior = pendente.current
      const junto = anterior && agora - anterior.em < JUNTAR_ANUNCIOS_MS ? `${anterior.texto} ${texto}` : texto
      pendente.current = { texto: junto, em: agora }
      anunciarNaRegiao(junto)
    },
    [anunciarNaRegiao],
  )
  const [estado, setEstado] = useState<EstadoNavegacao>(() =>
    estadoNavegacao(rota, pedido, { simulacao: vigiaSimulada !== null, localizacao: detectarRecursos().localizacao }),
  )
  const estadoRef = useRef(estado)
  const [voz, setVoz] = useState<Voz | null>(() => criarVoz())
  const [vozLigada, setVozLigada] = useState(false)
  const [telaPodeApagar, setTelaPodeApagar] = useState(false)
  const [tela] = useState(() => criarTelaLigada())

  const vozRef = useRef(voz)
  const vozLigadaRef = useRef(vozLigada)
  const pararVigia = useRef<(() => void) | null>(null)
  const soltarLeitura = useRef<(() => void) | null>(null)
  const controle = useRef<AbortController | null>(null)
  const fila = useRef<EventoNavegacao[]>([])
  const ocupado = useRef(false)
  const focoPendente = useRef<'painel' | 'chegada' | 'permissao' | null>(null)
  const refPainel = useRef<HTMLHeadingElement | null>(null)
  const refAviso = useRef<HTMLParagraphElement | null>(null)
  const despacharRef = useRef<(ev: EventoNavegacao) => void>(() => {})

  useEffect(() => {
    vozRef.current = voz
    vozLigadaRef.current = vozLigada
  }, [voz, vozLigada])

  // as vozes chegam depois em alguns navegadores (Chrome): confere de novo quando a lista muda
  useEffect(() => {
    const s = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis
    if (!s?.addEventListener) return
    const aoMudar = () => setVoz((atual) => atual ?? criarVoz())
    s.addEventListener('voiceschanged', aoMudar)
    return () => s.removeEventListener('voiceschanged', aoMudar)
  }, [])

  /** Para onde vai cada fala; devolve o texto que deve ir para a região viva, se houver. */
  const destino = useCallback((fala: FalaNavegacao, comFoco: boolean): string | null => {
    const v = vozLigadaRef.current ? vozRef.current : null
    if (fala.id === 'iniciada') {
      // só para destravar a voz do app no gesto; sem ela, não há o que dizer
      v?.falar(fala.texto, true)
      return null
    }
    if (v && fala.tipo === 'instrucao') {
      v.falar(fala.texto, fala.urgente)
      return null
    }
    return comFoco ? null : fala.texto
  }, [])

  const pararSensores = useCallback(
    (calar: boolean) => {
      pararVigia.current?.()
      pararVigia.current = null
      tela.soltar()
      if (calar) vozRef.current?.calar()
    },
    [tela],
  )

  const avisarTela = useCallback(() => {
    const e = estadoRef.current
    // com a aba oculta a navegação já está em pausa automática; ao voltar, a tela é pedida de novo
    if (e.oculta || (e.fase !== 'procurando' && e.fase !== 'navegando')) return
    setTelaPodeApagar(true)
    const texto = destino(FALAS_FIXAS.tela, false)
    if (texto) anunciar(texto)
  }, [anunciar, destino])

  const ligarSensores = useCallback(() => {
    // uma leitura por vez: a navegação para o "Ouvir a rota", e vice-versa
    soltarLeitura.current ??= assumirLeitura(() => {
      vozRef.current?.calar()
    })
    void tela.manter().then((ok) => {
      if (ok) setTelaPodeApagar(false)
      else avisarTela()
    })
    pararVigia.current?.()
    const vigiar = vigiaSimulada ?? vigiarPosicao
    pararVigia.current = vigiar(
      // um relógio só: a hora de chegada, a mesma do tique de 1 s (o timestamp do GPS varia por aparelho)
      (l) => despacharRef.current({ tipo: 'leitura', leitura: { ...l, tMs: Date.now() } }),
      (codigo) => despacharRef.current({ tipo: 'erro_posicao', codigo, agoraMs: Date.now() }),
    )
  }, [tela, vigiaSimulada, avisarTela])

  const recalcular = useCallback((novo: RotaIn) => {
    controle.current?.abort()
    const c = new AbortController()
    controle.current = c
    calcularRota(novo, c.signal).then(
      (r) => despacharRef.current({ tipo: 'rota_nova', rota: r, agoraMs: Date.now() }),
      (erro) => {
        if (!ehCancelamento(erro)) despacharRef.current({ tipo: 'recalculo_falhou', motivo: motivoDoErro(erro) })
      },
    )
  }, [])

  const executar = useCallback(
    (efeitos: Efeito[]) => {
      // só cala a região quando o foco vai para um elemento que já diz o fato
      const comFoco = efeitos.some((x) => x.tipo === 'focar' && x.alvo !== 'painel')
      const comInstrucao = efeitos.some((x) => x.tipo === 'falar' && x.fala.tipo === 'instrucao' && x.fala.id !== 'iniciada')
      const paraRegiao: string[] = []
      for (const ef of efeitos) {
        switch (ef.tipo) {
          case 'falar': {
            const texto = destino(ef.fala, comFoco)
            if (texto) paraRegiao.push(texto)
            break
          }
          case 'ligar_sensores':
            ligarSensores()
            break
          case 'parar_sensores':
            // a chegada sai inteira: só cala quando não há instrução no mesmo lote
            pararSensores(!comInstrucao)
            break
          case 'recalcular':
            recalcular(ef.pedido)
            break
          case 'focar':
            focoPendente.current = ef.alvo
            break
        }
      }
      // várias falas de uma vez viram um anúncio só: a região troca o texto e perderia as primeiras
      if (paraRegiao.length > 0) anunciar(paraRegiao.join(' '))
    },
    [anunciar, destino, ligarSensores, pararSensores, recalcular],
  )

  const despachar = useCallback(
    (ev: EventoNavegacao) => {
      fila.current.push(ev)
      if (ocupado.current) return
      ocupado.current = true
      try {
        while (fila.current.length > 0) {
          const r = reduzirNavegacao(estadoRef.current, fila.current.shift()!)
          estadoRef.current = r.estado
          executar(r.efeitos)
        }
      } finally {
        ocupado.current = false
      }
      setEstado(estadoRef.current)
    },
    [executar],
  )

  useEffect(() => {
    despacharRef.current = despachar
  }, [despachar])

  // foco depois que o elemento existe na tela
  useEffect(() => {
    const alvo = focoPendente.current
    if (!alvo) return
    focoPendente.current = null
    if (alvo === 'permissao') refAviso.current?.focus()
    else refPainel.current?.focus()
  })

  // tela ligada liberada pelo sistema (economia de bateria, outra aba)
  useEffect(() => tela.aoPerder(avisarTela), [tela, avisarTela])

  // aba oculta = pausa automática; visível de novo = retoma
  useEffect(() => {
    const aoMudar = () =>
      despacharRef.current(document.visibilityState === 'hidden' ? { tipo: 'oculta' } : { tipo: 'visivel', agoraMs: Date.now() })
    document.addEventListener('visibilitychange', aoMudar)
    return () => document.removeEventListener('visibilitychange', aoMudar)
  }, [])

  // o tique de 1 s só existe procurando (prazo da procura) ou navegando, com a aba à vista
  const tiqueLigado = (estado.fase === 'navegando' || estado.fase === 'procurando') && !estado.oculta
  useEffect(() => {
    if (!tiqueLigado) return
    const id = setInterval(() => despacharRef.current({ tipo: 'tempo', agoraMs: Date.now() }), TIQUE_MS)
    return () => clearInterval(id)
  }, [tiqueLigado])

  /** Para tudo: GPS, tela, voz, recálculo em curso e o trinco de leitura. Idempotente. */
  const pararTudo = useCallback(() => {
    pararSensores(true)
    controle.current?.abort()
    controle.current = null
    soltarLeitura.current?.()
    soltarLeitura.current = null
  }, [pararSensores])

  /** Encerrar já parou tudo: o desmonte que vem logo depois (navegar para /rota) não cala de novo. */
  const encerrado = useRef(false)

  // desmonte (e o desmonte de ensaio do StrictMode): nada fica ligado
  useEffect(
    () => () => {
      if (!encerrado.current) pararTudo()
    },
    [pararTudo],
  )

  return {
    estado,
    vozDisponivel: voz !== null,
    vozLigada: vozLigada && voz !== null,
    alternarVoz: () => setVozLigada((v) => !v),
    telaPodeApagar,
    refPainel,
    refAviso,
    comecar: () => despachar({ tipo: 'comecar', agoraMs: Date.now() }),
    alternarPausa: () =>
      despachar(estadoRef.current.fase === 'pausada' ? { tipo: 'continuar', agoraMs: Date.now() } : { tipo: 'pausar' }),
    repetir: () => despachar({ tipo: 'repetir' }),
    recalcular: () => despachar({ tipo: 'pedir_recalculo', agoraMs: Date.now() }),
    passoAPasso: () => despachar({ tipo: 'passo_a_passo' }),
    passoAnterior: () => despachar({ tipo: 'passo_anterior' }),
    proximoPasso: () => despachar({ tipo: 'proximo_passo' }),
    tentarDeNovo: () => despachar({ tipo: 'tentar_de_novo', agoraMs: Date.now() }),
    encerrar: () => {
      pararTudo()
      encerrado.current = true
    },
  }
}

export type Navegacao = ReturnType<typeof useNavegacao>

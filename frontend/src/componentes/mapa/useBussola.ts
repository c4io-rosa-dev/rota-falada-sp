import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
// só os tipos: a escuta de verdade mora no chunk lazy do mapa aberto (apoioMapaAberto.ts)
import type { OuvinteBussola } from './apoioMapaAberto'

/**
 * A permissão e o liga-desliga da bússola para a seta da pessoa no mapa (emenda de 10/11/2026 da
 * spec do mapa, 19.4).
 *
 * - Android (Chrome): `deviceorientationabsolute`, sem pedido de permissão.
 * - iPhone: `deviceorientation` com `webkitCompassHeading`, só depois de
 *   `DeviceOrientationEvent.requestPermission()` chamado dentro de um toque (`pedir`).
 *
 * LGPD: só escuta com o mapa aberto (`ativa`); a única leitura fica em memória, dentro do ouvinte,
 * e some ao fechar o mapa. Nada é gravado, registrado ou enviado, e a leitura não passa pelo
 * estado do React nem pelo DOM. A rotação do mapa não usa isto: só a seta.
 */

export type EstadoBussola =
  /** O navegador não tem o evento de orientação. */
  | 'sem_suporte'
  /** iPhone: falta o toque que pede a permissão. */
  | 'pedir'
  /** Escutando (pode não chegar leitura confiável: aí valem as outras fontes). */
  | 'ligada'
  | 'negada'

type ComPermissao = { requestPermission?: () => Promise<string> }

function eventoDeOrientacao(): ComPermissao | null {
  const E = (globalThis as { DeviceOrientationEvent?: ComPermissao }).DeviceOrientationEvent
  return typeof E === 'function' || typeof E === 'object' ? (E ?? null) : null
}

function estadoInicial(): EstadoBussola {
  const E = eventoDeOrientacao()
  if (!E) return 'sem_suporte'
  return typeof E.requestPermission === 'function' ? 'pedir' : 'ligada'
}

export function useBussola(
  ativa: boolean,
  /** `ouvirBussola` do chunk lazy; null enquanto ele não chegou. */
  ouvir: ((aoMudar: () => void) => OuvinteBussola) | null,
  /** Chamado quando a seta deve mudar (no máximo a cada 250 ms e com 5° ou mais de diferença). */
  aoMudar: () => void,
): { estado: EstadoBussola; pedir: () => void; ouvinte: RefObject<OuvinteBussola | null> } {
  const [estado, setEstado] = useState<EstadoBussola>(estadoInicial)
  const ouvinte = useRef<OuvinteBussola | null>(null)
  const avisar = useRef(aoMudar)

  useEffect(() => {
    avisar.current = aoMudar
  }, [aoMudar])

  useEffect(() => {
    if (!ativa || estado !== 'ligada' || !ouvir) return
    const o = ouvir(() => avisar.current())
    ouvinte.current = o
    return () => {
      o.parar()
      ouvinte.current = null
    }
  }, [ativa, estado, ouvir])

  // Alguns navegadores têm o pedido de permissão e respondem sem toque (não é o caso do iPhone, que
  // recusa fora de um gesto, sem mostrar nada): uma tentativa silenciosa, uma vez. Recusada, fica o botão.
  const tentou = useRef(false)
  useEffect(() => {
    if (!ativa || estado !== 'pedir' || tentou.current) return
    tentou.current = true
    let vivo = true
    eventoDeOrientacao()
      ?.requestPermission?.()
      .then(
        (resposta) => {
          if (vivo && resposta === 'granted') setEstado('ligada')
        },
        () => {},
      )
    return () => {
      vivo = false
    }
  }, [ativa, estado])

  /** Só a partir de um toque: é aqui que o iPhone mostra o pedido de permissão. */
  const pedir = useCallback(() => {
    const E = eventoDeOrientacao()
    if (typeof E?.requestPermission !== 'function') {
      setEstado(E ? 'ligada' : 'sem_suporte')
      return
    }
    E.requestPermission().then(
      (resposta) => setEstado(resposta === 'granted' ? 'ligada' : 'negada'),
      () => setEstado('negada'),
    )
  }, [])

  return { estado, pedir, ouvinte }
}

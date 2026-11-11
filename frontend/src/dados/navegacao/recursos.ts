import { vozLocalPortugues } from './voz'

export type Recursos = { localizacao: boolean; telaLigada: boolean; voz: boolean }

/** O que este aparelho oferece. A localização exige contexto seguro (https ou localhost). */
export function detectarRecursos(win: Window = window): Recursos {
  const nav = win.navigator
  return {
    localizacao: !!nav && 'geolocation' in nav && win.isSecureContext === true,
    telaLigada: !!nav && 'wakeLock' in nav,
    voz: vozLocalPortugues() !== null,
  }
}

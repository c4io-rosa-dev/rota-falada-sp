import { useSyncExternalStore } from 'react'
import { apiUrl, ErroApi, MSG_INDISPONIVEL, MSG_SEM_INTERNET, MSG_SEM_RESPOSTA } from './base'

/**
 * O Render Free dorme aos 15 min e leva cerca de 1 min para acordar. Toda chamada à API
 * passa por garantirAcordado(): há uma só espera por vez, por GET /health (simples, sem
 * preflight). O pedido de verdade só sai depois disso e nunca é repetido automaticamente.
 */
export type EstadoServidor = 'desconhecido' | 'acordado' | 'acordando' | 'demorando' | 'fora'

export const LIMIAR_ACORDANDO_MS = 4_000
export const LIMIAR_DEMORANDO_MS = 40_000
export const INTERVALO_TENTATIVA_MS = 5_000
export const TEMPO_TENTATIVA_MS = 30_000
export const TETO_ACORDAR_MS = 120_000
/** O servidor dorme aos 15 min; depois de 10 min sem contato, reconfere. */
export const VALIDADE_CONTATO_MS = 10 * 60 * 1000

let estado: EstadoServidor = 'desconhecido'
let ultimoContato = 0
let promessa: Promise<void> | null = null
const ouvintes = new Set<() => void>()

function mudar(novo: EstadoServidor) {
  if (novo === estado) return
  estado = novo
  ouvintes.forEach((o) => o())
}

function esperar(ms: number) {
  return new Promise<void>((resolver) => setTimeout(resolver, ms))
}

type Tentativa = 'ok' | 'banco_fora' | 'sem_resposta'

async function tentarHealth(): Promise<Tentativa> {
  const controle = new AbortController()
  const limite = setTimeout(() => controle.abort(), TEMPO_TENTATIVA_MS)
  try {
    const resposta = await fetch(apiUrl('/health'), { signal: controle.signal })
    // dormindo, o proxy pode devolver HTML com 200, 502 ou 503 sem JSON
    if (!resposta.ok || !resposta.headers.get('content-type')?.includes('json')) return 'sem_resposta'
    const corpo = (await resposta.json()) as { banco?: string }
    return corpo.banco === 'indisponivel' ? 'banco_fora' : 'ok'
  } catch {
    // servidor dormindo sem CORS e falta de sinal chegam iguais aqui: a interface não afirma a causa
    return 'sem_resposta'
  } finally {
    clearTimeout(limite)
  }
}

async function despertar(): Promise<void> {
  const inicio = Date.now()
  const marcaAcordando = setTimeout(() => mudar('acordando'), LIMIAR_ACORDANDO_MS)
  const marcaDemorando = setTimeout(() => mudar('demorando'), LIMIAR_DEMORANDO_MS)
  try {
    for (;;) {
      const tentativa = await tentarHealth()
      if (tentativa === 'ok') {
        ultimoContato = Date.now()
        mudar('acordado')
        return
      }
      if (tentativa === 'banco_fora') {
        mudar('fora')
        throw new ErroApi('indisponivel', MSG_INDISPONIVEL)
      }
      if (navigator.onLine === false) {
        mudar('fora')
        throw new ErroApi('rede', MSG_SEM_INTERNET)
      }
      if (Date.now() - inicio >= TETO_ACORDAR_MS) {
        mudar('fora')
        throw new ErroApi('indisponivel', MSG_SEM_RESPOSTA)
      }
      await esperar(INTERVALO_TENTATIVA_MS)
    }
  } finally {
    clearTimeout(marcaAcordando)
    clearTimeout(marcaDemorando)
  }
}

function cancelavel(espera: Promise<void>, sinal?: AbortSignal): Promise<void> {
  if (!sinal) return espera
  return new Promise<void>((resolver, rejeitar) => {
    const aoAbortar = () => rejeitar(new DOMException('Cancelado', 'AbortError'))
    if (sinal.aborted) return aoAbortar()
    sinal.addEventListener('abort', aoAbortar, { once: true })
    espera.then(resolver, rejeitar).finally(() => sinal.removeEventListener('abort', aoAbortar))
  })
}

/** Resolve com o servidor acordado. Cancelar só solta quem chamou; a espera segue para os outros. */
export function garantirAcordado(sinal?: AbortSignal): Promise<void> {
  if (navigator.onLine === false) return Promise.reject(new ErroApi('rede', MSG_SEM_INTERNET))
  if (estado === 'acordado' && Date.now() - ultimoContato < VALIDADE_CONTATO_MS) return Promise.resolve()
  promessa ??= despertar().finally(() => {
    promessa = null
  })
  return cancelavel(promessa, sinal)
}

/** Acorda antes de a pessoa precisar. Sem aviso na tela: nada aparece sem ação dela. */
export function aquecerServidor(): void {
  garantirAcordado().catch(() => {})
}

function assinar(ouvinte: () => void) {
  ouvintes.add(ouvinte)
  return () => {
    ouvintes.delete(ouvinte)
  }
}

export function useEstadoServidor(): EstadoServidor {
  return useSyncExternalStore(assinar, () => estado)
}

/** Só para testes: volta ao estado de uma carga nova da aplicação. */
export function reiniciarServidor() {
  estado = 'desconhecido'
  ultimoContato = 0
  promessa = null
  ouvintes.clear()
}

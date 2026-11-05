import type { components } from './types.gen'
import { pedir } from './http'

export type Barreira = components['schemas']['BarreiraOut']
export type BarreiraIn = components['schemas']['BarreiraIn']
export type Voto = components['schemas']['VotoIn']['voto']
export type StatusBarreira = components['schemas']['BarreiraOut']['status']
export type Evento = components['schemas']['EventoOut']
export type Eu = components['schemas']['EuOut']

const TEMPO_FOTO_MS = 60_000

/** Único módulo que anexa token. As leituras públicas seguem sem ele. */
export function listarProximas(lat: number, lon: number, raio_m: number, sinal?: AbortSignal): Promise<Barreira[]> {
  return pedir('/api/barreiras', { consulta: { lat, lon, raio_m }, sinal })
}

export function obterBarreira(id: number, sinal?: AbortSignal): Promise<Barreira> {
  return pedir(`/api/barreiras/${id}`, { sinal })
}

export function obterEu(token: string): Promise<Eu> {
  return pedir('/api/eu', { token })
}

/** 201 é nova; 200 é a mesma chave de idempotência, já registrada. */
export async function criarBarreira(token: string, entrada: BarreiraIn): Promise<{ barreira: Barreira; nova: boolean }> {
  let nova = true
  const barreira = await pedir<Barreira>('/api/barreiras', {
    metodo: 'POST',
    corpo: entrada,
    token,
    aoStatus: (status) => {
      nova = status === 201
    },
  })
  return { barreira, nova }
}

export function votar(token: string, id: number, voto: Voto): Promise<Barreira> {
  return pedir(`/api/barreiras/${id}/voto`, { metodo: 'PUT', corpo: { voto }, token })
}

export function anexarFoto(token: string, id: number, arquivo: File, descricao: string): Promise<Barreira> {
  const corpo = new FormData()
  corpo.append('arquivo', arquivo)
  corpo.append('descricao', descricao)
  return pedir(`/api/barreiras/${id}/foto`, { metodo: 'POST', corpo, token, tempoMs: TEMPO_FOTO_MS })
}

export function removerFoto(token: string, id: number): Promise<Barreira> {
  return pedir(`/api/barreiras/${id}/foto`, { metodo: 'DELETE', token })
}

export function listarFila(
  token: string,
  filtros: { status?: StatusBarreira; limite?: number; antes_de?: number },
  sinal?: AbortSignal,
): Promise<Barreira[]> {
  return pedir('/api/admin/barreiras', { consulta: filtros, token, sinal })
}

export function obterBarreiraAdmin(token: string, id: number, sinal?: AbortSignal): Promise<Barreira> {
  return pedir(`/api/admin/barreiras/${id}`, { token, sinal })
}

export function mudarStatus(token: string, id: number, status: StatusBarreira, motivo: string): Promise<Barreira> {
  return pedir(`/api/admin/barreiras/${id}/status`, { metodo: 'POST', corpo: { status, motivo }, token })
}

export function listarEventos(token: string, id: number, sinal?: AbortSignal): Promise<Evento[]> {
  return pedir(`/api/admin/barreiras/${id}/eventos`, { token, sinal })
}

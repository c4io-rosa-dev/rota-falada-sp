import type { components } from './types.gen'
import { ErroApi } from './base'
import { pedir } from './http'

export { apiUrl } from './base'

export type Fonte = components['schemas']['FonteOut']
export type Endereco = components['schemas']['EnderecoOut']
export type RotaIn = components['schemas']['RotaIn']
export type RotaOut = components['schemas']['RotaOut']

/** Teto do POST depois de o servidor acordar: ORS tem 15 s por chamada e o fallback é local. */
export const TEMPO_ROTA_MS = 60_000
export const MSG_ROTA_INDISPONIVEL =
  'O serviço de rotas não respondeu agora. Isso não quer dizer que a rota não existe.'

export function listarFontes(sinal?: AbortSignal): Promise<Fonte[]> {
  return pedir('/api/fontes', { sinal })
}

// o endereço digitado e o GPS ficam na URL: no cache do navegador, sobreviveriam a fechar a aba (D1)
export function buscarEnderecos(q: string, sinal?: AbortSignal): Promise<Endereco[]> {
  return pedir('/api/geocode', { consulta: { q }, sinal, cache: 'no-store' })
}

export function enderecoDoPonto(lat: number, lon: number, sinal?: AbortSignal): Promise<Endereco> {
  return pedir('/api/geocode/reverso', { consulta: { lat, lon }, sinal, cache: 'no-store' })
}

export async function calcularRota(pedido: RotaIn, sinal?: AbortSignal, aoSair?: () => void): Promise<RotaOut> {
  try {
    return await pedir<RotaOut>('/api/rotas', { metodo: 'POST', corpo: pedido, sinal, tempoMs: TEMPO_ROTA_MS, aoSair })
  } catch (erro) {
    // o detail do 503 de rota repete o texto do 404 (services/rota.py); nunca exibir
    if (erro instanceof ErroApi && erro.tipo === 'indisponivel') {
      throw new ErroApi('indisponivel', MSG_ROTA_INDISPONIVEL, erro.status)
    }
    throw erro
  }
}

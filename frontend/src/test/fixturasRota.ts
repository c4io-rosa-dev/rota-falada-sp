import type { Endereco, RotaOut } from '../api/client'
import type { Passo } from '../dados/passo'

export const LINHA = {
  type: 'LineString',
  coordinates: [
    [-46.635, -23.59],
    [-46.634, -23.59],
  ],
}

export function passo(ordem: number, extras: Partial<Passo> = {}): Passo {
  return {
    ordem,
    instrucao: `Siga por Rua ${ordem}`,
    distancia_m: 100,
    duracao_s: 120,
    direcao: 'siga',
    largura_m: 1.5,
    largura_medida: true,
    declividade_pct: 3,
    declividade_medida: true,
    guia: 'transponivel',
    is_degrau: false,
    barreiras_proximas: [],
    fonte: 'osm',
    data_referencia: '2026-10-12',
    geometria: LINHA,
    ...extras,
  }
}

export const ROTA: RotaOut = {
  passos: [passo(1), passo(2)],
  distancia_m: 200,
  duracao_s: 240,
  avisos: [],
  nivel_exigencia_atendido: 6,
  motor: 'ors',
  fontes: ['osm', 'geosampa'],
  geometria: LINHA,
  cache: false,
}

export function endereco(id: number, rotulo: string, extras: Partial<Endereco> = {}): Endereco {
  return { id, tipo: 'endereco', rotulo, lat: -23.59 + id / 1000, lon: -46.635, aproximado: false, ...extras }
}

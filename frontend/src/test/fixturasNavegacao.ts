import type { RotaOut } from '../api/client'
import { criarRegua, deslocar } from '../dados/navegacao/regua'
import type { PontoLatLng } from '../dados/rotaGeo'
import { passo } from './fixturasRota'

/** Rota em L perto da Paulista, construída em metros (spec 10.1). */
const A: PontoLatLng = [-23.5617, -46.656]
export const REGUA_L = criarRegua(A[0])

const MEIO_AB = deslocar(REGUA_L, A, 0, 60)
const B = deslocar(REGUA_L, A, 0, 120)
const C = deslocar(REGUA_L, B, -80, 0)
const D = deslocar(REGUA_L, C, 0, 8)
const E = deslocar(REGUA_L, D, -100, 0)

export const PONTOS_L = { A, B, C, D, E }

function linha(...pontos: PontoLatLng[]) {
  return { type: 'LineString', coordinates: pontos.map(([lat, lng]) => [lng, lat]) }
}

const PASSOS_L = [
  passo(1, { instrucao: 'Siga para leste em direção a Alameda Jaú', direcao: 'siga', distancia_m: 120, geometria: linha(A, MEIO_AB, B) }),
  passo(2, { instrucao: 'Vire à direita em direção a Rua Augusta', direcao: 'vire_direita', distancia_m: 80, geometria: linha(B, C) }),
  passo(3, { instrucao: 'Vire à esquerda em direção a Rua Peixoto Gomide', direcao: 'vire_esquerda', distancia_m: 8, geometria: linha(C, D) }),
  passo(4, { instrucao: 'Siga em direção a Rua Peixoto Gomide', direcao: 'siga', distancia_m: 0, geometria: linha(D, D) }),
  passo(5, {
    instrucao: 'Vire à direita em direção a Alameda Santos',
    direcao: 'vire_direita',
    distancia_m: 100,
    geometria: linha(D, E),
    is_degrau: true,
    guia: 'nao_transponivel',
  }),
]

export const ROTA_L: RotaOut = {
  passos: PASSOS_L,
  distancia_m: 308,
  duracao_s: 370,
  avisos: [],
  nivel_exigencia_atendido: 6,
  motor: 'ors',
  fontes: ['osm', 'geosampa'],
  geometria: linha(A, MEIO_AB, B, C, D, E),
  cache: false,
}

export const ROTA_L_SO_GEOMETRIA_TOTAL: RotaOut = {
  ...ROTA_L,
  passos: PASSOS_L.map((p) => ({ ...p, geometria: {} })),
}

export const ROTA_SEM_GEOMETRIA: RotaOut = {
  ...ROTA_L_SO_GEOMETRIA_TOTAL,
  geometria: {},
}

/**
 * Rota em U: 100 m para leste, atravessa a rua (15 m para sul) e volta 100 m para oeste pela
 * outra calçada. As duas pernas ficam a 15 m uma da outra e o fim fica a 15 m do começo: o caso
 * em que o encaixe pela menor distância lateral pula para a perna de volta.
 */
const U_A: PontoLatLng = A
const U_B = deslocar(REGUA_L, U_A, 0, 100)
const U_C = deslocar(REGUA_L, U_B, -15, 0)
const U_D = deslocar(REGUA_L, U_C, 0, -100)

export const PONTOS_U = { A: U_A, B: U_B, C: U_C, D: U_D }

export const ROTA_U: RotaOut = {
  passos: [
    passo(1, { instrucao: 'Siga para leste em direção a Rua da Ida', direcao: 'siga', distancia_m: 100, geometria: linha(U_A, U_B) }),
    passo(2, { instrucao: 'Vire à direita em direção a Rua da Travessia', direcao: 'vire_direita', distancia_m: 15, geometria: linha(U_B, U_C) }),
    passo(3, { instrucao: 'Vire à direita em direção a Rua da Volta', direcao: 'vire_direita', distancia_m: 100, geometria: linha(U_C, U_D) }),
  ],
  distancia_m: 215,
  duracao_s: 258,
  avisos: [],
  nivel_exigencia_atendido: 6,
  motor: 'ors',
  fontes: ['osm'],
  geometria: linha(U_A, U_B, U_C, U_D),
  cache: false,
}

import { expect, type BrowserContext, type Page, type Request } from '@playwright/test'
import { escolherPorTeclado, json, simular } from './apoio'

/**
 * Rota em L com geometria por passo: cópia em JSON da ROTA_L de src/test/fixturasNavegacao.ts
 * (spec 10.1), perto da Paulista. A ida A → B tem 120 m para leste, B → C 80 m para sul,
 * C → D 8 m para leste, o passo 4 é degenerado e D → E tem 100 m para sul.
 */
type Ponto = [number, number] // [lat, lng]

export const PONTOS: Record<'A' | 'M' | 'B' | 'C' | 'D' | 'E', Ponto> = {
  A: [-23.5617, -46.656],
  M: [-23.5617, -46.65541133],
  B: [-23.5617, -46.654822659],
  C: [-23.562419457, -46.654822659],
  D: [-23.562419457, -46.65474417],
  E: [-23.563318779, -46.65474417],
}

const linha = (...pontos: Ponto[]) => ({ type: 'LineString', coordinates: pontos.map(([lat, lng]) => [lng, lat]) })

function passo(ordem: number, instrucao: string, direcao: string, distancia_m: number, geometria: unknown, extras = {}) {
  return {
    ordem,
    instrucao,
    distancia_m,
    duracao_s: Math.round(distancia_m * 1.2),
    direcao,
    largura_m: 1.5,
    largura_medida: true,
    declividade_pct: 3,
    declividade_medida: true,
    guia: 'transponivel',
    is_degrau: false,
    barreiras_proximas: [],
    fonte: 'osm',
    data_referencia: '2026-10-12',
    geometria,
    ...extras,
  }
}

const { A, M, B, C, D, E } = PONTOS

export const ROTA_NAVEGAVEL = {
  passos: [
    passo(1, 'Siga para leste em direção a Alameda Jaú', 'siga', 120, linha(A, M, B)),
    passo(2, 'Vire à direita em direção a Rua Augusta', 'vire_direita', 80, linha(B, C)),
    passo(3, 'Vire à esquerda em direção a Rua Peixoto Gomide', 'vire_esquerda', 8, linha(C, D)),
    passo(4, 'Siga em direção a Rua Peixoto Gomide', 'siga', 0, linha(D, D)),
    passo(5, 'Vire à direita em direção a Alameda Santos', 'vire_direita', 100, linha(D, E), { is_degrau: true, guia: 'nao_transponivel' }),
  ],
  distancia_m: 308,
  duracao_s: 370,
  avisos: [],
  nivel_exigencia_atendido: 6,
  motor: 'ors',
  fontes: ['osm', 'geosampa'],
  geometria: linha(A, M, B, C, D, E),
  cache: false,
}

const TRECHOS: [Ponto, Ponto, number][] = [
  [A, B, 120],
  [B, C, 80],
  [C, D, 8],
  [D, E, 100],
]

/** O ponto a m metros do início, ao longo da linha (interpolação simples; o trecho é curto). */
export function aoLongo(m: number): Ponto {
  let resto = Math.max(0, m)
  for (const [de, ate, tamanho] of TRECHOS) {
    if (resto <= tamanho) {
      const f = resto / tamanho
      return [de[0] + (ate[0] - de[0]) * f, de[1] + (ate[1] - de[1]) * f]
    }
    resto -= tamanho
  }
  return E
}

/** Metros para norte e leste a partir de um ponto (Terra esférica, como a régua do app). */
export function deslocar(p: Ponto, norteM: number, lesteM: number): Ponto {
  const ky = (6_371_000 * Math.PI) / 180
  const kx = ky * Math.cos((p[0] * Math.PI) / 180)
  return [p[0] + norteM / ky, p[1] + lesteM / kx]
}

export async function posicao(context: BrowserContext, p: Ponto, accuracy = 5) {
  await context.setGeolocation({ latitude: p[0], longitude: p[1], accuracy })
}

/** O próprio site (vite preview); todo o resto é saída para fora do aparelho. */
const SITE = 'http://localhost:4173'

/**
 * Toda requisição que sai do site (API, tiles, Supabase, beacons, qualquer origem), na ordem:
 * a prova de que nada sai antes do Recalcular. Só o pré-voo OPTIONS fica de fora.
 */
export function registrarPedidos(page: Page): Request[] {
  const pedidos: Request[] = []
  page.on('request', (r) => {
    const url = r.url()
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith(SITE)) return
    if (r.method() !== 'OPTIONS') pedidos.push(r)
  })
  return pedidos
}

/** Calcula a rota em L em /rota e entra na navegação pelo botão da ficha. */
export async function abrirNavegacao(page: Page) {
  await simular(page, { 'POST /api/rotas': (r) => json(r, ROTA_NAVEGAVEL) })
  await page.goto('/rota')
  await escolherPorTeclado(page)
  await page.getByRole('button', { name: 'Calcular rota' }).click()
  await page.getByRole('link', { name: 'Iniciar navegação guiada' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Navegação guiada' })).toBeFocused()
}

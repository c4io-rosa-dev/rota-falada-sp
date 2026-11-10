/**
 * Guardas da LGPD na navegação guiada (spec 8). A parte estática lê o código-fonte, como o
 * regiaoUnica.test.ts; a parte dinâmica está em navegacaoPrivacidadeTela.test.tsx.
 */
import CABECALHOS from '../../public/_headers?raw'

const CRUS = import.meta.glob(
  [
    '../dados/navegacao/*.ts',
    '../componentes/navegacao/*.{ts,tsx}',
    '../pages/Navegar.tsx',
    // o mapa da navegação (spec do mapa próprio, seção 11): as mesmas regras valem para ele
    '../componentes/mapa/MapaNavegacao.tsx',
    // a bússola da seta da pessoa (emenda de 10/11/2026): mesma regra, nada gravado nem enviado
    '../componentes/mapa/useBussola.ts',
    '../componentes/mapa/apoioMapaAberto.ts',
    '../componentes/mapa/MotorMapaNavegacao.ts',
    '../componentes/mapa/estiloMapaNavegacao.ts',
    '../componentes/mapa/arquivoMapa.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

// sem test/: um temporário criado ou apagado por outro fluxo durante a rodada derrubaria a suíte (ENOENT)
const TODOS = import.meta.glob(['../**/*.{ts,tsx}', '!../test/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('o código da navegação não grava nem registra posição', () => {
  const fontes = Object.entries(CRUS).map(([caminho, texto]) => ({ caminho: caminho.replace('../', ''), texto }))

  it('lê o código de verdade', () => {
    const caminhos = fontes.map((f) => f.caminho)
    expect(caminhos).toContain('dados/navegacao/navegacao.ts')
    expect(caminhos).toContain('componentes/navegacao/useNavegacao.ts')
    expect(caminhos).toContain('pages/Navegar.tsx')
    for (const mapa of ['MapaNavegacao.tsx', 'useBussola.ts', 'apoioMapaAberto.ts', 'MotorMapaNavegacao.ts', 'estiloMapaNavegacao.ts', 'arquivoMapa.ts']) {
      expect(caminhos).toContain(`componentes/mapa/${mapa}`)
    }
    expect(caminhos).toContain('dados/navegacao/mapaNavegacao.ts')
    expect(caminhos).toContain('dados/navegacao/direcaoSeta.ts')
    expect(caminhos).toContain('componentes/navegacao/useTelaCheia.ts')
  })

  it('nenhum localStorage, sessionStorage, indexedDB ou console', () => {
    const achados = fontes
      .filter((f) => /localStorage|sessionStorage|indexedDB|console\./.test(f.texto))
      .map((f) => f.caminho)
    expect(achados).toEqual([])
  })

  it('a página nunca grava a sessão da rota (rota recalculada fica só na memória)', () => {
    expect(fontes.filter((f) => /gravarSessaoRota|guardarPassoDeRetorno|history\.(push|replace)State/.test(f.texto)).map((f) => f.caminho)).toEqual([])
  })

  /** URL, estado de navegação e saídas de rede fora do client da API (spec 8). */
  const proibido = /navigate\([^)]*state|navegar\([^)]*state|setSearchParams|location\.state|sendBeacon|\bfetch\(|XMLHttpRequest|WebSocket|EventSource/

  it('nada vai para a URL nem para o estado de navegação, e nenhuma saída de rede própria (spec 8)', () => {
    expect(fontes.filter((f) => proibido.test(f.texto)).map((f) => f.caminho)).toEqual([])
  })

  it('a guarda estática pega cada forma proibida (o regex não é vazio)', () => {
    for (const amostra of [
      "navegar('/rota', { state: { lat } })",
      'setSearchParams({ lat })',
      'const s = location.state',
      "navigator.sendBeacon('/x', dados)",
      "fetch('/x')",
    ]) {
      expect(amostra).toMatch(proibido)
    }
    expect("navegar('/rota')").not.toMatch(proibido)
  })

  it('o texto do modo demonstração só existe atrás da variável de build', () => {
    expect(Object.keys(TODOS).filter((c) => c.startsWith('./') || c.includes('/test/'))).toEqual([])
    const fora = Object.entries(TODOS)
      .map(([caminho, texto]) => ({ caminho: caminho.replace('../', ''), texto }))
      .filter((f) => f.texto.includes('Modo demonstração'))
      .filter((f) => !/import\.meta\.env\.VITE_PERMITIR_SIMULACAO === 'true'\s*\?\s*'Modo demonstração/.test(f.texto))
      .map((f) => f.caminho)
    expect(fora).toEqual([])
  })

  it('a simulação só é importada sob demanda, dentro da guarda', () => {
    const pagina = CRUS['../pages/Navegar.tsx']
    expect(pagina).not.toMatch(/^import .*posicaoSimulada/m)
    expect(pagina).toMatch(/import\.meta\.env\.VITE_PERMITIR_SIMULACAO === 'true'[\s\S]*import\('\.\.\/dados\/navegacao\/posicaoSimulada'\)/)
  })
})

describe('o mapa da navegação só chega quando a pessoa abre (spec do mapa próprio, seções 10.4 e 11)', () => {
  /** import estático (não import type) de uma biblioteca de mapa. */
  const BIBLIOTECA_ESTATICA = /^import\s+(?!type\b)[^'"]*?from\s+['"](maplibre-gl|pmtiles|@protomaps\/basemaps)(\/[^'"]*)?['"]/m
  /** import estático do motor: só o tipo pode ser importado pela casca. */
  const MOTOR_ESTATICO = /^import\s+(?!type\b)[^'"]*?from\s+['"][^'"]*MotorMapaNavegacao['"]/m

  it('a guarda pega cada forma proibida e deixa passar o import type', () => {
    for (const amostra of [
      "import maplibregl from 'maplibre-gl'",
      "import { Map } from 'maplibre-gl'",
      "import { PMTiles, Protocol } from 'pmtiles'",
      "import { layers } from '@protomaps/basemaps'",
      "import url from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'",
      "import {\n  Map,\n} from 'maplibre-gl'",
    ]) {
      expect(amostra).toMatch(BIBLIOTECA_ESTATICA)
    }
    expect("import type { Map } from 'maplibre-gl'").not.toMatch(BIBLIOTECA_ESTATICA)
    expect("import { criarMotor } from './MotorMapaNavegacao'").toMatch(MOTOR_ESTATICO)
    expect("import type { MotorMapa } from './MotorMapaNavegacao'").not.toMatch(MOTOR_ESTATICO)
    // sem ponto e vírgula no projeto: a guarda não pode atravessar um import anterior
    expect("import { Placa } from '../Placa'\nimport type { MotorMapa } from './MotorMapaNavegacao'").not.toMatch(MOTOR_ESTATICO)
  })

  it.each(['../pages/Navegar.tsx', '../componentes/mapa/MapaNavegacao.tsx'])('%s não importa maplibre-gl, pmtiles nem @protomaps/basemaps', (caminho) => {
    const texto = CRUS[caminho]
    expect(texto).toBeTruthy()
    expect(texto).not.toMatch(BIBLIOTECA_ESTATICA)
    expect(texto).not.toMatch(MOTOR_ESTATICO)
  })

  it('a página usa a casca do mapa e a casca carrega o motor por import() à mão', () => {
    expect(CRUS['../pages/Navegar.tsx']).toMatch(/^import \{ MapaNavegacao \} from '\.\.\/componentes\/mapa\/MapaNavegacao'$/m)
    expect(CRUS['../componentes/mapa/MapaNavegacao.tsx']).toContain("import('./MotorMapaNavegacao')")
  })
})

describe('cabeçalhos do site (public/_headers)', () => {
  const linha = (nome: string) =>
    CABECALHOS.split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.startsWith(`${nome}:`))

  it('Permissions-Policy libera só para o próprio site a localização, a tela ligada e os três sensores da bússola', () => {
    // decisão do dono (emenda de 10/11/2026 da spec do mapa): a seta da pessoa usa a bússola do aparelho.
    // O rumo do MAPA continua vindo da corda da rota. Nada é liberado para terceiros: só (self).
    const politica = linha('Permissions-Policy')
    expect(politica).toBe(
      'Permissions-Policy: geolocation=(self), screen-wake-lock=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self)',
    )
    expect(politica).not.toMatch(/\*|https?:/)
  })

  it('a CSP não muda: nada novo na rede', () => {
    expect(linha('Content-Security-Policy')).toBe(
      "Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org https://fiyuppcpbcdlnptqaigg.supabase.co; connect-src 'self' https://rota-falada-api.onrender.com https://fiyuppcpbcdlnptqaigg.supabase.co; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    )
  })
})

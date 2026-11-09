/**
 * Guardas da LGPD na navegação guiada (spec 8). A parte estática lê o código-fonte, como o
 * regiaoUnica.test.ts; a parte dinâmica está em navegacaoPrivacidade.test.tsx.
 */
import CABECALHOS from '../../public/_headers?raw'

const CRUS = import.meta.glob(['../dados/navegacao/*.ts', '../componentes/navegacao/*.{ts,tsx}', '../pages/Navegar.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

// sem test/: um temporário criado ou apagado por outro fluxo durante a rodada derrubaria a suíte (ENOENT)
const TODOS = import.meta.glob(['../**/*.{ts,tsx}', '!../test/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('o código da navegação não grava nem registra posição', () => {
  const fontes = Object.entries(CRUS).map(([caminho, texto]) => ({ caminho: caminho.replace('../', ''), texto }))

  it('lê o código de verdade', () => {
    const caminhos = fontes.map((f) => f.caminho)
    expect(caminhos).toContain('dados/navegacao/navegacao.ts')
    expect(caminhos).toContain('componentes/navegacao/useNavegacao.ts')
    expect(caminhos).toContain('pages/Navegar.tsx')
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

describe('cabeçalhos do site (public/_headers)', () => {
  const linha = (nome: string) =>
    CABECALHOS.split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.startsWith(`${nome}:`))

  it('Permissions-Policy libera só para o próprio site a localização e a tela ligada', () => {
    expect(linha('Permissions-Policy')).toBe('Permissions-Policy: geolocation=(self), screen-wake-lock=(self)')
  })

  it('a CSP não muda: nada novo na rede', () => {
    expect(linha('Content-Security-Policy')).toBe(
      "Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org https://fiyuppcpbcdlnptqaigg.supabase.co; connect-src 'self' https://rota-falada-api.onrender.com https://fiyuppcpbcdlnptqaigg.supabase.co; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    )
  })
})

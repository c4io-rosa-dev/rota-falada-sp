// Gate: Lighthouse de acessibilidade >= 95 em cada página. Precisa do `npm run preview` no ar.
// Lighthouse só vê o estado inicial; os outros estados são do axe, nos testes e2e/.
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:4173'
const PAGINAS = (process.env.PAGINAS ?? '/,/rota,/fontes,/acessibilidade,/barreiras,/barreiras/nova,/entrar').split(',')
const META = 95
const SAIDA = 'lighthouse-saida.json'

let falhou = false
for (const pagina of PAGINAS) {
  execFileSync(
    'npx',
    [
      '--yes',
      'lighthouse@12.8.2',
      `${BASE}${pagina}`,
      '--only-categories=accessibility',
      '--output=json',
      `--output-path=${SAIDA}`,
      '--quiet',
      '--chrome-flags=--headless=new',
    ],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  )
  const nota = Math.round(JSON.parse(readFileSync(SAIDA, 'utf-8')).categories.accessibility.score * 100)
  if (nota < META) falhou = true
  console.log(`${nota < META ? 'ABAIXO' : 'ok'}\t${nota}\t${pagina}`)
}
rmSync(SAIDA, { force: true })
process.exit(falhou ? 1 : 0)

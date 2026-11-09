// Compara o gzip de cada chunk de dist/assets com o teto do spec (seção de bundle). Rodar depois do build.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const KB = 1024
// os nomes dos chunks compartilhados mudam com o build; o teto vale por arquivo
const TETO_ENTRADA = 95 * KB
const TETO_CHUNK = 50 * KB

const pasta = join('dist', 'assets')
let falhou = false
for (const arquivo of readdirSync(pasta).filter((a) => a.endsWith('.js'))) {
  const tamanho = gzipSync(readFileSync(join(pasta, arquivo))).length
  const excedeu = tamanho > (arquivo.startsWith('index-') ? TETO_ENTRADA : TETO_CHUNK)
  if (excedeu) falhou = true
  console.log(`${excedeu ? 'EXCEDEU' : 'ok'}\t${(tamanho / KB).toFixed(1)} KB\t${arquivo}`)
}
// o Leaflet nunca pode vazar para a entrada
const entrada = readdirSync(pasta).find((a) => a.startsWith('index-') && a.endsWith('.js'))
if (entrada && readFileSync(join(pasta, entrada), 'utf-8').includes('leaflet-container')) {
  console.log('EXCEDEU\tLeaflet no chunk de entrada')
  falhou = true
}
// a simulação da navegação guiada só existe no build de teste ou de demonstração (spec 10.2):
// no build de produção, nem o texto da faixa nem o módulo da posição simulada podem entrar
const SO_NA_DEMONSTRACAO = ['Modo demonstração', 'aba-oculta-no-meio', 'precisao-ruim-40m']
for (const arquivo of readdirSync(pasta)) {
  if (arquivo.startsWith('posicaoSimulada') || arquivo.startsWith('simulacao')) {
    console.log(`EXCEDEU\tchunk da simulação no build: ${arquivo}`)
    falhou = true
    continue
  }
  if (!/\.(js|css|html)$/.test(arquivo)) continue
  const texto = readFileSync(join(pasta, arquivo), 'utf-8')
  for (const marca of SO_NA_DEMONSTRACAO) {
    if (texto.includes(marca)) {
      console.log(`EXCEDEU\t"${marca}" no build (${arquivo}): rode o build sem VITE_PERMITIR_SIMULACAO`)
      falhou = true
    }
  }
}
process.exit(falhou ? 1 : 0)

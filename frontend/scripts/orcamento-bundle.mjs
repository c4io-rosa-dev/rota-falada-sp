// Compara o gzip de cada chunk de dist/assets com o teto do spec (seção de bundle). Rodar depois do build.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { referenciasEstaticasAoMotor } from './regrasOrcamento.mjs'

const KB = 1024
// os nomes dos chunks compartilhados mudam com o build; o teto vale por arquivo
const TETO_ENTRADA = 95 * KB
const TETO_CHUNK = 50 * KB
// a página da navegação guiada carrega no celular, na rua: a casca do mapa não pode engordá-la
const TETO_NAVEGAR = 16 * KB
/**
 * Exceções nomeadas (spec do mapa próprio, seção 12): o motor do mapa (MapLibre + pmtiles) e o
 * worker do MapLibre só baixam quando a pessoa abre o mapa. Nunca subir estes tetos sem o dono.
 *
 * Medida de referência (gzip, build de produção de 09/11/2026, maplibre-gl 6.16.0, pmtiles 4.5.0,
 * @protomaps/basemaps 5.7.2): motor 295,5 KB de 300 (o maplibre-gl sozinho é uns 288 KB; o
 * @protomaps/basemaps, uns 6 KB), worker do MapLibre 144,9 KB de 150 e Navegar 13,9 KB de 16.
 * A folga é pequena: as três versões ficam fixadas no package.json por causa destes tetos. Antes
 * de subir qualquer uma delas (mesmo um patch), rode `npm run build && npm run orcamento` num branch e compare com a medida acima; se
 * passar do teto, leve ao dono antes de mudar o número.
 */
const EXCECOES = [
  { prefixo: 'MotorMapaNavegacao-', teto: 300 * KB },
  { prefixo: 'maplibre-gl-worker-', teto: 150 * KB },
]

function tetoDe(arquivo) {
  const excecao = EXCECOES.find((e) => arquivo.startsWith(e.prefixo))
  if (excecao) return excecao.teto
  if (arquivo.startsWith('index-')) return TETO_ENTRADA
  if (arquivo.startsWith('Navegar-')) return TETO_NAVEGAR
  return TETO_CHUNK
}

const pasta = join('dist', 'assets')
const arquivos = readdirSync(pasta)
const scripts = arquivos.filter((a) => /\.m?js$/.test(a))
let falhou = false
for (const arquivo of scripts) {
  const tamanho = gzipSync(readFileSync(join(pasta, arquivo))).length
  const teto = tetoDe(arquivo)
  const excedeu = tamanho > teto
  if (excedeu) falhou = true
  console.log(`${excedeu ? 'EXCEDEU' : 'ok'}\t${(tamanho / KB).toFixed(1)} KB\t(teto ${teto / KB} KB)\t${arquivo}`)
}
// as exceções precisam existir: um nome novo escaparia do teto delas e cairia no de 50 KB sem aviso
for (const { prefixo } of EXCECOES) {
  if (!scripts.some((a) => a.startsWith(prefixo))) {
    console.log(`EXCEDEU\tnenhum arquivo ${prefixo}* no build: a exceção nomeada não mede nada`)
    falhou = true
  }
}
// o Leaflet nunca pode vazar para a entrada
const entrada = arquivos.find((a) => a.startsWith('index-') && a.endsWith('.js'))
if (entrada && readFileSync(join(pasta, entrada), 'utf-8').includes('leaflet-container')) {
  console.log('EXCEDEU\tLeaflet no chunk de entrada')
  falhou = true
}
// o MapLibre e o pmtiles só chegam com o mapa aberto: nem a entrada nem a página da navegação os trazem
const MARCAS_DO_MAPA = ['maplibregl', 'PMTiles']
for (const arquivo of scripts.filter((a) => a.startsWith('index-') || a.startsWith('Navegar-'))) {
  const texto = readFileSync(join(pasta, arquivo), 'utf-8')
  for (const marca of MARCAS_DO_MAPA) {
    if (texto.includes(marca)) {
      console.log(`EXCEDEU\t"${marca}" em ${arquivo}: o motor do mapa só pode vir por import()`)
      falhou = true
    }
  }
  // nem por um import estático do chunk do motor, que não traz as marcas acima no texto
  for (const achado of referenciasEstaticasAoMotor(texto)) {
    console.log(`EXCEDEU\t${achado} em ${arquivo}: o motor do mapa só pode vir por import()`)
    falhou = true
  }
}
// os avisos de licença de terceiros acompanham o site (DATA-LICENSES.md): o arquivo existe e cita o mapa
const AVISOS = join('dist', 'licencas-terceiros.txt')
const avisos = existsSync(AVISOS) ? readFileSync(AVISOS, 'utf-8') : ''
for (const pacote of ['react', 'leaflet', 'maplibre-gl', 'pmtiles', '@protomaps/basemaps']) {
  if (!avisos.includes(`- ${pacote} `)) {
    console.log(`EXCEDEU\t${pacote} faltando em ${AVISOS}: o aviso de licença precisa ir com o site`)
    falhou = true
  }
}
// a simulação da navegação guiada só existe no build de teste ou de demonstração (spec 10.2):
// no build de produção, nem o texto da faixa nem o módulo da posição simulada podem entrar
const SO_NA_DEMONSTRACAO = ['Modo demonstração', 'aba-oculta-no-meio', 'precisao-ruim-40m']
for (const arquivo of arquivos) {
  if (arquivo.startsWith('posicaoSimulada') || arquivo.startsWith('simulacao')) {
    console.log(`EXCEDEU\tchunk da simulação no build: ${arquivo}`)
    falhou = true
    continue
  }
  if (!/\.(m?js|css|html)$/.test(arquivo)) continue
  const texto = readFileSync(join(pasta, arquivo), 'utf-8')
  for (const marca of SO_NA_DEMONSTRACAO) {
    if (texto.includes(marca)) {
      console.log(`EXCEDEU\t"${marca}" no build (${arquivo}): rode o build sem VITE_PERMITIR_SIMULACAO`)
      falhou = true
    }
  }
}
process.exit(falhou ? 1 : 0)

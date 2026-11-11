/**
 * Fixture PMTiles v3 escrita em código para os testes do mapa da navegação (spec do mapa, seção 13).
 *
 * Usada pelo Vitest e importada pelo Playwright (e2e/apoioMapa.ts), por isso só usa Uint8Array,
 * DataView e TextEncoder: nada de Buffer, fs ou outra API do Node, e nenhuma dependência.
 *
 * O arquivo gerado tem: cabeçalho v3 de 127 bytes, diretório raiz com uma única entrada, metadados `{}`
 * e um tile MVT feito à mão: camada `earth` com um quadrado que cobre o tile e camada `roads` com uma
 * grade de ruas `minor_road` com nome (`name` e `name:pt`), para o estilo desenhar rótulos e pedir a
 * letra local. Compressões `none`.
 *
 * O arquivo é servido pelo próprio Worker do site (worker/servirMapa.ts) com `bucketDoArquivo`, um
 * bucket R2 falso: o E2E passa pelo código de verdade do /mapa/* (Range, ETag, cabeçalhos).
 * Referências: especificação PMTiles v3 (github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md) e
 * Mapbox Vector Tile 2.1 (github.com/mapbox/vector-tile-spec).
 */

import type { BucketMapa } from '../../worker/tipos'

export type Limites = [oeste: number, sul: number, leste: number, norte: number]

export interface OpcoesPmtilesFalso {
  z: number
  x: number
  y: number
  limites: Limites
}

/** ETag fixo da fixture (o Worker real devolve o httpEtag do R2). */
export const ETAG_FALSO = '"pmtiles-falso-v1"'

const TAMANHO_CABECALHO = 127
const EXTENT = 4096

// Valores da especificação v3.
const COMPRESSAO_NENHUMA = 1
const TIPO_MVT = 1

/** Grava um inteiro sem sinal como varint (protobuf e diretório PMTiles). Aceita valores até 2^53. */
function varint(valor: number, saida: number[]): void {
  let v = valor
  while (v >= 0x80) {
    saida.push((v % 0x80) | 0x80)
    v = Math.floor(v / 0x80)
  }
  saida.push(v)
}

const zigzag = (n: number) => (n < 0 ? -2 * n - 1 : 2 * n)

/** Chave de campo protobuf: (número << 3) | tipo. Tipo 0 = varint, 2 = length-delimited. */
function chave(numero: number, tipo: 0 | 2, saida: number[]): void {
  varint(numero * 8 + tipo, saida)
}

function campoVarint(numero: number, valor: number, saida: number[]): void {
  chave(numero, 0, saida)
  varint(valor, saida)
}

function campoBytes(numero: number, bytes: ArrayLike<number>, saida: number[]): void {
  chave(numero, 2, saida)
  varint(bytes.length, saida)
  for (let i = 0; i < bytes.length; i++) saida.push(bytes[i])
}

/** Comando de geometria MVT: (quantidade << 3) | id. */
const comando = (id: 1 | 2 | 7, quantidade: number) => (quantidade << 3) | id

/** Nome das ruas da fixture: só letras do bloco latin, para pedir o arquivo latin do Archivo. */
export const NOME_RUA_FALSA = 'Rua da Fixtura'
/** Distância, em unidades do tile, entre as ruas da grade (16 por eixo). */
const PASSO_GRADE = 256

/** Camada `roads` (versão 2, extent 4096): uma feição LINESTRING com 32 partes, a grade de ruas. */
function camadaRuas(): number[] {
  const geometria: number[] = []
  let cx = 0
  let cy = 0
  const linha = (x0: number, y0: number, x1: number, y1: number) => {
    for (const v of [comando(1, 1), zigzag(x0 - cx), zigzag(y0 - cy), comando(2, 1), zigzag(x1 - x0), zigzag(y1 - y0)]) {
      varint(v, geometria)
    }
    cx = x1
    cy = y1
  }
  for (let k = 0; k < EXTENT / PASSO_GRADE; k++) {
    const meio = k * PASSO_GRADE + PASSO_GRADE / 2
    linha(0, meio, EXTENT, meio) // de oeste para leste
    linha(meio, 0, meio, EXTENT) // de norte para sul
  }

  const feicao: number[] = []
  // tags: kind=minor_road, name=NOME, name:pt=NOME, min_zoom=12 (índices em keys e values);
  // o min_zoom é o symbol-sort-key dos rótulos do Protomaps, como no arquivo real
  campoBytes(2, [0, 0, 1, 1, 2, 1, 3, 2], feicao)
  campoVarint(3, 2, feicao) // type = LINESTRING
  campoBytes(4, geometria, feicao)

  const texto = (t: string) => {
    const valor: number[] = []
    campoBytes(1, new TextEncoder().encode(t), valor) // string_value
    return valor
  }
  const camada: number[] = []
  campoVarint(15, 2, camada)
  campoBytes(1, new TextEncoder().encode('roads'), camada)
  campoBytes(2, feicao, camada)
  for (const chave of ['kind', 'name', 'name:pt', 'min_zoom']) campoBytes(3, new TextEncoder().encode(chave), camada)
  campoBytes(4, texto('minor_road'), camada)
  campoBytes(4, texto(NOME_RUA_FALSA), camada)
  const minZoom: number[] = []
  campoVarint(5, 12, minZoom) // uint_value
  campoBytes(4, minZoom, camada)
  campoVarint(5, EXTENT, camada)
  return camada
}

/** Tile MVT com a camada `earth` (um polígono quadrado que cobre o tile) e a camada `roads`. */
function tileMvt(): Uint8Array {
  // Anel externo em sentido horário na grade do tile (y para baixo): área positiva, como pede a spec MVT.
  const geometria: number[] = []
  for (const v of [
    comando(1, 1), zigzag(0), zigzag(0),
    comando(2, 3), zigzag(EXTENT), zigzag(0), zigzag(0), zigzag(EXTENT), zigzag(-EXTENT), zigzag(0),
    comando(7, 1),
  ]) {
    varint(v, geometria)
  }

  const feicao: number[] = []
  campoVarint(3, 3, feicao) // type = POLYGON
  campoBytes(4, geometria, feicao) // geometry (packed)

  const camada: number[] = []
  campoVarint(15, 2, camada) // version
  campoBytes(1, new TextEncoder().encode('earth'), camada) // name
  campoBytes(2, feicao, camada) // features
  campoVarint(5, EXTENT, camada) // extent

  const tile: number[] = []
  campoBytes(3, camada, tile) // layers
  campoBytes(3, camadaRuas(), tile)
  return Uint8Array.from(tile)
}

/** Gira o quadrante (curva de Hilbert), como no zxyToTileId da especificação. */
function girar(n: number, xy: [number, number], rx: number, ry: number): void {
  if (ry === 0) {
    if (rx === 1) {
      xy[0] = n - 1 - xy[0]
      xy[1] = n - 1 - xy[1]
    }
    const t = xy[0]
    xy[0] = xy[1]
    xy[1] = t
  }
}

/** TileId do PMTiles v3: tiles de todos os zooms anteriores + posição na curva de Hilbert do zoom z. */
export function idDoTile(z: number, x: number, y: number): number {
  const n = 2 ** z
  if (!Number.isInteger(z) || z < 0 || z > 26) throw new RangeError('zoom fora de 0..26')
  if (x < 0 || y < 0 || x >= n || y >= n) throw new RangeError('tile fora do zoom')
  const anteriores = (4 ** z - 1) / 3
  const xy: [number, number] = [x, y]
  let d = 0
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (xy[0] & s) > 0 ? 1 : 0
    const ry = (xy[1] & s) > 0 ? 1 : 0
    d += s * s * ((3 * rx) ^ ry)
    girar(s, xy, rx, ry)
  }
  return anteriores + d
}

/** Tile Web Mercator (x, y) que contém o ponto no zoom z. */
export function tileDoPonto(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z
  const rad = (lat * Math.PI) / 180
  const fx = ((lon + 180) / 360) * n
  const fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
  const prender = (v: number) => Math.min(n - 1, Math.max(0, Math.floor(v)))
  return { x: prender(fx), y: prender(fy) }
}

/** Diretório v3: quantidade, tileIds em delta, runLengths, tamanhos e offsets (offset + 1 na primeira entrada). */
function diretorio(tileId: number, tamanhoTile: number): Uint8Array {
  const saida: number[] = []
  varint(1, saida)
  varint(tileId, saida)
  varint(1, saida) // runLength
  varint(tamanhoTile, saida)
  varint(0 + 1, saida) // offset 0 dentro da seção de dados
  return Uint8Array.from(saida)
}

const e7 = (graus: number) => Math.round(graus * 1e7)

/** Gera um arquivo PMTiles v3 mínimo com um único tile MVT em (z, x, y). */
export function gerarPmtilesFalso({ z, x, y, limites }: OpcoesPmtilesFalso): Uint8Array {
  const tile = tileMvt()
  const raiz = diretorio(idDoTile(z, x, y), tile.length)
  const metadados = new TextEncoder().encode('{}')

  const raizOffset = TAMANHO_CABECALHO
  const metaOffset = raizOffset + raiz.length
  const folhasOffset = metaOffset + metadados.length
  const dadosOffset = folhasOffset // sem diretórios folha
  const total = dadosOffset + tile.length

  const arquivo = new Uint8Array(total)
  const dv = new DataView(arquivo.buffer)
  const u64 = (o: number, v: number) => dv.setBigUint64(o, BigInt(v), true)

  arquivo.set(new TextEncoder().encode('PMTiles'), 0)
  dv.setUint8(7, 3)
  u64(8, raizOffset)
  u64(16, raiz.length)
  u64(24, metaOffset)
  u64(32, metadados.length)
  u64(40, folhasOffset)
  u64(48, 0)
  u64(56, dadosOffset)
  u64(64, tile.length)
  u64(72, 1) // tiles endereçados
  u64(80, 1) // entradas
  u64(88, 1) // conteúdos distintos
  dv.setUint8(96, 1) // agrupado (clustered)
  dv.setUint8(97, COMPRESSAO_NENHUMA)
  dv.setUint8(98, COMPRESSAO_NENHUMA)
  dv.setUint8(99, TIPO_MVT)
  dv.setUint8(100, z)
  dv.setUint8(101, z)
  const [oeste, sul, leste, norte] = limites
  dv.setInt32(102, e7(oeste), true)
  dv.setInt32(106, e7(sul), true)
  dv.setInt32(110, e7(leste), true)
  dv.setInt32(114, e7(norte), true)
  dv.setUint8(118, z)
  dv.setInt32(119, e7((oeste + leste) / 2), true)
  dv.setInt32(123, e7((sul + norte) / 2), true)

  arquivo.set(raiz, raizOffset)
  arquivo.set(metadados, metaOffset)
  arquivo.set(tile, dadosOffset)
  return arquivo
}

/**
 * Bucket R2 falso com o arquivo da fixture, na interface mínima que o Worker usa. Com `vazio`, o
 * arquivo não existe (o Worker responde 404). O corpo de cada get é uma cópia, nunca uma vista.
 */
export function bucketDoArquivo(arquivo: Uint8Array, opcoes: { vazio?: boolean } = {}): BucketMapa {
  return {
    async head() {
      return opcoes.vazio ? null : { size: arquivo.length, httpEtag: ETAG_FALSO }
    },
    async get(_chave, op) {
      if (opcoes.vazio) return null
      const r = op?.range
      const fatia = r ? arquivo.slice(r.offset, r.offset + r.length) : arquivo.slice()
      return { size: arquivo.length, httpEtag: ETAG_FALSO, body: new Response(fatia).body as ReadableStream }
    },
  }
}

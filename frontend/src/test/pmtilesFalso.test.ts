import { responderMapa } from '../../worker/servirMapa'
import { bucketDoArquivo, gerarPmtilesFalso, idDoTile, NOME_RUA_FALSA, tileDoPonto, ETAG_FALSO } from './pmtilesFalso'

// Rota de e2e/apoioNavegacao.ts (ponto A) e uma caixa que a cobre.
const LIMITES: [number, number, number, number] = [-46.657, -23.5640, -46.6540, -23.5610]
const Z = 14

/** Leitor de varint (protobuf e diretório PMTiles usam o mesmo formato). */
function leitor(bytes: Uint8Array, inicio = 0, fim = bytes.length) {
  let pos = inicio
  return {
    get pos() {
      return pos
    },
    fim: () => pos >= fim,
    varint(): number {
      let valor = 0
      let mult = 1
      for (;;) {
        const b = bytes[pos++]
        valor += (b & 0x7f) * mult
        if (b < 0x80) return valor
        mult *= 128
      }
    },
    pular(n: number) {
      pos += n
    },
  }
}

function lerCabecalho(buf: Uint8Array) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const u64 = (o: number) => Number(dv.getBigUint64(o, true))
  return {
    magic: new TextDecoder().decode(buf.subarray(0, 7)),
    versao: dv.getUint8(7),
    raizOffset: u64(8),
    raizTamanho: u64(16),
    metaOffset: u64(24),
    metaTamanho: u64(32),
    folhasOffset: u64(40),
    folhasTamanho: u64(48),
    dadosOffset: u64(56),
    dadosTamanho: u64(64),
    tilesEnderecados: u64(72),
    entradas: u64(80),
    conteudos: u64(88),
    agrupado: dv.getUint8(96),
    compressaoInterna: dv.getUint8(97),
    compressaoTile: dv.getUint8(98),
    tipoTile: dv.getUint8(99),
    zoomMin: dv.getUint8(100),
    zoomMax: dv.getUint8(101),
    oeste: dv.getInt32(102, true),
    sul: dv.getInt32(106, true),
    leste: dv.getInt32(110, true),
    norte: dv.getInt32(114, true),
    zoomCentro: dv.getUint8(118),
    lonCentro: dv.getInt32(119, true),
    latCentro: dv.getInt32(123, true),
  }
}

/** Decodificação do diretório conforme a especificação v3 (colunas: ids em delta, runLength, tamanho, offset+1 ou 0). */
function lerDiretorio(bytes: Uint8Array) {
  const r = leitor(bytes)
  const n = r.varint()
  const entradas = Array.from({ length: n }, () => ({ tileId: 0, runLength: 0, tamanho: 0, offset: 0 }))
  let id = 0
  for (const e of entradas) {
    id += r.varint()
    e.tileId = id
  }
  for (const e of entradas) e.runLength = r.varint()
  for (const e of entradas) e.tamanho = r.varint()
  entradas.forEach((e, i) => {
    const v = r.varint()
    e.offset = v === 0 && i > 0 ? entradas[i - 1].offset + entradas[i - 1].tamanho : v - 1
  })
  expect(r.fim()).toBe(true)
  return entradas
}

type Campo = { numero: number; tipo: number; valor: number | Uint8Array }

/** Lê os campos de uma mensagem protobuf (só varint e length-delimited). */
function lerCampos(bytes: Uint8Array): Campo[] {
  const r = leitor(bytes)
  const campos: Campo[] = []
  while (!r.fim()) {
    const chave = r.varint()
    const numero = chave >> 3
    const tipo = chave & 7
    if (tipo === 0) campos.push({ numero, tipo, valor: r.varint() })
    else if (tipo === 2) {
      const n = r.varint()
      campos.push({ numero, tipo, valor: bytes.subarray(r.pos, r.pos + n) })
      r.pular(n)
    } else throw new Error(`tipo de campo inesperado ${tipo}`)
  }
  return campos
}

const pegar = (campos: Campo[], numero: number) => campos.filter((c) => c.numero === numero)

describe('idDoTile (curva de Hilbert do PMTiles v3)', () => {
  it('confere com os valores da especificação', () => {
    expect(idDoTile(0, 0, 0)).toBe(0)
    expect(idDoTile(1, 0, 0)).toBe(1)
    expect(idDoTile(1, 0, 1)).toBe(2)
    expect(idDoTile(1, 1, 1)).toBe(3)
    expect(idDoTile(1, 1, 0)).toBe(4)
    expect(idDoTile(2, 0, 0)).toBe(5)
    // último tile do z2 é o 20; primeiro do z3 é 21
    expect(idDoTile(3, 0, 0)).toBe(21)
  })
})

describe('tileDoPonto', () => {
  it('acha o tile de pontos conhecidos', () => {
    expect(tileDoPonto(0, 0, 1)).toEqual({ x: 1, y: 1 })
    expect(tileDoPonto(0, 0, 0)).toEqual({ x: 0, y: 0 })
    expect(tileDoPonto(85, -179.9, 2)).toEqual({ x: 0, y: 0 })
    expect(tileDoPonto(-85, 179.9, 2)).toEqual({ x: 3, y: 3 })
  })

  it('acha o tile z14 da rota de teste (Av. Paulista)', () => {
    expect(tileDoPonto(-23.5617, -46.656, 14)).toEqual({ x: 6068, y: 9295 })
    expect(tileDoPonto(-23.563318779, -46.65474417, 14)).toEqual({ x: 6068, y: 9295 })
  })
})

describe('gerarPmtilesFalso', () => {
  const { x, y } = tileDoPonto(-23.5617, -46.656, Z)
  const buf = gerarPmtilesFalso({ z: Z, x, y, limites: LIMITES })
  const cab = lerCabecalho(buf)

  it('escreve o cabeçalho v3 de 127 bytes campo a campo', () => {
    expect(buf).toBeInstanceOf(Uint8Array)
    expect(Array.from(buf.subarray(0, 7))).toEqual([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73])
    expect(cab.magic).toBe('PMTiles')
    expect(cab.versao).toBe(3)
    expect(cab.raizOffset).toBe(127)
    expect(cab.metaOffset).toBe(cab.raizOffset + cab.raizTamanho)
    expect(cab.metaTamanho).toBe(2)
    expect(cab.folhasOffset).toBe(cab.metaOffset + cab.metaTamanho)
    expect(cab.folhasTamanho).toBe(0)
    expect(cab.dadosOffset).toBe(cab.folhasOffset)
    expect(cab.dadosOffset + cab.dadosTamanho).toBe(buf.length)
    expect(cab.tilesEnderecados).toBe(1)
    expect(cab.entradas).toBe(1)
    expect(cab.conteudos).toBe(1)
    expect(cab.agrupado).toBe(1)
    expect(cab.compressaoInterna).toBe(1)
    expect(cab.compressaoTile).toBe(1)
    expect(cab.tipoTile).toBe(1)
    expect(cab.zoomMin).toBe(Z)
    expect(cab.zoomMax).toBe(Z)
    expect(cab.oeste).toBe(-466570000)
    expect(cab.sul).toBe(-235640000)
    expect(cab.leste).toBe(-466540000)
    expect(cab.norte).toBe(-235610000)
    expect(cab.zoomCentro).toBe(Z)
    expect(cab.lonCentro).toBe(-466555000)
    expect(cab.latCentro).toBe(-235625000)
  })

  it('escreve os metadados {}', () => {
    expect(new TextDecoder().decode(buf.subarray(cab.metaOffset, cab.metaOffset + cab.metaTamanho))).toBe('{}')
  })

  it('o diretório raiz tem uma entrada com o tileId do tile pedido', () => {
    const dir = lerDiretorio(buf.subarray(cab.raizOffset, cab.raizOffset + cab.raizTamanho))
    expect(dir).toHaveLength(1)
    expect(dir[0].tileId).toBe(idDoTile(Z, x, y))
    expect(dir[0].tileId).toBeGreaterThan(idDoTile(Z, 0, 0) - 1)
    expect(dir[0].runLength).toBe(1)
    expect(dir[0].offset).toBe(0)
    expect(dir[0].tamanho).toBe(cab.dadosTamanho)
  })

  it('o tile é um MVT com a camada earth, versão 2, extent 4096 e um polígono quadrado', () => {
    const tile = buf.subarray(cab.dadosOffset, cab.dadosOffset + cab.dadosTamanho)
    const camadas = pegar(lerCampos(tile), 3)
    expect(camadas).toHaveLength(2)
    const camada = lerCampos(camadas[0].valor as Uint8Array)
    expect(pegar(camada, 15)[0].valor).toBe(2)
    expect(new TextDecoder().decode(pegar(camada, 1)[0].valor as Uint8Array)).toBe('earth')
    expect(pegar(camada, 5)[0].valor).toBe(4096)
    const feicoes = pegar(camada, 2)
    expect(feicoes).toHaveLength(1)
    const feicao = lerCampos(feicoes[0].valor as Uint8Array)
    expect(pegar(feicao, 3)[0].valor).toBe(3) // POLYGON
    const g = leitor(pegar(feicao, 4)[0].valor as Uint8Array)
    const comandos: number[] = []
    while (!g.fim()) comandos.push(g.varint())
    // MoveTo(1) 0,0; LineTo(3) +4096,0 / 0,+4096 / -4096,0; ClosePath
    expect(comandos).toEqual([9, 0, 0, 26, 8192, 0, 0, 8192, 8191, 0, 15])
  })

  it('a camada roads tem uma grade de ruas minor_road com name, name:pt e min_zoom (o estilo desenha o rótulo)', () => {
    const tile = buf.subarray(cab.dadosOffset, cab.dadosOffset + cab.dadosTamanho)
    const camada = lerCampos(pegar(lerCampos(tile), 3)[1].valor as Uint8Array)
    const texto = (c: Campo) => new TextDecoder().decode(c.valor as Uint8Array)
    expect(texto(pegar(camada, 1)[0])).toBe('roads')
    expect(pegar(camada, 5)[0].valor).toBe(4096)
    const chaves = pegar(camada, 3).map(texto)
    expect(chaves).toEqual(['kind', 'name', 'name:pt', 'min_zoom'])
    const valores = pegar(camada, 4).map((v) => lerCampos(v.valor as Uint8Array)[0])
    expect(valores.slice(0, 2).map(texto)).toEqual(['minor_road', NOME_RUA_FALSA])
    expect(valores[2]).toMatchObject({ numero: 5, valor: 12 }) // uint_value
    const feicao = lerCampos(pegar(camada, 2)[0].valor as Uint8Array)
    expect(pegar(feicao, 3)[0].valor).toBe(2) // LINESTRING
    const tags = leitor(pegar(feicao, 2)[0].valor as Uint8Array)
    const pares: number[] = []
    while (!tags.fim()) pares.push(tags.varint())
    expect(pares).toEqual([0, 0, 1, 1, 2, 1, 3, 2])
    // 32 partes: cada uma MoveTo(1) e LineTo(1)
    const g = leitor(pegar(feicao, 4)[0].valor as Uint8Array)
    const comandos: number[] = []
    while (!g.fim()) comandos.push(g.varint())
    expect(comandos.filter((_c, i) => i % 3 === 0)).toEqual(Array.from({ length: 64 }, (_, i) => (i % 2 === 0 ? 9 : 10)))
  })

  it('tiles diferentes geram tileIds diferentes', () => {
    const outro = gerarPmtilesFalso({ z: Z, x: x + 1, y, limites: LIMITES })
    const c = lerCabecalho(outro)
    const dir = lerDiretorio(outro.subarray(c.raizOffset, c.raizOffset + c.raizTamanho))
    expect(dir[0].tileId).toBe(idDoTile(Z, x + 1, y))
    expect(dir[0].tileId).not.toBe(idDoTile(Z, x, y))
  })
})

describe('bucketDoArquivo servido pelo Worker de verdade (worker/servirMapa.ts)', () => {
  const buf = gerarPmtilesFalso({ z: Z, ...tileDoPonto(-23.5617, -46.656, Z), limites: LIMITES })
  const n = buf.length
  const URL_ARQUIVO = 'http://localhost:4173/mapa/rota-falada-sp-00000000.pmtiles'
  const pedir = (init: RequestInit = {}, vazio = false) =>
    responderMapa(new Request(URL_ARQUIVO, init), { MAPAS: bucketDoArquivo(buf, { vazio }) }, new Map())
  const bytes = async (r: Response) => Array.from(new Uint8Array(await r.arrayBuffer()))

  it('bytes=0-126 devolve 206 com o cabeçalho, a ETag da fixture e o cache do Worker', async () => {
    const r = await pedir({ headers: { Range: 'bytes=0-126' } })
    expect(r.status).toBe(206)
    expect(await bytes(r)).toEqual(Array.from(buf.subarray(0, 127)))
    expect(r.headers.get('content-range')).toBe(`bytes 0-126/${n}`)
    expect(r.headers.get('content-length')).toBe('127')
    expect(r.headers.get('etag')).toBe(ETAG_FALSO)
    expect(r.headers.get('cache-control')).toContain('immutable')
    expect(r.headers.get('cross-origin-resource-policy')).toBe('same-origin')
  })

  it('o pedido de 16 KB do pmtiles num arquivo menor devolve o arquivo inteiro em 206', async () => {
    const r = await pedir({ headers: { Range: 'bytes=0-16383' } })
    expect(r.status).toBe(206)
    expect(r.headers.get('content-range')).toBe(`bytes 0-${n - 1}/${n}`)
    expect(await bytes(r)).toEqual(Array.from(buf))
  })

  it('sem Range devolve 200 com o arquivo inteiro', async () => {
    const r = await pedir()
    expect(r.status).toBe(200)
    expect(await bytes(r)).toEqual(Array.from(buf))
  })

  it('Range que não cabe devolve 416 sem cache', async () => {
    const r = await pedir({ headers: { Range: `bytes=${n}-` } })
    expect(r.status).toBe(416)
    expect(r.headers.get('content-range')).toBe(`bytes */${n}`)
    expect(r.headers.get('cache-control')).toBe('no-store')
  })

  it('vazio: o arquivo não existe e o Worker responde 404', async () => {
    expect((await pedir({ headers: { Range: 'bytes=0-16383' } }, true)).status).toBe(404)
  })

  it('o corpo é uma cópia, não uma vista do buffer original', async () => {
    const r = await pedir({ headers: { Range: 'bytes=0-1' } })
    const corpo = new Uint8Array(await r.arrayBuffer())
    corpo[0] = 0
    expect(buf[0]).toBe(0x50)
  })
})

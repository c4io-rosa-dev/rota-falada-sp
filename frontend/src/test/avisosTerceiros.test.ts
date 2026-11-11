import { fecharDependencias, montarAvisos, pacoteDoModulo } from '../../scripts/avisosTerceiros'

describe('avisos de licença de terceiros', () => {
  it.each([
    ['/p/frontend/node_modules/maplibre-gl/dist/maplibre-gl.mjs', 'maplibre-gl'],
    ['C:\\p\\frontend\\node_modules\\pmtiles\\dist\\esm\\index.js', 'pmtiles'],
    ['/p/node_modules/@protomaps/basemaps/dist/esm/index.js', '@protomaps/basemaps'],
    ['/p/node_modules/@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2?url', '@fontsource-variable/archivo'],
    ['/p/node_modules/a/node_modules/@mapbox/vector-tile/index.js', '@mapbox/vector-tile'],
  ])('%s é do pacote %s', (id, nome) => {
    expect(pacoteDoModulo(id)).toBe(nome)
  })

  it.each([['/p/frontend/src/pages/Navegar.tsx'], ['\0vite/preload-helper.js'], ['/p/node_modules/'], ['/p/node_modules/@escopo/']])(
    '%s não é de pacote',
    (id) => {
      expect(pacoteDoModulo(id)).toBeNull()
    },
  )

  it('inclui as dependências declaradas, que um dist pré-empacotado (como o do maplibre-gl) leva embutidas', () => {
    const deps: Record<string, string[]> = {
      'maplibre-gl': ['pbf', '@mapbox/tiny-sdf', '@types/geojson', 'nao-instalado'],
      pbf: ['resolve-protobuf-schema'],
      'resolve-protobuf-schema': ['pbf'],
      '@mapbox/tiny-sdf': [],
      react: [],
    }
    const nomes = fecharDependencias(['react', 'maplibre-gl'], (n) => deps[n] ?? null)
    expect(nomes).toEqual(['@mapbox/tiny-sdf', 'maplibre-gl', 'pbf', 'react', 'resolve-protobuf-schema'])
  })

  it('lista os pacotes em ordem e traz o texto de cada licença por inteiro', () => {
    const texto = montarAvisos([
      { nome: 'pmtiles', versao: '4.5.0', licenca: 'BSD-3-Clause', texto: 'Copyright (c) Protomaps\n\nRedistribution...' },
      { nome: 'maplibre-gl', versao: '6.16.0', licenca: 'BSD-3-Clause', texto: 'Copyright (c) MapLibre contributors' },
      { nome: 'sem-arquivo', versao: '1.0.0', licenca: 'MIT', texto: null },
    ])
    expect(texto.indexOf('- maplibre-gl 6.16.0 (BSD-3-Clause)')).toBeLessThan(texto.indexOf('- pmtiles 4.5.0 (BSD-3-Clause)'))
    expect(texto).toContain('Copyright (c) Protomaps\n\nRedistribution...')
    expect(texto).toContain('Copyright (c) MapLibre contributors')
    expect(texto).toContain('licença declarada no package.json: MIT')
  })
})

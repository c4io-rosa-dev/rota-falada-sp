/**
 * A direção da seta da pessoa (emenda de 10/11/2026 da spec do mapa, 19.4): bússola → caminhada
 * (GPS) → rota → nenhuma. Tudo puro; a guarda estática lê o próprio código.
 */
import FONTE from '../dados/navegacao/direcaoSeta.ts?raw'
import {
  criarSuavizador,
  deveAtualizar,
  diferencaGraus,
  DIRECAO,
  escolherDirecao,
  normalizarGraus,
  rumoDoEvento,
} from '../dados/navegacao/direcaoSeta'

describe('constantes', () => {
  it('têm os valores da emenda', () => {
    expect(DIRECAO).toMatchObject({
      PRECISAO_MAX_GRAUS: 45,
      VALIDADE_BUSSOLA_MS: 3000,
      VELOCIDADE_MIN_MPS: 0.5,
      INTERVALO_MS: 250,
      PASSO_GRAUS: 5,
    })
  })
})

describe('normalizarGraus e diferencaGraus', () => {
  it('normaliza para [0, 360)', () => {
    expect(normalizarGraus(-90)).toBe(270)
    expect(normalizarGraus(360)).toBe(0)
    expect(normalizarGraus(725)).toBe(5)
  })

  it('a diferença é a menor volta', () => {
    expect(diferencaGraus(350, 10)).toBe(20)
    expect(diferencaGraus(10, 350)).toBe(20)
    expect(diferencaGraus(0, 180)).toBe(180)
  })
})

describe('rumoDoEvento', () => {
  it('iPhone: usa webkitCompassHeading e soma o ângulo da tela', () => {
    expect(rumoDoEvento({ webkitCompassHeading: 120, webkitCompassAccuracy: 10 }, 0)).toBe(120)
    expect(rumoDoEvento({ webkitCompassHeading: 300, webkitCompassAccuracy: 10 }, 90)).toBe(30)
    // sem a precisão declarada, vale a leitura
    expect(rumoDoEvento({ webkitCompassHeading: 45 }, 0)).toBe(45)
  })

  it('iPhone: precisão negativa (sem calibração) ou pior que 45° não vale', () => {
    expect(rumoDoEvento({ webkitCompassHeading: 120, webkitCompassAccuracy: -1 }, 0)).toBeNull()
    expect(rumoDoEvento({ webkitCompassHeading: 120, webkitCompassAccuracy: 46 }, 0)).toBeNull()
    expect(rumoDoEvento({ webkitCompassHeading: 120, webkitCompassAccuracy: 45 }, 0)).toBe(120)
  })

  it('Android deitado: 360 − alpha, mais o ângulo da tela', () => {
    expect(rumoDoEvento({ absolute: true, alpha: 0, beta: 0, gamma: 0 }, 0)).toBe(0)
    expect(rumoDoEvento({ absolute: true, alpha: 90, beta: 20, gamma: 0 }, 0)).toBe(270)
    expect(rumoDoEvento({ absolute: true, alpha: 270, beta: 45, gamma: 5 }, 0)).toBe(90)
    expect(rumoDoEvento({ absolute: true, alpha: 270, beta: 45, gamma: 5 }, 90)).toBe(180)
    expect(rumoDoEvento({ absolute: true, alpha: 270, beta: 45, gamma: 5 }, 270)).toBe(0)
  })

  it('Android em pé: usa as costas do aparelho, e bate com o topo na passagem dos 70°', () => {
    // em pé e reto (beta 90, gamma 0): as costas apontam para 360 − alpha
    expect(rumoDoEvento({ absolute: true, alpha: 90, beta: 90, gamma: 0 }, 0)).toBeCloseTo(270, 6)
    expect(rumoDoEvento({ absolute: true, alpha: 300, beta: 85, gamma: 0 }, 0)).toBeCloseTo(60, 6)
    // sem inclinar para os lados, as duas fórmulas dão o mesmo rumo: não há salto ao levantar o aparelho
    const deitado = rumoDoEvento({ absolute: true, alpha: 40, beta: 70, gamma: 0 }, 0)!
    const emPe = rumoDoEvento({ absolute: true, alpha: 40, beta: 70.01, gamma: 0 }, 0)!
    expect(diferencaGraus(deitado, emPe)).toBeLessThan(0.01)
  })

  it('leitura que não é de bússola não vale: evento relativo, campos nulos ou não numéricos', () => {
    expect(rumoDoEvento({ absolute: false, alpha: 10, beta: 0, gamma: 0 }, 0)).toBeNull()
    expect(rumoDoEvento({ alpha: 10, beta: 0, gamma: 0 }, 0)).toBeNull()
    expect(rumoDoEvento({ absolute: true, alpha: null, beta: 0, gamma: 0 }, 0)).toBeNull()
    expect(rumoDoEvento({ absolute: true, alpha: 10, beta: null, gamma: 0 }, 0)).toBeNull()
    expect(rumoDoEvento({ absolute: true, alpha: Number.NaN, beta: 0, gamma: 0 }, 0)).toBeNull()
    expect(rumoDoEvento({}, 0)).toBeNull()
  })

  it('ângulo de tela inválido vale zero', () => {
    expect(rumoDoEvento({ webkitCompassHeading: 120 }, Number.NaN)).toBe(120)
  })
})

describe('criarSuavizador (média circular)', () => {
  it('a primeira leitura passa inteira', () => {
    expect(criarSuavizador().somar(123)).toBeCloseTo(123, 6)
  })

  it('em volta do norte, 350° e 10° dão perto de 0°, nunca perto de 180°', () => {
    const s = criarSuavizador(0.5)
    s.somar(350)
    const media = s.somar(10)
    expect(diferencaGraus(media, 0)).toBeLessThan(1)
  })

  it('aproxima aos poucos de um rumo novo e chega nele', () => {
    const s = criarSuavizador(0.25)
    s.somar(0)
    const primeiro = s.somar(90)
    expect(primeiro).toBeGreaterThan(5)
    expect(primeiro).toBeLessThan(45)
    let ultimo = primeiro
    for (let i = 0; i < 40; i++) ultimo = s.somar(90)
    expect(ultimo).toBeCloseTo(90, 1)
  })

  it('ruído em volta de um rumo quase não mexe a média', () => {
    const s = criarSuavizador()
    let media = s.somar(200)
    for (const v of [204, 196, 203, 197, 205, 195, 201, 199]) media = s.somar(v)
    expect(diferencaGraus(media, 200)).toBeLessThan(3)
  })

  it('zerar esquece o vetor', () => {
    const s = criarSuavizador()
    s.somar(10)
    s.zerar()
    expect(s.somar(250)).toBeCloseTo(250, 6)
  })
})

describe('deveAtualizar (limite de frequência)', () => {
  it('a primeira sempre passa', () => {
    expect(deveAtualizar(null, 10, 0)).toBe(true)
  })

  it('antes de 250 ms não passa, nem com diferença grande', () => {
    expect(deveAtualizar({ graus: 10, emMs: 1000 }, 100, 1249)).toBe(false)
    expect(deveAtualizar({ graus: 10, emMs: 1000 }, 100, 1250)).toBe(true)
  })

  it('menos de 5° não passa, nem depois de muito tempo', () => {
    expect(deveAtualizar({ graus: 10, emMs: 1000 }, 14.9, 9000)).toBe(false)
    expect(deveAtualizar({ graus: 10, emMs: 1000 }, 15, 9000)).toBe(true)
    expect(deveAtualizar({ graus: 358, emMs: 1000 }, 2, 9000)).toBe(false)
    expect(deveAtualizar({ graus: 358, emMs: 1000 }, 4, 9000)).toBe(true)
  })
})

describe('escolherDirecao (queda de fontes)', () => {
  const AGORA = 100_000
  const gpsAndando = { rumoGraus: 200, velocidadeMps: 1.1, tMs: AGORA - 1000 }

  it('bússola recente vence tudo', () => {
    expect(escolherDirecao({ agoraMs: AGORA, bussola: { graus: 33, emMs: AGORA - 500 }, gps: gpsAndando, rumoRota: 90 })).toEqual({
      graus: 33,
      fonte: 'bussola',
    })
  })

  it('bússola parada há mais de 3 s cai para a caminhada', () => {
    expect(escolherDirecao({ agoraMs: AGORA, bussola: { graus: 33, emMs: AGORA - 3001 }, gps: gpsAndando, rumoRota: 90 })).toEqual({
      graus: 200,
      fonte: 'caminhada',
    })
    expect(escolherDirecao({ agoraMs: AGORA, bussola: { graus: 33, emMs: AGORA - 3000 }, gps: gpsAndando, rumoRota: 90 })?.fonte).toBe('bussola')
  })

  it('sem bússola: o GPS só vale andando (0,5 m/s ou mais), com rumo numérico e leitura recente', () => {
    const sem = { agoraMs: AGORA, bussola: null, rumoRota: 90 }
    expect(escolherDirecao({ ...sem, gps: gpsAndando })).toEqual({ graus: 200, fonte: 'caminhada' })
    expect(escolherDirecao({ ...sem, gps: { ...gpsAndando, velocidadeMps: 0.49 } })?.fonte).toBe('rota')
    expect(escolherDirecao({ ...sem, gps: { ...gpsAndando, velocidadeMps: 0.5 } })?.fonte).toBe('caminhada')
    expect(escolherDirecao({ ...sem, gps: { ...gpsAndando, rumoGraus: null } })?.fonte).toBe('rota')
    expect(escolherDirecao({ ...sem, gps: { ...gpsAndando, rumoGraus: Number.NaN } })?.fonte).toBe('rota')
    expect(escolherDirecao({ ...sem, gps: { ...gpsAndando, velocidadeMps: null } })?.fonte).toBe('rota')
    expect(escolherDirecao({ ...sem, gps: { tMs: AGORA } })?.fonte).toBe('rota')
    expect(escolherDirecao({ ...sem, gps: { ...gpsAndando, tMs: AGORA - 5001 } })?.fonte).toBe('rota')
  })

  it('sem bússola e sem caminhada: o sentido da rota', () => {
    expect(escolherDirecao({ agoraMs: AGORA, bussola: null, gps: null, rumoRota: 359.5 })).toEqual({ graus: 359.5, fonte: 'rota' })
  })

  it('fora da rota e sem nenhuma fonte: nenhuma seta', () => {
    expect(escolherDirecao({ agoraMs: AGORA, bussola: null, gps: null, rumoRota: null })).toBeNull()
    expect(escolherDirecao({ agoraMs: AGORA, bussola: null, gps: { tMs: AGORA, velocidadeMps: 0 }, rumoRota: null })).toBeNull()
  })

  it('devolve graus em [0, 360)', () => {
    expect(escolherDirecao({ agoraMs: AGORA, bussola: { graus: 360, emMs: AGORA }, gps: null, rumoRota: null })?.graus).toBe(0)
    expect(escolherDirecao({ agoraMs: AGORA, bussola: null, gps: null, rumoRota: -10 })?.graus).toBe(350)
  })
})

describe('guarda estática: a direção nunca é gravada, registrada nem enviada', () => {
  it('lê o código de verdade', () => {
    expect(FONTE).toContain('export function escolherDirecao')
  })

  it('sem armazenamento, sem rede, sem console, sem sensor e sem relógio', () => {
    expect(FONTE).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.|console\.|\bfetch\(|sendBeacon|XMLHttpRequest/)
    expect(FONTE).not.toMatch(/addEventListener|Date\.now|navigator\./)
  })
})

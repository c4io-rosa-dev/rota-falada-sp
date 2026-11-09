import { apagarSessaoRota, gravarSessaoRota, lerSessaoRota, PERFIL_FORM_PADRAO, VALIDADE_ROTA_MS, type SessaoRota } from '../dados/sessaoRota'
import { rotuloCategoria } from '../dados/categorias'
import {
  letreiroDoPasso,
  nomeFonte,
  separarInstrucao,
  textoBarreira,
  textoDataPasso,
  textoDuracao,
  textoExigencia,
  textoFalado,
  textoFontePasso,
  textoInstrucao,
  textoLargura,
  textoMotor,
  textoSobreARota,
  textosDeAviso,
} from '../dados/passo'
import { linhaDoGeoJson, meioDaLinha } from '../dados/rotaGeo'
import { LINHA, passo, ROTA } from './fixturasRota'

const DIFICULTA = {
  id: 7,
  origem: 'colaborativa' as const,
  categoria: 'calcada_estreita',
  severidade: 'dificulta',
  distancia_m: 12.4,
  confirmacoes: 1,
  data_referencia: '2026-11-03',
}

describe('textos do passo', () => {
  it('entende a instrução do pgRouting', () => {
    expect(separarInstrucao('Siga por Rua X')).toEqual({ acao: 'Siga', rua: 'Rua X' })
    expect(separarInstrucao('Vire à direita e siga por Rua X')).toEqual({ acao: 'Vire à direita', rua: 'Rua X' })
    expect(separarInstrucao('Siga por a via')).toEqual({ acao: 'Siga', rua: null })
  })

  it('instrução vazia nunca vira passo mudo', () => {
    expect(textoInstrucao(passo(1, { instrucao: '' }))).toBe('Siga o trecho')
    expect(letreiroDoPasso(passo(1, { instrucao: ' ' }))).toBe('Siga o trecho')
  })

  it('largura sem medição é "sem dado", mesmo com valor', () => {
    expect(textoLargura(passo(1, { largura_m: 0, largura_medida: false }))).toBe('sem dado')
  })

  it('duração, exigência e motor em texto', () => {
    expect(textoDuracao(30)).toBe('cerca de 1 minuto a pé')
    expect(textoDuracao(900)).toBe('cerca de 15 minutos a pé')
    expect(textoExigencia('any')).toBe('qualquer inclinação')
    expect(textoExigencia(6)).toBe('até 6%')
    expect(textoMotor('ors')).toBe('openrouteservice.org by HeiGIT')
    expect(textoMotor('pgrouting')).toBe('roteamento local (pgRouting)')
    expect(textoMotor('fixture')).toBe('rota gravada para demonstração, não calculada agora')
  })

  it('a frase da ficha só promete o que cada motor faz', () => {
    expect(textoSobreARota('ors')).toBe(
      'Rota sugerida com os dados disponíveis. Ela evita as barreiras confirmadas que bloqueiam a passagem e avisa das que só dificultam. Relatos ainda sem confirmação não mudam a rota, e não sabemos o que não foi registrado. A largura e a inclinação de cada passo são o pior valor conhecido no trecho, nos dois lados da rua.',
    )
    expect(textoSobreARota('pgrouting')).toContain('as barreiras confirmadas que bloqueiam a passagem')
    expect(textoSobreARota('pgrouting')).toContain('não sabemos o que não foi registrado')
    expect(textoSobreARota('fixture')).toContain('Ela não muda com as barreiras registradas')
  })

  it('fonte e data dizem de onde vem cada coisa', () => {
    expect(nomeFonte('colaborativo')).toBe('colaboradores')
    expect(textoFontePasso(passo(1))).toBe('OpenStreetMap; largura e declividade: GeoSampa')
    expect(textoFontePasso(passo(1, { declividade_medida: false }))).toBe('OpenStreetMap; largura: GeoSampa')
    expect(textoFontePasso(passo(1, { largura_medida: false, largura_m: null }))).toBe('OpenStreetMap; declividade: GeoSampa')
    expect(textoFontePasso(passo(1, { largura_medida: false, largura_m: null, declividade_medida: false }))).toBe('OpenStreetMap')
    expect(textoDataPasso(passo(1))).toBe('12/10/2026 (trecho no OSM)')
    expect(textoDataPasso(passo(1, { largura_medida: false, data_referencia: null }))).toBe('sem dado')
  })

  it('barreira em português, sem o slug cru', () => {
    expect(textoBarreira(DIFICULTA)).toBe(
      'Calçada estreita, a 12 m. Dificulta a passagem, não bloqueia a rota. 1 confirmação. Fonte: colaboradores, 03/11/2026.',
    )
    expect(textoBarreira({ ...DIFICULTA, origem: 'oficial', categoria: 'poda_de_arvore', confirmacoes: null })).toBe(
      'Poda de arvore, a 12 m. Dificulta a passagem, não bloqueia a rota. Fonte: SP156, 03/11/2026.',
    )
    expect(rotuloCategoria('escada')).toBe('Escada')
  })

  it('aviso barreira_dificulta sai de barreiras_proximas; os outros usam a mensagem', () => {
    const textos = textosDeAviso({
      avisos: [
        { tipo: 'trecho_sem_dados', mensagem: 'Sem dados.' },
        { tipo: 'barreira_dificulta', mensagem: "Barreira 'calcada_estreita' a 12 m" },
      ],
      passos: [passo(3, { barreiras_proximas: [DIFICULTA] })],
    })
    expect(textos[0]).toBe('Sem dados.')
    expect(textos[1]).toMatch(/^Passo 3: Calçada estreita/)
    expect(textos.join()).not.toContain('calcada_estreita')
  })

  it('a voz avisa da barreira do passo', () => {
    expect(textoFalado(passo(3, { barreiras_proximas: [DIFICULTA] }))).toContain('Atenção: barreira, Calçada estreita, a 12 metros.')
  })
})

describe('geometria', () => {
  it('inverte [lng, lat] e recusa o que não é linha', () => {
    expect(linhaDoGeoJson(LINHA)).toEqual([
      [-23.59, -46.635],
      [-23.59, -46.634],
    ])
    for (const invalida of [{}, null, { type: 'Point', coordinates: [1, 2] }, { type: 'LineString', coordinates: [[1, 2]] }, { type: 'LineString', coordinates: [[1], [2]] }]) {
      expect(linhaDoGeoJson(invalida)).toBeNull()
    }
  })

  it('acha o meio da linha ao longo dela', () => {
    const [lat, lon] = meioDaLinha([
      [0, 0],
      [0, 2],
    ])
    expect(lat).toBeCloseTo(0)
    expect(lon).toBeCloseTo(1)
  })
})

describe('sessão da busca', () => {
  const sessao: SessaoRota = {
    versao: 1,
    origem: null,
    destino: null,
    perfil: PERFIL_FORM_PADRAO,
    rota: ROTA,
    rotaDe: { pedido: { origem: { lat: 1, lng: 2 }, destino: { lat: 3, lng: 4 }, perfil: { inclinacao_max: 6, guia_max_m: 0.06, largura_min_m: 0.9, evitar_degraus: true, velocidade_kmh: 3 } }, origem: 'Rua A', destino: 'Rua B' },
    calculadaEm: '2026-11-05T12:00:00.000Z',
  }
  const agora = Date.parse('2026-11-05T12:00:00.000Z')

  afterEach(() => vi.restoreAllMocks())

  it('restaura sem rede e apaga', () => {
    gravarSessaoRota(sessao)
    expect(lerSessaoRota(agora)?.rota?.passos).toHaveLength(2)
    apagarSessaoRota()
    expect(lerSessaoRota(agora)).toBeNull()
  })

  it('rota com mais de 6 h cai, os pontos ficam', () => {
    gravarSessaoRota(sessao)
    const lida = lerSessaoRota(agora + VALIDADE_ROTA_MS + 1)
    expect(lida?.rota).toBeNull()
    expect(lida?.rotaDe).toBeNull()
    expect(lida?.perfil).toEqual(PERFIL_FORM_PADRAO)
  })

  it('formato estranho é ignorado', () => {
    sessionStorage.setItem('rf-busca', '{"versao":9}')
    expect(lerSessaoRota(agora)).toBeNull()
    sessionStorage.setItem('rf-busca', 'não é json')
    expect(lerSessaoRota(agora)).toBeNull()
  })

  it('armazenamento que lança não derruba a tela', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    expect(() => gravarSessaoRota(sessao)).not.toThrow()
    expect(lerSessaoRota(agora)).toBeNull()
  })

  it('nunca grava em localStorage', () => {
    gravarSessaoRota(sessao)
    expect(localStorage.length).toBe(0)
  })
})

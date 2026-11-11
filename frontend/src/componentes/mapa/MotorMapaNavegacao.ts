/**
 * Motor do mapa da navegação guiada (spec do mapa próprio, seção 9). Chunk lazy: é o único
 * módulo que importa maplibre-gl e pmtiles, e só entra quando a pessoa abre o mapa.
 *
 * O que ele promete:
 * - nenhum pedido a terceiros: o arquivo de tiles, o worker do MapLibre e a letra vêm do próprio site;
 * - a posição nunca desliza: a câmera pula (jumpTo); só o giro anima, 200 ms, e nada anima com
 *   movimento reduzido ou com a aba escondida;
 * - a vista inclinada (emenda de 10/11/2026, 19.2) é um ângulo fixo de 45°, opcional, e a troca é
 *   sempre um salto; os prédios em volume só aparecem com ela, e nunca no alto contraste;
 * - a seta da pessoa (19.4) recebe a direção já escolhida pela casca e só a desenha: a direção
 *   nunca vai para o DOM nem é guardada além do último número, em memória;
 * - nada focável e nada anunciado: o nome acessível fica na figura da casca (seção 10);
 * - nada guardado: só a última cena, em memória, para reaplicar ao trocar o tema ou voltar à aba.
 *   Os pedaços do arquivo são pedidos com cache 'no-store': o navegador não grava em disco a
 *   região por onde a pessoa passou (FonteSemCache);
 * - a câmera só se mexe quando muda: a mesma cena não redesenha o mapa (bateria do celular).
 *
 * Sinais no DOM, sem posição, para os testes de ponta a ponta (o contêiner é aria-hidden por dentro
 * do role="img" da casca): `data-estilo` ('carregando' | 'carregado', depois do style.load e do
 * primeiro idle), `data-erros-mapa` (erros do MapLibre que não são de tile), `data-rumo` (o rumo
 * real do mapa, em graus inteiros), `data-inclinacao` (0 ou 45) e `data-predios` ('sim' | 'nao').
 * Só no build de E2E, `data-centro` (o centro arredondado).
 *
 * Falhas: antes de criar o mapa, chama `aoFalhar(motivo)` e rejeita com ErroMotorMapa (a casca
 * só precisa olhar o aoFalhar; o catch serve para o import que falhar). Depois de criado, um
 * contexto WebGL perdido chama `aoFalhar('nao_carregou')` e tiles faltando chamam `aoFaltarParte()`.
 */
import fonteLatin from '@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2?url'
import fonteLatinExt from '@fontsource-variable/archivo/files/archivo-latin-ext-wght-normal.woff2?url'
import { addProtocol, Map as MapaGL, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl'
import urlDoWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { FetchSource, PMTiles, Protocol } from 'pmtiles'
import { circuloPrecisao, setaDaPessoa, ZOOM_NAVEGACAO, type Cena, type LonLat } from '../../dados/navegacao/mapaNavegacao'
import { criarRegua } from '../../dados/navegacao/regua'
import { CAIXA_AREA, URL_MAPA, ZOOM_MAX, ZOOM_MIN } from './arquivoMapa'
import {
  CAMADA_PREDIOS_3D,
  estiloMapaNavegacao,
  PARTE,
  PROP_ENCAIXADA,
  PROP_PARTE,
  type CoresMapa,
  type FontesMapa,
  type Tema,
} from './estiloMapaNavegacao'

export type MotivoFalha = 'sem_webgl' | 'nao_carregou'

export type OpcoesMotor = {
  /** Lido a cada atualização (prefers-reduced-motion). */
  reduzido: () => boolean
  aoFalhar: (m: MotivoFalha) => void
  aoFaltarParte: () => void
  /** O rumo real do mapa, em graus [0, 360), a cada quadro do giro e ao fim de cada movimento. */
  aoMudarRumo?: (rumo: number) => void
}

export type MotorMapa = {
  /** inclinada: a vista de 45° (só no modo seguir; enquadrar fica de cima). */
  atualizar(cena: Cena, girar: boolean, inclinada?: boolean): void
  /** Direção da seta da pessoa, em graus (0 = norte); null tira a seta (anel sem seta). */
  apontar(graus: number | null): void
  trocarTema(tema: Tema): void
  destruir(): void
}

/** Rejeição de criarMotor quando a falha foi antes de existir o mapa (já avisada por aoFalhar). */
export class ErroMotorMapa extends Error {
  readonly motivo: MotivoFalha
  constructor(motivo: MotivoFalha) {
    super(motivo)
    this.name = 'ErroMotorMapa'
    this.motivo = motivo
  }
}

/** Prazo para o cabeçalho do arquivo e para o primeiro idle depois da câmera. */
const PRAZO_MS = 8000
/** Mesma política de vigiarTiles (opcoesMapa.ts). */
const LIMITE_ERROS_TILE = 3
const DURACAO_GIRO_MS = 200
const MARGEM_ENQUADRAR_PX = 24
/** Fração da altura no padding.top quando a pessoa fica no terço de baixo (mapa girado). */
const FRACAO_PESSOA_ABAIXO = 0.4
/**
 * Ângulo fixo da vista inclinada e teto do mapa (maxPitch): abaixo do limite estável de 60° do
 * MapLibre, e quanto menor o ângulo, menos tiles entram no horizonte.
 */
export const INCLINACAO_GRAUS = 45
const MARGEM_CAIXA_GRAUS = 0.01
const PIXEL_RATIO_MAX = 2
/** Arredondamento das chaves de comparação: 1e-5 grau ≈ 1 m em São Paulo. */
const CASAS_CHAVE = 5

const CONSULTA_ESCURO = '(prefers-color-scheme: dark)'
const CONSULTA_CONTRASTE = '(forced-colors: active)'
/** Quem pede mais contraste não recebe os volumes translúcidos dos prédios. */
const CONSULTA_MAIS_CONTRASTE = '(prefers-contrast: more)'

/** Cores do tema claro (index.css), para quando os tokens não puderem ser lidos. */
const CORES_PADRAO: CoresMapa = {
  vao: '#dfe0db',
  concreto: '#d2d4cf',
  torre: '#c3c6c0',
  placa: '#e6e7e2',
  junta: '#8a8f8a',
  juntaForte: '#5d625e',
  tinta: '#1c1f1d',
  tinta2: '#3a3f3b',
  oxido: '#9a3f2c',
}

const TOKENS: Record<keyof CoresMapa, string> = {
  vao: '--vao',
  concreto: '--concreto',
  torre: '--torre',
  placa: '--placa',
  junta: '--junta',
  juntaForte: '--junta-forte',
  tinta: '--tinta',
  tinta2: '--tinta-2',
  oxido: '--oxido',
}

/** Só no build de E2E (vite build --mode e2e): o centro real da câmera vai para o DOM. */
const APOIO_E2E = import.meta.env.MODE === 'e2e'

/**
 * Pede os pedaços do arquivo sem gravar no cache HTTP do navegador ('no-store', o que o pmtiles já
 * faz no Chrome do Windows): os pedaços da região vista não ficam em disco depois de fechar a aba.
 * O mapa guarda em memória só os tiles e diretórios recentes, e some com a aba. Sem cache, o
 * "reload" que o pmtiles usa depois de uma ETag diferente perde o sentido (ele também gravaria).
 */
class FonteSemCache extends FetchSource {
  constructor(url: string) {
    super(url)
    this.chromeWindowsNoCache = true
    Object.defineProperty(this, 'mustReload', { get: () => false, set: () => {} })
  }
}

/** Rumo do MapLibre ((-180, 180]) em [0, 360). */
const normalizarRumo = (graus: number) => ((graus % 360) + 360) % 360

/** Uma vez por carga do módulo: o MapLibre guarda o protocolo globalmente. */
let protocolo: Protocol | null = null

/* ---------- ambiente ---------- */

function temWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) !== null
  } catch {
    return false
  }
}

function consultar(media: string): MediaQueryList | null {
  return typeof matchMedia === 'function' ? matchMedia(media) : null
}

function temaDoAparelho(): Tema {
  if (consultar(CONSULTA_CONTRASTE)?.matches) return 'contraste'
  return consultar(CONSULTA_ESCURO)?.matches ? 'escuro' : 'claro'
}

/** Os tokens do DESIGN.md já resolvidos para o esquema atual (o CSS troca os pares -noturno). */
function coresDosTokens(): CoresMapa {
  const css = getComputedStyle(document.documentElement)
  const cores = { ...CORES_PADRAO }
  for (const papel of Object.keys(TOKENS) as (keyof CoresMapa)[]) {
    const valor = css.getPropertyValue(TOKENS[papel]).trim()
    if (valor) cores[papel] = valor
  }
  return cores
}

/**
 * O canvas não obedece a forced-colors: uma sonda no DOM lê as cores de sistema já resolvidas
 * (CanvasText, Canvas e Highlight) e o estilo é refeito com elas.
 */
function coresDeSistema(): CoresMapa {
  const sonda = document.createElement('span')
  sonda.dataset.sondaMapa = '1'
  sonda.setAttribute('aria-hidden', 'true')
  sonda.style.cssText =
    'position:absolute;width:0;height:0;overflow:hidden;color:CanvasText;background-color:Canvas;outline:1px solid Highlight'
  document.body.appendChild(sonda)
  let texto = '#000000'
  let fundo = '#ffffff'
  let destaque = '#0000ff'
  try {
    const css = getComputedStyle(sonda)
    texto = css.color || texto
    fundo = css.backgroundColor || fundo
    destaque = css.outlineColor || destaque
  } finally {
    sonda.remove()
  }
  return {
    vao: fundo,
    concreto: fundo,
    torre: fundo,
    placa: fundo,
    junta: texto,
    juntaForte: texto,
    tinta: texto,
    tinta2: texto,
    oxido: destaque,
  }
}

/** A letra local só serve se o navegador sabe carregar FontFace; senão, a variante sem rótulos. */
function fontesLocais(): FontesMapa | null {
  return typeof FontFace === 'function' ? { latin: fonteLatin, latinExt: fonteLatinExt } : null
}

function estiloDo(tema: Tema) {
  return estiloMapaNavegacao({
    tema,
    urlArquivo: URL_MAPA,
    fontes: fontesLocais(),
    cores: tema === 'contraste' ? coresDeSistema() : coresDosTokens(),
  })
}

function comPrazo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolver, rejeitar) => {
    const prazo = setTimeout(() => rejeitar(new Error('prazo')), ms)
    promessa.then(
      (v) => {
        clearTimeout(prazo)
        resolver(v)
      },
      (e: unknown) => {
        clearTimeout(prazo)
        rejeitar(e)
      },
    )
  })
}

/** ease-out cúbico: começa no ritmo e assenta devagar. */
const suavizarSaida = (t: number) => 1 - (1 - t) ** 3

/* ---------- dados das fontes ---------- */

type Geometria =
  | { type: 'Point'; coordinates: LonLat }
  | { type: 'LineString'; coordinates: LonLat[] }
  | { type: 'Polygon'; coordinates: LonLat[][] }
type Feicao = { type: 'Feature'; properties: Record<string, string | boolean>; geometry: Geometria }
type DadosFonte = { chave: string; dados: () => Colecao }
type Colecao = { type: 'FeatureCollection'; features: Feicao[] }

const feicao = (properties: Feicao['properties'], geometry: Geometria): Feicao => ({ type: 'Feature', properties, geometry })
const colecao = (features: Feicao[]): Colecao => ({ type: 'FeatureCollection', features })

const chavePonto = (p: LonLat) => `${p[0].toFixed(CASAS_CHAVE)},${p[1].toFixed(CASAS_CHAVE)}`
const chaveLinha = (l: LonLat[] | null) => (l && l.length > 0 ? `${l.length}:${chavePonto(l[0])}:${chavePonto(l[l.length - 1])}` : '-')

/** Chave e conteúdo de cada fonte: a comparação é por progresso (ponto do corte), manobra e pessoa. */
function dadosDaCena(cena: Cena): Record<'rota' | 'manobra' | 'pessoa', DadosFonte> {
  const { andado, restante, manobra, destino, pessoa } = cena
  const seta = cena.setaManobra
  return {
    rota: {
      chave: `${chaveLinha(andado)}|${chaveLinha(restante)}|${chavePonto(destino)}`,
      dados: () =>
        colecao([
          ...(andado ? [feicao({ [PROP_PARTE]: PARTE.andado }, { type: 'LineString', coordinates: andado })] : []),
          ...(restante ? [feicao({ [PROP_PARTE]: PARTE.restante }, { type: 'LineString', coordinates: restante })] : []),
          feicao({ [PROP_PARTE]: PARTE.destino }, { type: 'Point', coordinates: destino }),
        ]),
    },
    manobra: {
      chave: manobra ? `${chaveLinha(manobra.trecho)}|${chavePonto(manobra.ponto)}|${seta ? chaveLinha(seta.ponta) : '-'}` : '-',
      dados: () =>
        colecao(
          manobra
            ? [
                feicao({}, { type: 'LineString', coordinates: manobra.trecho }),
                feicao({}, { type: 'Point', coordinates: manobra.ponto }),
                // a seta da virada: haste ao longo da rota e ponta em triângulo (forma, não só cor)
                ...(seta
                  ? [
                      feicao({ [PROP_PARTE]: PARTE.seta }, { type: 'LineString', coordinates: seta.haste }),
                      feicao({ [PROP_PARTE]: PARTE.seta }, { type: 'Polygon', coordinates: [seta.ponta] }),
                    ]
                  : []),
              ]
            : [],
        ),
    },
    pessoa: {
      chave: pessoa ? `${chavePonto(pessoa.ponto)}|${pessoa.encaixada}|${pessoa.raioPrecisaoM === null ? '-' : Math.round(pessoa.raioPrecisaoM)}` : '-',
      dados: () => {
        if (!pessoa) return colecao([])
        const ponto = feicao({ [PROP_ENCAIXADA]: pessoa.encaixada }, { type: 'Point', coordinates: pessoa.ponto })
        if (pessoa.encaixada || pessoa.raioPrecisaoM === null) return colecao([ponto])
        const regua = criarRegua(pessoa.ponto[1])
        const anel = circuloPrecisao(pessoa.ponto, pessoa.raioPrecisaoM, regua)
        return colecao([feicao({}, { type: 'Polygon', coordinates: [anel] }), ponto])
      },
    },
  }
}

/** A seta da pessoa: um triângulo em metros no ponto dela, ou nada (sem pessoa ou sem direção). */
function dadosDaSeta(cena: Cena, graus: number | null): DadosFonte {
  const pessoa = cena.pessoa
  if (!pessoa || graus === null) return { chave: '-', dados: () => colecao([]) }
  return {
    chave: `${chavePonto(pessoa.ponto)}|${Math.round(graus)}`,
    dados: () => colecao([feicao({}, { type: 'Polygon', coordinates: [setaDaPessoa(pessoa.ponto, graus, criarRegua(pessoa.ponto[1]))] })]),
  }
}

/* ---------- acessibilidade do canvas ---------- */

/** O nome acessível é da figura (seção 10): o canvas sai da ordem de foco e da árvore. */
function calarCanvas(mapa: MapaGL) {
  const canvas = mapa.getCanvas()
  canvas.setAttribute('tabindex', '-1')
  canvas.setAttribute('aria-hidden', 'true')
  for (const alvo of [canvas, mapa.getCanvasContainer()]) {
    alvo.removeAttribute('role')
    alvo.removeAttribute('aria-label')
  }
}

/* ---------- motor ---------- */

export async function criarMotor(el: HTMLElement, opcoes: OpcoesMotor): Promise<MotorMapa> {
  const falharAntes = (motivo: MotivoFalha): never => {
    opcoes.aoFalhar(motivo)
    throw new ErroMotorMapa(motivo)
  }

  if (!temWebGL()) falharAntes('sem_webgl')

  if (!protocolo) {
    protocolo = new Protocol()
    addProtocol('pmtiles', protocolo.tile)
  }
  setWorkerUrl(urlDoWorker)

  // Pré-verificação: o arquivo existe e responde (cobre o bucket vazio, 503 e rede).
  const arquivo = new PMTiles(new FonteSemCache(URL_MAPA))
  try {
    await comPrazo(arquivo.getHeader(), PRAZO_MS)
  } catch {
    falharAntes('nao_carregou')
  }
  protocolo.add(arquivo) // o protocolo reaproveita o cabeçalho já lido

  const [oeste, sul, leste, norte] = CAIXA_AREA
  let tema = temaDoAparelho()
  const mapa = new MapaGL({
    container: el,
    style: estiloDo(tema),
    center: [(oeste + leste) / 2, (sul + norte) / 2],
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    pitch: 0,
    maxPitch: INCLINACAO_GRAUS,
    pixelRatio: Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, PIXEL_RATIO_MAX),
    maxTileCacheSize: 30,
    refreshExpiredTiles: false,
    maxBounds: [
      [oeste - MARGEM_CAIXA_GRAUS, sul - MARGEM_CAIXA_GRAUS],
      [leste + MARGEM_CAIXA_GRAUS, norte + MARGEM_CAIXA_GRAUS],
    ],
    minZoom: ZOOM_MIN,
    maxZoom: ZOOM_MAX,
    zoom: ZOOM_NAVEGACAO,
    locale: { 'Map.Title': '' },
  })
  calarCanvas(mapa)

  let destruido = false
  let estiloPronto = false
  let ultima: { cena: Cena; girar: boolean; inclinada: boolean } | null = null
  /** Rumo que a câmera já tem (ou para onde está girando). */
  let rumoAtual = 0
  /** Inclinação que a câmera já tem: 0 ou INCLINACAO_GRAUS. */
  let inclinacaoAtual = 0
  /** Direção da seta da pessoa: só o último número, em memória. */
  let direcao: number | null = null
  let chaves: Record<string, string> = {}
  let quadro: number | null = null
  /** Centro, margem e rumo da última câmera aplicada no modo seguir; null depois de enquadrar ou congelar. */
  let ultimaCamera: string | null = null
  let errosOutros = 0
  el.dataset.estilo = 'carregando'
  el.dataset.rumo = '0'
  el.dataset.inclinacao = '0'
  el.dataset.predios = 'nao'

  // Vigia de tiles: avisa uma vez se faltam partes (3 erros ou 8 s sem idle depois da 1ª câmera).
  let errosTile = 0
  let avisouParte = false
  let prazoIdle: ReturnType<typeof setTimeout> | null = null
  let vigiaArmada = false
  const avisarParte = () => {
    if (avisouParte || destruido) return
    avisouParte = true
    opcoes.aoFaltarParte()
  }
  const pararPrazoIdle = () => {
    if (prazoIdle !== null) clearTimeout(prazoIdle)
    prazoIdle = null
  }

  /**
   * Os prédios em volume só aparecem com a vista inclinada, nunca no alto contraste (a camada
   * nem existe nesse estilo) e nunca para quem pede mais contraste.
   */
  function mostrarPredios() {
    if (destruido || !estiloPronto) return
    const visivel =
      inclinacaoAtual > 0 && tema !== 'contraste' && !consultar(CONSULTA_MAIS_CONTRASTE)?.matches && mapa.getLayer(CAMADA_PREDIOS_3D) !== undefined
    el.dataset.predios = visivel ? 'sim' : 'nao'
    if (mapa.getLayer(CAMADA_PREDIOS_3D) === undefined) return
    mapa.setLayoutProperty(CAMADA_PREDIOS_3D, 'visibility', visivel ? 'visible' : 'none')
  }

  /** A troca de plano é sempre um salto (nunca anima), com ou sem movimento reduzido. */
  function inclinar(graus: number) {
    if (graus === inclinacaoAtual) return
    inclinacaoAtual = graus
    el.dataset.inclinacao = String(graus)
    mostrarPredios()
  }

  mapa.on('style.load', () => {
    estiloPronto = true
    chaves = { seta: '-' } // estilo novo nasce com as fontes vazias
    mostrarPredios()
    agendarDados()
  })
  mapa.on('load', () => calarCanvas(mapa))
  mapa.on('idle', () => {
    pararPrazoIdle()
    // o estilo inteiro (camadas, letra, fontes de dados) desenhou ao menos uma vez
    if (estiloPronto) el.dataset.estilo = 'carregado'
  })
  const informarRumo = () => {
    if (destruido) return
    const rumo = normalizarRumo(mapa.getBearing())
    el.dataset.rumo = String(Math.round(rumo) % 360)
    opcoes.aoMudarRumo?.(rumo)
  }
  mapa.on('rotate', informarRumo)
  mapa.on('moveend', () => {
    informarRumo()
    if (APOIO_E2E) {
      const c = mapa.getCenter()
      el.dataset.centro = `${c.lng.toFixed(CASAS_CHAVE)},${c.lat.toFixed(CASAS_CHAVE)}`
    }
  })
  mapa.on('webglcontextlost', () => {
    if (!destruido) opcoes.aoFalhar('nao_carregou')
  })
  mapa.on('error', (ev) => {
    // Com um ouvinte de error, o MapLibre não registra o erro por conta própria.
    // Erro de tile chega com sourceId/tile; os demais não contam para "parte faltando".
    const deTile = ev as { sourceId?: string; tile?: unknown }
    if (deTile.tile === undefined && deTile.sourceId === undefined) {
      // estilo, letra, setData...: não é "parte faltando", mas fica contado (sem a mensagem, que
      // pode citar endereços) para os testes de ponta a ponta verem um mapa em branco
      errosOutros += 1
      el.dataset.errosMapa = String(errosOutros)
      return
    }
    errosTile += 1
    if (errosTile >= LIMITE_ERROS_TILE) avisarParte()
  })

  function escreverDados() {
    quadro = null
    if (destruido || !estiloPronto || !ultima || document.hidden) return
    const fontes: Record<string, DadosFonte> = { ...dadosDaCena(ultima.cena), seta: dadosDaSeta(ultima.cena, direcao) }
    for (const [id, { chave, dados }] of Object.entries(fontes)) {
      if (chaves[id] === chave) continue
      const fonte = mapa.getSource<GeoJSONSource>(id)
      if (!fonte) continue
      void fonte.setData(dados() as Parameters<GeoJSONSource['setData']>[0])
      chaves[id] = chave
    }
  }

  function agendarDados() {
    if (quadro !== null || destruido) return
    quadro = requestAnimationFrame(escreverDados)
  }

  function armarVigia() {
    if (vigiaArmada) return
    vigiaArmada = true
    prazoIdle = setTimeout(avisarParte, PRAZO_MS)
  }

  /** instantaneo: ao voltar à aba, tudo vai num jumpTo só, sem giro animado. */
  function aplicarCamera(cena: Cena, girar: boolean, inclinada: boolean, instantaneo: boolean) {
    const camera = cena.camera
    const inclinacao = inclinada ? INCLINACAO_GRAUS : 0
    if (camera.modo === 'congelar') {
      // Congelado não mexe no centro, mas a escolha da vista vale agora (o rótulo já diz como está).
      if (inclinacao !== inclinacaoAtual) {
        mapa.jumpTo({ pitch: inclinacao })
        inclinar(inclinacao)
      }
      // Congelado não mexe no centro. Mas, se a pessoa desligou "Girar", o rótulo já diz
      // "norte para cima": o mapa volta ao norte agora, pela mesma regra do giro.
      if (!girar && rumoAtual !== 0) {
        if (instantaneo || opcoes.reduzido()) mapa.jumpTo({ bearing: 0 })
        else mapa.rotateTo(0, { duration: DURACAO_GIRO_MS, easing: suavizarSaida })
        rumoAtual = 0
      }
      ultimaCamera = null
      return
    }
    if (camera.modo === 'enquadrar') {
      // o passo inteiro é visto de cima: inclinado, o fundo do enquadramento encolheria
      if (inclinacaoAtual !== 0) {
        mapa.jumpTo({ pitch: 0 })
        inclinar(0)
      }
      mapa.fitBounds(camera.caixa, { animate: false, padding: MARGEM_ENQUADRAR_PX, bearing: 0 })
      rumoAtual = 0
      ultimaCamera = null
      armarVigia()
      return
    }
    const alvo = girar ? camera.rumo : 0
    const padding = {
      // girado ou inclinado, a pessoa fica no terço de baixo: o que vem pela frente ganha a tela
      top: camera.pessoaAbaixo || inclinada ? Math.round(el.clientHeight * FRACAO_PESSOA_ABAIXO) : 0,
      bottom: 0,
      left: 0,
      right: 0,
    }
    // a inclinação só entra no salto quando muda: sem animação, com ou sem movimento reduzido
    const posicao =
      inclinacao !== inclinacaoAtual || instantaneo
        ? { center: camera.centro, zoom: ZOOM_NAVEGACAO, padding, pitch: inclinacao }
        : { center: camera.centro, zoom: ZOOM_NAVEGACAO, padding }
    const mudou = alvo !== rumoAtual
    const chave = `${chavePonto(camera.centro)}|${padding.top}|${alvo}|${inclinacao}`
    // o tique de 1 s com a pessoa parada não redesenha nada
    if (!instantaneo && !mudou && chave === ultimaCamera) return
    if (instantaneo || (mudou && opcoes.reduzido())) {
      mapa.jumpTo({ ...posicao, bearing: alvo })
    } else if (mudou) {
      mapa.jumpTo(posicao)
      mapa.rotateTo(alvo, { duration: DURACAO_GIRO_MS, easing: suavizarSaida })
    } else if (mapa.isRotating()) {
      // O jumpTo para o giro em andamento onde ele estiver: o rumo-alvo vai junto, senão o mapa
      // fica preso num ângulo do meio até a próxima mudança de 10°. O giro termina agora.
      mapa.jumpTo({ ...posicao, bearing: alvo })
    } else {
      mapa.jumpTo(posicao)
    }
    rumoAtual = alvo
    ultimaCamera = chave
    inclinar(inclinacao)
    armarVigia()
  }

  const aoMudarVisibilidade = () => {
    if (destruido || document.hidden || !ultima) return
    aplicarCamera(ultima.cena, ultima.girar, ultima.inclinada, true)
    agendarDados()
  }
  const aoMudarEsquema = () => {
    const novo = temaDoAparelho()
    if (novo !== tema) motor.trocarTema(novo)
  }
  document.addEventListener('visibilitychange', aoMudarVisibilidade)
  const consultas = [consultar(CONSULTA_ESCURO), consultar(CONSULTA_CONTRASTE)].filter(
    (c): c is MediaQueryList => c !== null,
  )
  for (const c of consultas) c.addEventListener('change', aoMudarEsquema)
  const maisContraste = consultar(CONSULTA_MAIS_CONTRASTE)
  maisContraste?.addEventListener('change', mostrarPredios)

  const motor: MotorMapa = {
    atualizar(cena, girar, inclinada = false) {
      if (destruido) return
      ultima = { cena, girar, inclinada }
      if (document.hidden) return // guarda só a última; aplica no visibilitychange
      aplicarCamera(cena, girar, inclinada, false)
      agendarDados()
    },
    apontar(graus) {
      if (destruido) return
      direcao = graus === null || !Number.isFinite(graus) ? null : graus
      agendarDados() // o quadro seguinte reescreve a fonte da seta só se a chave mudou
    },
    trocarTema(novo) {
      if (destruido) return
      tema = novo
      estiloPronto = false
      el.dataset.estilo = 'carregando'
      mapa.setStyle(estiloDo(novo), { diff: false })
    },
    destruir() {
      if (destruido) return
      destruido = true
      document.removeEventListener('visibilitychange', aoMudarVisibilidade)
      for (const c of consultas) c.removeEventListener('change', aoMudarEsquema)
      maisContraste?.removeEventListener('change', mostrarPredios)
      direcao = null
      if (quadro !== null) cancelAnimationFrame(quadro)
      quadro = null
      pararPrazoIdle()
      ultima = null
      mapa.remove() // solta o WebGL, o worker e os pedidos pendentes
    },
  }
  return motor
}

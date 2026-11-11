/**
 * O que a casca do mapa só precisa com o mapa aberto: a cena, a escolha da direção da seta e a
 * escuta da bússola. Chunk lazy, baixado junto com o motor (import() à mão em MapaNavegacao.tsx):
 * a página da navegação, que carrega no celular na rua, não leva este código (orçamento de bundle).
 *
 * LGPD (emenda de 10/11/2026 da spec do mapa, 19.4): a bússola só é ouvida entre `ouvirBussola` e
 * `parar`; guarda uma única leitura, em memória, que some ao parar. Nada é gravado, registrado ou
 * enviado, e a leitura não vai para o DOM. A rotação do mapa não usa a bússola: só a seta.
 */
import {
  criarSuavizador,
  deveAtualizar,
  DIRECAO,
  escolherDirecao,
  rumoDoEvento,
  type Direcao,
  type EventoOrientacao,
} from '../../dados/navegacao/direcaoSeta'
import { rumoDaRotaAgora } from '../../dados/navegacao/mapaNavegacao'
import type { EstadoNavegacao } from '../../dados/navegacao/navegacao'

export { cenaDoMapa } from '../../dados/navegacao/mapaNavegacao'

export type LeituraBussola = { graus: number; emMs: number }
export type OuvinteBussola = { leitura(): LeituraBussola | null; parar(): void }

/** A seta da pessoa: bússola → caminhada (GPS) → rota → nenhuma (null = anel sem seta). */
export function direcaoDaSeta(e: EstadoNavegacao, bussola: LeituraBussola | null, agoraMs: number): Direcao | null {
  const l = e.ultimaLeitura
  return escolherDirecao({
    agoraMs,
    bussola,
    gps: l ? { rumoGraus: l.rumoGraus, velocidadeMps: l.velocidadeMps, tMs: l.tMs } : null,
    rumoRota: rumoDaRotaAgora(e),
  })
}

/** screen.orientation.angle; no Safari antigo, window.orientation (que pode ser negativo). */
function anguloDaTela(): number {
  const angulo = (globalThis as { screen?: { orientation?: { angle?: number } } }).screen?.orientation?.angle
  if (typeof angulo === 'number') return angulo
  const antigo = (globalThis as { orientation?: number }).orientation
  return typeof antigo === 'number' ? antigo : 0
}

/**
 * Escuta a bússola do aparelho: `deviceorientationabsolute` (Chrome no Android) e
 * `deviceorientation` (iPhone, com `webkitCompassHeading`). Suaviza por média circular e chama
 * `aoMudar` no máximo a cada 250 ms e só com 5° ou mais de diferença. Com a aba escondida, ignora.
 */
export function ouvirBussola(aoMudar: () => void): OuvinteBussola {
  const suavizador = criarSuavizador()
  let emitida: LeituraBussola | null = null
  let atual: LeituraBussola | null = null

  const aoOrientar = (ev: Event) => {
    if (document.hidden) return
    const rumo = rumoDoEvento(ev as EventoOrientacao, anguloDaTela())
    if (rumo === null) return // leitura não confiável: fica a anterior, que vence em 3 s
    const agora = Date.now()
    const graus = suavizador.somar(rumo)
    if (deveAtualizar(emitida, graus, agora)) {
      emitida = { graus, emMs: agora }
      atual = emitida
      aoMudar()
    } else if (atual) {
      // parado: a seta não muda, mas a leitura continua valendo
      const vencida = agora - atual.emMs > DIRECAO.VALIDADE_BUSSOLA_MS
      atual = { graus: atual.graus, emMs: agora }
      // a bússola tinha ficado muda (e a seta caído para outra fonte): ela volta a valer agora
      if (vencida) aoMudar()
    }
  }

  window.addEventListener('deviceorientationabsolute', aoOrientar)
  window.addEventListener('deviceorientation', aoOrientar)
  return {
    leitura: () => atual,
    parar() {
      window.removeEventListener('deviceorientationabsolute', aoOrientar)
      window.removeEventListener('deviceorientation', aoOrientar)
      atual = null
      emitida = null
      suavizador.zerar()
    },
  }
}

/**
 * A linha "quanto falta" junto dos controles (emenda de 10/11/2026 da spec do mapa, 19.1):
 * distância até o destino e "Passo X de Y". Sem tempo restante (o ritmo de cadeira, andador e
 * caminhada varia demais para prometer minutos). Puro; o texto fica parado na tela, nunca é anunciado.
 */
import { distanciaNaTela } from './falasNavegacao'
import type { EstadoNavegacao } from './navegacao'

export type ResumoCaminho = {
  /** "Faltam 190 m até o destino." ou null quando a distância não vale (fora da rota). */
  falta: string | null
  /** "Passo 2 de 5." */
  passo: string
}

function frase(metros: number, aproximado: boolean): string {
  const d = distanciaNaTela(metros)
  const verbo = d === '1 m' ? 'Falta' : 'Faltam'
  return `${verbo} ${aproximado ? 'cerca de ' : ''}${d} até o destino.`
}

/** null nas fases sem passo na tela (preparo, procurando, chegada, sem permissão). */
export function resumoDoCaminho(e: EstadoNavegacao): ResumoCaminho | null {
  const passos = e.rota.passos
  const atual = passos[e.passoAtual]
  if (!atual) return null
  const passo = `Passo ${atual.ordem} de ${passos.length}.`

  if (e.fase === 'passo_a_passo') {
    // sem GPS: o que falta a partir do começo deste passo, pelo comprimento dos passos
    const resto = e.contexto.comprimentosM.slice(e.passoAtual).reduce((soma, m) => soma + m, 0)
    return { falta: `Do começo deste passo até o destino: ${distanciaNaTela(resto)}.`, passo }
  }

  const acompanhando = e.fase === 'navegando' || (e.fase === 'pausada' && e.faseAntesDaPausa === 'navegando')
  if (!acompanhando || !e.trajeto) return null
  // fora da rota a distância pela rota não vale: fica só o passo
  if (e.acompanhamento.fora) return { falta: null, passo }
  const resto = Math.max(0, e.trajeto.totalM - e.acompanhamento.progressoMaxM)
  return { falta: frase(resto, e.acompanhamento.sinal !== 'bom'), passo }
}

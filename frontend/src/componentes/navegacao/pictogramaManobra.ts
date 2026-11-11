import type { Passo } from '../../dados/passo'
import type { NomePictograma } from '../pictogramas'

const LEVE = /ligeiramente|levemente|mantenha/i
const RETORNO = /retorno|meia[- ]volta/i

/**
 * O desenho da manobra ao lado da ação no painel (emenda de 10/11/2026, 19.1). Vem do campo
 * `direcao` do passo ('siga' | 'vire_direita' | 'vire_esquerda'); o texto só refina (curva leve,
 * retorno). É decorativo: a ação escrita continua sendo a informação.
 */
export function pictogramaDaManobra(passo: Pick<Passo, 'direcao' | 'instrucao'>): NomePictograma {
  const texto = passo.instrucao
  if (RETORNO.test(texto)) return 'retorno'
  const leve = LEVE.test(texto)
  const lado =
    passo.direcao === 'vire_direita' || (passo.direcao === 'siga' && leve && /à direita/i.test(texto))
      ? 'direita'
      : passo.direcao === 'vire_esquerda' || (passo.direcao === 'siga' && leve && /à esquerda/i.test(texto))
        ? 'esquerda'
        : null
  if (lado === null) return 'em-frente'
  return leve ? (`leve-${lado}` as const) : (`vire-${lado}` as const)
}

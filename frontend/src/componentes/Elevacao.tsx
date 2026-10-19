import type { ReactNode } from 'react'
import type { Passo } from '../dados/passo'
import { Passarela } from './Passarela'
import { Torre } from './Torre'

type Props = {
  passos: Passo[]
  passoAtivo: number | null
  /** Nome acessível da lista de passos. */
  rotuloLista: string
  /** Janelas da torre da origem (à esquerda). */
  origem: ReactNode
  /** Janelas da torre do destino (à direita, mais baixa). */
  destino: ReactNode
  baseOrigem?: string
  baseDestino?: string
}

/**
 * Elevação: torre da origem, as passarelas em ziguezague descendente (um <li> por
 * passo, numa <ol> real) e a torre do destino. O chão e os conectores são desenho.
 * No celular, as passarelas viram patamares empilhados, um por linha.
 */
export function Elevacao({ passos, passoAtivo, rotuloLista, origem, destino, baseOrigem, baseDestino }: Props) {
  return (
    <div className="elevacao">
      <Torre variante="origem" base={baseOrigem}>
        {origem}
      </Torre>
      <ol className="elevacao__passos" aria-label={rotuloLista}>
        {passos.map((p, i) => (
          <Passarela key={p.ordem} passo={p} lado={i % 2 === 0 ? 'inicio' : 'fim'} ativo={p.ordem === passoAtivo} />
        ))}
      </ol>
      {/* poço de circulação da torre do destino: a parede onde os vãos pares chegam */}
      <span className="elevacao__poco" aria-hidden="true" />
      <Torre variante="destino" base={baseDestino}>
        {destino}
      </Torre>
      <div className="elevacao__desenho" aria-hidden="true">
        <span className="elevacao__chao" />
      </div>
    </div>
  )
}

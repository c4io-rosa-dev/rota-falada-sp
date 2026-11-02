import type { ReactNode } from 'react'
import type { Passo } from '../dados/passo'
import { Passarela } from './Passarela'
import { Torre } from './Torre'

type Props = {
  passos: Passo[]
  passoAtivo: number | null
  /** Nome acessível da lista de passos. */
  rotuloLista: string
  /** Conteúdo do card da rota, à esquerda. */
  origem: ReactNode
}

/**
 * Elevação: card da rota, passarelas em ziguezague descendente (um <li> por passo,
 * numa <ol> real). O chão e os conectores são desenho.
 * No celular, as passarelas viram patamares empilhados, um por linha.
 */
export function Elevacao({ passos, passoAtivo, rotuloLista, origem }: Props) {
  return (
    <div className="elevacao">
      <Torre variante="origem">
        {origem}
      </Torre>
      <ol className="elevacao__passos" aria-label={rotuloLista}>
        {passos.map((p, i) => (
          <Passarela key={p.ordem} passo={p} lado={i % 2 === 0 ? 'inicio' : 'fim'} ativo={p.ordem === passoAtivo} />
        ))}
      </ol>
      <div className="elevacao__desenho" aria-hidden="true">
        <span className="elevacao__chao" />
      </div>
    </div>
  )
}

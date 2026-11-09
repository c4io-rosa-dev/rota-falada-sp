import type { MouseEvent } from 'react'
import { levarAoPasso } from '../dados/retornoPasso'

/** "passo 5", levando ao passo na lista. */
export function LinkPasso({ ordem }: { ordem: number }) {
  function ir(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    levarAoPasso(ordem)
  }
  return (
    <a href={`#passo-${ordem}`} onClick={ir}>
      passo {ordem}
    </a>
  )
}

import { formatarDistancia, letreiroDoPasso, type Passo } from '../dados/passo'

type Props = {
  passo: Passo
  ativo?: boolean
  /** Em que torre o vão se apoia: o ziguezague alterna início e fim. */
  lado?: 'inicio' | 'fim'
}

/**
 * Um passo da rota como vão de concreto: número, nome da rua em letreiro e distância.
 * Só isso (revisão minimalista de 13/10/2026); a cota técnica completa de cada passo
 * vive na tabela da seção 4. O guarda-corpo fino acende em óxido no passo ativo.
 */
export function Passarela({ passo, ativo = false, lado = 'inicio' }: Props) {
  const classe = ['passarela', `passarela--${lado}`, ativo && 'passarela--ativa'].filter(Boolean).join(' ')

  return (
    <li className={classe} aria-current={ativo ? 'step' : undefined}>
      <div className="passarela__vao">
        <span className="passarela__ordem medida">{passo.ordem}</span>{' '}
        <span className="letreiro passarela__rua">{letreiroDoPasso(passo)}</span>{' '}
        <span className="passarela__distancia medida">{formatarDistancia(passo.distancia_m)}</span>
      </div>
    </li>
  )
}

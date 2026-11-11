import { PREFIXO_SIMULACAO } from '../../dados/navegacao/falasNavegacao'

/** Só com a simulação ligada (build de teste ou de demonstração). Em produção o texto nem existe. */
export function FaixaSimulacao() {
  return <p className="navegar__faixa">{PREFIXO_SIMULACAO}</p>
}

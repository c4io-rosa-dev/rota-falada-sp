const CHAVE_RETORNO = 'rf-voltar-passo'

/** Leva o foco e a vista ao passo da lista (o `li` tem tabIndex -1), sem animação. */
export function levarAoPasso(ordem: number): void {
  const alvo = document.getElementById(`passo-${ordem}`)
  if (!alvo) return
  alvo.focus()
  alvo.scrollIntoView?.({ block: 'start' })
}

/** Guarda, só nesta aba, de qual passo a pessoa saiu para ver barreiras. */
export function guardarPassoDeRetorno(ordem: number): void {
  try {
    sessionStorage.setItem(CHAVE_RETORNO, String(ordem))
  } catch {
    // sem armazenamento, a volta só não restaura o lugar
  }
}

/** Lê e apaga o passo de retorno: vale para uma volta só. */
export function tirarPassoDeRetorno(): number | null {
  try {
    const valor = sessionStorage.getItem(CHAVE_RETORNO)
    sessionStorage.removeItem(CHAVE_RETORNO)
    const ordem = Number(valor)
    return valor !== null && Number.isInteger(ordem) && ordem > 0 ? ordem : null
  } catch {
    return null
  }
}

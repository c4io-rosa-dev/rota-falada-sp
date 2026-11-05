import type { Anunciar } from '../componentes/useAnuncio'

/** O foco caiu no body porque o elemento focado saiu da tela (WCAG 2.4.3). */
export function focoPerdido(): boolean {
  const ativo = document.activeElement
  return ativo === null || ativo === document.body
}

/**
 * Foco ou anúncio, nunca os dois: no NVDA eles se sobrepõem. Focar o campo que já tem o foco
 * não faz o leitor falar nada, e por isso, nesse caso, a mensagem vai para a região viva.
 * A mensagem precisa estar no DOM antes (flushSync), para o foco ler a descrição nova.
 */
export function focarOuAnunciar(campo: HTMLElement | null | undefined, texto: string, anunciar: Anunciar): void {
  if (!campo || document.activeElement === campo) anunciar(texto)
  else campo.focus()
}

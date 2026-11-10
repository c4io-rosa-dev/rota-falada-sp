import { useEffect, useRef, type RefObject } from 'react'

/** Classe posta no <html> enquanto a tela cheia está ligada: a página de trás não rola. */
export const CLASSE_TELA_CHEIA = 'com-tela-cheia'

/** Quem anuncia não pode ficar inerte: a região viva única (RegiaoViva.tsx) continua valendo em tela cheia. */
const REGIAO_VIVA = '[data-regiao-viva]'

/**
 * Mapa em tela cheia como layout CSS dentro da página (emenda de 10/11/2026 da spec do mapa, 19.3).
 * Não usa a Fullscreen API, que não vale para elementos comuns no iPhone.
 *
 * Enquanto ligada:
 * - tudo o que está fora do contêiner (cabeçalho, título, rodapé) fica `inert`: o Tab e o leitor de
 *   tela não entram no que está encoberto. A região viva fica de fora e continua anunciando;
 * - a página de trás não rola;
 * - a tecla Esc sai (além do botão "Sair da tela cheia", sempre à vista).
 * Ao desligar, tudo volta como estava.
 */
export function useTelaCheia(conteiner: RefObject<HTMLElement | null>, ligada: boolean, aoSair: () => void): void {
  const sair = useRef(aoSair)

  useEffect(() => {
    sair.current = aoSair
  }, [aoSair])

  useEffect(() => {
    const el = conteiner.current
    if (!ligada || !el) return

    const inertes: Element[] = []
    for (let no: Element = el; no.parentElement && no !== document.body; no = no.parentElement) {
      for (const irmao of Array.from(no.parentElement.children)) {
        if (irmao === no || irmao.hasAttribute('inert')) continue
        if (irmao.matches(REGIAO_VIVA) || irmao.querySelector(REGIAO_VIVA)) continue
        irmao.setAttribute('inert', '')
        inertes.push(irmao)
      }
    }
    document.documentElement.classList.add(CLASSE_TELA_CHEIA)

    const aoTeclar = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || ev.defaultPrevented) return
      ev.preventDefault()
      sair.current()
    }
    document.addEventListener('keydown', aoTeclar)

    return () => {
      document.removeEventListener('keydown', aoTeclar)
      document.documentElement.classList.remove(CLASSE_TELA_CHEIA)
      for (const irmao of inertes) irmao.removeAttribute('inert')
    }
  }, [conteiner, ligada])
}

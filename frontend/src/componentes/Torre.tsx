import type { ReactNode } from 'react'

type PropsTorre = {
  variante: 'origem' | 'destino' | 'fachada' | 'anexo'
  /** Letreiro discreto no embasamento (nome da rua da torre). */
  base?: string
  className?: string
  children: ReactNode
}

/** Plano liso de concreto cujas janelas emolduram o conteúdo. Sem ornamento. */
export function Torre({ variante, base, className, children }: PropsTorre) {
  const classe = ['torre', `torre--${variante}`, className].filter(Boolean).join(' ')
  return (
    <div className={classe}>
      {children}
      {base && (
        <p className="torre__base">
          <span className="letreiro">{base}</span>
        </p>
      )}
    </div>
  )
}

type PropsJanela = {
  /** Nome da área da torre onde a janela é aberta. */
  area: string
  className?: string
  children: ReactNode
}

/** Recorte na torre, com junta de 1 px, que emoldura um conteúdo real. */
export function Janela({ area, className, children }: PropsJanela) {
  const classe = ['janela', `janela--${area}`, className].filter(Boolean).join(' ')
  return <div className={classe}>{children}</div>
}

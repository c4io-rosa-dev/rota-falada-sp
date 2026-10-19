import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router'
import { Pictograma } from './Pictograma'
import type { NomePictograma } from './pictogramas'

type Comum = {
  /** ação: caixilho óxido e 56 px; neutra: caixilho de junta e 44 px. */
  variante?: 'acao' | 'neutra'
  pictograma?: NomePictograma
  children: ReactNode
  className?: string
}

type PlacaLink = Comum & { para: string }
type PlacaBotao = Comum & { para?: undefined } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>

/** Laje de concreto com caixilho de 2 px e canto vivo. Vira Link com `para`, senão botão. */
export function Placa(props: PlacaLink | PlacaBotao) {
  const { variante = 'neutra', pictograma, children, className } = props
  const classe = ['placa', `placa--${variante}`, className].filter(Boolean).join(' ')
  const miolo = (
    <>
      <span className="placa__texto letreiro">{children}</span>
      {pictograma && <Pictograma nome={pictograma} className="placa__picto" />}
    </>
  )

  if (props.para !== undefined) {
    return (
      <Link to={props.para} className={classe}>
        {miolo}
      </Link>
    )
  }

  // as props próprias da placa não vão para o <button>
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { variante: _v, pictograma: _p, children: _c, className: _cl, para: _para, type = 'button', ...resto } = props as PlacaBotao
  return (
    <button {...resto} type={type} className={classe}>
      {miolo}
    </button>
  )
}

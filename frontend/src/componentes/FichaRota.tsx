import { Fragment, type ReactNode } from 'react'
import { Pictograma } from './Pictograma'

type Props = {
  resumo: ReactNode
  dados: { rotulo: string; valor: ReactNode }[]
  avisos: string[]
  /** Fixa só na landing; em /rota nada fixo pode cobrir o foco. */
  solta?: boolean
  children?: ReactNode
}

export function FichaRota({ resumo, dados, avisos, solta = false, children }: Props) {
  return (
    <div className={solta ? 'ficha ficha--solta' : 'ficha'}>
      <p className="ficha__resumo">{resumo}</p>
      <dl className="ficha__dados">
        {dados.map((d) => (
          <Fragment key={d.rotulo}>
            <dt>{d.rotulo}</dt>
            <dd>{d.valor}</dd>
          </Fragment>
        ))}
      </dl>
      {avisos.map((texto, i) => (
        // avisos podem repetir o tipo: a chave é a posição
        <p key={i} className="aviso">
          <Pictograma nome="fonte" />
          <span>{texto}</span>
        </p>
      ))}
      {children}
    </div>
  )
}

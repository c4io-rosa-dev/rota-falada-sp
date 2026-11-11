import { Fragment, type ReactNode } from 'react'
import { Pictograma } from './Pictograma'

export type AvisoDaFicha = { conteudo: ReactNode; grave?: boolean }

type Props = {
  resumo: ReactNode
  dados: { rotulo: string; valor: ReactNode }[]
  avisos: AvisoDaFicha[]
  /** Com título, os avisos ganham um h3: quem navega por títulos chega direto a eles. */
  tituloAvisos?: string
  /** Fixa só na landing; em /rota nada fixo pode cobrir o foco. */
  solta?: boolean
  children?: ReactNode
}

export function FichaRota({ resumo, dados, avisos, tituloAvisos, solta = false, children }: Props) {
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
      {tituloAvisos && avisos.length > 0 && <h3 className="letreiro ficha__titulo-avisos">{tituloAvisos}</h3>}
      {avisos.map((aviso, i) => (
        // avisos podem repetir o tipo: a chave é a posição
        <p key={i} className={aviso.grave ? 'aviso aviso--grave' : 'aviso'}>
          <Pictograma nome={aviso.grave ? 'alerta' : 'fonte'} />
          <span>{aviso.conteudo}</span>
        </p>
      ))}
      {children}
    </div>
  )
}

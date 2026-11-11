import { useId, useRef, useState, type ReactNode } from 'react'
import { Placa } from '../Placa'
import type { NomePictograma } from '../pictogramas'
import { ConfirmarEncerrar } from './ConfirmarEncerrar'

type Controle = {
  rotulo: string
  pictograma?: NomePictograma
  aoTocar: () => void
  /** aria-disabled com guarda no clique: o botão continua focável e anunciado. */
  inativo?: boolean
  /** Por que está inativo; fica à vista logo abaixo e é a descrição acessível do botão. */
  dica?: string
  pressionado?: boolean
  acao?: boolean
}

type Props = {
  controles: Controle[]
  aoEncerrar: () => void
  /** Texto extra abaixo dos controles, se houver (ex.: aviso de tela). */
  children?: ReactNode
}

/**
 * Os controles numa ordem fixa, empilhados, sem barra fixa (zoom de 400% e 320 px). Encerrar
 * fica separado por espaço extra e pede confirmação na própria linha.
 */
export function ControlesNavegacao({ controles, aoEncerrar, children }: Props) {
  const [confirmando, setConfirmando] = useState(false)
  const encerrar = useRef<HTMLButtonElement>(null)
  const base = useId()

  return (
    <div className="controles" role="group" aria-label="Controles da navegação">
      {controles.map((c, i) => {
        const idDica = c.dica ? `${base}-dica-${i}` : undefined
        return (
          <div key={c.rotulo} className="controles__item">
            <Placa
              variante={c.acao ? 'acao' : 'neutra'}
              pictograma={c.pictograma}
              aria-pressed={c.pressionado}
              aria-disabled={c.inativo || undefined}
              aria-describedby={idDica}
              onClick={() => {
                if (!c.inativo) c.aoTocar()
              }}
              className="controles__placa"
            >
              {c.rotulo}
            </Placa>
            {c.dica && (
              <p id={idDica} className="campo__dica controles__dica">
                {c.dica}
              </p>
            )}
          </div>
        )
      })}
      <div className="controles__encerrar">
        <Placa ref={encerrar} onClick={() => setConfirmando(true)} className="controles__placa">
          Encerrar
        </Placa>
        {confirmando && (
          <ConfirmarEncerrar
            aoConfirmar={aoEncerrar}
            aoDesistir={() => {
              setConfirmando(false)
              encerrar.current?.focus()
            }}
          />
        )}
      </div>
      {children}
    </div>
  )
}

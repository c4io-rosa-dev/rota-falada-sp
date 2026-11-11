import { useEffect, useRef } from 'react'
import { Placa } from '../Placa'

type Props = { aoConfirmar: () => void; aoDesistir: () => void }

/** A pergunta aparece na própria linha e recebe o foco; o foco já lê a pergunta, sem anúncio. */
export function ConfirmarEncerrar({ aoConfirmar, aoDesistir }: Props) {
  const pergunta = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    pergunta.current?.focus()
  }, [])

  return (
    <div className="confirmar">
      <p ref={pergunta} tabIndex={-1} className="confirmar__pergunta">
        Encerrar a navegação?
      </p>
      <div className="confirmar__opcoes">
        <Placa onClick={aoConfirmar}>Sim, encerrar</Placa>
        <Placa onClick={aoDesistir}>Continuar navegando</Placa>
      </div>
    </div>
  )
}

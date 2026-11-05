import { useEffect, useId, useRef, type RefObject } from 'react'
import { MSG_LOGIN_DESLIGADO } from '../auth/config'
import { useSessao } from '../auth/useSessao'
import { FluxoCodigo } from './FluxoCodigo'
import { Placa } from './Placa'

type Props = {
  motivo: 'primeira' | 'expirou'
  aoEntrar: () => void
  aoCancelar: () => void
  /** Para onde o foco volta quando o portão fecha: o que o tinha some com ele (WCAG 2.4.3). */
  refRetorno: RefObject<HTMLElement | null>
  /** O título, para quem pede a ação de novo com o portão aberto levar o foco até aqui. */
  refTitulo?: RefObject<HTMLHeadingElement | null>
}

/** Login na própria página, sem modal nem troca de rota: o formulário e a foto continuam montados. */
export function PortaoLogin({ motivo, aoEntrar, aoCancelar, refRetorno, refTitulo }: Props) {
  const { disponivel, aoEntrar: marcarLogado } = useSessao()
  const proprio = useRef<HTMLHeadingElement>(null)
  const titulo = refTitulo ?? proprio
  // uma página pode ter dois portões: voto e foto, decisão e auditoria
  const idTitulo = useId()

  useEffect(() => {
    titulo.current?.focus()
  }, [titulo])

  return (
    <section className="portao" aria-labelledby={idTitulo}>
      <h2 id={idTitulo} ref={titulo} tabIndex={-1} className="letreiro portao__titulo">
        {motivo === 'expirou' ? 'Sua sessão terminou' : 'Entre para continuar'}
      </h2>
      {!disponivel ? (
        <p>{MSG_LOGIN_DESLIGADO}</p>
      ) : (
        <>
          <p>
            {motivo === 'expirou'
              ? 'O que você escreveu continua aqui. Depois do código, a mesma ação é refeita.'
              : 'Pedimos um código no seu e-mail só desta vez. O que você escreveu continua aqui.'}
          </p>
          <FluxoCodigo
            aoEntrar={() => {
              marcarLogado()
              // antes da ação: se o que estava na tela ficou inválido, o erro leva o foco ao campo
              refRetorno.current?.focus()
              aoEntrar()
            }}
          />
        </>
      )}
      <Placa
        onClick={() => {
          refRetorno.current?.focus()
          aoCancelar()
        }}
      >
        Cancelar
      </Placa>
    </section>
  )
}

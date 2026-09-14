import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'

export function Inicio() {
  const h1 = usePaginaAcessivel('Início')
  return (
    <>
      <h1 ref={h1} tabIndex={-1}>
        Rota Falada SP
      </h1>
      <p>
        Rotas a pé em São Paulo que evitam escadas, calçadas estreitas e outras barreiras,
        descritas em texto e lidas em voz alta.
      </p>
      <p>O cálculo de rotas ainda não está disponível nesta versão.</p>
    </>
  )
}

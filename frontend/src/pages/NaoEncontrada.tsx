import { Link } from 'react-router'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'

export function NaoEncontrada() {
  const h1 = usePaginaAcessivel('Página não encontrada')
  return (
    <>
      <h1 ref={h1} tabIndex={-1}>
        Página não encontrada
      </h1>
      <p>Este endereço não existe no Rota Falada SP.</p>
      <p>
        <Link className="alvo" to="/rota">
          Planejar uma rota
        </Link>
      </p>
    </>
  )
}

import { NavLink } from 'react-router'
import { useSessao } from './useSessao'

/** "Entrar" ou "Conta" no menu; sem login configurado, nada. */
export function LinkConta() {
  const { disponivel, logado } = useSessao()
  if (!disponivel) return null
  return (
    <li>
      <NavLink className="alvo" to={logado ? '/conta' : '/entrar'}>
        {logado ? 'Conta' : 'Entrar'}
      </NavLink>
    </li>
  )
}

import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'
import { MSG_LOGIN_DESLIGADO, voltaSegura } from '../auth/config'
import { useSessao } from '../auth/useSessao'
import { FluxoCodigo } from '../componentes/FluxoCodigo'
import '../estilos/colaborar.css'

export function Entrar() {
  const h1 = usePaginaAcessivel('Entrar')
  const { disponivel, logado, aoEntrar } = useSessao()
  const [parametros] = useSearchParams()
  const navegar = useNavigate()
  const volta = voltaSegura(parametros.get('volta'))

  if (logado) return <Navigate to={volta} replace />

  return (
    <div className="folha">
      <h1 ref={h1} tabIndex={-1}>
        Entrar
      </h1>
      {disponivel ? (
        <>
          <p>Enviaremos um código de 6 dígitos para o seu e-mail. Sem senha. Planejar rotas não precisa de conta.</p>
          <FluxoCodigo
            aoEntrar={() => {
              aoEntrar()
              navegar(volta, { replace: true })
            }}
          />
        </>
      ) : (
        <p>{MSG_LOGIN_DESLIGADO}</p>
      )}
    </div>
  )
}

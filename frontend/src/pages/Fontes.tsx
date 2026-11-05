import { useEffect } from 'react'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'
import { listarFontes } from '../api/client'
import { useConsulta } from '../api/useConsulta'
import { useAnuncio } from '../componentes/useAnuncio'
import { useEsperaServidor } from '../componentes/useEsperaServidor'
import { formatarData } from '../dados/passo'

export function Fontes() {
  const h1 = usePaginaAcessivel('Fontes de dados e licenças')
  const { dados: fontes, erro, carregando } = useConsulta('fontes', listarFontes)
  const espera = useEsperaServidor(carregando)
  const anunciar = useAnuncio()

  useEffect(() => {
    if (erro) anunciar(erro.message)
  }, [erro, anunciar])

  return (
    <>
      <h1 ref={h1} tabIndex={-1}>
        Fontes de dados e licenças
      </h1>
      <p>
        Toda informação exibida no Rota Falada SP declara de onde veio e de quando é. Esta
        página lista as fontes, suas licenças e a atribuição obrigatória de cada uma.
      </p>
      {erro && <p>{erro.message}</p>}
      {carregando && <p>{espera ?? 'Carregando fontes…'}</p>}
      {fontes && (
        <ul>
          {fontes.map((f) => (
            <li key={f.chave}>
              <a href={f.url}>{f.nome}</a>, licença {f.licenca}.{' '}
              {f.data_referencia && <>Dados de {formatarData(f.data_referencia)}. </>}
              <span>{f.atribuicao}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

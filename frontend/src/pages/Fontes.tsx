import { useEffect, useState } from 'react'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'
import { listarFontes, type Fonte } from '../api/client'

function formatarData(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR')
}

export function Fontes() {
  const h1 = usePaginaAcessivel('Fontes de dados e licenças')
  const [fontes, setFontes] = useState<Fonte[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    listarFontes()
      .then(setFontes)
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : String(e)))
  }, [])

  return (
    <>
      <h1 ref={h1} tabIndex={-1}>
        Fontes de dados e licenças
      </h1>
      <p>
        Toda informação exibida no Rota Falada SP declara de onde veio e de quando é. Esta
        página lista as fontes, suas licenças e a atribuição obrigatória de cada uma.
      </p>
      {erro && <p role="alert">{erro}</p>}
      {!fontes && !erro && <p role="status">Carregando fontes…</p>}
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

import { Link } from 'react-router'
import { rotuloCategoria } from '../dados/categorias'
import { textoBarreira, type BarreiraResumo } from '../dados/passo'

/**
 * Só `dificulta` chega ao passo: intransponível vira desvio e pendente não entra na rota.
 * Por isso a lista vazia não vira "sem barreiras". O id oficial não é de
 * barreira_colaborativa: só a colaborativa leva à ficha.
 */
export function BarreirasDoPasso({ barreiras }: { barreiras: BarreiraResumo[] }) {
  if (barreiras.length === 0) return null
  return (
    <ul className="barreiras-passo">
      {barreiras.map((b) => (
        <li key={`${b.origem}-${b.id}`}>
          {textoBarreira(b)}
          {b.origem === 'colaborativa' && (
            <Link
              className="alvo barreiras-passo__link"
              to={`/barreiras/${b.id}`}
              aria-label={`Ver e votar: ${rotuloCategoria(b.categoria)}, a ${Math.round(b.distancia_m)} m`}
            >
              Ver e votar
            </Link>
          )}
        </li>
      ))}
    </ul>
  )
}

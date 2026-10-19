import { useId } from 'react'
import { DESENHOS, type NomePictograma } from './pictogramas'

/** Pictograma autoral: grade 24, um só peso de traço (2), canto vivo. */

type Props = {
  nome: NomePictograma
  /** Com título, o pictograma é imagem com nome; sem, é decorativo. */
  titulo?: string
  tamanho?: number
  className?: string
}

export function Pictograma({ nome, titulo, tamanho = 24, className }: Props) {
  const idTitulo = useId()
  const classe = ['pictograma', className].filter(Boolean).join(' ')
  const comum = {
    className: classe,
    width: tamanho,
    height: tamanho,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'butt' as const,
    strokeLinejoin: 'miter' as const,
    focusable: 'false' as const,
    'data-pictograma': nome,
  }
  const tracos = DESENHOS[nome].map((d) => <path key={d} d={d} />)

  if (titulo) {
    return (
      <svg {...comum} role="img" aria-labelledby={idTitulo}>
        <title id={idTitulo}>{titulo}</title>
        {tracos}
      </svg>
    )
  }
  return (
    <svg {...comum} aria-hidden="true">
      {tracos}
    </svg>
  )
}

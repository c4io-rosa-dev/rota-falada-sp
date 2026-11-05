import type { components } from '../api/types.gen'

export type Categoria = components['schemas']['BarreiraIn']['categoria']

/** A lista fechada do spec colaborativo; o compilador acusa categoria faltando. */
export const CATEGORIAS: Record<Categoria, { rotulo: string; dica: string }> = {
  escada: { rotulo: 'Escada', dica: 'Degraus sem rampa ao lado.' },
  sem_rampa: { rotulo: 'Sem rampa', dica: 'Desnível sem rampa nem guia rebaixada.' },
  elevador_quebrado: { rotulo: 'Elevador quebrado', dica: 'Elevador ou plataforma fora de uso.' },
  obstaculo_bloqueando: { rotulo: 'Obstáculo bloqueando', dica: 'Algo fecha a passagem inteira.' },
  calcada_estreita: { rotulo: 'Calçada estreita', dica: 'Passa com dificuldade.' },
  rampa_ingreme: { rotulo: 'Rampa íngreme', dica: 'Existe rampa, mas é muito inclinada.' },
  buraco: { rotulo: 'Buraco', dica: 'Buraco ou trecho afundado.' },
  piso_irregular: { rotulo: 'Piso irregular', dica: 'Pedras soltas, raízes ou desníveis pequenos.' },
  sem_piso_tatil: { rotulo: 'Sem piso tátil', dica: 'Falta ou está interrompido o piso tátil.' },
  outro: { rotulo: 'Outro', dica: 'Descreva no campo de texto.' },
}

/** As categorias de `barreira_oficial` (etl/etl/sp156.py); `buraco` já está na lista acima. */
const CATEGORIAS_SP156: Record<string, string> = {
  calcada_danificada: 'Calçada danificada',
  guia_danificada: 'Guia danificada',
  guia_sem_rebaixamento: 'Guia sem rebaixamento',
  obstaculo_calcada: 'Obstáculo na calçada',
  raiz_de_arvore: 'Raiz de árvore',
  travessia: 'Travessia',
}

/** Categoria em português: "calcada" e "calçada" são palavras diferentes, e o produto é falado. */
export function rotuloCategoria(chave: string): string {
  const conhecida = CATEGORIAS[chave as Categoria]?.rotulo ?? CATEGORIAS_SP156[chave]
  if (conhecida) return conhecida
  // só o que nunca vimos: troca "_" por espaço, para não mostrar a chave crua
  const texto = chave.replaceAll('_', ' ')
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

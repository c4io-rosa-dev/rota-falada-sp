/**
 * Desenhos dos pictogramas autorais na grade 24, com um só peso de traço (2) e canto vivo,
 * o mesmo peso dos conectores da elevação. Nada de glifo unicode ou emoji.
 */
export const DESENHOS = {
  // calçada alta descendo em rampa até o leito da rua
  'guia-rebaixada': ['M2 8H8L15 17H22', 'M2 21H22'],
  // degrau vertical da guia, com a marca de impedimento
  'guia-alta': ['M2 9H11V18H22', 'M2 21H22', 'M15 4L20 9', 'M20 4L15 9'],
  // duas faces de calçada e a cota entre elas
  largura: ['M4 3V21', 'M20 3V21', 'M7 12H17', 'M10 9L7 12L10 15', 'M14 9L17 12L14 15'],
  rampa: ['M3 19H21V9Z'],
  degrau: ['M3 20H9V14H15V8H21'],
  ouvir: ['M4 9H8L13 5V19L8 15H4Z', 'M16 9.5C17.2 10.7 17.2 13.3 16 14.5', 'M18.5 7C21 9.5 21 14.5 18.5 17'],
  parar: ['M6 6H18V18H6Z'],
  siga: ['M3 12H20', 'M14 6L20 12L14 18'],
  fonte: ['M6 3H14L19 8V21H6Z', 'M14 3V8H19', 'M9 13H16', 'M9 17H16'],
  // duas torres e a passarela entre elas: a marca do Rota Falada SP
  marca: ['M3 21V4H9V21', 'M15 21V9H21V21', 'M9 12H15', 'M2 21H22'],
} as const

export type NomePictograma = keyof typeof DESENHOS

export const NOMES_PICTOGRAMA = Object.keys(DESENHOS) as NomePictograma[]


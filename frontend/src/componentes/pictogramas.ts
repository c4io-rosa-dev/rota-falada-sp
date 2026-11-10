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
  // manobras do painel da navegação: a seta sai de baixo (de onde a pessoa vem) e aponta para onde ir
  'em-frente': ['M12 21V4', 'M6 10L12 4L18 10'],
  'vire-direita': ['M6 21V9H19', 'M14 4L19 9L14 14'],
  'vire-esquerda': ['M18 21V9H5', 'M10 4L5 9L10 14'],
  'leve-direita': ['M8 21V13L17 4', 'M10 4H17V11'],
  'leve-esquerda': ['M16 21V13L7 4', 'M14 4H7V11'],
  retorno: ['M5 21V5H16V15', 'M11 10L16 15L21 10'],
  fonte: ['M6 3H14L19 8V21H6Z', 'M14 3V8H19', 'M9 13H16', 'M9 17H16'],
  // mira: o ponto onde o GPS colocou a pessoa
  localizacao: ['M12 2V7', 'M12 17V22', 'M2 12H7', 'M17 12H22', 'M8 8H16V16H8Z'],
  alerta: ['M12 3L22 21H2Z', 'M12 10V15', 'M12 17V19'],
  mais: ['M5 12H19', 'M12 5V19'],
  menos: ['M5 12H19'],
  enquadrar: ['M3 9V3H9', 'M15 3H21V9', 'M21 15V21H15', 'M9 21H3V15'],
  origem: ['M5 5H19V19H5Z', 'M10 10H14V14H10Z'],
  destino: ['M6 3V21', 'M6 4H19L15 9L19 14H6'],
  foto: ['M3 7H21V20H3Z', 'M8 7V4H16V7', 'M9 11H15V16H9Z'],
  // duas torres e a passarela entre elas: a marca do Rota Falada SP
  marca: ['M3 21V4H9V21', 'M15 21V9H21V21', 'M9 12H15', 'M2 21H22'],
} as const

export type NomePictograma = keyof typeof DESENHOS

export const NOMES_PICTOGRAMA = Object.keys(DESENHOS) as NomePictograma[]


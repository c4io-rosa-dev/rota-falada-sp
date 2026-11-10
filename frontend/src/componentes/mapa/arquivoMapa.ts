/**
 * O arquivo de tiles do mapa da navegação, servido pelo próprio Worker do site em /mapa/*
 * (mesma origem; nenhum terceiro recebe pedido de mapa).
 *
 * O nome leva a data da extração do OpenStreetMap (AAAAMMDD) e casa com a regex do Worker,
 * /^\/mapa\/rota-falada-sp-\d{8}\.pmtiles$/. Extraído do build do Protomaps de 09/11/2026
 * (19,9 MB, zoom 0 a 15). Sem o arquivo no bucket, o mapa mostra "O mapa não carregou" e a
 * navegação segue pelo painel e pela voz. Ao gerar um arquivo novo (scripts/mapa/LEIAME.md),
 * troca-se só esta linha, sempre com nome novo.
 */
export const ARQUIVO_MAPA = 'rota-falada-sp-20261109.pmtiles'
export const URL_MAPA = '/mapa/' + ARQUIVO_MAPA

/**
 * [oeste, sul, leste, norte] em graus. É a BBOX_UNIAO de etl/etl/config.py (a caixa que
 * envolve todos os retângulos de AREA_PILOTO). Se a área coberta mudar lá, muda aqui também: o teste
 * estiloMapaNavegacao.test.ts lê o config.py e quebra enquanto as duas divergirem.
 */
export const CAIXA_AREA: [number, number, number, number] = [-46.72, -23.625, -46.575, -23.51]

export const ZOOM_MIN = 14
export const ZOOM_MAX = 18

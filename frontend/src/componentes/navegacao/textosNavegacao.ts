/** Textos fixos da tela de navegação, num lugar só para o preparo e as telas sem GPS dizerem o mesmo. */

/** Avisos de rua que valem com ou sem GPS (inclusive no passo a passo). */
export const AVISO_CARROS = 'O app não vê carros, semáforos nem obras.'
export const AVISO_PARE = 'Pare para olhar a tela antes de virar.'

/**
 * Privacidade, sem promessa falsa: cada Recalcular é um POST /api/rotas comum; o servidor
 * consulta o serviço de rotas com a origem arredondada e guarda a rota calculada no cache
 * anônimo (rota_cache) por até 6 horas, como qualquer rota.
 */
/**
 * Privacidade do mapa da navegação (spec do mapa próprio, seção 11), sem prometer anonimato:
 * os pedidos de pedaços do arquivo indicam a região, o Worker não registra nada e a Cloudflare,
 * que hospeda o site, recebe os pedidos para entregá-los (sem dizer o que ela retém, que não depende
 * do código). Os pedaços vão sem cache HTTP ('no-store'). Também aparece na página Acessibilidade.
 */
export const TEXTO_MAPA_PRIVACIDADE =
  'O mapa é opcional e vem do próprio site, num arquivo só da área coberta. Para desenhar a região em volta de você, o aparelho pede ao site pedaços desse arquivo, e esses pedidos indicam a região. O site não registra esses pedidos e nenhum outro serviço recebe pedido de mapa. A Cloudflare, que hospeda o site, recebe esses pedidos para entregá-los, como qualquer acesso ao site. O mapa pede esses pedaços sem guardá-los no cache do navegador: o que foi visto some quando a aba fecha. As escolhas de mostrar e girar o mapa ficam só nesta aba.'

export const AVISO_PRIVACIDADE =
  'Sua localização fica só neste aparelho enquanto você navega. Se você tocar em Recalcular, a posição arredondada (cerca de 11 m) vai ao nosso servidor, que calcula a rota com um serviço de rotas, e a rota calculada fica guardada sem identificação por até 6 horas, como qualquer rota.' +
  ' ' +
  TEXTO_MAPA_PRIVACIDADE

/* Mapa da navegação guiada (spec do mapa próprio, seções 10.1 e 10.2). O mapa é complemento: a voz e o texto continuam valendo. */

/** Estado `carregando`: texto parado, sem spinner animado. */
export const MAPA_CARREGANDO = 'Carregando o mapa…'
/** Estado `sem_webgl`: sem "Tentar de novo". */
export const MAPA_SEM_WEBGL =
  'Este aparelho não consegue desenhar o mapa. A navegação continua pela voz e pelo texto.'
/** Estado `falhou` (import, 404, 503, prazo, contexto perdido): com "Tentar de novo". */
export const MAPA_FALHOU = 'O mapa não carregou. A navegação continua pela voz e pelo texto.'
/** Alguns pedaços do mapa faltaram, o resto desenhou. */
export const MAPA_PARTE_FALTANDO = 'Parte do mapa não carregou. Siga pelo painel.'
/** Anúncios (useAnuncio, chave 'mapa'): só as falhas, uma vez cada. */
export const MAPA_ANUNCIO_FALHOU = 'O mapa não carregou. Siga pela voz e pelo texto.'
export const MAPA_ANUNCIO_SEM_WEBGL = 'Este aparelho não consegue desenhar o mapa.'

/** Dicas (aria-describedby) das placas "Mostrar o mapa" e "Girar o mapa com a rota". */
export const DICA_MOSTRAR_MAPA = 'Opcional. A voz e o texto continuam valendo. A escolha vale só nesta aba.'
export const DICA_GIRAR_MAPA =
  'Desligado, o norte fica para cima. Ligado, segue a rota, não a bússola: não acompanha o corpo, e fora da rota volta ao norte. Vale só nesta aba.'

/**
 * aria-label do mapa: ROTULO_MAPA_NORTE ou ROTULO_MAPA_GIRADO, seguido de ROTULO_MAPA_FIM
 * (que já começa com espaço; junte com `+`). Muda só quando a preferência de girar muda, por isso
 * descreve a preferência de um jeito que vale em todos os momentos: procurando, fora da rota, em
 * sentido contrário e no passo a passo o mapa fica com o norte para cima mesmo com "Girar" ligado,
 * e nem sempre há trecho andado ou próxima virada.
 */
export const ROTULO_MAPA_NORTE = 'Mapa da rota a pé, com o norte para cima.'
export const ROTULO_MAPA_GIRADO =
  'Mapa da rota a pé. Com você na rota, ele gira no sentido em que ela segue; fora dela e no passo a passo, o norte fica para cima.'
export const ROTULO_MAPA_FIM =
  ' Mostra o trecho que falta e, quando houver, o trecho já andado e a próxima virada. Tudo o que ele mostra está no painel.'

/** Atribuição no figcaption, fora do role="img", com link para https://www.openstreetmap.org/copyright. */
export const ATRIBUICAO_MAPA = 'Mapa: Protomaps © colaboradores do OpenStreetMap'

export const ANTES_DE_SAIR = [
  `A posição pode errar alguns metros. ${AVISO_PARE}`,
  AVISO_CARROS,
  'Com a tela apagada ou o celular bloqueado, as instruções param.',
  AVISO_PRIVACIDADE,
  'Rotas recalculadas não ficam salvas neste aparelho: ao recarregar a página, volta a rota original.',
]

/** Sem GPS (rota sem desenho ou navegador sem localização): só os avisos de rua. */
export const ANTES_DE_SAIR_SEM_GPS = [AVISO_CARROS, AVISO_PARE]

export const MSG_SEM_DESENHO =
  'Esta rota não tem o desenho do caminho, então não dá para acompanhar pela localização. Você pode seguir passo a passo.'
export const MSG_SEM_LOCALIZACAO = 'Este navegador não informa a sua posição. Você pode seguir passo a passo.'
export const MSG_SEM_PERMISSAO =
  'O navegador não autorizou a localização. Sem ela não dá para acompanhar o caminho. Enquanto isso, você pode seguir passo a passo.'

/** Onde fica a permissão: no iPhone, nos ajustes do site no Safari ou nos Ajustes do aparelho; no Chrome do Android, nas permissões do site. */
export const COMO_LIBERAR = [
  'No iPhone: toque em aA na barra de endereço, Ajustes do Site, Localização, Permitir. Se não aparecer, abra Ajustes, Privacidade e Segurança, Serviços de Localização, Sites do Safari.',
  'No Android, no Chrome: toque no ícone ao lado do endereço, Permissões, Local, Permitir.',
  'Depois de liberar, toque em Tentar de novo. Se não funcionar, recarregue a página.',
]

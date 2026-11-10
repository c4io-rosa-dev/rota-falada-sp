/** Textos fixos da tela de navegação, num lugar só para o preparo e as telas sem GPS dizerem o mesmo. */

/**
 * Fora da rota, o painel troca a manobra adiante (que não vale mais) por este estado, em destaque,
 * e pelo que fazer: as mesmas palavras da fala "saiu" e do Repetir.
 */
export const PAINEL_FORA = 'Fora da rota'
export const PAINEL_FORA_O_QUE_FAZER = 'Volte para a rota ou toque em Recalcular.'

/** Avisos de rua que valem com ou sem GPS (inclusive no passo a passo). */
export const AVISO_CARROS = 'O app não vê carros, semáforos nem obras.'
export const AVISO_PARE = 'Pare para olhar a tela antes de virar.'

/**
 * Privacidade do mapa da navegação (spec do mapa próprio, seção 11), sem prometer anonimato:
 * os pedidos de pedaços do arquivo indicam a região, o Worker não registra nada e a Cloudflare,
 * que hospeda o site, recebe os pedidos para entregá-los (sem dizer o que ela retém, que não depende
 * do código). Os pedaços vão sem cache HTTP ('no-store'). Versão completa: página Acessibilidade.
 */
export const TEXTO_MAPA_PRIVACIDADE =
  'O mapa é opcional e vem do próprio site, num arquivo só da área coberta. Para desenhar a região em volta de você, o aparelho pede ao site pedaços desse arquivo, e esses pedidos indicam a região. O site não registra esses pedidos e nenhum outro serviço recebe pedido de mapa. A Cloudflare, que hospeda o site, recebe esses pedidos para entregá-los, como qualquer acesso ao site. O mapa pede esses pedaços sem guardá-los no cache do navegador: o que foi visto some quando a aba fecha. A seta que mostra para onde você está virado pode usar a bússola do aparelho: essa direção fica só no aparelho, não é guardada e não é enviada. As escolhas do mapa (mostrar, girar, inclinar e tela cheia) ficam só nesta aba.'

/**
 * Privacidade no preparo, versão curta e sem promessa falsa (a completa fica na página
 * Acessibilidade). A posição vive só na memória da página, a última leitura e nada mais. Cada
 * Recalcular é um POST /api/rotas comum: o servidor consulta o serviço de rotas com a origem
 * arredondada e guarda a rota calculada no cache anônimo (rota_cache) por até 6 horas.
 */
export const AVISO_PRIVACIDADE =
  'Sua posição, a direção e o trajeto ficam só neste aparelho e não são guardados. A posição atual só sai do aparelho quando você toca em Recalcular: vai arredondada (cerca de 11 m) ao nosso servidor e ao serviço de rotas que ele usa, e a nova rota fica guardada sem identificação por até 6 horas.'

/** O mapa, curto: os pedidos indicam a região, o site não os registra e a hospedagem os recebe. */
export const AVISO_PRIVACIDADE_MAPA =
  'Se você abrir o mapa, o aparelho pede ao site o desenho da região em volta. O site não registra esses pedidos, mas eles passam pela Cloudflare, que hospeda o site.'

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

/** Dicas (aria-describedby) das placas "Mostrar o mapa" e "Girar o mapa com a rota". A seta da pessoa é outra coisa: ela pode usar a bússola. */
export const DICA_MOSTRAR_MAPA = 'Opcional. A voz e o texto continuam valendo. A escolha vale só nesta aba.'
export const DICA_GIRAR_MAPA =
  'Desligado, o norte fica para cima. Ligado, segue a rota, não a bússola: não acompanha o corpo, e fora da rota volta ao norte. Vale só nesta aba.'

/* Emenda de 10/11/2026 da spec do mapa (seção 19): vista inclinada, tela cheia e seta da pessoa. */

/** Dica da alternância "Vista inclinada". */
export const DICA_INCLINAR_MAPA =
  'Desligada, o mapa é visto de cima. Ligada, ele inclina e mostra os prédios em volume; a troca não é animada. Vale só nesta aba.'
/** Dica da alternância "Mapa em tela cheia". */
export const DICA_TELA_CHEIA =
  'O mapa ocupa a tela, com a instrução em cima e os controles embaixo. Para sair, use o botão Sair da tela cheia ou a tecla Esc. Vale só nesta aba.'
export const ROTULO_SAIR_TELA_CHEIA = 'Sair da tela cheia'

/** De onde vem a direção da seta da pessoa: texto parado, à vista, nunca anunciado. */
export const SETA_PELA_BUSSOLA = 'Seta pela bússola: mostra para onde o aparelho está virado.'
export const SETA_PELA_CAMINHADA = 'Seta pelo sentido da caminhada.'
export const SETA_PELA_ROTA = 'Seta pelo sentido da rota.'
export const SETA_SEM_DIRECAO = 'Sem direção agora: o ponto fica sem seta.'
/** iPhone: a bússola só pode ser lida depois de um toque que peça a permissão. */
export const ROTULO_USAR_BUSSOLA = 'Usar a bússola na seta'
export const DICA_USAR_BUSSOLA =
  'O aparelho vai pedir permissão para ler a bússola. A direção fica só neste aparelho e não é guardada.'
export const BUSSOLA_NEGADA = 'A bússola não foi autorizada. A seta segue o sentido da caminhada ou da rota.'

/**
 * aria-label do mapa: ROTULO_MAPA_NORTE ou ROTULO_MAPA_GIRADO, depois ROTULO_MAPA_INCLINADO se a
 * vista inclinada está ligada, e por fim ROTULO_MAPA_FIM (os dois últimos já começam com espaço;
 * junte com `+`). Muda só quando a preferência de girar muda, por isso
 * descreve a preferência de um jeito que vale em todos os momentos: procurando, fora da rota, em
 * sentido contrário e no passo a passo o mapa fica com o norte para cima mesmo com "Girar" ligado,
 * e nem sempre há trecho andado ou próxima virada.
 */
export const ROTULO_MAPA_NORTE = 'Mapa da rota a pé, com o norte para cima.'
export const ROTULO_MAPA_GIRADO =
  'Mapa da rota a pé. Com você na rota, ele gira no sentido em que ela segue; fora dela e no passo a passo, o norte fica para cima.'
export const ROTULO_MAPA_INCLINADO = ' Vista inclinada ligada: enquanto segue você, o mapa aparece inclinado.'
export const ROTULO_MAPA_FIM =
  ' Mostra o trecho que falta e, quando houver, o trecho já andado e a próxima virada. Tudo o que ele mostra está no painel.'

/** Atribuição no figcaption, fora do role="img", com link para https://www.openstreetmap.org/copyright. */
export const ATRIBUICAO_MAPA = 'Mapa: Protomaps © colaboradores do OpenStreetMap'

export const ANTES_DE_SAIR = [
  `A posição pode errar alguns metros. ${AVISO_PARE}`,
  AVISO_CARROS,
  'Com a tela apagada ou o celular bloqueado, as instruções param.',
  AVISO_PRIVACIDADE,
  AVISO_PRIVACIDADE_MAPA,
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

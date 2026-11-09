/** Textos fixos da tela de navegação, num lugar só para o preparo e as telas sem GPS dizerem o mesmo. */

/** Avisos de rua que valem com ou sem GPS (inclusive no passo a passo). */
export const AVISO_CARROS = 'O app não vê carros, semáforos nem obras.'
export const AVISO_PARE = 'Pare para olhar a tela antes de virar.'

/**
 * Privacidade, sem promessa falsa: cada Recalcular é um POST /api/rotas comum; o servidor
 * consulta o serviço de rotas com a origem arredondada e guarda a rota calculada no cache
 * anônimo (rota_cache) por até 6 horas, como qualquer rota.
 */
export const AVISO_PRIVACIDADE =
  'Sua localização fica só neste aparelho enquanto você navega. Se você tocar em Recalcular, a posição arredondada (cerca de 11 m) vai ao nosso servidor, que calcula a rota com um serviço de rotas, e a rota calculada fica guardada sem identificação por até 6 horas, como qualquer rota.'

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

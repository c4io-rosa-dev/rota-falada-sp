import { ErroApi } from '../api/base'
import { obterToken, renovarToken, temSessaoSalva } from './cliente'

export type MotivoLogin = 'primeira' | 'expirou'

const MSG_LOGIN = 'Faça login para continuar.'

/** 401 que nem a renovação resolveu: a tela abre o portão, nunca uma frase sem saída. */
export class ErroSessao extends ErroApi {
  readonly motivo: MotivoLogin

  constructor(motivo: MotivoLogin) {
    super('sessao', MSG_LOGIN, 401)
    this.name = 'ErroSessao'
    this.motivo = motivo
  }
}

export function motivoDoLogin(erro: ErroApi): MotivoLogin {
  return erro instanceof ErroSessao ? erro.motivo : 'expirou'
}

/**
 * Único ciclo de token de todo o front: sem sessão, ErroSessao('primeira'); sessão que não dá
 * mais token ou 401 sem renovação, ErroSessao('expirou'); 401 renova e repete uma vez. O 401 sai antes de qualquer gravação no
 * backend, então repetir é seguro. Falha de rede sai como ErroApi('rede'), sem portão.
 */
export async function comSessao<T>(chamada: (token: string) => Promise<T>): Promise<T> {
  // antes de pedir o token: um refresh revogado apaga a sessão salva
  const tinhaSessao = temSessaoSalva()
  const token = await obterToken()
  if (!token) throw new ErroSessao(tinhaSessao ? 'expirou' : 'primeira')
  try {
    return await chamada(token)
  } catch (erro) {
    if (!(erro instanceof ErroApi) || erro.tipo !== 'sessao') throw erro
    const novo = await renovarToken()
    if (!novo) throw new ErroSessao('expirou')
    return chamada(novo)
  }
}

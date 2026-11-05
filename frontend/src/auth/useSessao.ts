import { createContext, useContext } from 'react'

export type Papel = 'colaborador' | 'admin'
export type Conta = { id: string; email: string; papel: Papel | null }

export type Sessao = {
  /** Há VITE_ configuradas: sem elas, rota e leituras seguem e o login some. */
  disponivel: boolean
  logado: boolean
  conta: Conta | null
  /**
   * Publica o e-mail, que é local, e depois busca o papel. Acorda o Render por GET /api/eu,
   * então só as páginas que precisam chamam. Lança ErroApi; 401 sem renovação é ErroSessao.
   */
  carregarConta: () => Promise<Conta | null>
  aoEntrar: () => void
  sair: () => Promise<void>
}

export const ContextoSessao = createContext<Sessao>({
  disponivel: false,
  logado: false,
  conta: null,
  carregarConta: async () => null,
  aoEntrar: () => {},
  sair: async () => {},
})

export function useSessao(): Sessao {
  return useContext(ContextoSessao)
}

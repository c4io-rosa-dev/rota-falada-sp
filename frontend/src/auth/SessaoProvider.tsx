import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { obterEu } from '../api/colaboracao'
import { apagarRascunho, esquecerMinhas } from '../dados/rascunho'
import { apagarSessaoRota } from '../dados/sessaoRota'
import { lerConta, sair as sairDoAuth, temSessaoSalva } from './cliente'
import { comSessao } from './comSessao'
import { lerConfigAuth } from './config'
import { ContextoSessao, type Conta } from './useSessao'

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [disponivel] = useState(() => lerConfigAuth() !== null)
  const [logado, setLogado] = useState(() => disponivel && temSessaoSalva())
  const [conta, setConta] = useState<Conta | null>(null)

  // quem saiu ou entrou nesse meio tempo: a resposta de antes não pode voltar à tela
  const geracao = useRef(0)

  const carregarConta = useCallback(async () => {
    const minha = geracao.current
    const dados = await lerConta()
    if (minha !== geracao.current) return null
    if (!dados) {
      setLogado(false)
      setConta(null)
      return null
    }
    // o e-mail é local: aparece mesmo com a API dormindo ou fora
    setConta((c) => ({ ...dados, papel: c?.id === dados.id ? c.papel : null }))
    const eu = await comSessao((token) => obterEu(token))
    if (minha !== geracao.current) return null
    const nova: Conta = { ...dados, papel: eu.papel }
    setConta(nova)
    return nova
  }, [])

  const aoEntrar = useCallback(() => {
    geracao.current += 1
    setLogado(true)
  }, [])

  const sair = useCallback(async () => {
    // antes de tudo, e sem depender de conta carregada: o aparelho pode ser de outra pessoa
    geracao.current += 1
    esquecerMinhas()
    apagarRascunho()
    apagarSessaoRota()
    await sairDoAuth()
    setLogado(false)
    setConta(null)
  }, [])

  const valor = useMemo(
    () => ({ disponivel, logado, conta, carregarConta, aoEntrar, sair }),
    [disponivel, logado, conta, carregarConta, aoEntrar, sair],
  )
  return <ContextoSessao.Provider value={valor}>{children}</ContextoSessao.Provider>
}

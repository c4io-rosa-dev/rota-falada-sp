import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'
import { ErroApi, MSG_INESPERADO } from '../api/base'
import { aquecerServidor } from '../api/servidor'
import { motivoDoLogin } from '../auth/comSessao'
import { useSessao } from '../auth/useSessao'
import { Placa } from '../componentes/Placa'
import { PortaoLogin } from '../componentes/PortaoLogin'
import { useAnuncio } from '../componentes/useAnuncio'
import { useEsperaServidor } from '../componentes/useEsperaServidor'
import '../estilos/colaborar.css'

/** Lida a cada render, pelo nome: sem o endereço configurado, nada de link quebrado. */
function contatoPrivacidade(): string | undefined {
  return import.meta.env.VITE_CONTATO_PRIVACIDADE || undefined
}

export function Conta() {
  const h1 = usePaginaAcessivel('Sua conta')
  const { logado, conta, carregarConta, sair } = useSessao()
  const [erro, setErro] = useState<ErroApi | null>(null)
  const [carregando, setCarregando] = useState(logado)
  const espera = useEsperaServidor(carregando)
  const [saindo, setSaindo] = useState(false)
  const anunciar = useAnuncio()

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      await carregarConta()
    } catch (e) {
      const erroApi = e instanceof ErroApi ? e : new ErroApi('inesperado', MSG_INESPERADO)
      setErro(erroApi)
      // o portão leva o foco ao próprio título e se lê sozinho
      if (erroApi.tipo !== 'sessao') anunciar(erroApi.message)
    } finally {
      setCarregando(false)
    }
  }, [carregarConta, anunciar])

  useEffect(() => {
    if (!logado) return
    aquecerServidor()
    void carregar()
  }, [logado, carregar])

  // quem acabou de sair vai ao início; só quem chega aqui sem sessão vai ao login
  if (!logado) return <Navigate to={saindo ? '/' : '/entrar'} replace />

  async function encerrar() {
    setSaindo(true)
    await sair()
    anunciar('Você saiu da conta.')
  }

  const faltaSessao = erro?.tipo === 'sessao'
  const contato = contatoPrivacidade()
  return (
    <div className="folha">
      <h1 ref={h1} tabIndex={-1}>
        Sua conta
      </h1>
      <p>E-mail: {conta?.email ?? (erro ? 'indisponível agora' : 'carregando…')}</p>
      <p>
        Sua conta serve para registrar barreiras e votar. Suas rotas não ficam ligadas a ela. Quem usa o site não vê quem
        registrou ou votou; a moderação vê um código da conta, nunca o e-mail, para auditoria.
      </p>
      <p>
        Para tirar dúvidas, pedir suporte ou apagar sua conta,{' '}
        {contato ? (
          <>
            escreva para <a href={`mailto:${contato}`}>{contato}</a>
          </>
        ) : (
          'fale com a equipe do projeto'
        )}
        . Se a conta for apagada, as barreiras que você registrou continuam públicas, sem autor.
      </p>
      <Placa onClick={encerrar}>Sair</Placa>
      {/* tudo o que chega depois de GET /api/eu fica abaixo de "Sair", para ele não pular sozinho (D3, D19) */}
      {carregando && <p>{espera ?? 'Carregando os dados da conta…'}</p>}
      {erro && faltaSessao && <PortaoLogin motivo={motivoDoLogin(erro)} refRetorno={h1} aoEntrar={() => void carregar()} aoCancelar={() => setErro(null)} />}
      {erro && !faltaSessao && (
        <>
          <p>{erro.message}</p>
          <Placa
            onClick={() => {
              // o botão some: o foco espera no título da página
              h1.current?.focus()
              void carregar()
            }}
          >
            Tentar de novo
          </Placa>
        </>
      )}
      {conta?.papel === 'admin' && (
        <p>
          <Link className="alvo" to="/admin">
            Painel de moderação
          </Link>
        </p>
      )}
    </div>
  )
}

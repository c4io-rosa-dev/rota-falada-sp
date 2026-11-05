import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { focoPerdido } from '../a11y/foco'
import { votar, type Barreira, type Voto } from '../api/colaboracao'
import { useAcaoComLogin } from '../auth/useAcaoComLogin'
import { useSessao } from '../auth/useSessao'
import { explicacaoVoto, ROTULO_VOTO, textoVotoRegistrado, votacaoEncerrada } from '../dados/barreira'
import { lembrarMinha } from '../dados/rascunho'
import { Placa } from './Placa'
import { PortaoLogin } from './PortaoLogin'
import { useAnuncio } from './useAnuncio'
import { useEsperaServidor } from './useEsperaServidor'

const VOTOS: Voto[] = ['confirma', 'contesta', 'resolvida']
export const MSG_AUTOR = 'Você cadastrou esta barreira; quem vota são outras pessoas.'

type Props = {
  barreira: Barreira
  ehAutor: boolean
  aoAtualizar: (b: Barreira) => void
  aoRecarregar: () => void
  aoDescobrirAutor: () => void
}

export function Votacao({ barreira, ehAutor, aoAtualizar, aoRecarregar, aoDescobrirAutor }: Props) {
  const [meuVoto, setMeuVoto] = useState<Voto | null>(null)
  const [mensagem, setMensagem] = useState<string | null>(null)
  const ultimo = useRef<Voto | null>(null)
  const botaoDoVoto = useRef<HTMLElement | null>(null)
  const fraseAutor = useRef<HTMLParagraphElement>(null)
  const descobriuAutor = useRef(false)
  const anunciar = useAnuncio()
  const { conta } = useSessao()

  const acao = useAcaoComLogin(
    (token: string, voto: Voto) => votar(token, barreira.id, voto),
    (atualizada) => {
      setMeuVoto(ultimo.current)
      setMensagem(null)
      aoAtualizar(atualizada)
      // o voto que encerra tira esta seção da tela: a ficha é quem diz o resultado
      if (votacaoEncerrada(atualizada)) return
      anunciar(textoVotoRegistrado(ultimo.current ?? 'confirma', atualizada))
    },
    { textoEnvio: 'Registrando o voto.' },
  )
  const enviando = acao.estado.fase === 'enviando'
  const espera = useEsperaServidor(enviando)

  const erro = acao.estado.fase === 'erro' ? acao.estado.erro : null
  useEffect(() => {
    if (!erro) return
    // o único 403 de PUT /voto é de autor (services/votacao.py): os botões saem da tela
    if (erro.tipo === 'permissao') {
      if (conta) lembrarMinha(conta.id, barreira.id)
      descobriuAutor.current = true
      aoDescobrirAutor()
      return
    }
    setMensagem(erro.message)
    anunciar(erro.message)
    if (erro.tipo === 'conflito' || erro.tipo === 'nao_encontrado') aoRecarregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [erro])

  useEffect(() => {
    if (!ehAutor || !descobriuAutor.current) return
    descobriuAutor.current = false
    if (focoPerdido()) fraseAutor.current?.focus()
    else anunciar(MSG_AUTOR)
  }, [ehAutor, anunciar])

  if (ehAutor) {
    return (
      <p ref={fraseAutor} tabIndex={-1}>
        {MSG_AUTOR}
      </p>
    )
  }

  function votarCom(voto: Voto, e: MouseEvent<HTMLButtonElement>) {
    if (enviando) return
    ultimo.current = voto
    botaoDoVoto.current = e.currentTarget
    void acao.executar(voto)
  }

  return (
    <section className="votacao" aria-labelledby="titulo-votacao">
      <h2 id="titulo-votacao" className="letreiro colaborar__titulo">
        Você passou por aqui?
      </h2>
      <div className="votacao__opcoes">
        {VOTOS.map((voto) => (
          <div key={voto} className="votacao__opcao">
            <Placa aria-pressed={meuVoto === voto} aria-disabled={enviando || undefined} aria-describedby={`voto-${voto}`} onClick={(e) => votarCom(voto, e)}>
              {ROTULO_VOTO[voto]}
            </Placa>
            <p id={`voto-${voto}`} className="campo__dica">
              {explicacaoVoto(voto, barreira)}
            </p>
          </div>
        ))}
      </div>
      {enviando && <p className="campo__retorno">{espera ?? 'Registrando o voto…'}</p>}
      {mensagem && <p className="campo__retorno campo__retorno--erro">{mensagem}</p>}
      <p className="campo__dica">
        Seu voto conta uma vez. Votar de novo troca o voto. Quem usa o site não vê quem votou; a moderação vê um código da
        conta, nunca o e-mail, para auditoria.
      </p>
      {acao.estado.fase === 'login' && <PortaoLogin motivo={acao.estado.motivo} refRetorno={botaoDoVoto} refTitulo={acao.refPortao} aoEntrar={acao.concluirLogin} aoCancelar={acao.cancelarLogin} />}
    </section>
  )
}

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router'
import { focarOuAnunciar, focoPerdido } from '../../a11y/foco'
import { usePaginaAcessivel } from '../../a11y/usePaginaAcessivel'
import { listarEventos, mudarStatus, obterBarreiraAdmin, removerFoto, type Barreira, type StatusBarreira } from '../../api/colaboracao'
import { useConsulta } from '../../api/useConsulta'
import { comSessao, motivoDoLogin } from '../../auth/comSessao'
import { useAcaoComLogin } from '../../auth/useAcaoComLogin'
import { Pictograma } from '../../componentes/Pictograma'
import { Placa } from '../../componentes/Placa'
import { PortaoLogin } from '../../componentes/PortaoLogin'
import { useAnuncio } from '../../componentes/useAnuncio'
import { useEsperaServidor } from '../../componentes/useEsperaServidor'
import { erroDoMotivo, SIGNIFICADO_STATUS, STATUS_TODOS, textoEfeito, textoEvento, textoStatus, textoVotos } from '../../dados/barreira'
import { rotuloCategoria } from '../../dados/categorias'
import '../../estilos/colaborar.css'
import '../../estilos/rota.css'

const MSG_SEM_PERMISSAO = 'Esta área é só para a equipe de moderação.'
const MSG_INDISPONIVEL = 'Esta barreira não está mais disponível.'

export function Decisao() {
  const { id } = useParams()
  const numero = Number(id)
  const valido = Number.isInteger(numero) && numero > 0
  const h1 = usePaginaAcessivel('Decisão da moderação')
  const navegar = useNavigate()
  const anunciar = useAnuncio()
  const [atualizada, setAtualizada] = useState<Barreira | null>(null)
  const [escolha, setEscolha] = useState<StatusBarreira | null>(null)
  const [motivo, setMotivo] = useState('')
  const [erroMotivo, setErroMotivo] = useState<string | null>(null)
  const [fotoRemovida, setFotoRemovida] = useState(false)
  const campoMotivo = useRef<HTMLTextAreaElement>(null)
  const botaoRegistrar = useRef<HTMLButtonElement>(null)
  const botaoRemover = useRef<HTMLButtonElement>(null)
  const retornoFoto = useRef<HTMLParagraphElement>(null)
  const tituloAuditoria = useRef<HTMLHeadingElement>(null)

  const ficha = useConsulta(valido ? `admin-${numero}` : null, (sinal) => comSessao((t) => obterBarreiraAdmin(t, numero, sinal)))
  const eventos = useConsulta(ficha.dados ? `eventos-${numero}` : null, (sinal) => comSessao((t) => listarEventos(t, numero, sinal)))
  const espera = useEsperaServidor(ficha.carregando)
  const barreira = atualizada ?? ficha.dados
  const statusEscolhido = escolha ?? barreira?.status ?? null

  /** O login chama de novo ao concluir: o motivo editado com o portão aberto é o que vai à auditoria. */
  function montarDecisao(): [StatusBarreira, string] | null {
    if (!statusEscolhido) return null
    const invalido = erroDoMotivo(motivo)
    flushSync(() => setErroMotivo(invalido))
    if (invalido) {
      focarOuAnunciar(campoMotivo.current, invalido, anunciar)
      return null
    }
    return [statusEscolhido, motivo.trim()]
  }

  const decisao = useAcaoComLogin(
    (token: string, status: StatusBarreira, texto: string) => mudarStatus(token, numero, status, texto),
    (nova) => {
      setAtualizada(nova)
      setMotivo('')
      setEscolha(null)
      eventos.recarregar()
      anunciar(`Status alterado para ${textoStatus(nova).toLowerCase()}. Auditoria atualizada.`)
    },
    { montarArgs: montarDecisao, textoEnvio: 'Registrando a decisão.' },
  )
  const remocao = useAcaoComLogin(
    (token: string) => removerFoto(token, numero),
    (nova) => {
      setAtualizada(nova)
      setFotoRemovida(true)
      eventos.recarregar()
    },
    { textoEnvio: 'Removendo a foto.' },
  )
  const registrando = decisao.estado.fase === 'enviando'
  const removendo = remocao.estado.fase === 'enviando'
  const esperaAcao = useEsperaServidor(registrando || removendo)

  // "Remover foto" sai da tela com o sucesso: o foco vai à frase, que se lê sozinha
  useEffect(() => {
    if (!fotoRemovida) return
    if (focoPerdido()) retornoFoto.current?.focus()
    else anunciar('Foto removida.')
  }, [fotoRemovida, anunciar])

  const falha = decisao.estado.fase === 'erro' ? decisao.estado.erro : remocao.estado.fase === 'erro' ? remocao.estado.erro : null
  useEffect(() => {
    if (falha) anunciar(falha.message)
  }, [falha, anunciar])

  // o portão leva o foco ao próprio título e se lê sozinho; os outros erros só a região diz
  const erro = ficha.erro
  const textoErro = !valido ? MSG_INDISPONIVEL : erro?.tipo === 'permissao' ? MSG_SEM_PERMISSAO : erro && erro.tipo !== 'sessao' ? erro.message : null
  useEffect(() => {
    if (textoErro) anunciar(textoErro)
  }, [textoErro, anunciar])

  const textoErroEventos = eventos.erro && eventos.erro.tipo !== 'sessao' ? eventos.erro.message : null
  useEffect(() => {
    if (textoErroEventos) anunciar(textoErroEventos)
  }, [textoErroEventos, anunciar])

  function registrar(e: FormEvent) {
    e.preventDefault()
    if (registrando) return
    const args = montarDecisao()
    if (args) void decisao.executar(...args)
  }

  return (
    <div className="folha">
      <h1 ref={h1} tabIndex={-1}>
        Decisão da moderação
      </h1>
      {ficha.carregando && !barreira && <p>{espera ?? 'Carregando a ficha…'}</p>}
      {erro?.tipo === 'sessao' && <PortaoLogin motivo={motivoDoLogin(erro)} refRetorno={h1} aoEntrar={ficha.recarregar} aoCancelar={() => navegar('/')} />}
      {textoErro && <p>{textoErro}</p>}
      {erro && erro.tipo !== 'sessao' && erro.tipo !== 'permissao' && erro.tipo !== 'nao_encontrado' && (
        <Placa
          onClick={() => {
            // o botão some: o foco espera no título da página
            h1.current?.focus()
            ficha.recarregar()
          }}
        >
          Tentar de novo
        </Placa>
      )}

      {barreira && (
        <>
          <h2>
            Nº {barreira.id}, {rotuloCategoria(barreira.categoria)}
          </h2>
          <p>
            {textoStatus(barreira)}. {textoEfeito(barreira)}
          </p>
          <p>{textoVotos(barreira)}.</p>
          {barreira.descricao && <p>{barreira.descricao}</p>}
          {barreira.foto_url && <img className="foto__previa" src={barreira.foto_url} alt={barreira.foto_descricao ?? ''} loading="lazy" />}
          {barreira.foto_url && barreira.status !== 'removida' && (
            <>
              <p className="campo__dica">Foto denunciada: remova só a foto por aqui. Marcar a barreira como removida apaga a foto de vez, mesmo que ela volte depois.</p>
              <Placa ref={botaoRemover} aria-disabled={removendo || undefined} onClick={() => void remocao.executar()}>
                Remover foto
              </Placa>
              {removendo && <p className="campo__retorno">{esperaAcao ?? 'Removendo a foto…'}</p>}
            </>
          )}
          {fotoRemovida && !barreira.foto_url && (
            <p ref={retornoFoto} tabIndex={-1} className="campo__retorno">
              Foto removida.
            </p>
          )}

          <form onSubmit={registrar} noValidate aria-label="Registrar decisão" className="decisao">
            <fieldset className="exigencia">
              <legend>Novo status</legend>
              <div className="decisao__opcoes">
                {STATUS_TODOS.map((s) => (
                  <label key={s} className="opcao opcao--dupla">
                    <input type="radio" name="status" value={s} checked={statusEscolhido === s} onChange={() => setEscolha(s)} />
                    <span>
                      {textoStatus({ status: s, severidade: barreira.severidade })}
                      <span className="opcao__dica">{SIGNIFICADO_STATUS[s]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="campo__dica">Enquanto a votação estiver aberta, um voto novo pode recalcular o status.</p>
            <div className="campo">
              <label htmlFor="motivo">Motivo</label>
              <p id="motivo-dica" className="campo__dica">
                De 3 a 300 caracteres. Fica na auditoria.
              </p>
              <textarea
                ref={campoMotivo}
                id="motivo"
                rows={3}
                maxLength={300}
                aria-invalid={erroMotivo ? true : undefined}
                aria-describedby={erroMotivo ? 'motivo-dica motivo-erro' : 'motivo-dica'}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
              {erroMotivo && (
                <p id="motivo-erro" className="campo__retorno campo__retorno--erro">
                  <Pictograma nome="alerta" />
                  <span>{erroMotivo}</span>
                </p>
              )}
            </div>
            <Placa ref={botaoRegistrar} type="submit" variante="acao" pictograma="siga" aria-disabled={registrando || undefined}>
              Registrar decisão
            </Placa>
            {registrando && <p className="campo__retorno">{esperaAcao ?? 'Registrando a decisão…'}</p>}
            {falha && <p className="campo__retorno campo__retorno--erro">{falha.message}</p>}
          </form>
          {decisao.estado.fase === 'login' && <PortaoLogin motivo={decisao.estado.motivo} refRetorno={botaoRegistrar} refTitulo={decisao.refPortao} aoEntrar={decisao.concluirLogin} aoCancelar={decisao.cancelarLogin} />}
          {remocao.estado.fase === 'login' && <PortaoLogin motivo={remocao.estado.motivo} refRetorno={botaoRemover} refTitulo={remocao.refPortao} aoEntrar={remocao.concluirLogin} aoCancelar={remocao.cancelarLogin} />}

          <h2 ref={tituloAuditoria} tabIndex={-1}>
            Auditoria
          </h2>
          {eventos.carregando && <p>Carregando a auditoria…</p>}
          {eventos.erro?.tipo === 'sessao' && <PortaoLogin motivo={motivoDoLogin(eventos.erro)} refRetorno={h1} aoEntrar={eventos.recarregar} aoCancelar={() => navegar('/')} />}
          {textoErroEventos && (
            <>
              <p>{textoErroEventos}</p>
              <Placa
                onClick={() => {
                  tituloAuditoria.current?.focus()
                  eventos.recarregar()
                }}
              >
                Tentar de novo
              </Placa>
            </>
          )}
          {eventos.dados && (
            <ol className="auditoria">
              {eventos.dados.map((ev) => (
                <li key={ev.id}>{textoEvento(ev)}</li>
              ))}
            </ol>
          )}
        </>
      )}
      <p>
        <Link className="alvo" to="/admin">
          Voltar à fila
        </Link>
      </p>
    </div>
  )
}

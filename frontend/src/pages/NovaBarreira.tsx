import { useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { useLocation, useNavigate } from 'react-router'
import { focarOuAnunciar } from '../a11y/foco'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'
import { criarBarreira, type BarreiraIn } from '../api/colaboracao'
import { aquecerServidor } from '../api/servidor'
import { useAcaoComLogin } from '../auth/useAcaoComLogin'
import { EscolhaLocal } from '../componentes/EscolhaLocal'
import { Pictograma } from '../componentes/Pictograma'
import { Placa } from '../componentes/Placa'
import { PortaoLogin } from '../componentes/PortaoLogin'
import { Janela, Torre } from '../componentes/Torre'
import { useAnuncio } from '../componentes/useAnuncio'
import { useEsperaServidor } from '../componentes/useEsperaServidor'
import { CATEGORIAS, type Categoria } from '../dados/categorias'
import { apagarRascunho, comChave, comEdicao, gravarRascunho, lerRascunho, type LocalEscolhido, type Rascunho } from '../dados/rascunho'
import '../estilos/colaborar.css'
import '../estilos/rota.css'

const MSG_FALHA_ENVIO = 'Instabilidade no sistema. O rascunho fica só nesta aba: se você a fechar, ele se perde.'

type EstadoNavegacao = { local?: LocalEscolhido } | null

/**
 * Uma única página, sem assistente: trocar de etapa sozinho ao tocar numa opção violaria
 * WCAG 3.2.2 e confundiria o NVDA, que seleciona rádio ao andar com as setas. O login vem
 * no fim, ao confirmar: ninguém digita e-mail antes de saber se vale a pena.
 */
export function NovaBarreira() {
  const h1 = usePaginaAcessivel('Registrar barreira')
  const local = useLocation()
  const estadoNav = local.state as EstadoNavegacao
  const navegar = useNavigate()
  const anunciar = useAnuncio()
  const [rascunho, setRascunho] = useState<Rascunho>(() => {
    const salvo = lerRascunho()
    const vindo = estadoNav?.local
    if (!vindo) return salvo
    // outro ponto é outra barreira: a chave da tentativa anterior devolveria a barreira antiga (D18)
    return salvo.local?.lat === vindo.lat && salvo.local?.lon === vindo.lon ? salvo : comEdicao(salvo, { local: vindo })
  })
  // o GPS e o mapa respondem minutos depois, com o callback do render do clique: quem edita lê daqui
  const rascunhoAtual = useRef(rascunho)
  const [erros, setErros] = useState<{ categoria?: string; local?: string }>({})
  const botao = useRef<HTMLButtonElement>(null)

  /**
   * Valida o que está na tela e monta o corpo. O login chama de novo ao concluir: o que vale é o
   * que a pessoa deixou escrito enquanto esperava o e-mail, com a chave certa para isso.
   */
  function montarEnvio(): [BarreiraIn] | null {
    const novos: typeof erros = {}
    if (!rascunho.categoria) novos.categoria = 'Escolha o tipo de barreira.'
    if (!rascunho.local) novos.local = 'Diga onde está a barreira.'
    flushSync(() => setErros(novos))
    if (novos.categoria) {
      focarOuAnunciar(document.querySelector<HTMLInputElement>('input[name="categoria"]'), novos.categoria, anunciar)
      return null
    }
    if (novos.local || !rascunho.local || !rascunho.categoria) {
      focarOuAnunciar(document.getElementById('local-busca'), novos.local ?? '', anunciar)
      return null
    }
    // a chave é salva antes do fetch: repetir, sessão expirada e recarga da aba reusam a mesma
    const comAChave = comChave(rascunho)
    rascunhoAtual.current = comAChave
    setRascunho(comAChave)
    gravarRascunho(comAChave)
    return [
      {
        categoria: rascunho.categoria,
        lat: rascunho.local.lat,
        lon: rascunho.local.lon,
        descricao: rascunho.descricao.trim() || undefined,
        chave_idempotencia: comAChave.chave,
      },
    ]
  }

  const acao = useAcaoComLogin(
    criarBarreira,
    ({ barreira, nova }) => {
      const ponto = rascunhoAtual.current.local
      apagarRascunho()
      // o ponto vai e volta pela ficha, como em /barreiras: "Ver outras barreiras" continua aqui
      navegar(`/barreiras/${barreira.id}`, {
        state: { recemCriada: true, jaExistia: !nova, ponto: ponto ? [ponto.lat, ponto.lon] : undefined, rotuloPonto: ponto?.rotulo ?? undefined },
      })
    },
    {
      montarArgs: montarEnvio,
      textoEnvio: 'Enviando a barreira.',
      aoConcluirForaDaTela: (_resultado, [corpo]) => {
        // a pessoa foi embora: nada de arrastá-la de volta. Um rascunho novo, com outra chave, fica.
        if (lerRascunho().chave === corpo.chave_idempotencia) apagarRascunho()
        anunciar('Barreira registrada.')
      },
    },
  )
  const enviando = acao.estado.fase === 'enviando'
  const espera = useEsperaServidor(enviando)

  useEffect(() => aquecerServidor(), [])

  useEffect(() => {
    if (!estadoNav?.local) return
    // o state sobrevive à recarga e passaria por cima de "Trocar o local": consumido uma vez
    gravarRascunho(rascunho)
    navegar(local.pathname, { replace: true, state: null })
    // só na chegada
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function mudar(mudanca: Partial<Rascunho>) {
    const novo = comEdicao(rascunhoAtual.current, mudanca)
    rascunhoAtual.current = novo
    setRascunho(novo)
    gravarRascunho(novo)
    acao.limparErro()
  }

  const erroAcao = acao.estado.fase === 'erro' ? acao.estado.erro : null
  // 422 com texto é o ponto fora da área: é do local, e fica ligado a "Trocar o local"
  const erroDoLocal = erroAcao?.tipo === 'validacao' && !erroAcao.campos ? erroAcao.message : null
  const mensagemErro = erroAcao && !erroDoLocal ? (erroAcao.tipo === 'validacao' || erroAcao.tipo === 'limite' ? erroAcao.message : MSG_FALHA_ENVIO) : null

  useEffect(() => {
    // o foco vai a "Trocar o local", que lê a mensagem; os outros erros ficam no botão e anunciam
    if (erroDoLocal) focarOuAnunciar(document.getElementById('local-trocar'), erroDoLocal, anunciar)
    else if (mensagemErro) anunciar(mensagemErro)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [erroDoLocal, mensagemErro])

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (enviando) return
    const args = montarEnvio()
    if (args) void acao.executar(...args)
  }

  return (
    <div className="rota">
      <div className="rota__cabeca">
        <h1 ref={h1} tabIndex={-1} className="display">
          Registrar barreira
        </h1>
        <p className="subtitulo">
          Três toques: o tipo, o lugar e confirmar. O que você registra fica público, sem seu nome nem e-mail; a moderação vê
          só um código da conta, para auditoria. Os dados ficam abertos, sob a licença ODbL.
        </p>
      </div>

      <form className="formulario" aria-label="Registrar barreira" onSubmit={enviar} noValidate>
        <fieldset className="exigencia" aria-describedby={erros.categoria ? 'categoria-erro' : undefined}>
          <legend>Tipo de barreira</legend>
          {erros.categoria && (
            <p id="categoria-erro" className="campo__retorno campo__retorno--erro">
              <Pictograma nome="alerta" />
              <span>{erros.categoria}</span>
            </p>
          )}
          <div className="exigencia__opcoes">
            {(Object.keys(CATEGORIAS) as Categoria[]).map((c) => (
              <label key={c} className="opcao opcao--dupla">
                <input type="radio" name="categoria" value={c} checked={rascunho.categoria === c} onChange={() => mudar({ categoria: c })} />
                <span>
                  {CATEGORIAS[c].rotulo}
                  <span className="opcao__dica">{CATEGORIAS[c].dica}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <EscolhaLocal
          id="local"
          local={rascunho.local ?? null}
          aoEscolher={(l) => mudar({ local: l ?? undefined })}
          erro={rascunho.local ? erroDoLocal : (erros.local ?? null)}
          aoEditar={() => setErros((e) => ({ ...e, local: undefined }))}
        />

        <div className="campo">
          <label htmlFor="descricao">Descrição (opcional)</label>
          <p id="descricao-dica" className="campo__dica">
            Até 500 caracteres. Não escreva nomes nem placas de carro.
          </p>
          <textarea
            id="descricao"
            name="descricao"
            maxLength={500}
            rows={3}
            aria-describedby="descricao-dica"
            value={rascunho.descricao}
            onChange={(e) => mudar({ descricao: e.target.value })}
          />
        </div>

        <div className="formulario__envio">
          <Placa ref={botao} type="submit" variante="acao" pictograma="siga" aria-disabled={enviando || undefined}>
            Registrar barreira
          </Placa>
          {enviando && <p className="campo__retorno">{espera ?? 'Enviando a barreira…'}</p>}
          {mensagemErro && (
            <p className="campo__retorno campo__retorno--erro">
              <Pictograma nome="alerta" />
              <span>{mensagemErro}</span>
            </p>
          )}
        </div>
      </form>

      <Torre variante="anexo">
        <Janela area="aviso">
          <h2 className="letreiro">O que acontece depois</h2>
          <p>
            A barreira aparece como aguardando confirmação. Com as confirmações necessárias, a rota passa a evitar ou avisar,
            conforme o tipo; tipos só informativos não mudam a rota. A moderação pode decidir antes.
          </p>
        </Janela>
      </Torre>

      {acao.estado.fase === 'login' && (
        <div className="colaborar__portao">
          <PortaoLogin
            motivo={acao.estado.motivo}
            refRetorno={botao}
            refTitulo={acao.refPortao}
            aoEntrar={acao.concluirLogin}
            aoCancelar={acao.cancelarLogin}
          />
        </div>
      )}
    </div>
  )
}

import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { focarOuAnunciar } from '../a11y/foco'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'
import { ehCancelamento, ErroApi, MSG_INESPERADO } from '../api/base'
import { calcularRota } from '../api/client'
import { aquecerServidor } from '../api/servidor'
import { BotaoMinhaLocalizacao } from '../componentes/BotaoMinhaLocalizacao'
import { CampoEndereco } from '../componentes/CampoEndereco'
import { Placa } from '../componentes/Placa'
import { ResultadoRota } from '../componentes/ResultadoRota'
import { Janela, Torre } from '../componentes/Torre'
import { useAnuncio } from '../componentes/useAnuncio'
import { useBuscaEndereco } from '../componentes/useBuscaEndereco'
import { useEsperaServidor } from '../componentes/useEsperaServidor'
import {
  apagarSessaoRota,
  gravarSessaoRota,
  lerSessaoRota,
  PERFIL_FORM_PADRAO,
  type BuscaFeita,
  type Inclinacao,
  type PerfilForm,
} from '../dados/sessaoRota'
import '../estilos/rota.css'
import { focoVaiParaResultado, mesmoPonto, montarPedido, reduzirRota, resumoDaRota, type EstadoRota } from './rotaEstado'

const EXIGENCIAS: { valor: Inclinacao; rotulo: string }[] = [
  { valor: 3, rotulo: 'até 3%' },
  { valor: 6, rotulo: 'até 6%' },
  { valor: 10, rotulo: 'até 10%' },
  { valor: 'any', rotulo: 'qualquer inclinação' },
]

const LIMIAR_LENTO_MS = 15_000
const SUFIXO_TITULO = ' · Rota Falada SP'
const TEXTO_LENTO = 'Ainda calculando; o serviço de rotas está lento.'
const TEXTO_DESATUALIZADA = 'Esta rota é da busca anterior. Calcule de novo.'
const MSG_MESMO_PONTO = 'A origem e o destino são o mesmo ponto. Escolha outro destino.'

/** O pedido vem do que gerou a rota, gravado com ela: os campos podem já ser outros. */
function estadoRestaurado(): EstadoRota {
  const s = lerSessaoRota()
  if (!s?.rota || !s.calculadaEm || !s.rotaDe) return { fase: 'ocioso' }
  return {
    fase: 'resultado',
    busca: s.rotaDe,
    rota: s.rota,
    calculadaEm: s.calculadaEm,
    restaurada: true,
  }
}

export function Rota() {
  const h1 = usePaginaAcessivel('Planejar rota')
  const anunciar = useAnuncio()
  const [restauro] = useState(() => lerSessaoRota())
  const origem = useBuscaEndereco('Origem', restauro?.origem ?? null)
  const destino = useBuscaEndereco('Destino', restauro?.destino ?? null)
  const [perfil, setPerfil] = useState<PerfilForm>(restauro?.perfil ?? PERFIL_FORM_PADRAO)
  const [estado, despachar] = useReducer(reduzirRota, undefined, estadoRestaurado)
  const [erros, setErros] = useState<{ origem?: string; destino?: string }>({})
  const [limpezas, setLimpezas] = useState(0)
  const botao = useRef<HTMLButtonElement>(null)
  const titulo = useRef<HTMLHeadingElement>(null)
  const controle = useRef<AbortController | null>(null)
  const focoNoEnvio = useRef<Element | null>(null)
  const calculando = estado.fase === 'calculando'
  const espera = useEsperaServidor(calculando)

  useEffect(() => {
    aquecerServidor()
    return () => controle.current?.abort()
  }, [])

  // grava na seleção e no resultado, nunca a cada tecla
  const rotaAtual = estado.fase === 'resultado' ? estado : null
  useEffect(() => {
    gravarSessaoRota({
      versao: 1,
      origem: origem.escolha,
      destino: destino.escolha,
      perfil,
      rota: rotaAtual?.rota ?? null,
      rotaDe: rotaAtual?.busca ?? null,
      calculadaEm: rotaAtual?.calculadaEm ?? null,
    })
  }, [origem.escolha, destino.escolha, perfil, rotaAtual])

  // sem nome de rua no título: não gravar trajeto no histórico do navegador
  const temResultado = estado.fase === 'resultado'
  useEffect(() => {
    document.title = (temResultado ? 'Rota calculada' : 'Planejar rota') + SUFIXO_TITULO
  }, [temResultado])

  // fim do cálculo: foco no h2 ou anúncio, nunca os dois. Restaurar não move foco.
  const fase = estado.fase
  const restaurada = estado.fase === 'resultado' && estado.restaurada
  const resumo = estado.fase === 'resultado' ? `Rota encontrada. ${resumoDaRota(estado.rota)}.` : null
  const buscaAtual = useMemo<BuscaFeita | null>(
    () =>
      origem.escolha && destino.escolha
        ? { pedido: montarPedido(origem.escolha, destino.escolha, perfil), origem: origem.escolha.rotulo, destino: destino.escolha.rotulo }
        : null,
    [origem.escolha, destino.escolha, perfil],
  )
  const desatualizada = estado.fase === 'resultado' && JSON.stringify(buscaAtual?.pedido ?? null) !== JSON.stringify(estado.busca.pedido)

  const anterior = useRef(fase)
  useEffect(() => {
    const veioDoCalculo = anterior.current === 'calculando'
    anterior.current = fase
    if (!veioDoCalculo || restaurada) return
    if (fase === 'resultado' || fase === 'sem_rota' || fase === 'indisponivel') {
      // voltou a editar durante o cálculo: não tirar o foco de quem está digitando
      if (!desatualizada && focoVaiParaResultado(document.activeElement, focoNoEnvio.current)) {
        titulo.current?.focus()
        // "Calculando a rota." já não é verdade: nem pendente, nem esquecido no fim da página
        anunciar('')
      } else if (resumo) anunciar(resumo)
      else anunciar(titulo.current?.textContent ?? '')
    }
  }, [fase, restaurada, resumo, desatualizada, anunciar])

  // o aviso é a única salvaguarda de WCAG 3.2.2 aqui: anuncia na transição, nunca a cada tecla
  const avisouDesatualizada = useRef(desatualizada)
  useEffect(() => {
    if (desatualizada && !avisouDesatualizada.current) anunciar(TEXTO_DESATUALIZADA)
    avisouDesatualizada.current = desatualizada
  }, [desatualizada, anunciar])

  const lento = estado.fase === 'calculando' && estado.lento
  const temEspera = espera !== null
  useEffect(() => {
    // o texto de espera do servidor vem antes: só um deles é verdade de cada vez
    if (lento && !temEspera) anunciar(TEXTO_LENTO)
  }, [lento, temEspera, anunciar])

  async function executar(busca: BuscaFeita) {
    const pedidoControle = new AbortController()
    controle.current?.abort()
    controle.current = pedidoControle
    focoNoEnvio.current = document.activeElement
    despachar({ tipo: 'calcular', busca })
    anunciar('Calculando a rota.')
    let limiar: ReturnType<typeof setTimeout> | undefined
    try {
      // conta só depois de o servidor responder: "acordando" e "lento" são fatos diferentes (R5, R6)
      const rota = await calcularRota(busca.pedido, pedidoControle.signal, () => {
        limiar = setTimeout(() => despachar({ tipo: 'demorou' }), LIMIAR_LENTO_MS)
      })
      despachar({ tipo: 'chegou', rota, calculadaEm: new Date().toISOString() })
    } catch (erro) {
      if (ehCancelamento(erro)) return
      if (erro instanceof ErroApi && erro.tipo === 'nao_encontrado') despachar({ tipo: 'sem_rota', detalhe: erro.message })
      else despachar({ tipo: 'falhou', mensagem: erro instanceof ErroApi ? erro.message : MSG_INESPERADO })
    } finally {
      clearTimeout(limiar)
    }
  }

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (calculando) return
    const novos: typeof erros = {}
    if (!origem.escolha) novos.origem = 'Escolha um endereço da lista.'
    if (!destino.escolha) novos.destino = 'Escolha um endereço da lista.'
    if (origem.escolha && destino.escolha && mesmoPonto(origem.escolha, destino.escolha)) {
      novos.destino = MSG_MESMO_PONTO
    }
    flushSync(() => setErros(novos))
    // o foco lê a descrição do campo; com o foco já nele (Enter), a região anuncia
    if (novos.origem) focarOuAnunciar(document.getElementById('origem'), novos.origem, anunciar)
    else if (novos.destino) focarOuAnunciar(document.getElementById('destino'), novos.destino, anunciar)
    else if (buscaAtual) void executar(buscaAtual)
  }

  /** O erro só vale até a pessoa mexer no que ele aponta. */
  function limparErroOrigem() {
    setErros((e) => ({ destino: e.destino === MSG_MESMO_PONTO ? undefined : e.destino }))
  }

  function limparErroDestino() {
    setErros((e) => ({ origem: e.origem }))
  }

  function cancelar() {
    controle.current?.abort()
    despachar({ tipo: 'cancelar' })
    anunciar('Cálculo cancelado.')
    botao.current?.focus()
  }

  function limparBusca() {
    controle.current?.abort()
    origem.limpar()
    destino.limpar()
    setPerfil(PERFIL_FORM_PADRAO)
    setErros({})
    despachar({ tipo: 'limpar' })
    apagarSessaoRota()
    // o texto do campo pode não mudar (origem já vazia): remontar cancela o GPS e limpa a frase dele
    setLimpezas((n) => n + 1)
    anunciar('Busca apagada.')
    document.getElementById('origem')?.focus()
  }

  return (
    <div className="rota">
      <div className="rota__cabeca">
        <h1 ref={h1} tabIndex={-1} className="display">
          Planejar rota
        </h1>
        <p className="subtitulo">
          Diga de onde sai e aonde quer chegar. A rota volta como lista de passos, com a fonte e a data de cada dado.
        </p>
      </div>

      <form className="formulario" aria-label="Planejar rota" onSubmit={enviar} noValidate>
        <CampoEndereco id="origem" rotulo="Origem" busca={origem} erro={origem.escolha ? null : erros.origem} aoEditar={limparErroOrigem}>
          <BotaoMinhaLocalizacao
            key={limpezas}
            idCampo="origem"
            valorCampo={origem.texto}
            aoEscolher={(endereco) => {
              limparErroOrigem()
              origem.escolher(endereco, 'gps')
            }}
          />
        </CampoEndereco>
        <CampoEndereco
          id="destino"
          rotulo="Destino"
          busca={destino}
          erro={erros.destino && (!destino.escolha || erros.destino === MSG_MESMO_PONTO) ? erros.destino : null}
          aoEditar={limparErroDestino}
        />

        <fieldset className="exigencia" aria-describedby="exigencia-dica">
          <legend>Exigência</legend>
          <p id="exigencia-dica" className="campo__dica">
            Inclinação máxima que a calçada pode ter no caminho.
          </p>
          <div className="exigencia__opcoes">
            {EXIGENCIAS.map((o) => (
              <label key={o.valor} className="opcao">
                <input
                  type="radio"
                  name="exigencia"
                  value={o.valor}
                  checked={perfil.inclinacao_max === o.valor}
                  onChange={() => setPerfil((p) => ({ ...p, inclinacao_max: o.valor }))}
                />
                <span>{o.rotulo}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="opcao">
          <input
            type="checkbox"
            name="evitar_degraus"
            checked={perfil.evitar_degraus}
            onChange={(e) => setPerfil((p) => ({ ...p, evitar_degraus: e.target.checked }))}
          />
          <span>Evitar degraus</span>
        </label>

        <div className="formulario__envio">
          <Placa
            ref={botao}
            type="submit"
            variante="acao"
            pictograma="siga"
            aria-disabled={calculando || undefined}
            aria-describedby={calculando ? 'estado-calculo' : undefined}
          >
            Calcular rota
          </Placa>
          {calculando && (
            <div id="estado-calculo" className="estado-calculo">
              <p>{espera ?? (estado.lento ? TEXTO_LENTO : 'Calculando a rota…')}</p>
              <Placa onClick={cancelar}>Cancelar</Placa>
            </div>
          )}
          {(origem.escolha || destino.escolha || temResultado) && !calculando && (
            <div className="formulario__limpar">
              <Placa onClick={limparBusca}>Limpar busca</Placa>
              <p className="campo__dica">A busca fica só nesta aba e some quando você a fecha.</p>
            </div>
          )}
        </div>
      </form>

      <Torre variante="anexo">
        <Janela area="aviso">
          <h2 className="letreiro">Área piloto</h2>
          <p>
            Os dados de calçada cobrem Vila Mariana, Lapa e Ipiranga. Fora dessa área a rota não existe, e o Rota Falada
            SP diz isso em vez de inventar um caminho.
          </p>
          <p>
            Sua rota não fica ligada a nenhuma conta. O trajeto calculado fica guardado sem identificação por até 6 horas,
            para a próxima consulta responder mais rápido.
          </p>
        </Janela>
      </Torre>

      {estado.fase === 'resultado' && (
        <>
          {desatualizada && (
            <p className="aviso rota__aviso">
              <span>{TEXTO_DESATUALIZADA}</span>
            </p>
          )}
          <ResultadoRota
            rota={estado.rota}
            origem={estado.busca.origem}
            destino={estado.busca.destino}
            exigenciaPedida={estado.busca.pedido.perfil.inclinacao_max}
            calculadaEm={estado.calculadaEm}
            desatualizada={desatualizada}
            tituloRef={titulo}
          />
        </>
      )}

      {estado.fase === 'sem_rota' && (
        <section className="resultado resultado--falha" aria-labelledby="titulo-resultado">
          <h2 id="titulo-resultado" ref={titulo} tabIndex={-1} className="letreiro resultado__titulo">
            Não encontramos rota
          </h2>
          <p>{estado.detalhe}</p>
          <p>Tente outro ponto ou desmarque Evitar degraus; isso pode incluir degraus no caminho.</p>
        </section>
      )}

      {estado.fase === 'indisponivel' && (
        <section className="resultado resultado--falha" aria-labelledby="titulo-resultado">
          <h2 id="titulo-resultado" ref={titulo} tabIndex={-1} className="letreiro resultado__titulo">
            Não foi possível calcular agora
          </h2>
          <p>{estado.mensagem}</p>
          <Placa
            onClick={() => {
              // este botão some com o cálculo: o foco espera em "Calcular rota"
              botao.current?.focus()
              void executar(estado.busca)
            }}
          >
            Tentar de novo
          </Placa>
        </section>
      )}
    </div>
  )
}

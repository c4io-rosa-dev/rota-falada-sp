import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { focoPerdido } from '../../a11y/foco'
import { usePaginaAcessivel } from '../../a11y/usePaginaAcessivel'
import { ehCancelamento, ErroApi, MSG_INESPERADO } from '../../api/base'
import { listarFila, type Barreira, type StatusBarreira } from '../../api/colaboracao'
import { useConsulta } from '../../api/useConsulta'
import { comSessao, motivoDoLogin, type MotivoLogin } from '../../auth/comSessao'
import { Placa } from '../../componentes/Placa'
import { PortaoLogin } from '../../componentes/PortaoLogin'
import { useAnuncio } from '../../componentes/useAnuncio'
import { useEsperaServidor } from '../../componentes/useEsperaServidor'
import { formatarDia, STATUS_TODOS, textoStatus, textoVotos } from '../../dados/barreira'
import { rotuloCategoria } from '../../dados/categorias'
import '../../estilos/colaborar.css'
import '../../estilos/rota.css'

const LIMITE = 50
const MSG_SEM_PERMISSAO = 'Esta área é só para a equipe de moderação.'

function statusDaUrl(valor: string | null): StatusBarreira {
  return STATUS_TODOS.includes(valor as StatusBarreira) ? (valor as StatusBarreira) : 'pendente'
}

export function Fila() {
  const h1 = usePaginaAcessivel('Moderação')
  const navegar = useNavigate()
  const [parametros] = useSearchParams()
  const status = statusDaUrl(parametros.get('status'))
  const anunciar = useAnuncio()
  const { dados, erro, carregando, recarregar } = useConsulta(`fila-${status}`, (sinal) =>
    comSessao((token) => listarFila(token, { status, limite: LIMITE }, sinal)),
  )
  const espera = useEsperaServidor(carregando)
  const [extras, setExtras] = useState<{ status: StatusBarreira; itens: Barreira[]; fim: boolean }>({ status, itens: [], fim: false })
  const [erroMais, setErroMais] = useState<string | null>(null)
  const [portaoMais, setPortaoMais] = useState<MotivoLogin | null>(null)
  const [indiceNovo, setIndiceNovo] = useState(-1)
  const [semMais, setSemMais] = useState(false)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const esperaMais = useEsperaServidor(carregandoMais)
  const pedidoMais = useRef<AbortController | null>(null)
  const primeiroNovo = useRef<HTMLAnchorElement>(null)
  const textoFim = useRef<HTMLParagraphElement>(null)
  const botaoMais = useRef<HTMLButtonElement>(null)
  const tinhaFiltros = useRef(false)

  const adicionais = extras.status === status ? extras.itens : []
  const itens = [...(dados ?? []), ...adicionais]
  const fim = extras.status === status ? extras.fim : false

  // um 1º lote novo recomeça a fila: colar os lotes antigos atrás dele repetiria ou esconderia itens
  useEffect(() => {
    pedidoMais.current?.abort()
    pedidoMais.current = null
    setExtras({ status, itens: [], fim: false })
    setIndiceNovo(-1)
    setSemMais(false)
    setErroMais(null)
    setPortaoMais(null)
    setCarregandoMais(false)
  }, [status, dados])

  useEffect(() => () => pedidoMais.current?.abort(), [])

  // o portão leva o foco ao próprio título e se lê sozinho
  useEffect(() => {
    if (erro) {
      if (erro.tipo !== 'sessao') anunciar(erro.tipo === 'permissao' ? MSG_SEM_PERMISSAO : erro.message)
    } else if (dados) {
      anunciar(`${dados.length} ${dados.length === 1 ? 'barreira' : 'barreiras'}: ${textoStatus({ status, severidade: 'dificulta' }).toLowerCase()}.`)
    }
  }, [dados, erro, status, anunciar])

  // sem permissão, os filtros saem da tela e levariam o foco junto (D27)
  const mostraFiltros = erro?.tipo !== 'sessao' && erro?.tipo !== 'permissao'
  useEffect(() => {
    if (tinhaFiltros.current && !mostraFiltros && erro?.tipo === 'permissao' && focoPerdido()) h1.current?.focus()
    tinhaFiltros.current = mostraFiltros
  }, [mostraFiltros, erro, h1])

  async function carregarMais() {
    const ultimo = itens[itens.length - 1]
    if (!ultimo || pedidoMais.current) return
    const controle = new AbortController()
    pedidoMais.current = controle
    setErroMais(null)
    setCarregandoMais(true)
    anunciar('Carregando mais barreiras.')
    try {
      const mais = await comSessao((token) => listarFila(token, { status, limite: LIMITE, antes_de: ultimo.id }, controle.signal))
      if (controle.signal.aborted) return
      // o botão pode sair da tela com o lote: o foco vai ao primeiro novo, ou à frase do fim
      flushSync(() => {
        setIndiceNovo(mais.length > 0 ? itens.length : -1)
        setSemMais(mais.length === 0)
        setExtras({ status, itens: [...adicionais, ...mais], fim: mais.length < LIMITE })
        setCarregandoMais(false)
      })
      anunciar('') // o foco lê o que chegou; "Carregando mais barreiras." já não vale
      if (mais.length > 0) primeiroNovo.current?.focus()
      else textoFim.current?.focus()
    } catch (e) {
      if (controle.signal.aborted || ehCancelamento(e)) return
      setCarregandoMais(false)
      if (e instanceof ErroApi && e.tipo === 'sessao') {
        anunciar('')
        setPortaoMais(motivoDoLogin(e))
        return
      }
      const texto = e instanceof ErroApi ? e.message : MSG_INESPERADO
      setErroMais(texto)
      anunciar(texto)
    } finally {
      if (pedidoMais.current === controle) pedidoMais.current = null
    }
  }

  return (
    <div className="colaborar">
      <div className="rota__cabeca">
        <h1 ref={h1} tabIndex={-1} className="display">
          Moderação
        </h1>
      </div>

      {erro?.tipo === 'sessao' && <PortaoLogin motivo={motivoDoLogin(erro)} refRetorno={h1} aoEntrar={recarregar} aoCancelar={() => navegar('/')} />}
      {erro?.tipo === 'permissao' && <p className="colaborar__lista">{MSG_SEM_PERMISSAO}</p>}

      {mostraFiltros && (
        <nav aria-label="Filtrar por status">
          <ul className="filtros">
            {STATUS_TODOS.map((s) => (
              <li key={s}>
                <Link className="alvo" to={`/admin?status=${s}`} aria-current={s === status ? 'page' : undefined}>
                  {textoStatus({ status: s, severidade: 'dificulta' })}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {erro && mostraFiltros && (
        <div className="colaborar__lista">
          <p>{erro.message}</p>
          <Placa
            onClick={() => {
              h1.current?.focus()
              recarregar()
            }}
          >
            Tentar de novo
          </Placa>
        </div>
      )}

      {!erro && (
        <section className="colaborar__lista" aria-label="Fila de barreiras">
          {carregando && <p>{espera ?? 'Carregando a fila…'}</p>}
          {dados && itens.length === 0 && <p>Nenhuma barreira neste status.</p>}
          {itens.length > 0 && (
            <ol className="lista-gravada">
              {itens.map((b, i) => (
                <li key={b.id}>
                  <h2 className="letreiro colaborar__titulo">
                    <Link ref={i === indiceNovo ? primeiroNovo : undefined} className="alvo lista-gravada__link" to={`/admin/barreiras/${b.id}`}>
                      Nº {b.id}, {rotuloCategoria(b.categoria)}
                    </Link>
                  </h2>
                  <p>
                    {textoStatus(b)}. {textoVotos(b)}. Registrada em <span className="medida">{formatarDia(b.criada_em)}</span>.
                  </p>
                </li>
              ))}
            </ol>
          )}
          {erroMais && <p>{erroMais}</p>}
          {semMais && fim && (
            <p ref={textoFim} tabIndex={-1}>
              Não há mais barreiras.
            </p>
          )}
          {dados && dados.length === LIMITE && !fim && (
            <Placa ref={botaoMais} aria-disabled={carregandoMais || undefined} onClick={carregarMais}>
              Carregar mais
            </Placa>
          )}
          {carregandoMais && <p className="campo__retorno">{esperaMais ?? 'Carregando mais barreiras…'}</p>}
          {portaoMais && (
            <PortaoLogin
              motivo={portaoMais}
              refRetorno={botaoMais}
              aoEntrar={() => {
                setPortaoMais(null)
                void carregarMais()
              }}
              aoCancelar={() => setPortaoMais(null)}
            />
          )}
        </section>
      )}
    </div>
  )
}

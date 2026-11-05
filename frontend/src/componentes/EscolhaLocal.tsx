import { useEffect, useRef, useState, type ComponentType } from 'react'
import { flushSync } from 'react-dom'
import { focarOuAnunciar, focoPerdido } from '../a11y/foco'
import { ehCancelamento, ErroApi, MSG_INESPERADO } from '../api/base'
import { enderecoDoPonto } from '../api/client'
import { arredondar4, ErroLocalizacao, FORA_DA_AREA, obterPosicao, PRECISAO_ACEITAVEL_M, temGeolocalizacao } from '../dados/localizacao'
import { ehFalhaDeConexao, localDeEndereco, NOTA_SEM_CONFIRMAR, type LocalEscolhido } from '../dados/rascunho'
import { CampoEndereco } from './CampoEndereco'
import { Pictograma } from './Pictograma'
import { Placa } from './Placa'
import { useAnuncio } from './useAnuncio'
import { useBuscaEndereco } from './useBuscaEndereco'
import { useEsperaServidor } from './useEsperaServidor'

type PropsPonto = { aoMarcar: (local: LocalEscolhido) => void }

type Props = {
  id: string
  local: LocalEscolhido | null
  aoEscolher: (local: LocalEscolhido | null) => void
  /** Erro de quem usa: ligado à busca sem local, e a "Trocar o local" com local. */
  erro?: string | null
  aoEditar?: () => void
}

const MSG_MAPA = 'Não foi possível abrir o mapa. Use a localização ou digite o endereço.'

function textoDoLocal(local: LocalEscolhido): string {
  return local.rotulo ? `Local marcado perto de ${local.rotulo}.` : 'Local marcado, sem endereço confirmado.'
}

/** Três caminhos equivalentes para dizer onde: GPS, busca e mapa. Nenhum depende de arrastar. */
export function EscolhaLocal({ id, local, aoEscolher, erro, aoEditar }: Props) {
  const busca = useBuscaEndereco('Endereço', null, (e) => {
    aoEscolher(localDeEndereco(e))
    setMensagem(null)
  })
  const [buscandoGps, setBuscandoGps] = useState(false)
  const [mensagem, setMensagem] = useState<string | null>(null)
  const [PontoNoMapa, setPontoNoMapa] = useState<ComponentType<PropsPonto> | null>(null)
  const [faseMapa, setFaseMapa] = useState<'fechado' | 'carregando' | 'pronto' | 'falhou'>('fechado')
  const espera = useEsperaServidor(buscandoGps)
  const anunciar = useAnuncio()
  const botaoGps = useRef<HTMLButtonElement>(null)
  const botaoMapa = useRef<HTMLButtonElement>(null)
  const marcado = useRef<HTMLParagraphElement>(null)
  const pedidoGps = useRef<{ controle: AbortController; texto: string } | null>(null)

  function cancelarGps() {
    pedidoGps.current?.controle.abort()
    pedidoGps.current = null
    setBuscandoGps(false)
  }

  useEffect(() => () => pedidoGps.current?.controle.abort(), [])

  // a espera diz que nada se perde: o que a pessoa fez nesse meio tempo vale mais que o GPS
  const textoCampo = busca.texto
  useEffect(() => {
    if (pedidoGps.current && pedidoGps.current.texto !== textoCampo) {
      pedidoGps.current.controle.abort()
      pedidoGps.current = null
      setBuscandoGps(false)
    }
  }, [textoCampo])

  // os blocos se trocam, e quem tinha o foco sai da tela. O foco vai ao que entrou e lê o
  // resultado; se a pessoa saiu dali durante a espera, fica onde está e a região anuncia.
  const temLocal = local !== null
  const textoLocal = local ? textoDoLocal(local) : null
  const tinhaLocal = useRef(temLocal)
  useEffect(() => {
    if (tinhaLocal.current === temLocal) return
    tinhaLocal.current = temLocal
    if (temLocal) {
      if (focoPerdido()) {
        marcado.current?.focus()
        anunciar('') // o local se lê sozinho; "Buscando sua localização." já não vale
      } else if (textoLocal) anunciar(textoLocal)
    } else if (focoPerdido()) {
      document.getElementById(`${id}-busca`)?.focus()
    }
  }, [temLocal, textoLocal, id, anunciar])

  /** Sem local marcado: o foco vai à busca, que lê o erro. Quem saiu dali ouve pela região. */
  function avisar(texto: string) {
    flushSync(() => setMensagem(texto))
    const campo = document.getElementById(`${id}-busca`)
    if (focoPerdido() || document.activeElement === botaoGps.current || document.activeElement === campo) focarOuAnunciar(campo, texto, anunciar)
    else anunciar(texto)
  }

  async function usarGps() {
    if (buscandoGps) return
    const controle = new AbortController()
    pedidoGps.current = { controle, texto: busca.texto }
    setBuscandoGps(true)
    setMensagem(null)
    anunciar('Buscando sua localização.')
    try {
      const p = await obterPosicao()
      if (controle.signal.aborted) return
      const nota = p.precisaoM > PRECISAO_ACEITAVEL_M ? `A margem do GPS é de cerca de ${Math.round(p.precisaoM)} m. Confira.` : undefined
      try {
        // a barreira usa a coordenada do GPS: o endereço devolvido pode estar a até 50 m
        const e = await enderecoDoPonto(arredondar4(p.lat), arredondar4(p.lon), controle.signal)
        if (controle.signal.aborted) return
        aoEscolher({ lat: p.lat, lon: p.lon, rotulo: e.rotulo, origem: 'gps', nota })
      } catch (erroReverso) {
        if (controle.signal.aborted || ehCancelamento(erroReverso)) return
        if (erroReverso instanceof ErroApi && erroReverso.tipo === 'nao_encontrado' && erroReverso.message !== FORA_DA_AREA) {
          aoEscolher({ lat: p.lat, lon: p.lon, rotulo: null, origem: 'gps', nota: nota ?? 'Sem endereço conhecido a até 50 m; pode registrar neste ponto.' })
        } else if (ehFalhaDeConexao(erroReverso)) {
          // quem está na rua sem sinal não perde o ponto; o 422 do POST segura o que for de fora
          aoEscolher({ lat: p.lat, lon: p.lon, rotulo: null, origem: 'gps', nota: nota ? `${NOTA_SEM_CONFIRMAR} ${nota}` : NOTA_SEM_CONFIRMAR })
        } else {
          avisar(erroReverso instanceof ErroApi ? erroReverso.message : MSG_INESPERADO)
        }
      }
    } catch (erroGps) {
      if (controle.signal.aborted) return
      if (erroGps instanceof ErroLocalizacao) {
        avisar(erroGps.codigo === 1 ? 'O navegador não autorizou a localização. Digite o endereço.' : 'Não conseguimos sua localização agora. Digite o endereço.')
      }
    } finally {
      if (pedidoGps.current?.controle === controle) {
        pedidoGps.current = null
        setBuscandoGps(false)
      }
    }
  }

  // import() à mão: React.lazy guarda a rejeição e derrubaria a página inteira no limite de erro
  async function abrirMapa() {
    if (faseMapa === 'carregando') return
    setFaseMapa('carregando')
    anunciar('Abrindo o mapa.')
    try {
      const modulo = await import('./mapa/PontoNoMapa')
      setPontoNoMapa(() => modulo.default)
      setFaseMapa('pronto')
      anunciar('Mapa aberto. Use os botões abaixo dele.')
    } catch {
      setFaseMapa('falhou')
      anunciar(MSG_MAPA)
    }
  }

  const erroNoCampo = erro ?? mensagem
  return (
    <fieldset className="escolha-local">
      <legend>Onde?</legend>
      {local && (
        <div className="escolha-local__escolhido">
          <p ref={marcado} tabIndex={-1} aria-describedby={local.nota ? `${id}-nota` : undefined}>
            <strong className="escolha-local__rotulo">Local marcado:</strong>{' '}
            {local.rotulo ? `perto de ${local.rotulo}` : 'ponto sem endereço confirmado'}
          </p>
          {local.nota && (
            <p id={`${id}-nota`} className="campo__dica">
              {local.nota}
            </p>
          )}
          {erro && (
            <p id={`${id}-erro`} className="campo__retorno campo__retorno--erro">
              <Pictograma nome="alerta" />
              <span>{erro}</span>
            </p>
          )}
          <Placa
            id={`${id}-trocar`}
            aria-describedby={erro ? `${id}-erro` : undefined}
            onClick={() => {
              aoEditar?.()
              aoEscolher(null)
              busca.limpar()
            }}
          >
            Trocar o local
          </Placa>
        </div>
      )}
      {!local && (
        <>
          {temGeolocalizacao() && (
            <div className="localizacao">
              <Placa ref={botaoGps} pictograma="localizacao" onClick={usarGps} aria-describedby={`${id}-gps-dica`} aria-disabled={buscandoGps || undefined}>
                Usar minha localização
              </Placa>
              <p id={`${id}-gps-dica`} className="campo__dica">Usa o GPS do aparelho uma vez, só quando você aciona.</p>
              {buscandoGps && <p className="campo__retorno">{espera ?? 'Buscando sua localização…'}</p>}
            </div>
          )}
          <CampoEndereco
            id={`${id}-busca`}
            rotulo="Endereço"
            busca={busca}
            erro={erroNoCampo}
            aoEditar={() => {
              setMensagem(null)
              aoEditar?.()
            }}
          />
          <Placa
            ref={botaoMapa}
            pictograma="enquadrar"
            aria-pressed={faseMapa === 'pronto'}
            aria-disabled={faseMapa === 'carregando' || undefined}
            aria-describedby={`${id}-mapa-dica`}
            onClick={() => (faseMapa === 'pronto' ? setFaseMapa('fechado') : void abrirMapa())}
          >
            Escolher no mapa
          </Placa>
          <p id={`${id}-mapa-dica`} className="campo__dica">
            O mapa baixa imagens do OpenStreetMap, que recebe o endereço IP do seu aparelho e a região vista. A localização
            e o endereço levam ao mesmo resultado.
          </p>
          {faseMapa === 'carregando' && <p className="campo__retorno">Abrindo o mapa…</p>}
          {faseMapa === 'falhou' && (
            <div className="campo__retorno">
              <p>{MSG_MAPA}</p>
              <Placa
                onClick={() => {
                  botaoMapa.current?.focus()
                  void abrirMapa()
                }}
              >
                Tentar de novo
              </Placa>
            </div>
          )}
          {faseMapa === 'pronto' && PontoNoMapa && (
            <PontoNoMapa
              aoMarcar={(l) => {
                cancelarGps()
                aoEscolher(l)
              }}
            />
          )}
        </>
      )}
    </fieldset>
  )
}

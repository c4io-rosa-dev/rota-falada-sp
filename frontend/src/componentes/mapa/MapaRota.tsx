import { useEffect, useId, useRef, useState, type ComponentType } from 'react'
import type { RotaOut } from '../../api/client'
import { formatarDistancia } from '../../dados/passo'
import { Passarela } from '../Passarela'
import { Placa } from '../Placa'
import { useAnuncio } from '../useAnuncio'
import type { ControleMapa } from './MapaLeaflet'

type PropsLeaflet = {
  ref?: React.Ref<ControleMapa>
  rota: RotaOut
  descricao: string
  passoSelecionado: number | null
  rodadaPasso: number
  passoEmLeitura: number | null
  aoFalharTiles: () => void
  aoMudarZoom: (noMinimo: boolean, noMaximo: boolean) => void
}

type Props = {
  rota: RotaOut
  origem: string
  destino: string
  aberto: boolean
  aoAlternar: (aberto: boolean) => void
  passoSelecionado: number | null
  /** Sobe a cada pressão em "Ver o passo N": pressionar de novo enquadra e fala outra vez. */
  rodadaPasso: number
  passoEmLeitura: number | null
}

const MSG_TILES = 'O fundo do mapa não carregou. A linha da rota e a lista continuam.'

/**
 * Casca do mapa: o chunk do Leaflet e os tiles só saem por ação da pessoa. import() à mão
 * porque React.lazy guarda a rejeição, e "Tentar de novo" precisa de uma nova tentativa.
 */
export function MapaRota({ rota, origem, destino, aberto, aoAlternar, passoSelecionado, rodadaPasso, passoEmLeitura }: Props) {
  const [Leaflet, setLeaflet] = useState<ComponentType<PropsLeaflet> | null>(null)
  const [fase, setFase] = useState<'fechado' | 'carregando' | 'pronto' | 'falhou'>('fechado')
  const [tilesFalharam, setTilesFalharam] = useState(false)
  const [zoom, setZoom] = useState({ noMinimo: false, noMaximo: false })
  const controle = useRef<ControleMapa>(null)
  const legenda = useRef<HTMLOListElement>(null)
  const botaoMapa = useRef<HTMLButtonElement>(null)
  const dica = useId()
  const anunciar = useAnuncio()

  async function abrir() {
    if (fase === 'carregando') return
    setFase('carregando')
    anunciar('Abrindo o mapa.')
    try {
      const modulo = await import('./MapaLeaflet')
      setLeaflet(() => modulo.default as ComponentType<PropsLeaflet>)
      setFase('pronto')
      // só agora o mapa existe: os passos só ganham "Ver no mapa" com ele aberto de verdade
      aoAlternar(true)
      anunciar('Mapa aberto. A lista de passos continua completa.')
    } catch {
      setFase('falhou')
      anunciar('Não foi possível abrir o mapa. A lista de passos está completa.')
    }
  }

  function fechar() {
    aoAlternar(false)
    setFase('fechado')
    setTilesFalharam(false)
    anunciar('Mapa fechado.')
  }

  /** O botão fica igual depois de pressionado: quem usa leitor de tela precisa saber que o mapa andou. */
  function mover(acao: () => void, texto: string) {
    acao()
    anunciar(texto, { chave: 'mover-mapa', intervaloMs: 1500 })
  }

  const passo = rota.passos.find((p) => p.ordem === passoSelecionado) ?? null

  // "Ver o passo N": com o mapa fora da vista, o foco vai à legenda, que diz o passo; senão, a
  // região anuncia. Nunca os dois.
  useEffect(() => {
    if (passoSelecionado === null) return
    const caixa = legenda.current?.getBoundingClientRect()
    if (caixa && (caixa.top < 0 || caixa.bottom > window.innerHeight)) legenda.current?.focus()
    else anunciar(`Mapa no passo ${passoSelecionado}.`)
  }, [passoSelecionado, rodadaPasso, anunciar])

  const descricao = `Mapa ilustrativo da rota de ${origem} até ${destino}, ${formatarDistancia(rota.distancia_m)} em ${rota.passos.length} passos. Tudo o que ele mostra está na lista de passos desta página.`

  return (
    <div className="mapa-rota">
      <Placa ref={botaoMapa} pictograma="enquadrar" aria-pressed={aberto} aria-describedby={dica} aria-disabled={fase === 'carregando' || undefined} onClick={aberto ? fechar : abrir}>
        Mostrar mapa
      </Placa>
      <p id={dica} className="campo__dica">
        Mostrar o mapa baixa imagens do OpenStreetMap, que recebe o endereço IP do seu aparelho e a região vista. A lista
        de passos já traz tudo.
      </p>

      {fase === 'carregando' && <p className="campo__retorno">Abrindo o mapa…</p>}
      {fase === 'falhou' && (
        <div className="campo__retorno">
          <p>Não foi possível abrir o mapa. A lista de passos está completa.</p>
          <Placa
            onClick={() => {
              botaoMapa.current?.focus()
              void abrir()
            }}
          >
            Tentar de novo
          </Placa>
        </div>
      )}

      {fase === 'pronto' && Leaflet && (
        <section aria-labelledby="titulo-mapa" className="mapa-rota__corpo">
          <h3 id="titulo-mapa" className="letreiro mapa-rota__titulo">
            Mapa da rota
          </h3>
          <figure className="mapa">
            <Leaflet
              ref={controle}
              rota={rota}
              descricao={descricao}
              passoSelecionado={passoSelecionado}
              rodadaPasso={rodadaPasso}
              passoEmLeitura={passoEmLeitura}
              aoFalharTiles={() => {
                setTilesFalharam(true)
                anunciar(MSG_TILES)
              }}
              aoMudarZoom={(noMinimo, noMaximo) => setZoom({ noMinimo, noMaximo })}
            />
            <figcaption className="mapa__atribuicao">
              © colaboradores do <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
            </figcaption>
          </figure>
          {tilesFalharam && (
            <div className="aviso">
              <span>{MSG_TILES}</span>
              <Placa
                onClick={() => {
                  botaoMapa.current?.focus()
                  setTilesFalharam(false)
                  controle.current?.recarregarTiles()
                }}
              >
                Tentar de novo
              </Placa>
            </div>
          )}
          <div role="group" aria-label="Controles do mapa" className="mapa-rota__controles">
            <Placa pictograma="mais" aria-disabled={zoom.noMaximo || undefined} onClick={() => !zoom.noMaximo && mover(() => controle.current?.aproximar(), 'Mapa aproximado.')}>
              Aproximar
            </Placa>
            <Placa pictograma="menos" aria-disabled={zoom.noMinimo || undefined} onClick={() => !zoom.noMinimo && mover(() => controle.current?.afastar(), 'Mapa afastado.')}>
              Afastar
            </Placa>
            <Placa pictograma="enquadrar" onClick={() => mover(() => controle.current?.rotaInteira(), 'Mapa mostra a rota inteira.')}>
              Rota inteira
            </Placa>
          </div>
          {passo && (
            <ol ref={legenda} start={passo.ordem} className="mapa-rota__legenda" tabIndex={-1} aria-label={`Mapa no passo ${passo.ordem}`}>
              <Passarela passo={passo} ativo />
            </ol>
          )}
          <p className="mapa-rota__volta">
            <a className="alvo" href={passo ? `#passo-${passo.ordem}` : '#lista-passos'}>
              {passo ? `Voltar ao passo ${passo.ordem} na lista` : 'Ir para a lista de passos'}
            </a>
          </p>
        </section>
      )}
    </div>
  )
}

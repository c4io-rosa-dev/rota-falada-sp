import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import { ehCancelamento, ErroApi, MSG_INESPERADO } from '../../api/base'
import { enderecoDoPonto } from '../../api/client'
import { arredondar4, FORA_DA_AREA } from '../../dados/localizacao'
import { ehFalhaDeConexao, NOTA_SEM_CONFIRMAR, type LocalEscolhido } from '../../dados/rascunho'
import { Pictograma } from '../Pictograma'
import { Placa } from '../Placa'
import { useAnuncio } from '../useAnuncio'
import { useEsperaServidor } from '../useEsperaServidor'
import './mapa.css'
import { MAX_ZOOM, opcoesMapa, ponteiroEhFino, URL_TILES, vigiarTiles, type VigiaTiles } from './opcoesMapa'

/** Centro inicial: Vila Mariana, dentro da área piloto. */
const CENTRO: [number, number] = [-23.59, -46.635]
const PASSO_PX = 100
const MSG_TILES = 'O fundo do mapa não carregou. Use a localização ou digite o endereço.'

const MOVER = [
  { rotulo: 'Norte', dx: 0, dy: -PASSO_PX },
  { rotulo: 'Sul', dx: 0, dy: PASSO_PX },
  { rotulo: 'Leste', dx: PASSO_PX, dy: 0 },
  { rotulo: 'Oeste', dx: -PASSO_PX, dy: 0 },
]

/**
 * Marcar um ponto sem arrastar: a mira fica no centro e o mapa se move por botões reais de
 * 44 px; clicar no mapa centraliza nele. O mapa segue role="img" e sem nada focável dentro,
 * e a mesma tarefa existe nos botões (WCAG 2.5.7). O ponto marcado sempre vira texto.
 */
export default function PontoNoMapa({ aoMarcar }: { aoMarcar: (local: LocalEscolhido) => void }) {
  const contêiner = useRef<HTMLDivElement>(null)
  const mapaRef = useRef<L.Map | null>(null)
  const tilesRef = useRef<L.TileLayer | null>(null)
  const vigiaRef = useRef<VigiaTiles | null>(null)
  const botaoMarcar = useRef<HTMLButtonElement>(null)
  const pedido = useRef<AbortController | null>(null)
  const [mensagem, setMensagem] = useState<string | null>(null)
  const [tilesFalharam, setTilesFalharam] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const espera = useEsperaServidor(ocupado)
  const anunciar = useAnuncio()

  useEffect(() => {
    const el = contêiner.current
    if (!el) return
    const mapa = L.map(el, opcoesMapa(ponteiroEhFino())).setView(CENTRO, 17, { animate: false })
    mapaRef.current = mapa
    el.setAttribute('role', 'img')
    el.setAttribute('aria-label', 'Mapa para escolher um ponto. Use os botões abaixo do mapa; a mira marca o centro.')
    const tiles = L.tileLayer(URL_TILES, { maxZoom: MAX_ZOOM })
    const vigia = vigiarTiles(tiles, () => {
      setTilesFalharam(true)
      anunciar(MSG_TILES)
    })
    vigiaRef.current = vigia
    tiles.addTo(mapa)
    tilesRef.current = tiles
    mapa.on('click', (e: L.LeafletMouseEvent) => mapa.setView(e.latlng, mapa.getZoom(), { animate: false }))
    return () => {
      vigia.parar()
      pedido.current?.abort()
      mapa.remove()
      mapaRef.current = null
    }
  }, [anunciar])

  /** O mapa só mostra para quem enxerga; quem usa leitor de tela precisa saber que ele andou. */
  function mover(acao: (mapa: L.Map) => void, texto: string) {
    const mapa = mapaRef.current
    if (!mapa) return
    acao(mapa)
    anunciar(texto, { chave: 'mover-mapa', intervaloMs: 1500 })
  }

  async function marcar() {
    const mapa = mapaRef.current
    if (!mapa || ocupado) return
    const { lat, lng } = mapa.getCenter()
    const controle = new AbortController()
    pedido.current = controle
    setOcupado(true)
    setMensagem(null)
    anunciar('Marcando o ponto.')
    try {
      const e = await enderecoDoPonto(arredondar4(lat), arredondar4(lng), controle.signal)
      if (controle.signal.aborted) return
      aoMarcar({ lat, lon: lng, rotulo: e.rotulo, origem: 'mapa' })
    } catch (erro) {
      if (controle.signal.aborted || ehCancelamento(erro)) return
      if (erro instanceof ErroApi && erro.tipo === 'nao_encontrado' && erro.message !== FORA_DA_AREA) {
        aoMarcar({ lat, lon: lng, rotulo: null, origem: 'mapa', nota: 'Sem endereço conhecido a até 50 m; pode registrar neste ponto.' })
      } else if (ehFalhaDeConexao(erro)) {
        aoMarcar({ lat, lon: lng, rotulo: null, origem: 'mapa', nota: NOTA_SEM_CONFIRMAR })
      } else {
        const texto = erro instanceof ErroApi ? erro.message : MSG_INESPERADO
        setMensagem(texto)
        anunciar(texto)
      }
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="mapa-rota__corpo">
      <figure className="mapa">
        <div ref={contêiner} className="mapa__leaflet" />
        <Pictograma nome="localizacao" tamanho={36} className="mapa__mira" />
        <figcaption className="mapa__atribuicao">
          © colaboradores do <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
        </figcaption>
      </figure>
      {tilesFalharam && (
        <div className="aviso">
          <span>{MSG_TILES}</span>
          <Placa
            onClick={() => {
              botaoMarcar.current?.focus()
              setTilesFalharam(false)
              vigiaRef.current?.rearmar()
              tilesRef.current?.redraw()
            }}
          >
            Tentar de novo
          </Placa>
        </div>
      )}
      <div role="group" aria-label="Mover o mapa" className="mapa-rota__controles">
        {MOVER.map((m) => (
          <Placa key={m.rotulo} onClick={() => mover((mapa) => mapa.panBy([m.dx, m.dy], { animate: false }), `Mapa movido para ${m.rotulo.toLowerCase()}.`)}>
            {m.rotulo}
          </Placa>
        ))}
        <Placa pictograma="mais" onClick={() => mover((mapa) => mapa.zoomIn(1, { animate: false }), 'Mapa aproximado.')}>
          Aproximar
        </Placa>
        <Placa pictograma="menos" onClick={() => mover((mapa) => mapa.zoomOut(1, { animate: false }), 'Mapa afastado.')}>
          Afastar
        </Placa>
      </div>
      <Placa ref={botaoMarcar} pictograma="localizacao" onClick={marcar} aria-disabled={ocupado || undefined}>
        Marcar o centro do mapa
      </Placa>
      {ocupado && <p className="campo__retorno">{espera ?? 'Marcando o ponto…'}</p>}
      {mensagem && <p className="campo__retorno campo__retorno--erro">{mensagem}</p>}
    </div>
  )
}

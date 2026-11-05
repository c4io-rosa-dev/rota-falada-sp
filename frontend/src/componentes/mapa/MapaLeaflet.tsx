import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import type { RotaOut } from '../../api/client'
import { linhaDoGeoJson, type PontoLatLng } from '../../dados/rotaGeo'
import { DESENHOS, type NomePictograma } from '../pictogramas'
import './mapa.css'
import { MAX_ZOOM, opcoesMapa, ponteiroEhFino, URL_TILES, vigiarTiles, type VigiaTiles } from './opcoesMapa'

export type ControleMapa = {
  aproximar: () => void
  afastar: () => void
  rotaInteira: () => void
  recarregarTiles: () => void
}

type Props = {
  ref?: Ref<ControleMapa>
  rota: RotaOut
  descricao: string
  /** Passo enquadrado e destacado. */
  passoSelecionado: number | null
  /** Sobe a cada "Ver o passo N", para enquadrar de novo depois de a pessoa mover o mapa. */
  rodadaPasso: number
  /** Passo em leitura em voz alta: só troca o destaque, nunca move o mapa. */
  passoEmLeitura: number | null
  aoFalharTiles: () => void
  aoMudarZoom: (noMinimo: boolean, noMaximo: boolean) => void
}

/** A grade é 24 e o svg tem 28 px: o traço compensa, para desenhar os mesmos 2 px de todo pictograma. */
const TRACO_MARCADOR = 48 / 28

function iconeDe(nome: NomePictograma): L.DivIcon {
  const tracos = DESENHOS[nome].map((d) => `<path d="${d}"/>`).join('')
  return L.divIcon({
    className: 'mapa__marcador',
    html: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="${TRACO_MARCADOR}" aria-hidden="true">${tracos}</svg>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  })
}

export default function MapaLeaflet({ ref, rota, descricao, passoSelecionado, rodadaPasso, passoEmLeitura, aoFalharTiles, aoMudarZoom }: Props) {
  const contêiner = useRef<HTMLDivElement>(null)
  const mapaRef = useRef<L.Map | null>(null)
  const tilesRef = useRef<L.TileLayer | null>(null)
  const vigiaRef = useRef<VigiaTiles | null>(null)
  const destaqueRef = useRef<L.Polyline[]>([])
  const avisos = useRef({ aoFalharTiles, aoMudarZoom })
  useEffect(() => {
    avisos.current = { aoFalharTiles, aoMudarZoom }
  })

  const linha = linhaDoGeoJson(rota.geometria) as PontoLatLng[]

  useEffect(() => {
    const el = contêiner.current
    if (!el) return
    const mapa = L.map(el, opcoesMapa(ponteiroEhFino()))
    mapaRef.current = mapa
    // o MapContainer do react-leaflet só repassa className/id/style; o contêiner é nosso
    el.setAttribute('role', 'img')
    el.setAttribute('aria-label', descricao)

    const tiles = L.tileLayer(URL_TILES, { maxZoom: MAX_ZOOM })
    const vigia = vigiarTiles(tiles, () => avisos.current.aoFalharTiles())
    vigiaRef.current = vigia
    tiles.addTo(mapa)
    tilesRef.current = tiles

    L.polyline(linha, { className: 'mapa__casing', interactive: false }).addTo(mapa)
    L.polyline(linha, { className: 'mapa__linha', interactive: false }).addTo(mapa)
    L.marker(linha[0], { icon: iconeDe('origem'), keyboard: false, interactive: false }).addTo(mapa)
    L.marker(linha[linha.length - 1], { icon: iconeDe('destino'), keyboard: false, interactive: false }).addTo(mapa)

    const notificarZoom = () => avisos.current.aoMudarZoom(mapa.getZoom() <= mapa.getMinZoom(), mapa.getZoom() >= MAX_ZOOM)
    mapa.on('zoomend', notificarZoom)
    mapa.fitBounds(linha, { animate: false, padding: [24, 24] })
    notificarZoom()

    return () => {
      vigia.parar()
      mapa.remove()
      mapaRef.current = null
    }
    // o mapa é recriado só com outra rota; a descrição acompanha a rota
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rota])

  useImperativeHandle(
    ref,
    () => ({
      aproximar: () => mapaRef.current?.zoomIn(1, { animate: false }),
      afastar: () => mapaRef.current?.zoomOut(1, { animate: false }),
      rotaInteira: () => mapaRef.current?.fitBounds(linhaDoGeoJson(rota.geometria) as PontoLatLng[], { animate: false, padding: [24, 24] }),
      recarregarTiles: () => {
        vigiaRef.current?.rearmar()
        tilesRef.current?.redraw()
      },
    }),
    [rota],
  )

  // o destaque (óxido) acompanha a leitura; o enquadramento só o passo escolhido
  const ordemDestaque = passoEmLeitura ?? passoSelecionado
  useEffect(() => {
    const mapa = mapaRef.current
    if (!mapa) return
    destaqueRef.current.forEach((c) => c.remove())
    destaqueRef.current = []
    const passo = rota.passos.find((p) => p.ordem === ordemDestaque)
    const trecho = passo ? linhaDoGeoJson(passo.geometria) : null
    if (!trecho) return
    destaqueRef.current = [
      L.polyline(trecho, { className: 'mapa__casing mapa__casing--ativo', interactive: false }).addTo(mapa),
      L.polyline(trecho, { className: 'mapa__linha mapa__linha--ativa', interactive: false }).addTo(mapa),
    ]
  }, [rota, ordemDestaque])

  useEffect(() => {
    const passo = rota.passos.find((p) => p.ordem === passoSelecionado)
    const trecho = passo ? linhaDoGeoJson(passo.geometria) : null
    if (trecho) mapaRef.current?.fitBounds(trecho, { animate: false, padding: [48, 48], maxZoom: 18 })
  }, [rota, passoSelecionado, rodadaPasso])

  return <div ref={contêiner} className="mapa__leaflet" />
}

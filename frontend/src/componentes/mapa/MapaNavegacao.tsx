import { useEffect, useId, useRef, useState } from 'react'
import { cenaDoMapa, type PrefsMapa } from '../../dados/navegacao/mapaNavegacao'
import type { EstadoNavegacao } from '../../dados/navegacao/navegacao'
import {
  ATRIBUICAO_MAPA,
  DICA_GIRAR_MAPA,
  DICA_MOSTRAR_MAPA,
  MAPA_ANUNCIO_FALHOU,
  MAPA_ANUNCIO_SEM_WEBGL,
  MAPA_CARREGANDO,
  MAPA_FALHOU,
  MAPA_PARTE_FALTANDO,
  MAPA_SEM_WEBGL,
  ROTULO_MAPA_FIM,
  ROTULO_MAPA_GIRADO,
  ROTULO_MAPA_NORTE,
} from '../navegacao/textosNavegacao'
import { Placa } from '../Placa'
import { useAnuncio } from '../useAnuncio'
// só o tipo: apagado na compilação, o chunk do motor (MapLibre) continua fora desta página
import type { MotivoFalha, MotorMapa } from './MotorMapaNavegacao'
import './mapa.css'

type Props = {
  estado: EstadoNavegacao
  prefs: PrefsMapa
  aoMudarPrefs: (qual: 'aberto' | 'girar', valor: boolean) => void
}

/** Fase com o mapa aberto; fechado = !prefs.aberto. */
type FaseAberto = 'carregando' | 'pronto' | 'sem_webgl' | 'falhou'

const NOME_OSM = 'OpenStreetMap'
/** O link abre em outra aba: um toque sem querer na rua não encerra a navegação (voz e GPS). */
const AVISO_OUTRA_ABA = ' (abre em outra aba)'
/** "Mapa: Protomaps © colaboradores do " + link. O texto inteiro continua sendo ATRIBUICAO_MAPA. */
const ATRIBUICAO_ANTES = ATRIBUICAO_MAPA.endsWith(NOME_OSM) ? ATRIBUICAO_MAPA.slice(0, -NOME_OSM.length) : `${ATRIBUICAO_MAPA} `

function movimentoReduzido(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Casca do mapa da navegação guiada (spec 10). Complemento do painel e da voz, nunca a única
 * fonte. O motor (MapLibre) só sai por import() à mão quando a pessoa abre: React.lazy guardaria
 * a rejeição e "Tentar de novo" precisa de uma carga nova (padrão de MapaRota.tsx). A posição
 * chega ao motor a cada leitura sem novo render da figura: o aria-label só muda com "Girar".
 */
export function MapaNavegacao({ estado, prefs, aoMudarPrefs }: Props) {
  // ao reabrir, a figura nasce em "carregando": o contêiner precisa existir antes do efeito
  const [fase, setFase] = useState<FaseAberto>('carregando')
  const [parteFaltando, setParteFaltando] = useState(false)
  const [tentativa, setTentativa] = useState(0)
  const motor = useRef<MotorMapa | null>(null)
  const rumoAplicado = useRef(0)
  const bloco = useRef<HTMLDivElement>(null)
  const tela = useRef<HTMLDivElement>(null)
  const norte = useRef<HTMLSpanElement>(null)
  const agulha = useRef<SVGSVGElement>(null)
  const figura = useRef<HTMLElement>(null)
  const botaoMostrar = useRef<HTMLButtonElement>(null)
  const dicaMostrar = useId()
  const dicaGirar = useId()
  const anunciar = useAnuncio()

  // Carga do motor: ao abrir e a cada "Tentar de novo". Fechar e desmontar destroem.
  useEffect(() => {
    if (!prefs.aberto) return
    const el = tela.current
    if (!el) return
    let vivo = true
    let avisou = false
    let criado: MotorMapa | null = null

    const falhar = (motivo: MotivoFalha | 'import') => {
      if (!vivo || avisou) return
      avisou = true
      criado?.destruir()
      criado = null
      motor.current = null
      // "Girar" e o link da atribuição somem na falha: quem estava neles não cai no começo da página
      const ativo = document.activeElement
      if (ativo && ativo !== botaoMostrar.current && bloco.current?.contains(ativo)) botaoMostrar.current?.focus()
      const semWebgl = motivo === 'sem_webgl'
      setFase(semWebgl ? 'sem_webgl' : 'falhou')
      anunciar(semWebgl ? MAPA_ANUNCIO_SEM_WEBGL : MAPA_ANUNCIO_FALHOU, { chave: 'mapa' })
    }

    import('./MotorMapaNavegacao')
      .then((modulo) =>
        modulo.criarMotor(el, {
          reduzido: movimentoReduzido,
          aoFalhar: falhar,
          aoFaltarParte: () => {
            if (vivo) setParteFaltando(true)
          },
          // a agulha segue o rumo real do mapa (quadro a quadro no giro), direto no DOM, sem novo render
          aoMudarRumo: (rumo) => {
            if (!vivo) return
            const girado = Math.round(rumo) % 360 !== 0
            if (norte.current) norte.current.hidden = !girado
            if (agulha.current) agulha.current.style.transform = girado ? `rotate(${-rumo}deg)` : ''
          },
        }),
      )
      .then((m) => {
        if (!vivo || avisou) {
          m.destruir()
          return
        }
        criado = m
        motor.current = m
        rumoAplicado.current = 0 // um mapa novo nasce com o norte para cima
        setFase('pronto')
      })
      // import que falhou, ou motor que já avisou por aoFalhar antes de existir o mapa
      .catch(() => falhar('import'))

    return () => {
      vivo = false
      criado?.destruir()
      criado = null
      motor.current = null
    }
  }, [prefs.aberto, tentativa, anunciar])

  // A cada leitura: a cena vai ao motor; nada é anunciado e o foco não muda. Sem timer, sem sensor.
  useEffect(() => {
    const m = motor.current
    if (!prefs.aberto || fase !== 'pronto' || !m) return
    const cena = cenaDoMapa(estado, prefs, rumoAplicado.current)
    if (!cena) return
    rumoAplicado.current = cena.rumoAplicado
    m.atualizar(cena, prefs.girar)
    // direto no DOM, sem novo render: atributo de apoio (E2E). O indicador de norte segue o motor.
    if (figura.current) figura.current.dataset.camera = cena.camera.modo
  }, [estado, prefs, fase])

  function alternarMapa() {
    if (prefs.aberto) {
      // a próxima abertura recomeça do zero; o efeito de carga destrói o motor
      setFase('carregando')
      setParteFaltando(false)
    }
    aoMudarPrefs('aberto', !prefs.aberto)
  }

  function tentarDeNovo() {
    // o botão some: o foco vai ao "Mostrar o mapa", nunca ao corpo da página
    botaoMostrar.current?.focus()
    setParteFaltando(false)
    setFase('carregando')
    setTentativa((t) => t + 1)
  }

  const comTela = fase === 'carregando' || fase === 'pronto'
  const rotulo = (prefs.girar ? ROTULO_MAPA_GIRADO : ROTULO_MAPA_NORTE) + ROTULO_MAPA_FIM

  return (
    <div ref={bloco} className="mapa-nav__bloco">
      <div className="mapa-nav__escolha">
        {/* ação com o rótulo do que faz agora, sem aria-pressed (WCAG 4.1.2): o estado não fica só no
            fundo e na borda. É o mesmo botão: o foco fica nele ao trocar o rótulo */}
        <Placa ref={botaoMostrar} pictograma="enquadrar" aria-describedby={dicaMostrar} onClick={alternarMapa}>
          {prefs.aberto ? 'Esconder o mapa' : 'Mostrar o mapa'}
        </Placa>
        <p id={dicaMostrar} className="campo__dica">
          {DICA_MOSTRAR_MAPA}
        </p>
      </div>

      {prefs.aberto && comTela && (
        <div className="mapa-nav__escolha">
          {/* alternância: nome fixo e estado no aria-pressed. O "ligado"/"desligado" escrito é para
              quem vê (WCAG 1.4.1) e fica fora do nome, que nunca troca junto com o aria-pressed */}
          <Placa aria-pressed={prefs.girar} aria-describedby={dicaGirar} onClick={() => aoMudarPrefs('girar', !prefs.girar)}>
            Girar o mapa com a rota
            <span className="mapa-nav__ligado" aria-hidden="true">
              {prefs.girar ? ': ligado' : ': desligado'}
            </span>
          </Placa>
          <p id={dicaGirar} className="campo__dica">
            {DICA_GIRAR_MAPA}
          </p>
        </div>
      )}

      {prefs.aberto && (
        <figure ref={figura} className="mapa-nav" data-fase={fase}>
          {comTela && (
            <div role="img" aria-label={rotulo} className="mapa-nav__tela">
              <div ref={tela} className="mapa-nav__motor" />
              <span ref={norte} className="mapa-nav__norte" aria-hidden="true" hidden>
                <svg ref={agulha} className="mapa-nav__agulha" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="butt" strokeLinejoin="miter" focusable="false">
                  {/* seta para o norte e o N, na grade 24 e traço 2 dos pictogramas */}
                  <path d="M12 2L16 9H8Z" />
                  <path d="M8 22V13L16 22V13" />
                </svg>
              </span>
            </div>
          )}

          {fase === 'carregando' && <p className="mapa-nav__estado">{MAPA_CARREGANDO}</p>}
          {fase === 'pronto' && parteFaltando && <p className="mapa-nav__estado">{MAPA_PARTE_FALTANDO}</p>}
          {fase === 'sem_webgl' && <p className="mapa-nav__estado">{MAPA_SEM_WEBGL}</p>}
          {fase === 'falhou' && (
            <div className="mapa-nav__estado">
              <p>{MAPA_FALHOU}</p>
              <Placa onClick={tentarDeNovo}>Tentar de novo</Placa>
            </div>
          )}

          {comTela && (
            <figcaption className="mapa-nav__atribuicao">
              {ATRIBUICAO_ANTES}
              <a className="mapa-nav__link" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
                {NOME_OSM}
                {AVISO_OUTRA_ABA}
              </a>
            </figcaption>
          )}
        </figure>
      )}
    </div>
  )
}

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { FonteDirecao } from '../../dados/navegacao/direcaoSeta'
import type { PrefsMapa } from '../../dados/navegacao/mapaNavegacao'
import type { EstadoNavegacao } from '../../dados/navegacao/navegacao'
import type { QualPreferenciaMapa } from '../../dados/preferenciaMapa'
import {
  ATRIBUICAO_MAPA,
  BUSSOLA_NEGADA,
  DICA_GIRAR_MAPA,
  DICA_GIRAR_PELA_INCLINADA,
  DICA_INCLINAR_MAPA,
  DICA_MOSTRAR_MAPA,
  DICA_TELA_CHEIA,
  DICA_USAR_BUSSOLA,
  MAPA_ANUNCIO_FALHOU,
  MAPA_ANUNCIO_SEM_WEBGL,
  MAPA_CARREGANDO,
  MAPA_FALHOU,
  MAPA_PARTE_FALTANDO,
  MAPA_SEM_WEBGL,
  ROTULO_MAPA_FIM,
  ROTULO_MAPA_GIRADO,
  ROTULO_MAPA_INCLINADO,
  ROTULO_MAPA_NORTE,
  ROTULO_SAIR_TELA_CHEIA,
  ROTULO_USAR_BUSSOLA,
  SETA_PELA_BUSSOLA,
  SETA_PELA_CAMINHADA,
  SETA_PELA_ROTA,
  SETA_SEM_DIRECAO,
} from '../navegacao/textosNavegacao'
import { Placa } from '../Placa'
import { useAnuncio } from '../useAnuncio'
// só o tipo: apagado na compilação, o chunk do motor (MapLibre) continua fora desta página
import type { MotivoFalha, MotorMapa } from './MotorMapaNavegacao'
import { useBussola } from './useBussola'
import './mapa.css'

type Props = {
  estado: EstadoNavegacao
  prefs: PrefsMapa
  aoMudarPrefs: (qual: QualPreferenciaMapa, valor: boolean) => void
  /** O que vem antes das opções do mapa na faixa de baixo: a distância que falta e os controles. */
  children?: ReactNode
}

/**
 * A cena, a escolha da direção da seta e a escuta da bússola: só o tipo aqui. O código chega por
 * import() junto com o motor, para não pesar na página da navegação.
 */
type ApoioMapa = typeof import('./apoioMapaAberto')

/** Fase com o mapa aberto; fechado = !prefs.aberto. */
type FaseAberto = 'carregando' | 'pronto' | 'sem_webgl' | 'falhou'

type FonteSeta = FonteDirecao | 'nenhuma'

const TEXTO_DA_FONTE: Record<FonteSeta, string> = {
  bussola: SETA_PELA_BUSSOLA,
  caminhada: SETA_PELA_CAMINHADA,
  rota: SETA_PELA_ROTA,
  nenhuma: SETA_SEM_DIRECAO,
}

const NOME_OSM = 'OpenStreetMap'
/** O link abre em outra aba: um toque sem querer na rua não encerra a navegação (voz e GPS). */
const AVISO_OUTRA_ABA = ' (abre em outra aba)'
/** "Mapa: Protomaps © colaboradores do " + link. O texto inteiro continua sendo ATRIBUICAO_MAPA. */
const ATRIBUICAO_ANTES = ATRIBUICAO_MAPA.endsWith(NOME_OSM) ? ATRIBUICAO_MAPA.slice(0, -NOME_OSM.length) : `${ATRIBUICAO_MAPA} `

function movimentoReduzido(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** O estado escrito à vista de uma alternância: fora do nome, que nunca troca junto com o aria-pressed. */
function Ligado({ ligado }: { ligado: boolean }) {
  return (
    <span className="mapa-nav__ligado" aria-hidden="true">
      {ligado ? ': ligado' : ': desligado'}
    </span>
  )
}

/**
 * Casca do mapa da navegação guiada (spec 10 e emenda 19). Complemento do painel e da voz, nunca
 * a única fonte. O motor (MapLibre) só sai por import() à mão quando a pessoa abre: React.lazy
 * guardaria a rejeição e "Tentar de novo" precisa de uma carga nova (padrão de MapaRota.tsx). A
 * posição chega ao motor a cada leitura sem novo render da figura: o aria-label só muda com
 * "Girar" e "Vista inclinada".
 *
 * A casca devolve duas partes irmãs, na ordem do DOM que vale nos dois modos de tela: a faixa de
 * baixo (`nav-tela__base`: os filhos, depois as opções do mapa) e a figura. Em tela cheia a página
 * (Navegar.tsx) só muda o CSS do contêiner; a ordem de leitura e do Tab não muda.
 */
export function MapaNavegacao({ estado, prefs, aoMudarPrefs, children }: Props) {
  // ao reabrir, a figura nasce em "carregando": o contêiner precisa existir antes do efeito
  const [fase, setFase] = useState<FaseAberto>('carregando')
  const [parteFaltando, setParteFaltando] = useState(false)
  const [tentativa, setTentativa] = useState(0)
  const [fonteSeta, setFonteSeta] = useState<FonteSeta>('nenhuma')
  const motor = useRef<MotorMapa | null>(null)
  const apoio = useRef<ApoioMapa | null>(null)
  const [ouvirBussola, setOuvirBussola] = useState<ApoioMapa['ouvirBussola'] | null>(null)
  const rumoAplicado = useRef(0)
  const ultimoEstado = useRef(estado)
  const bloco = useRef<HTMLDivElement>(null)
  const tela = useRef<HTMLDivElement>(null)
  const norte = useRef<HTMLSpanElement>(null)
  const agulha = useRef<SVGSVGElement>(null)
  const figura = useRef<HTMLElement>(null)
  const botaoMostrar = useRef<HTMLButtonElement>(null)
  const botaoCheia = useRef<HTMLButtonElement>(null)
  const botaoSair = useRef<HTMLButtonElement>(null)
  const textoSeta = useRef<HTMLParagraphElement>(null)
  const dicaMostrar = useId()
  const dicaGirar = useId()
  const dicaInclinar = useId()
  const dicaCheia = useId()
  const dicaBussola = useId()
  const anunciar = useAnuncio()
  const mudarPrefs = useRef(aoMudarPrefs)

  const inclinada = prefs.inclinada === true
  // inclinado e com o norte fixo, quem anda para o sul vê o que ficou para trás: a vista inclinada sempre gira com a rota
  const girar = prefs.girar || inclinada
  const cheia = prefs.aberto && prefs.cheia === true

  useEffect(() => {
    mudarPrefs.current = aoMudarPrefs
    ultimoEstado.current = estado
  })

  /**
   * A seta da pessoa: bússola → caminhada (GPS) → rota → nenhuma. A direção vai direto ao motor,
   * sem passar pelo estado do React nem pelo DOM; só a FONTE (um nome) vira texto à vista.
   */
  const aoGirarBussola = useRef<() => void>(() => {})
  // os sensores só são ouvidos com o mapa aberto e desenhado
  const bussola = useBussola(
    prefs.aberto && fase === 'pronto',
    ouvirBussola,
    useCallback(() => aoGirarBussola.current(), []),
  )
  const ouvinteBussola = bussola.ouvinte
  const aplicarSeta = useCallback(() => {
    const m = motor.current
    const a = apoio.current
    if (!m || !a) return
    const direcao = a.direcaoDaSeta(ultimoEstado.current, ouvinteBussola.current?.leitura() ?? null, Date.now())
    m.apontar(direcao ? direcao.graus : null)
    setFonteSeta(direcao ? direcao.fonte : 'nenhuma')
  }, [ouvinteBussola])

  useEffect(() => {
    aoGirarBussola.current = aplicarSeta
  }, [aplicarSeta])

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
      // as opções e o link da atribuição somem na falha: quem estava neles não cai no começo da página
      const ativo = document.activeElement
      if (ativo && ativo !== botaoMostrar.current && (bloco.current?.contains(ativo) || figura.current?.contains(ativo) || ativo === botaoSair.current)) {
        botaoMostrar.current?.focus()
      }
      const semWebgl = motivo === 'sem_webgl'
      setFase(semWebgl ? 'sem_webgl' : 'falhou')
      // sem mapa não há por que ficar em tela cheia
      mudarPrefs.current('cheia', false)
      anunciar(semWebgl ? MAPA_ANUNCIO_SEM_WEBGL : MAPA_ANUNCIO_FALHOU, { chave: 'mapa' })
    }

    // o apoio (cena, direção da seta, bússola) vem no mesmo momento do motor: só com o mapa aberto
    Promise.all([import('./MotorMapaNavegacao'), import('./apoioMapaAberto')])
      .then(([modulo, a]) => {
        if (vivo) {
          apoio.current = a
          setOuvirBussola(() => a.ouvirBussola)
        }
        return modulo.criarMotor(el, {
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
        })
      })
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

  // A cada leitura: a cena vai ao motor; nada é anunciado e o foco não muda. Sem timer.
  useEffect(() => {
    const m = motor.current
    const a = apoio.current
    if (!prefs.aberto || fase !== 'pronto' || !m || !a) return
    const cena = a.cenaDoMapa(estado, { ...prefs, girar }, rumoAplicado.current)
    if (!cena) return
    rumoAplicado.current = cena.rumoAplicado
    m.atualizar(cena, girar, inclinada)
    // a mesma leitura confere a seta: a bússola que parou há mais de 3 s cai para a caminhada ou a rota
    ultimoEstado.current = estado
    aplicarSeta()
    // direto no DOM, sem novo render: atributo de apoio (E2E). O indicador de norte segue o motor.
    if (figura.current) figura.current.dataset.camera = cena.camera.modo
  }, [estado, prefs, fase, girar, inclinada, aplicarSeta])

  // Tela cheia: ao entrar, o foco vai para "Sair da tela cheia"; ao sair, fica na alternância.
  // Na montagem (preferência vinda da aba) o foco não é mexido.
  const cheiaAntes = useRef(cheia)
  useEffect(() => {
    if (cheia === cheiaAntes.current) return
    cheiaAntes.current = cheia
    if (cheia) botaoSair.current?.focus()
    else botaoCheia.current?.focus()
  }, [cheia])

  // iPhone: respondido o pedido da bússola feito no toque, o botão some; o foco vai para o texto que
  // diz a fonte da seta. Se a bússola ligou sozinha (sem toque), o foco não é mexido.
  const bussolaAntes = useRef(bussola.estado)
  const pediuNoToque = useRef(false)
  useEffect(() => {
    const antes = bussolaAntes.current
    bussolaAntes.current = bussola.estado
    if (antes === 'pedir' && bussola.estado !== 'pedir' && pediuNoToque.current) textoSeta.current?.focus()
  }, [bussola.estado])

  function pedirBussola() {
    pediuNoToque.current = true
    bussola.pedir()
  }

  function alternarMapa() {
    if (prefs.aberto) {
      // a próxima abertura recomeça do zero; o efeito de carga destrói o motor
      setFase('carregando')
      setParteFaltando(false)
      // fechar o mapa também sai da tela cheia: reabrir não toma a tela sozinho
      if (prefs.cheia) aoMudarPrefs('cheia', false)
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
  const rotulo = (girar ? ROTULO_MAPA_GIRADO : ROTULO_MAPA_NORTE) + (inclinada ? ROTULO_MAPA_INCLINADO : '') + ROTULO_MAPA_FIM
  // a seta só existe quando há uma pessoa no mapa (no passo a passo e na procura sem leitura, não há)
  const comPessoa = estado.fase !== 'passo_a_passo' && !(estado.fase === 'procurando' && !estado.ultimaLeitura)

  return (
    <>
      <div className="nav-tela__base">
        {/* sempre o primeiro da faixa de baixo e sempre à vista em tela cheia: a saída fácil (além do Esc) */}
        {cheia && (
          <Placa ref={botaoSair} className="nav-tela__sair" onClick={() => aoMudarPrefs('cheia', false)}>
            {ROTULO_SAIR_TELA_CHEIA}
          </Placa>
        )}
        {children}
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
            <>
              <div className="mapa-nav__escolha">
                {/* alternância: nome fixo e estado no aria-pressed. O "ligado"/"desligado" escrito é para
                    quem vê (WCAG 1.4.1) e fica fora do nome, que nunca troca junto com o aria-pressed */}
                {/* com a vista inclinada o giro é obrigatório: o botão mostra ligado e não desliga (aria-disabled
                    mantém o foco nele, e a dica diz por quê) */}
                <Placa
                  aria-pressed={girar}
                  aria-disabled={inclinada || undefined}
                  aria-describedby={dicaGirar}
                  onClick={() => {
                    if (!inclinada) aoMudarPrefs('girar', !prefs.girar)
                  }}
                >
                  Girar o mapa com a rota
                  <Ligado ligado={girar} />
                </Placa>
                <p id={dicaGirar} className="campo__dica">
                  {inclinada ? DICA_GIRAR_PELA_INCLINADA : DICA_GIRAR_MAPA}
                </p>
              </div>

              <div className="mapa-nav__escolha">
                {/* botão, não gesto de dois dedos (WCAG 2.5.1); desligada por padrão */}
                <Placa aria-pressed={inclinada} aria-describedby={dicaInclinar} onClick={() => aoMudarPrefs('inclinada', !inclinada)}>
                  Vista inclinada
                  <Ligado ligado={inclinada} />
                </Placa>
                <p id={dicaInclinar} className="campo__dica">
                  {DICA_INCLINAR_MAPA}
                </p>
              </div>

              <div className="mapa-nav__escolha">
                <Placa ref={botaoCheia} aria-pressed={cheia} aria-describedby={dicaCheia} onClick={() => aoMudarPrefs('cheia', !cheia)}>
                  Mapa em tela cheia
                  <Ligado ligado={cheia} />
                </Placa>
                <p id={dicaCheia} className="campo__dica">
                  {DICA_TELA_CHEIA}
                </p>
              </div>
            </>
          )}

          {prefs.aberto && fase === 'pronto' && comPessoa && (
            <div className="mapa-nav__escolha">
              {/* texto parado, nunca anunciado: diz de onde vem a direção da seta. Recebe o foco só
                  depois da resposta ao pedido da bússola, quando o botão some */}
              <p ref={textoSeta} tabIndex={-1} className="mapa-nav__seta" data-fonte-seta={fonteSeta}>
                {TEXTO_DA_FONTE[fonteSeta]}
                {bussola.estado === 'negada' && ` ${BUSSOLA_NEGADA}`}
              </p>
              {bussola.estado === 'pedir' && (
                <>
                  {/* o toque é o gesto que o iPhone exige para pedir a permissão */}
                  <Placa aria-describedby={dicaBussola} onClick={pedirBussola}>
                    {ROTULO_USAR_BUSSOLA}
                  </Placa>
                  <p id={dicaBussola} className="campo__dica">
                    {DICA_USAR_BUSSOLA}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

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
    </>
  )
}

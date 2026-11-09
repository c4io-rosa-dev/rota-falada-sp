import { Fragment, useEffect, useMemo, useState, type RefObject } from 'react'
import { Link } from 'react-router'
import type { RotaOut } from '../api/client'
import { alertasDaRota, falasDaRota, textoExigenciaDaRota, type Exigencia } from '../dados/narrador'
import { nomesDasFontes, textoMotor, textoSobreARota } from '../dados/passo'
import { linhaDoGeoJson } from '../dados/rotaGeo'
import { horaDe, resumoDaRota } from '../pages/rotaEstado'
import { BotaoOuvir } from './BotaoOuvir'
import { FichaRota } from './FichaRota'
import { levarAoPasso, tirarPassoDeRetorno } from '../dados/retornoPasso'
import { LinkPasso } from './LinkPasso'
import { MapaRota } from './mapa/MapaRota'
import { TabelaPassos } from './TabelaPassos'

type Props = {
  rota: RotaOut
  /** Os rótulos da busca que gerou esta rota, nunca os campos vivos do formulário. */
  origem: string
  destino: string
  exigenciaPedida: Exigencia
  calculadaEm: string
  /** Os campos já não são os desta rota: o título precisa dizer isso a quem navega por títulos. */
  desatualizada: boolean
  tituloRef: RefObject<HTMLHeadingElement | null>
}

export function ResultadoRota({ rota, origem, destino, exigenciaPedida, calculadaEm, desatualizada, tituloRef }: Props) {
  const [passoAtivo, setPassoAtivo] = useState<number | null>(null)
  const [mapaAberto, setMapaAberto] = useState(false)
  const [noMapa, setNoMapa] = useState<{ ordem: number; rodada: number } | null>(null)
  const temMapa = linhaDoGeoJson(rota.geometria) !== null
  const alertas = useMemo(() => alertasDaRota(rota, exigenciaPedida), [rota, exigenciaPedida])
  const falas = useMemo(() => falasDaRota(rota, exigenciaPedida), [rota, exigenciaPedida])

  // quem foi às barreiras de um passo e voltou continua naquele passo, não no topo da página
  useEffect(() => {
    const ordem = tirarPassoDeRetorno()
    if (ordem === null) return
    // depois do foco no h1 que toda página faz ao montar
    const espera = setTimeout(() => levarAoPasso(ordem), 0)
    return () => clearTimeout(espera)
  }, [])

  // o passo em leitura fica à vista, sem animação (conforto sensorial) e sem mover o foco
  useEffect(() => {
    if (passoAtivo === null) return
    document.getElementById(`passo-${passoAtivo}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [passoAtivo])

  return (
    <section className="resultado" aria-labelledby="titulo-resultado">
      <h2 id="titulo-resultado" ref={tituloRef} tabIndex={-1} className="resultado__titulo">
        <span className="letreiro">{desatualizada ? 'Rota da busca anterior' : 'Rota encontrada'}</span>{' '}
        <span className="medida">{resumoDaRota(rota, exigenciaPedida)}</span>
      </h2>

      <div className={mapaAberto ? 'resultado__topo resultado__topo--mapa' : 'resultado__topo'}>
        <FichaRota
          solta
          resumo={textoSobreARota(rota.motor)}
          dados={[
            { rotulo: 'De', valor: origem },
            { rotulo: 'Até', valor: destino },
            { rotulo: 'Inclinação', valor: textoExigenciaDaRota(rota, exigenciaPedida) },
            { rotulo: 'Calculada por', valor: textoMotor(rota.motor) },
            {
              rotulo: 'Calculada às',
              valor: `${horaDe(calculadaEm)}${rota.cache ? '. Reaproveitada de um cálculo das últimas 6 horas' : ''}`,
            },
            {
              rotulo: 'Fontes',
              valor: (
                <>
                  {nomesDasFontes(rota)}.{' '}
                  <Link className="alvo" to="/fontes">
                    Licenças
                  </Link>
                </>
              ),
            },
          ]}
          tituloAvisos="Avisos"
          avisos={alertas.map((a) => ({
            grave: a.grave,
            conteudo: (
              <>
                {a.texto}
                {a.passos.length > 0 && (
                  <>
                    {' '}
                    <span className="aviso__ir">
                      Ir {a.passos.length === 1 ? 'ao' : 'aos'}{' '}
                      {/* links soltos no texto, sem invólucro: são links em frase (WCAG 2.5.8) */}
                      {a.passos.map((ordem, i) => (
                        <Fragment key={ordem}>
                          {i > 0 && ', '}
                          <LinkPasso ordem={ordem} />
                        </Fragment>
                      ))}
                    </span>
                  </>
                )}
              </>
            ),
          }))}
        >
          <BotaoOuvir key={calculadaEm} falas={falas} rotulo="Ouvir a rota" aoMudarPasso={setPassoAtivo} />
        </FichaRota>

        {temMapa && (
          <MapaRota
            rota={rota}
            origem={origem}
            destino={destino}
            aberto={mapaAberto}
            aoAlternar={(aberto) => {
              setMapaAberto(aberto)
              if (!aberto) setNoMapa(null)
            }}
            passoSelecionado={noMapa?.ordem ?? null}
            rodadaPasso={noMapa?.rodada ?? 0}
            passoEmLeitura={passoAtivo}
          />
        )}
      </div>

      <h3 className="letreiro resultado__subtitulo">Passos</h3>
      <TabelaPassos
        passos={rota.passos}
        passoAtivo={passoAtivo}
        rotulo={`Os ${rota.passos.length} passos da rota`}
        pedido={exigenciaPedida}
        aoVerNoMapa={mapaAberto ? (ordem) => setNoMapa((a) => ({ ordem, rodada: (a?.rodada ?? 0) + 1 })) : undefined}
        passoNoMapa={noMapa?.ordem ?? null}
        comBarreiras
      />
    </section>
  )
}

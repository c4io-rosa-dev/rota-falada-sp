import { useState, type RefObject } from 'react'
import { Link } from 'react-router'
import type { RotaOut } from '../api/client'
import { nomesDasFontes, textoExigencia, textosDeAviso, textoMotor, textoSobreARota } from '../dados/passo'
import { linhaDoGeoJson } from '../dados/rotaGeo'
import { horaDe, resumoDaRota } from '../pages/rotaEstado'
import { BotaoOuvir } from './BotaoOuvir'
import { FichaRota } from './FichaRota'
import { MapaRota } from './mapa/MapaRota'
import { TabelaPassos } from './TabelaPassos'

type Props = {
  rota: RotaOut
  /** Os rótulos da busca que gerou esta rota, nunca os campos vivos do formulário. */
  origem: string
  destino: string
  exigenciaPedida: 3 | 6 | 10 | 'any'
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
  const degraus = rota.passos.filter((p) => p.is_degrau).map((p) => p.ordem)

  return (
    <section className="resultado" aria-labelledby="titulo-resultado">
      <h2 id="titulo-resultado" ref={tituloRef} tabIndex={-1} className="resultado__titulo">
        <span className="letreiro">{desatualizada ? 'Rota da busca anterior' : 'Rota encontrada'}</span> <span className="medida">{resumoDaRota(rota)}</span>
      </h2>

      <div className={mapaAberto ? 'resultado__topo resultado__topo--mapa' : 'resultado__topo'}>
        <FichaRota
          solta
          resumo={textoSobreARota(rota.motor)}
          dados={[
            { rotulo: 'De', valor: origem },
            { rotulo: 'Até', valor: destino },
            {
              rotulo: 'Exigência',
              valor: `Pedida: ${textoExigencia(exigenciaPedida)}. Atendida: ${textoExigencia(rota.nivel_exigencia_atendido)}.`,
            },
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
          avisos={[
            ...textosDeAviso(rota),
            ...(degraus.length > 0 ? [`Há degrau no ${degraus.length === 1 ? 'passo' : 'passos'} ${degraus.join(', ')}.`] : []),
          ]}
        >
          <BotaoOuvir key={calculadaEm} passos={rota.passos} rotulo="Ouvir a rota" aoMudarPasso={setPassoAtivo} />
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

      <TabelaPassos
        passos={rota.passos}
        passoAtivo={passoAtivo}
        rotulo={`Os ${rota.passos.length} passos da rota`}
        aoVerNoMapa={mapaAberto ? (ordem) => setNoMapa((a) => ({ ordem, rodada: (a?.rodada ?? 0) + 1 })) : undefined}
        passoNoMapa={noMapa?.ordem ?? null}
        comBarreiras
      />
    </section>
  )
}

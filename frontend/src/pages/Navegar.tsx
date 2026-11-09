import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'
import type { RotaOut } from '../api/client'
import { ControlesNavegacao } from '../componentes/navegacao/ControlesNavegacao'
import { DetalhesTrecho } from '../componentes/navegacao/DetalhesTrecho'
import { FaixaSimulacao } from '../componentes/navegacao/FaixaSimulacao'
import { PainelNavegacao } from '../componentes/navegacao/PainelNavegacao'
import { PreparoNavegacao } from '../componentes/navegacao/PreparoNavegacao'
import {
  ANTES_DE_SAIR_SEM_GPS,
  COMO_LIBERAR,
  MSG_SEM_DESENHO,
  MSG_SEM_LOCALIZACAO,
  MSG_SEM_PERMISSAO,
} from '../componentes/navegacao/textosNavegacao'
import { useNavegacao, type Vigia } from '../componentes/navegacao/useNavegacao'
import { Placa } from '../componentes/Placa'
import { montarTrajeto } from '../dados/navegacao/trajeto'
import { lerSessaoRota, type BuscaFeita } from '../dados/sessaoRota'
import '../estilos/navegacao.css'
import { resumoDaRota } from './rotaEstado'

/**
 * /rota/navegar: acompanha a rota da sessão pelo GPS, tudo no aparelho (spec da navegação guiada).
 * A rota recalculada vive só na memória desta página: nunca vai para a sessão.
 */
export function Navegar() {
  const h1 = usePaginaAcessivel('Navegação guiada')
  const { search } = useLocation()
  const [sessao] = useState(() => lerSessaoRota())
  const rota = sessao?.rota ?? null
  const busca = sessao?.rotaDe ?? null
  const [simulacao, setSimulacao] = useState<Vigia | null | 'carregando'>((): 'carregando' | null =>
    import.meta.env.VITE_PERMITIR_SIMULACAO === 'true' && rota && new URLSearchParams(search).has('simular') ? 'carregando' : null,
  )

  // a simulação só existe no build de teste ou de demonstração; em produção este bloco some
  useEffect(() => {
    if (import.meta.env.VITE_PERMITIR_SIMULACAO === 'true') {
      if (simulacao !== 'carregando' || !rota) return
      const pontos = montarTrajeto(rota)?.pontos
      let vivo = true
      void import('../dados/navegacao/posicaoSimulada').then((m) => {
        if (vivo) setSimulacao(() => (pontos ? m.simulacaoDaBusca(search, pontos) : null))
      })
      return () => {
        vivo = false
      }
    }
  }, [simulacao, rota, search])

  const simulando = typeof simulacao === 'function'
  return (
    <div className="navegar">
      {simulando && <FaixaSimulacao />}
      <h1 ref={h1} tabIndex={-1} className="navegar__titulo">
        Navegação guiada
      </h1>
      {!rota || !busca ? (
        <>
          <p>Nenhuma rota para navegar. Calcule uma rota primeiro.</p>
          <p>
            <Link className="alvo navegar__link" to="/rota">
              Calcular uma rota
            </Link>
          </p>
        </>
      ) : (
        simulacao !== 'carregando' && <NavegacaoGuiada rota={rota} busca={busca} vigia={simulando ? simulacao : null} />
      )}
    </div>
  )
}

function NavegacaoGuiada({ rota, busca, vigia }: { rota: RotaOut; busca: BuscaFeita; vigia: Vigia | null }) {
  const nav = useNavegacao(rota, busca.pedido, vigia)
  const navegar = useNavigate()
  const e = nav.estado

  function encerrar() {
    nav.encerrar()
    // sem gravar nada e sem passo de retorno: /rota volta com a rota original e o foco no h1
    navegar('/rota')
  }

  if (e.fase === 'preparo') {
    return (
      <PreparoNavegacao
        resumo={resumoDaRota(rota, busca.pedido.perfil.inclinacao_max)}
        vozDisponivel={nav.vozDisponivel}
        vozLigada={nav.vozLigada}
        aoAlternarVoz={nav.alternarVoz}
        aoComecar={nav.comecar}
        aoPassoAPasso={nav.passoAPasso}
      />
    )
  }

  if (e.fase === 'sem_permissao') {
    return (
      <div className="navegar__aviso">
        {/* recebe o foco quando a permissão é negada: o foco lê a mensagem, sem anúncio */}
        <p ref={nav.refAviso} tabIndex={-1}>
          {MSG_SEM_PERMISSAO}
        </p>
        <p id="como-liberar">Para liberar a localização:</p>
        <ul className="navegar__lista" aria-labelledby="como-liberar">
          {COMO_LIBERAR.map((texto) => (
            <li key={texto}>{texto}</li>
          ))}
        </ul>
        {/* o toque é um gesto: pode pedir a localização de novo */}
        <Placa variante="acao" pictograma="siga" onClick={nav.tentarDeNovo}>
          Tentar de novo
        </Placa>
        <Placa onClick={nav.passoAPasso}>Seguir passo a passo</Placa>
      </div>
    )
  }

  if (e.fase === 'indisponivel') {
    return (
      <div className="navegar__aviso">
        {/* recebe o foco quando o navegador não tem localização (erro 0 ao começar) */}
        <p ref={nav.refAviso} tabIndex={-1}>
          {e.motivoIndisponivel === 'sem_desenho' ? MSG_SEM_DESENHO : MSG_SEM_LOCALIZACAO}
        </p>
        {/* o passo a passo também é usado andando na rua: os avisos de rua valem sem GPS */}
        <h2 id="antes-de-sair" className="letreiro navegar__subtitulo">
          Antes de sair
        </h2>
        <ul className="navegar__lista" aria-labelledby="antes-de-sair">
          {ANTES_DE_SAIR_SEM_GPS.map((texto) => (
            <li key={texto}>{texto}</li>
          ))}
        </ul>
        <Placa onClick={nav.passoAPasso}>Seguir passo a passo</Placa>
      </div>
    )
  }

  const passoAPasso = e.fase === 'passo_a_passo'
  const ultimo = e.passoAtual === e.rota.passos.length - 1
  const comDetalhes = passoAPasso || e.fase === 'navegando' || (e.fase === 'pausada' && e.faseAntesDaPausa === 'navegando')
  const fora = e.fase === 'navegando' && e.acompanhamento.fora
  const procuraDemorada = e.fase === 'procurando' && e.procuraDemorada
  // aria-disabled sozinho só diz "indisponível": a dica diz por quê
  const dicaRecalcular = e.fase === 'pausada' ? 'Disponível depois de retomar.' : e.recalculando ? 'Calculando nova rota.' : undefined

  return (
    <>
      <PainelNavegacao estado={e} telaPodeApagar={nav.telaPodeApagar} refTitulo={nav.refPainel} />
      {e.fase === 'chegou' ? (
        <Placa para="/rota" className="navegar__voltar">
          Voltar para a rota
        </Placa>
      ) : (
        <>
          {procuraDemorada && <Placa onClick={nav.passoAPasso}>Seguir passo a passo</Placa>}
          {comDetalhes && <DetalhesTrecho passo={e.rota.passos[e.passoAtual]} />}
          <ControlesNavegacao
            aoEncerrar={encerrar}
            controles={
              passoAPasso
                ? [
                    { rotulo: 'Passo anterior', aoTocar: nav.passoAnterior, inativo: e.passoAtual === 0 },
                    { rotulo: 'Próximo passo', aoTocar: nav.proximoPasso, inativo: ultimo },
                    { rotulo: 'Repetir', pictograma: 'ouvir', aoTocar: nav.repetir },
                  ]
                : [
                    { rotulo: 'Repetir', pictograma: 'ouvir', aoTocar: nav.repetir },
                    // fora da rota vira a ação principal, sem mudar de lugar
                    {
                      rotulo: 'Recalcular',
                      pictograma: 'siga',
                      aoTocar: nav.recalcular,
                      acao: fora,
                      inativo: dicaRecalcular !== undefined,
                      dica: dicaRecalcular,
                    },
                    { rotulo: 'Pausar', pictograma: 'parar', aoTocar: nav.alternarPausa, pressionado: e.fase === 'pausada' },
                  ]
            }
          />
        </>
      )}
    </>
  )
}

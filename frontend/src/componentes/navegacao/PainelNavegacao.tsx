import type { RefObject } from 'react'
import { gravesFaladosDoPasso } from '../../dados/narrador'
import { distanciaNaTela, proximoUtil } from '../../dados/navegacao/falasNavegacao'
import { avisoDaProcura, type EstadoNavegacao } from '../../dados/navegacao/navegacao'
import { letreiroDoPasso, separarInstrucao, textoInstrucao } from '../../dados/passo'
import { Pictograma } from '../Pictograma'
import type { NomePictograma } from '../pictogramas'

type Props = {
  estado: EstadoNavegacao
  telaPodeApagar: boolean
  refTitulo: RefObject<HTMLHeadingElement | null>
}

function pictogramaDoAviso(aviso: string): NomePictograma {
  if (aviso.startsWith('degrau')) return 'degrau'
  if (aviso.startsWith('inclinação')) return 'rampa'
  if (aviso.startsWith('calçada estreita')) return 'largura'
  return 'alerta'
}

function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/** Só texto: a cor nunca é o único sinal. A ordem diz o que pesa mais agora. */
function linhaDeEstado(e: EstadoNavegacao): string | null {
  if (e.fase === 'pausada') return 'Pausada'
  if (e.fase !== 'navegando') return null
  if (e.recalculando) return 'Calculando nova rota'
  if (e.acompanhamento.sinal === 'sem_sinal') return 'Sem sinal de localização'
  if (e.acompanhamento.fora) return 'Fora da rota'
  if (e.acompanhamento.sinal === 'fraco') return 'Sinal fraco, a posição pode errar'
  return 'Na rota'
}

function titulo(e: EstadoNavegacao): string {
  if (e.fase === 'chegou') return 'Você chegou ao destino'
  const procurando = e.fase === 'procurando' || (e.fase === 'pausada' && e.faseAntesDaPausa === 'procurando')
  if (procurando) return 'Procurando sua posição'
  return `Passo ${e.rota.passos[e.passoAtual].ordem} de ${e.rota.passos.length}`
}

/**
 * O painel da navegação. Não é região viva: a distância muda na tela e nunca é anunciada.
 * O h2 recebe o foco ao começar, na chegada e ao entrar no passo a passo.
 */
export function PainelNavegacao({ estado: e, telaPodeApagar, refTitulo }: Props) {
  const passos = e.rota.passos
  const atual = passos[e.passoAtual]
  const passoAPasso = e.fase === 'passo_a_passo'
  const comPasso = e.fase === 'navegando' || passoAPasso || (e.fase === 'pausada' && e.faseAntesDaPausa === 'navegando')

  // a ação é a do próximo passo útil (a manobra adiante); no passo a passo, a do próprio passo
  const prox = passoAPasso ? e.passoAtual : proximoUtil(e.contexto, e.passoAtual)
  const alvo = prox === null ? atual : passos[prox]
  const acao = prox === null ? 'Siga até o destino' : separarInstrucao(textoInstrucao(alvo)).acao
  const fraco = e.acompanhamento.sinal !== 'bom'
  // o mesmo arredondamento da voz (metrosFalados), para a tela não contradizer a fala
  const distancia = passoAPasso
    ? distanciaNaTela(atual.distancia_m)
    : `em ${fraco ? 'cerca de ' : ''}${distanciaNaTela(e.faltaM)}`
  const graves = gravesFaladosDoPasso(atual, e.contexto.pedido)
  const estadoTexto = linhaDeEstado(e)
  const chegou = e.fase === 'chegou'
  const procura = avisoDaProcura(e)

  return (
    <section className="painel" aria-labelledby="painel-titulo">
      {/* na chegada o foco vem para cá e a região não anuncia: a ressalva vai junto, como descrição */}
      <h2
        id="painel-titulo"
        ref={refTitulo}
        tabIndex={-1}
        className="letreiro painel__titulo"
        aria-describedby={chegou ? 'chegada-ressalva' : undefined}
      >
        {titulo(e)}
      </h2>

      {chegou && <p id="chegada-ressalva">A posição pode errar alguns metros; confira pelo entorno.</p>}
      {procura && <p className="painel__procura">{procura.texto}</p>}

      {comPasso && (
        <>
          <p className="painel__acao letreiro">{acao}</p>
          <p className="painel__rua">{letreiroDoPasso(alvo)}</p>
          <p className="painel__distancia medida">{distancia}</p>
          {graves.length > 0 && (
            <div className="painel__trecho">
              <p id="neste-trecho" className="painel__rotulo">
                Neste trecho:
              </p>
              <ul aria-labelledby="neste-trecho" className="painel__avisos">
                {graves.map((g) => (
                  <li key={g} className="aviso aviso--grave">
                    <Pictograma nome={pictogramaDoAviso(g)} />
                    <span>{maiuscula(g)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {(estadoTexto || (telaPodeApagar && !passoAPasso && e.fase !== 'chegou')) && (
        <div className="painel__estado">
          {estadoTexto && <p>{estadoTexto}</p>}
          {telaPodeApagar && !passoAPasso && e.fase !== 'chegou' && <p>A tela pode apagar</p>}
        </div>
      )}
    </section>
  )
}

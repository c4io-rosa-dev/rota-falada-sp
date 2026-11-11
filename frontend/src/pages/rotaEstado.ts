import type { Endereco, RotaIn, RotaOut } from '../api/client'
import type { BuscaFeita, PerfilForm } from '../dados/sessaoRota'
import { alertasDaRota, type Exigencia } from '../dados/narrador'
import { formatarDistancia, textoDuracao } from '../dados/passo'

export type EstadoRota =
  | { fase: 'ocioso' }
  | { fase: 'calculando'; busca: BuscaFeita; lento: boolean }
  | { fase: 'resultado'; busca: BuscaFeita; rota: RotaOut; calculadaEm: string; restaurada: boolean }
  | { fase: 'sem_rota'; busca: BuscaFeita; detalhe: string }
  | { fase: 'indisponivel'; busca: BuscaFeita; mensagem: string }

export type AcaoRota =
  | { tipo: 'calcular'; busca: BuscaFeita }
  | { tipo: 'demorou' }
  | { tipo: 'chegou'; rota: RotaOut; calculadaEm: string }
  | { tipo: 'sem_rota'; detalhe: string }
  | { tipo: 'falhou'; mensagem: string }
  | { tipo: 'cancelar' }
  | { tipo: 'limpar' }

export const MSG_SEM_PASSOS = 'Não encontramos rota acessível entre esses pontos.'

export function reduzirRota(estado: EstadoRota, acao: AcaoRota): EstadoRota {
  switch (acao.tipo) {
    case 'calcular':
      return { fase: 'calculando', busca: acao.busca, lento: false }
    case 'demorou':
      return estado.fase === 'calculando' ? { ...estado, lento: true } : estado
    case 'chegou':
      if (estado.fase !== 'calculando') return estado
      // lista vazia não é rota: a interface nunca mostra um resultado sem passos
      return acao.rota.passos.length === 0
        ? { fase: 'sem_rota', busca: estado.busca, detalhe: MSG_SEM_PASSOS }
        : { fase: 'resultado', busca: estado.busca, rota: acao.rota, calculadaEm: acao.calculadaEm, restaurada: false }
    case 'sem_rota':
      return estado.fase === 'calculando' ? { fase: 'sem_rota', busca: estado.busca, detalhe: acao.detalhe } : estado
    case 'falhou':
      return estado.fase === 'calculando' ? { fase: 'indisponivel', busca: estado.busca, mensagem: acao.mensagem } : estado
    case 'cancelar':
    case 'limpar':
      return { fase: 'ocioso' }
  }
}

/** O contrato exige o perfil inteiro; `inclinacao_max` é número, não a string do rádio. */
export function montarPedido(origem: Endereco, destino: Endereco, perfil: PerfilForm): RotaIn {
  return {
    origem: { lat: origem.lat, lng: origem.lon },
    destino: { lat: destino.lat, lng: destino.lon },
    perfil: {
      inclinacao_max: perfil.inclinacao_max,
      guia_max_m: 0.06,
      largura_min_m: 0.9,
      evitar_degraus: perfil.evitar_degraus,
      velocidade_kmh: 3,
    },
  }
}

/** 5 casas, como a chave do cache de rotas: abaixo disso é o mesmo ponto. */
export function mesmoPonto(a: Endereco, b: Endereco): boolean {
  return a.lat.toFixed(5) === b.lat.toFixed(5) && a.lon.toFixed(5) === b.lon.toFixed(5)
}

/** Conta os mesmos avisos que a ficha mostra (dados/narrador.ts). */
export function resumoDaRota(
  rota: Pick<RotaOut, 'distancia_m' | 'duracao_s' | 'passos' | 'motor' | 'nivel_exigencia_atendido'>,
  pedido: Exigencia,
): string {
  const n = rota.passos.length
  const avisos = alertasDaRota(rota, pedido).length
  const textoAvisos = avisos === 0 ? 'sem avisos' : avisos === 1 ? '1 aviso' : `${avisos} avisos`
  return `${formatarDistancia(rota.distancia_m)} em ${n} ${n === 1 ? 'passo' : 'passos'}, ${textoDuracao(rota.duracao_s)}, ${textoAvisos}`
}

/**
 * Fim do cálculo. Se o foco ainda está de onde o envio partiu, seja o botão ou o campo do
 * Enter (ou caiu no body porque "Cancelar" sumiu), vai para o h2, que traz o resumo: a 400% de
 * zoom e no celular com teclado o resultado está fora da vista. Se a pessoa saiu dali durante
 * a espera, o foco fica onde está e a região anuncia. Nunca os dois.
 */
export function focoVaiParaResultado(ativo: Element | null, focoNoEnvio: Element | null): boolean {
  return ativo === null || ativo === document.body || ativo === focoNoEnvio
}

const FORMATO_HORA = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

export function horaDe(iso: string): string {
  return FORMATO_HORA.format(new Date(iso))
}

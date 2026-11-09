/**
 * A posição simulada do modo demonstração (spec 10.2). Mesma assinatura de vigiarPosicao, mas as
 * leituras vêm de leiturasDoCenario e chegam por setTimeout; o GPS real nunca é chamado.
 *
 * Só é importado com import() dinâmico, dentro de `if (import.meta.env.VITE_PERMITIR_SIMULACAO === 'true')`:
 * fora do build de teste ou de demonstração, este módulo nem entra no pacote.
 */
import type { LeituraPosicao } from '../localizacao'
import type { PontoLatLng } from '../rotaGeo'
import { ehCenario, leiturasDoCenario, type Cenario } from './simulacao'

export type Vigia = (aoMudar: (l: LeituraPosicao) => void, aoErrar: (codigo: number) => void) => () => void

const RITMO_MAXIMO = 20

/** `&ritmo=5` acelera a demonstração; qualquer coisa fora de 1 a 20 vira 1 (ou o teto). */
export function ritmoDaBusca(valor: string | null): number {
  const n = Number(valor)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(RITMO_MAXIMO, n)
}

export function criarPosicaoSimulada(nome: Cenario, linha: PontoLatLng[], op: { ritmo?: number } = {}): Vigia {
  const ritmo = op.ritmo ?? 1
  return (aoMudar) => {
    const leituras = leiturasDoCenario(nome, linha)
    let i = 0
    let ativa = true
    let espera: ReturnType<typeof setTimeout> | undefined

    const agendar = () => {
      if (!ativa || i >= leituras.length) return
      const atraso = i === 0 ? 0 : (leituras[i].tMs - leituras[i - 1].tMs) / ritmo
      espera = setTimeout(() => {
        if (!ativa) return
        const l = leituras[i++]
        aoMudar({ lat: l.lat, lon: l.lon, precisaoM: l.precisaoM, tMs: l.tMs })
        agendar()
      }, atraso)
    }

    agendar()
    return () => {
      if (!ativa) return
      ativa = false
      clearTimeout(espera)
    }
  }
}

/** Lê `?simular=<cenário>&ritmo=<n>`. Sem cenário válido, não há simulação. */
export function simulacaoDaBusca(busca: string, linha: PontoLatLng[]): Vigia | null {
  const parametros = new URLSearchParams(busca)
  const nome = parametros.get('simular')
  if (!ehCenario(nome)) return null
  return criarPosicaoSimulada(nome, linha, { ritmo: ritmoDaBusca(parametros.get('ritmo')) })
}

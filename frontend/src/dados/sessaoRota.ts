import type { Endereco, RotaIn, RotaOut } from '../api/client'

export type Inclinacao = 3 | 6 | 10 | 'any'
export type PerfilForm = { inclinacao_max: Inclinacao; evitar_degraus: boolean }

/** O que gerou a rota. Fica junto dela: os campos podem mudar sem recalcular (WCAG 3.2.2). */
export type BuscaFeita = { pedido: RotaIn; origem: string; destino: string }

export type SessaoRota = {
  versao: 1
  /** O que está nos campos agora. */
  origem: Endereco | null
  destino: Endereco | null
  perfil: PerfilForm
  rota: RotaOut | null
  rotaDe: BuscaFeita | null
  calculadaEm: string | null
}

const CHAVE = 'rf-busca'
/** O mesmo TTL do cache de rotas no backend. */
export const VALIDADE_ROTA_MS = 6 * 60 * 60 * 1000

export const PERFIL_FORM_PADRAO: PerfilForm = { inclinacao_max: 6, evitar_degraus: true }

function ehSessao(valor: unknown): valor is SessaoRota {
  const s = valor as Partial<SessaoRota> | null
  return !!s && s.versao === 1 && typeof s.perfil === 'object' && s.perfil !== null && 'origem' in s && 'destino' in s
}

/**
 * Fica só nesta aba: sobrevive a recarregar, a descartar a aba e a ir a /barreiras e voltar,
 * sem rede. Fechar a aba apaga. Nunca URL nem localStorage: seria histórico de trajetos.
 */
export function lerSessaoRota(agora = Date.now()): SessaoRota | null {
  try {
    const bruto = sessionStorage.getItem(CHAVE)
    if (!bruto) return null
    const sessao: unknown = JSON.parse(bruto)
    if (!ehSessao(sessao)) return null
    const vencida = sessao.calculadaEm !== null && agora - Date.parse(sessao.calculadaEm) > VALIDADE_ROTA_MS
    return vencida ? { ...sessao, rota: null, rotaDe: null, calculadaEm: null } : sessao
  } catch {
    return null
  }
}

export function gravarSessaoRota(sessao: SessaoRota): void {
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify(sessao))
  } catch {
    // sem armazenamento a tela funciona igual, só não restaura
  }
}

export function apagarSessaoRota(): void {
  try {
    sessionStorage.removeItem(CHAVE)
  } catch {
    // idem
  }
}

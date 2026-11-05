import { ErroApi } from '../api/base'
import type { Endereco } from '../api/client'
import type { Categoria } from './categorias'

export type LocalEscolhido = {
  lat: number
  lon: number
  rotulo: string | null
  origem: 'gps' | 'busca' | 'mapa' | 'passo'
  /** Aviso a manter visível: meio da rua, número aproximado, GPS impreciso. */
  nota?: string
}

export type Rascunho = {
  categoria?: Categoria
  local?: LocalEscolhido
  descricao: string
  chave?: string
}

const CHAVE = 'rf-rascunho'

export const AVISO_MEIO_DA_RUA = 'O ponto fica perto do meio da rua. Se puder, digite o número ou marque no mapa.'
export const AVISO_NUMERO_APROXIMADO = 'Este é o número mais próximo que conhecemos, não o que você digitou. Confira.'

/** Sem conexão a coordenada continua valendo; a recusa de "fora da área" é só com resposta. */
export const NOTA_SEM_CONFIRMAR = 'Ponto guardado. Não conseguimos confirmar o endereço agora.'

export function ehFalhaDeConexao(erro: unknown): boolean {
  return erro instanceof ErroApi && (erro.tipo === 'rede' || erro.tipo === 'tempo' || erro.tipo === 'indisponivel')
}

export function localDeEndereco(e: Endereco): LocalEscolhido {
  const nota = e.tipo === 'logradouro' ? AVISO_MEIO_DA_RUA : e.aproximado ? AVISO_NUMERO_APROXIMADO : undefined
  return { lat: e.lat, lon: e.lon, rotulo: e.rotulo, origem: 'busca', nota }
}

export const RASCUNHO_VAZIO: Rascunho = { descricao: '' }

export function lerRascunho(): Rascunho {
  try {
    const bruto = sessionStorage.getItem(CHAVE)
    return bruto ? (JSON.parse(bruto) as Rascunho) : RASCUNHO_VAZIO
  } catch {
    return RASCUNHO_VAZIO
  }
}

export function gravarRascunho(rascunho: Rascunho): void {
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify(rascunho))
  } catch {
    // sem armazenamento, o rascunho fica só na memória da página
  }
}

export function apagarRascunho(): void {
  try {
    sessionStorage.removeItem(CHAVE)
  } catch {
    // idem
  }
}

/** Sem contexto seguro, randomUUID não existe; getRandomValues sim. */
export function gerarUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/**
 * Editar depois de uma falha gera chave nova: senão o servidor devolveria a barreira
 * antiga, ignorando a correção. O risco é uma duplicata, que a moderação resolve.
 */
export function comEdicao(rascunho: Rascunho, mudanca: Partial<Rascunho>): Rascunho {
  const novo = { ...rascunho, ...mudanca }
  delete novo.chave
  return novo
}

/** A mesma chave vale para repetição, sessão expirada e recarga da aba. */
export function comChave(rascunho: Rascunho): Rascunho & { chave: string } {
  return { ...rascunho, chave: rascunho.chave ?? gerarUuid() }
}

function chaveMinhas(conta: string) {
  return `rf:minhas:${conta}`
}

/** Ids criados neste navegador: só para oferecer a foto e poupar um 403. O servidor continua decidindo. */
export function lerMinhas(conta: string): number[] {
  try {
    const bruto = localStorage.getItem(chaveMinhas(conta))
    return bruto ? (JSON.parse(bruto) as number[]) : []
  } catch {
    return []
  }
}

export function lembrarMinha(conta: string, id: number): void {
  try {
    const atuais = lerMinhas(conta)
    if (!atuais.includes(id)) localStorage.setItem(chaveMinhas(conta), JSON.stringify([...atuais, id]))
  } catch {
    // é conveniência; sem isso o 403 ensina
  }
}

/** Ao sair, de todas as contas: não depende de saber qual, e o aparelho pode ser compartilhado. */
export function esquecerMinhas(): void {
  try {
    for (const chave of Object.keys(localStorage)) {
      if (chave.startsWith('rf:minhas:')) localStorage.removeItem(chave)
    }
  } catch {
    // idem
  }
}

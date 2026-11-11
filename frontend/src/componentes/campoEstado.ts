import type { Endereco } from '../api/client'

export type ViaEscolha = 'lista' | 'gps' | 'restauro'

export type EstadoCampo =
  | { fase: 'vazio' }
  | { fase: 'digitando'; texto: string }
  | { fase: 'buscando'; texto: string }
  | { fase: 'lista'; texto: string; opcoes: Endereco[]; ativo: number; aberta: boolean }
  | { fase: 'sem_resultado'; texto: string }
  | { fase: 'erro'; texto: string; mensagem: string }
  | { fase: 'escolhido'; escolha: Endereco; via: ViaEscolha }

export type AcaoCampo =
  | { tipo: 'digitar'; texto: string }
  | { tipo: 'buscar'; texto: string }
  | { tipo: 'resultado'; texto: string; opcoes: Endereco[] }
  | { tipo: 'falhou'; texto: string; mensagem: string }
  | { tipo: 'abrir'; ativo?: 'primeiro' | 'ultimo' }
  | { tipo: 'fechar' }
  | { tipo: 'sair' }
  | { tipo: 'mover'; passo: 1 | -1 }
  | { tipo: 'escolher'; escolha: Endereco; via: ViaEscolha }
  | { tipo: 'limpar' }

export const MINIMO_BUSCA = 3

export function estadoInicialCampo(escolha: Endereco | null): EstadoCampo {
  return escolha ? { fase: 'escolhido', escolha, via: 'restauro' } : { fase: 'vazio' }
}

export function reduzirCampo(estado: EstadoCampo, acao: AcaoCampo): EstadoCampo {
  switch (acao.tipo) {
    case 'digitar':
      return acao.texto.trim() === '' ? { fase: 'vazio' } : { fase: 'digitando', texto: acao.texto }
    case 'buscar':
      return { fase: 'buscando', texto: acao.texto }
    case 'resultado':
      // resposta de uma busca que a digitação já invalidou é ignorada
      if (estado.fase !== 'buscando' || estado.texto !== acao.texto) return estado
      return acao.opcoes.length === 0
        ? { fase: 'sem_resultado', texto: acao.texto }
        : { fase: 'lista', texto: acao.texto, opcoes: acao.opcoes, ativo: -1, aberta: true }
    case 'falhou':
      if (estado.fase !== 'buscando' || estado.texto !== acao.texto) return estado
      return { fase: 'erro', texto: acao.texto, mensagem: acao.mensagem }
    case 'abrir': {
      if (estado.fase !== 'lista') return estado
      if (!acao.ativo) return { ...estado, aberta: true }
      return { ...estado, aberta: true, ativo: acao.ativo === 'primeiro' ? 0 : estado.opcoes.length - 1 }
    }
    case 'fechar':
      return estado.fase === 'lista' ? { ...estado, aberta: false, ativo: -1 } : estado
    case 'sair':
      // a busca foi interrompida: nada de "Buscando…" para sempre nem lista aberta num campo sem foco
      if (estado.fase === 'buscando') return { fase: 'digitando', texto: estado.texto }
      return estado.fase === 'lista' ? { ...estado, aberta: false, ativo: -1 } : estado
    case 'mover': {
      if (estado.fase !== 'lista' || !estado.aberta) return estado
      const n = estado.opcoes.length
      const atual = estado.ativo < 0 && acao.passo === -1 ? 0 : estado.ativo
      return { ...estado, ativo: (atual + acao.passo + n) % n }
    }
    case 'escolher':
      return { fase: 'escolhido', escolha: acao.escolha, via: acao.via }
    case 'limpar':
      return { fase: 'vazio' }
  }
}

export function textoDoCampo(estado: EstadoCampo): string {
  if (estado.fase === 'vazio') return ''
  if (estado.fase === 'escolhido') return estado.escolha.rotulo
  return estado.texto
}

export function escolhaDoCampo(estado: EstadoCampo): Endereco | null {
  return estado.fase === 'escolhido' ? estado.escolha : null
}

export function textoForaDaArea(texto: string): string {
  return `Não encontramos "${texto.trim()}" na área piloto (centro expandido, Lapa e Ipiranga). Confira a grafia; fora dessa área o Rota Falada SP ainda não atende.`
}

/** A linha de retorno visível do campo, ligada por aria-describedby. */
export function textoRetorno(estado: EstadoCampo): string | null {
  switch (estado.fase) {
    case 'buscando':
      return 'Buscando…'
    case 'sem_resultado':
      return textoForaDaArea(estado.texto)
    case 'erro':
      return estado.mensagem
    case 'escolhido':
      return estado.escolha.aproximado
        ? 'Este é o número mais próximo que conhecemos, não o que você digitou. Confira.'
        : null
    default:
      return null
  }
}

/** O anúncio da lista: curto, e a instrução de teclas só na primeira vez de cada campo. */
export function textoDaLista(opcoes: Endereco[], rotulo: string, primeiraVez: boolean): string {
  if (opcoes.length === 1 && opcoes[0].aproximado) {
    return '1 endereço aproximado: o número digitado não existe; este é o mais próximo.'
  }
  const inicio =
    opcoes.length >= 8
      ? `Os ${opcoes.length} primeiros endereços`
      : opcoes.length === 1
        ? '1 endereço'
        : `${opcoes.length} endereços`
  return `${inicio} para ${rotulo}.${primeiraVez ? ' Seta para baixo para escolher.' : ''}`
}

/** Sugestões com o mesmo nome a menos disto são a mesma coisa para quem escolhe. */
const MESMO_LUGAR_M = 150

/**
 * Tira sugestões repetidas: mesmo rótulo e quase o mesmo ponto. No leitor de tela, duas opções
 * que soam iguais obrigam a adivinhar (WCAG 2.4.6). A primeira, mais relevante, fica.
 */
export function semRepetidas<T extends { rotulo: string; lat: number; lon: number }>(opcoes: T[]): T[] {
  const ficam: T[] = []
  for (const op of opcoes) {
    const nome = op.rotulo.trim().toLocaleLowerCase('pt-BR')
    const repetida = ficam.some(
      (f) =>
        f.rotulo.trim().toLocaleLowerCase('pt-BR') === nome &&
        Math.hypot((f.lat - op.lat) * 111_000, (f.lon - op.lon) * 102_000) < MESMO_LUGAR_M,
    )
    if (!repetida) ficam.push(op)
  }
  return ficam
}

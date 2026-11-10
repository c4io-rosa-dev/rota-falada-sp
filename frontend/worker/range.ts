import type { IntervaloBytes } from './tipos'

/** Um único intervalo em bytes, depois do `=`: `a-b`, `a-` ou `-n` (espaços em volta são tolerados). */
const INTERVALO = /^(\d*)-(\d*)$/

/**
 * Lê o cabeçalho Range de um pedido (RFC 9110, seção 14).
 *
 * - `null`: servir o arquivo inteiro (200). Vale para sem cabeçalho e para o que o servidor pode
 *   ignorar: outra unidade, vários intervalos ou um valor mal formado (seção 14.2).
 * - `'invalido'`: 416. Só quando o intervalo é bem formado mas não cabe no arquivo: início no
 *   tamanho ou além, faixa invertida ou sufixo zero.
 * - Fim além do arquivo (mesmo fora do inteiro seguro) é preso ao último byte; sufixo maior que
 *   o arquivo devolve o arquivo inteiro.
 */
export function interpretarRange(cabecalho: string | null, tamanho: number): IntervaloBytes | 'invalido' | null {
  if (cabecalho === null) return null
  const igual = cabecalho.indexOf('=')
  if (igual < 0) return null
  if (cabecalho.slice(0, igual).trim().toLowerCase() !== 'bytes') return null
  const conjunto = cabecalho.slice(igual + 1).trim()
  if (conjunto.includes(',')) return null
  const partes = INTERVALO.exec(conjunto)
  if (!partes) return null
  const [, textoInicio, textoFim] = partes
  // só dígitos (a regex garante): Number nunca dá NaN; um número enorme vira um valor grande ou Infinity
  if (textoInicio === '') {
    if (textoFim === '') return null
    const n = Number(textoFim)
    if (n === 0) return 'invalido'
    const length = Math.min(n, tamanho)
    return { offset: tamanho - length, length }
  }

  const inicio = Number(textoInicio)
  if (inicio >= tamanho) return 'invalido'
  if (textoFim === '') return { offset: inicio, length: tamanho - inicio }

  const fim = Number(textoFim)
  if (inicio > fim) return 'invalido'
  return { offset: inicio, length: Math.min(fim, tamanho - 1) - inicio + 1 }
}

// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { interpretarRange } from '../range'

describe('interpretarRange', () => {
  it('sem cabeçalho devolve null', () => {
    expect(interpretarRange(null, 100)).toBeNull()
  })

  it('bytes=a-b devolve offset e length', () => {
    expect(interpretarRange('bytes=10-19', 100)).toEqual({ offset: 10, length: 10 })
  })

  it('bytes=0-0 pede um byte', () => {
    expect(interpretarRange('bytes=0-0', 100)).toEqual({ offset: 0, length: 1 })
  })

  it('prende o fim ao último byte do arquivo', () => {
    expect(interpretarRange('bytes=90-500', 100)).toEqual({ offset: 90, length: 10 })
  })

  it('bytes=a- vai até o fim', () => {
    expect(interpretarRange('bytes=40-', 100)).toEqual({ offset: 40, length: 60 })
  })

  it('bytes=0- num arquivo de 1 byte', () => {
    expect(interpretarRange('bytes=0-', 1)).toEqual({ offset: 0, length: 1 })
  })

  it('bytes=-n pede os últimos n bytes', () => {
    expect(interpretarRange('bytes=-10', 100)).toEqual({ offset: 90, length: 10 })
  })

  it('sufixo maior que o arquivo devolve o arquivo inteiro', () => {
    expect(interpretarRange('bytes=-500', 100)).toEqual({ offset: 0, length: 100 })
  })

  it.each([
    ['início depois do fim', 'bytes=5-2'],
    ['início no tamanho', 'bytes=100-'],
    ['início além do tamanho com fim', 'bytes=100-200'],
    ['início acima do inteiro seguro', 'bytes=9007199254740993-'],
    ['sufixo zero', 'bytes=-0'],
  ])('%s é 416 (intervalo bem formado que não cabe)', (_nome, cabecalho) => {
    expect(interpretarRange(cabecalho, 100)).toBe('invalido')
  })

  // RFC 9110, seção 14.2: o servidor pode ignorar o Range e servir o arquivo inteiro (200)
  it.each([
    ['vários intervalos', 'bytes=0-1,4-5'],
    ['outra unidade', 'items=0-1'],
    ['espaço no meio', 'bytes=0 -1'],
    ['vazio', ''],
    ['sem igual', 'bytes'],
    ['só a unidade', 'bytes='],
    ['só o traço', 'bytes=-'],
    ['sinal de mais', 'bytes=+1-2'],
    ['sinal de menos duplo', 'bytes=--1'],
    ['letras', 'bytes=a-b'],
    ['decimal', 'bytes=1.5-2'],
  ])('%s é ignorado (null, serve 200)', (_nome, cabecalho) => {
    expect(interpretarRange(cabecalho, 100)).toBeNull()
  })

  it('a unidade não diferencia maiúsculas e tolera espaço em volta do intervalo', () => {
    expect(interpretarRange('Bytes=0-1', 100)).toEqual({ offset: 0, length: 2 })
    expect(interpretarRange('bytes= 0-1', 100)).toEqual({ offset: 0, length: 2 })
  })

  it('fim acima do inteiro seguro é preso ao último byte, não recusado', () => {
    expect(interpretarRange('bytes=0-9007199254740993', 100)).toEqual({ offset: 0, length: 100 })
    expect(interpretarRange(`bytes=10-${'9'.repeat(400)}`, 100)).toEqual({ offset: 10, length: 90 })
  })

  it('sufixo acima do inteiro seguro devolve o arquivo inteiro', () => {
    expect(interpretarRange('bytes=-9007199254740993', 100)).toEqual({ offset: 0, length: 100 })
  })
})

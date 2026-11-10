// @vitest-environment node
/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ_WORKER = join(import.meta.dirname, '..')
const WRANGLER = join(RAIZ_WORKER, '..', 'wrangler.jsonc')

function arquivosTs(pasta: string): string[] {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome)
    if (statSync(caminho).isDirectory()) return nome === 'test' ? [] : arquivosTs(caminho)
    return nome.endsWith('.ts') ? [caminho] : []
  })
}

/** Remove comentários de linha `//` que não estão dentro de strings (JSONC simples). */
function semComentarios(texto: string): string {
  let saida = ''
  let emString = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (emString) {
      saida += c
      if (c === '\\') {
        saida += texto[++i] ?? ''
      } else if (c === '"') {
        emString = false
      }
    } else if (c === '"') {
      emString = true
      saida += c
    } else if (c === '/' && texto[i + 1] === '/') {
      while (i < texto.length && texto[i] !== '\n') i++
      saida += '\n'
    } else {
      saida += c
    }
  }
  return saida
}

describe('o Worker do mapa não registra nada', () => {
  it('nenhum console. no código do worker fora dos testes', () => {
    const arquivos = arquivosTs(RAIZ_WORKER)
    expect(arquivos.map((a) => relative(RAIZ_WORKER, a).split(sep).join('/')).sort()).toEqual(
      expect.arrayContaining(['index.ts', 'range.ts', 'servirMapa.ts', 'tipos.ts']),
    )
    const comConsole = arquivos.filter((a) => readFileSync(a, 'utf8').includes('console.'))
    expect(comConsole).toEqual([])
  })

  it('o wrangler.jsonc liga o worker só em /mapa/* e desliga a observabilidade', () => {
    const config = JSON.parse(semComentarios(readFileSync(WRANGLER, 'utf8')))
    expect(config.main).toBe('./worker/index.ts')
    expect(config.observability).toEqual({ enabled: false })
    expect(config.assets.run_worker_first).toEqual(['/mapa/*'])
    expect(config.assets.not_found_handling).toBe('single-page-application')
    expect(config.assets.directory).toBe('./dist')
    expect(config.assets.binding).toBeUndefined()
    expect(config.r2_buckets).toEqual([{ binding: 'MAPAS', bucket_name: 'rota-falada-mapas' }])
    expect(config.tail_consumers).toBeUndefined()
    expect(config.logpush).toBeUndefined()
  })
})

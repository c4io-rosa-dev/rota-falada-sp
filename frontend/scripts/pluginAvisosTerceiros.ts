import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { fecharDependencias, montarAvisos, pacoteDoModulo, type Pacote } from './avisosTerceiros.ts'

/** Arquivo publicado na raiz do site e linkado da página Fontes. */
export const ARQUIVO_AVISOS = 'licencas-terceiros.txt'

const ARQUIVO_LICENCA = /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i

const pastaDe = (raiz: string, nome: string) => join(raiz, 'node_modules', ...nome.split('/'))

/** Dependências declaradas no package.json, ou null se o pacote não está instalado na raiz. */
function dependenciasDe(raiz: string, nome: string): string[] | null {
  const manifesto = join(pastaDe(raiz, nome), 'package.json')
  if (!existsSync(manifesto)) return null
  const { dependencies } = JSON.parse(readFileSync(manifesto, 'utf-8')) as { dependencies?: Record<string, string> }
  return Object.keys(dependencies ?? {})
}

function lerPacote(raiz: string, nome: string): Pacote {
  const pasta = pastaDe(raiz, nome)
  const manifesto = JSON.parse(readFileSync(join(pasta, 'package.json'), 'utf-8')) as { version?: string; license?: string }
  const arquivos = existsSync(pasta) ? readdirSync(pasta).filter((a) => ARQUIVO_LICENCA.test(a)).sort() : []
  const texto = arquivos.length > 0 ? arquivos.map((a) => readFileSync(join(pasta, a), 'utf-8').trim()).join('\n\n') : null
  return { nome, versao: manifesto.version ?? '?', licenca: manifesto.license ?? 'não declarada', texto }
}

/**
 * Só no build: junta os pacotes de node_modules que entram em algum chunk (inclusive os importados
 * com ?url, como a letra e o worker do MapLibre), mais as dependências que eles declaram, e publica
 * o aviso de licença de cada um.
 */
export function avisosTerceiros(): Plugin {
  let raiz = process.cwd()
  return {
    name: 'rota-falada:avisos-terceiros',
    apply: 'build',
    configResolved(config) {
      raiz = config.root
    },
    generateBundle(_opcoes, bundle) {
      const nomes = new Set<string>()
      for (const saida of Object.values(bundle)) {
        if (saida.type !== 'chunk') continue
        for (const id of saida.moduleIds) {
          const nome = pacoteDoModulo(id)
          if (nome) nomes.add(nome)
        }
      }
      const todos = fecharDependencias([...nomes], (n) => dependenciasDe(raiz, n))
      this.emitFile({ type: 'asset', fileName: ARQUIVO_AVISOS, source: montarAvisos(todos.map((n) => lerPacote(raiz, n))) })
    },
  }
}

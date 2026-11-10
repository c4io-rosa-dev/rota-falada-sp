/**
 * Avisos de licença do código de terceiros que vai para o site publicado (BSD, MIT, ISC e OFL pedem
 * que o aviso de copyright acompanhe a redistribuição; o build minificado não leva os comentários).
 * Funções puras: o plugin em pluginAvisosTerceiros.ts lê o disco e chama estas.
 */

export type Pacote = { nome: string; versao: string; licenca: string; texto: string | null }

/**
 * Nome do pacote npm de um módulo do bundle (o último `node_modules/` do caminho), ou null para
 * código do próprio projeto e módulos virtuais. Aceita barras do Windows e sufixos como `?url`.
 */
export function pacoteDoModulo(id: string): string | null {
  const caminho = id.replace(/\\/g, '/').split('?')[0]
  if (caminho.startsWith('\0')) return null
  const marca = '/node_modules/'
  const i = caminho.lastIndexOf(marca)
  if (i < 0) return null
  const partes = caminho.slice(i + marca.length).split('/')
  if (partes[0].startsWith('@')) return partes.length > 1 && partes[1] !== '' ? `${partes[0]}/${partes[1]}` : null
  return partes[0] !== '' ? partes[0] : null
}

/**
 * Os pacotes do bundle mais as dependências que eles declaram, recursivamente: um dist
 * pré-empacotado (o do maplibre-gl embute pbf, tiny-sdf, earcut...) não aparece módulo a módulo.
 * `dependenciasDe` devolve null para o que não está instalado; tipos (@types/*) ficam de fora.
 */
export function fecharDependencias(inicio: string[], dependenciasDe: (nome: string) => string[] | null): string[] {
  const vistos = new Set<string>()
  const fila = [...inicio]
  while (fila.length > 0) {
    const nome = fila.pop()!
    if (vistos.has(nome) || nome.startsWith('@types/')) continue
    const deps = dependenciasDe(nome)
    if (deps === null) continue
    vistos.add(nome)
    fila.push(...deps)
  }
  return [...vistos].sort((a, b) => a.localeCompare(b))
}

/** O texto do arquivo, em ordem alfabética de pacote, com o aviso de cada um por inteiro. */
export function montarAvisos(pacotes: Pacote[]): string {
  const ordenados = [...pacotes].sort((a, b) => a.nome.localeCompare(b.nome))
  const cabecalho = [
    'Rota Falada SP: avisos de licença do código de terceiros incluído neste site.',
    'Gerado no build a partir dos pacotes npm que entram no bundle e das dependências que eles declaram',
    '(um pacote pré-empacotado leva as dele embutidas; a lista pode incluir alguma que não chega ao site).',
    'Os dados (OpenStreetMap e outros) estão na página Fontes de dados e licenças.',
    '',
    ...ordenados.map((p) => `- ${p.nome} ${p.versao} (${p.licenca})`),
  ].join('\n')
  const blocos = ordenados.map((p) =>
    [
      '='.repeat(72),
      `${p.nome} ${p.versao}`,
      `Licença: ${p.licenca}`,
      '',
      p.texto?.trim() ?? `(o pacote não traz o texto da licença; licença declarada no package.json: ${p.licenca})`,
    ].join('\n'),
  )
  return [cabecalho, ...blocos, ''].join('\n\n')
}

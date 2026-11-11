/**
 * Preferências do mapa da navegação guiada: mostrar o mapa, girar o mapa com a rota, vista
 * inclinada e mapa em tela cheia. Todas começam desligadas.
 * Ficam só nesta aba (sessionStorage), somem ao fechar a aba e nunca vão ao servidor.
 * Grava só '1' ou '0'; qualquer outro valor vale false. Se o armazenamento falhar,
 * a leitura vale false e a escrita é ignorada (a página mantém a escolha no estado React).
 */

export const CHAVE_ABERTO = 'rota-falada:mapa-aberto'
export const CHAVE_GIRAR = 'rota-falada:mapa-girar'
export const CHAVE_INCLINADA = 'rota-falada:mapa-inclinada'
export const CHAVE_CHEIA = 'rota-falada:mapa-tela-cheia'

export type QualPreferenciaMapa = 'aberto' | 'girar' | 'inclinada' | 'cheia'

const CHAVES: Record<QualPreferenciaMapa, string> = {
  aberto: CHAVE_ABERTO,
  girar: CHAVE_GIRAR,
  inclinada: CHAVE_INCLINADA,
  cheia: CHAVE_CHEIA,
}

function ler(chave: string): boolean {
  try {
    return sessionStorage.getItem(chave) === '1'
  } catch {
    return false
  }
}

export function lerPreferenciasMapa(): Record<QualPreferenciaMapa, boolean> {
  return { aberto: ler(CHAVE_ABERTO), girar: ler(CHAVE_GIRAR), inclinada: ler(CHAVE_INCLINADA), cheia: ler(CHAVE_CHEIA) }
}

export function gravarPreferenciaMapa(qual: QualPreferenciaMapa, valor: boolean): void {
  try {
    sessionStorage.setItem(CHAVES[qual], valor ? '1' : '0')
  } catch {
    // armazenamento bloqueado ou cheio: a escolha vale só até sair da página
  }
}

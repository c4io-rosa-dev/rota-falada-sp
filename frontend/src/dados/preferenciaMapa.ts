/**
 * Preferências do mapa da navegação guiada: mostrar o mapa e girar o mapa com a rota.
 * Ficam só nesta aba (sessionStorage), somem ao fechar a aba e nunca vão ao servidor.
 * Grava só '1' ou '0'; qualquer outro valor vale false. Se o armazenamento falhar,
 * a leitura vale false e a escrita é ignorada (a página mantém a escolha no estado React).
 */

export const CHAVE_ABERTO = 'rota-falada:mapa-aberto'
export const CHAVE_GIRAR = 'rota-falada:mapa-girar'

export type QualPreferenciaMapa = 'aberto' | 'girar'

const CHAVES: Record<QualPreferenciaMapa, string> = { aberto: CHAVE_ABERTO, girar: CHAVE_GIRAR }

function ler(chave: string): boolean {
  try {
    return sessionStorage.getItem(chave) === '1'
  } catch {
    return false
  }
}

export function lerPreferenciasMapa(): { aberto: boolean; girar: boolean } {
  return { aberto: ler(CHAVE_ABERTO), girar: ler(CHAVE_GIRAR) }
}

export function gravarPreferenciaMapa(qual: QualPreferenciaMapa, valor: boolean): void {
  try {
    sessionStorage.setItem(CHAVES[qual], valor ? '1' : '0')
  } catch {
    // armazenamento bloqueado ou cheio: a escolha vale só até sair da página
  }
}

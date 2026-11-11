/** Mantém a tela ligada durante a navegação (Screen Wake Lock). Sem a API, só informa que não conseguiu. */
export type TelaLigada = { manter(): Promise<boolean>; soltar(): void; aoPerder(cb: () => void): () => void }

type Sentinela = { release(): Promise<void>; addEventListener(tipo: 'release', cb: () => void): void }
type ComWakeLock = { wakeLock?: { request(tipo: 'screen'): Promise<Sentinela> } }

export function criarTelaLigada(nav: Navigator = navigator, doc: Document = document): TelaLigada {
  const ouvintes = new Set<() => void>()
  let ativa = false
  let sentinela: Sentinela | null = null

  const aoVoltar = () => {
    if (ativa && doc.visibilityState === 'visible' && !sentinela) void pedir()
  }

  async function pedir(): Promise<boolean> {
    const api = (nav as unknown as ComWakeLock).wakeLock
    if (!api) return false
    try {
      const s = await api.request('screen')
      if (!ativa) {
        // soltar() chegou durante o pedido: devolve a tela sem avisar ninguém.
        void s.release().catch(() => {})
        return false
      }
      sentinela = s
      s.addEventListener('release', () => {
        if (sentinela !== s) return
        sentinela = null
        // aba oculta: a perda é esperada (a navegação já pausa sozinha) e ao voltar a ficar
        // visível a tela é pedida de novo. A ordem entre 'release' e 'visibilitychange' varia
        // por navegador, por isso a conferência é aqui e não só no ouvinte de visibilidade.
        if (doc.visibilityState === 'hidden') return
        for (const cb of [...ouvintes]) cb()
      })
      return true
    } catch {
      return false
    }
  }

  return {
    async manter() {
      if (!(nav as unknown as ComWakeLock).wakeLock) return false
      if (!ativa) {
        ativa = true
        doc.addEventListener('visibilitychange', aoVoltar)
      }
      if (sentinela) return true
      return pedir()
    },
    soltar() {
      ativa = false
      doc.removeEventListener('visibilitychange', aoVoltar)
      const s = sentinela
      sentinela = null
      if (s) void s.release().catch(() => {})
    },
    aoPerder(cb) {
      ouvintes.add(cb)
      return () => {
        ouvintes.delete(cb)
      }
    },
  }
}

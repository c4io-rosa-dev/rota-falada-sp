import { criarTelaLigada } from '../dados/navegacao/telaLigada'

class SentinelaFalsa extends EventTarget {
  released = false
  release = vi.fn(async () => {
    if (this.released) return
    this.released = true
    this.dispatchEvent(new Event('release'))
  })
  /** Liberação feita pelo sistema (aba oculta, economia de bateria). */
  liberarPeloSistema() {
    this.released = true
    this.dispatchEvent(new Event('release'))
  }
}

function navCom(request?: (tipo: string) => Promise<SentinelaFalsa>) {
  const sentinelas: SentinelaFalsa[] = []
  const pedir = vi.fn(
    request ??
      (async () => {
        const s = new SentinelaFalsa()
        sentinelas.push(s)
        return s
      }),
  )
  const nav = { wakeLock: { request: pedir } } as unknown as Navigator
  return { nav, pedir, sentinelas }
}

function docFalso(): Document {
  const doc = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState }
  doc.visibilityState = 'visible'
  return doc as unknown as Document
}

function ficar(doc: Document, estado: DocumentVisibilityState) {
  ;(doc as unknown as { visibilityState: DocumentVisibilityState }).visibilityState = estado
  doc.dispatchEvent(new Event('visibilitychange'))
}

const microtarefas = () => new Promise((r) => setTimeout(r, 0))

describe('criarTelaLigada', () => {
  it('sem API, manter devolve false', async () => {
    const tela = criarTelaLigada({} as Navigator, docFalso())
    expect(await tela.manter()).toBe(false)
  })

  it('com API, pede tela e devolve true', async () => {
    const { nav, pedir } = navCom()
    const tela = criarTelaLigada(nav, docFalso())
    expect(await tela.manter()).toBe(true)
    expect(pedir).toHaveBeenCalledWith('screen')
  })

  it('pedido rejeitado devolve false', async () => {
    const { nav } = navCom(() => Promise.reject(new Error('NotAllowedError')))
    const tela = criarTelaLigada(nav, docFalso())
    expect(await tela.manter()).toBe(false)
  })

  it('soltar libera e não chama aoPerder', async () => {
    const { nav, sentinelas } = navCom()
    const tela = criarTelaLigada(nav, docFalso())
    const perdeu = vi.fn()
    tela.aoPerder(perdeu)
    await tela.manter()
    tela.soltar()
    await microtarefas()
    expect(sentinelas[0].release).toHaveBeenCalledTimes(1)
    expect(perdeu).not.toHaveBeenCalled()
  })

  it('liberação pelo sistema chama aoPerder', async () => {
    const { nav, sentinelas } = navCom()
    const tela = criarTelaLigada(nav, docFalso())
    const perdeu = vi.fn()
    tela.aoPerder(perdeu)
    await tela.manter()
    sentinelas[0].liberarPeloSistema()
    expect(perdeu).toHaveBeenCalledTimes(1)
  })

  it('ao voltar a visível pede de novo; depois de soltar, não', async () => {
    const { nav, pedir, sentinelas } = navCom()
    const doc = docFalso()
    const tela = criarTelaLigada(nav, doc)
    await tela.manter()
    sentinelas[0].liberarPeloSistema()
    ficar(doc, 'hidden')
    expect(pedir).toHaveBeenCalledTimes(1)
    ficar(doc, 'visible')
    await microtarefas()
    expect(pedir).toHaveBeenCalledTimes(2)
    tela.soltar()
    await microtarefas()
    ficar(doc, 'hidden')
    ficar(doc, 'visible')
    await microtarefas()
    expect(pedir).toHaveBeenCalledTimes(2)
    expect(sentinelas[1].release).toHaveBeenCalledTimes(1)
  })

  it('"release" que chega com a aba oculta (antes do visibilitychange) não avisa; ao voltar, pede de novo', async () => {
    const { nav, pedir, sentinelas } = navCom()
    const doc = docFalso()
    const tela = criarTelaLigada(nav, doc)
    const perdeu = vi.fn()
    tela.aoPerder(perdeu)
    await tela.manter()
    // no Chromium a liberação pode chegar antes do visibilitychange: a aba já está oculta
    ;(doc as unknown as { visibilityState: DocumentVisibilityState }).visibilityState = 'hidden'
    sentinelas[0].liberarPeloSistema()
    expect(perdeu).not.toHaveBeenCalled()
    ficar(doc, 'hidden')
    ficar(doc, 'visible')
    await microtarefas()
    expect(pedir).toHaveBeenCalledTimes(2)
    expect(perdeu).not.toHaveBeenCalled()
  })

  it('aoPerder devolve função que remove o ouvinte', async () => {
    const { nav, sentinelas } = navCom()
    const tela = criarTelaLigada(nav, docFalso())
    const perdeu = vi.fn()
    const remover = tela.aoPerder(perdeu)
    remover()
    await tela.manter()
    sentinelas[0].liberarPeloSistema()
    expect(perdeu).not.toHaveBeenCalled()
  })

  it('soltar durante o pedido libera a sentinela que chega depois', async () => {
    let entregar: (s: SentinelaFalsa) => void = () => {}
    const s = new SentinelaFalsa()
    const { nav } = navCom(() => new Promise<SentinelaFalsa>((r) => (entregar = r)))
    const tela = criarTelaLigada(nav, docFalso())
    const perdeu = vi.fn()
    tela.aoPerder(perdeu)
    const pedido = tela.manter()
    tela.soltar()
    entregar(s)
    expect(await pedido).toBe(false)
    expect(s.release).toHaveBeenCalledTimes(1)
    expect(perdeu).not.toHaveBeenCalled()
  })
})

/**
 * Voz da navegação guiada. Só voz local (localService === true): uma voz remota mandaria cada
 * frase a um servidor no instante em que a pessoa chega ao ponto, o que já é uma trilha de posições.
 */
export type Voz = { falar(texto: string, urgente: boolean): boolean; calar(): void }

function sintese(): SpeechSynthesis | undefined {
  const g = globalThis as { speechSynthesis?: SpeechSynthesis; SpeechSynthesisUtterance?: unknown }
  return g.speechSynthesis && typeof g.SpeechSynthesisUtterance === 'function' ? g.speechSynthesis : undefined
}

/** pt-BR local antes de qualquer outro português local; nenhuma local → null. */
export function vozLocalPortugues(s: SpeechSynthesis | undefined = sintese()): SpeechSynthesisVoice | null {
  if (!s) return null
  const locais = (s.getVoices?.() ?? []).filter((v) => v.localService === true)
  const norm = (v: SpeechSynthesisVoice) => (v.lang ?? '').replace('_', '-').toLowerCase()
  return locais.find((v) => norm(v) === 'pt-br') ?? locais.find((v) => norm(v).startsWith('pt')) ?? null
}

export function criarVoz(): Voz | null {
  const s = sintese()
  const voz = vozLocalPortugues(s)
  if (!s || !voz) return null
  return {
    falar(texto, urgente) {
      if (urgente) s.cancel()
      const fala = new SpeechSynthesisUtterance(texto)
      fala.voice = voz
      fala.lang = 'pt-BR'
      s.speak(fala)
      return true
    },
    calar() {
      s.cancel()
    },
  }
}

/** Dona atual do trinco de "uma leitura por vez" na página. */
let dona: { parar: () => void } | null = null

/** Quem assume para a leitura anterior (uma vez). Devolve a função de soltar, que só solta se ainda for a dona. */
export function assumirLeitura(parar: () => void): () => void {
  const anterior = dona
  const minha = { parar }
  dona = minha
  anterior?.parar()
  return () => {
    if (dona === minha) dona = null
  }
}

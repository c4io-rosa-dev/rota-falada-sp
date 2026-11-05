const CRUS = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('restrições verificadas no código-fonte', () => {
  const fontes = Object.entries(CRUS)
    .map(([caminho, texto]) => ({ caminho: caminho.replace('../', ''), texto }))
    .filter((f) => !f.caminho.startsWith('./'))

  it('lê o código de verdade', () => {
    expect(fontes.map((f) => f.caminho)).toContain('componentes/RegiaoViva.tsx')
  })

  it('só RegiaoViva.tsx cria região viva', () => {
    const achados = fontes
      .filter((f) => f.caminho !== 'componentes/RegiaoViva.tsx')
      .filter((f) => /aria-live|role="status"|role="alert"|role='status'|role='alert'/.test(f.texto))
      .map((f) => f.caminho)
    expect(achados).toEqual([])
  })

  it('nenhuma interface diz "garante": diz "evita" e "não sabemos"', () => {
    const achados = fontes
      .filter((f) => !f.caminho.endsWith('types.gen.ts'))
      .filter((f) => /\bgarant(e|em|ia|ias|imos|ido|ida|ir)\b/i.test(f.texto))
      .map((f) => f.caminho)
    expect(achados).toEqual([])
  })

  it('mapa nunca voa: setView e fitBounds, sem flyTo', () => {
    expect(fontes.filter((f) => /flyTo/.test(f.texto)).map((f) => f.caminho)).toEqual([])
  })
})

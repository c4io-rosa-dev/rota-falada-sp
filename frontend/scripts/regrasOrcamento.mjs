// Regras do orçamento que leem o texto dos chunks (usadas por orcamento-bundle.mjs e testadas em
// src/test/regrasOrcamento.test.ts). Só texto: nada aqui lê disco.

/**
 * O motor do mapa (MapLibre + pmtiles) só pode chegar por import() dinâmico. Devolve as referências
 * que o trariam junto com a página: um import estático do chunk do motor (`from"./MotorMapaNavegacao-`
 * ou `import"./MotorMapaNavegacao-`) ou qualquer menção ao worker do MapLibre. O `import("./...")`
 * dinâmico e a lista de dependências do preload do Vite ("assets/MotorMapaNavegacao-...") não contam.
 */
export function referenciasEstaticasAoMotor(texto) {
  const achados = []
  if (/(?:\bfrom|\bimport)\s*["'`]\.\/MotorMapaNavegacao-/.test(texto)) achados.push('import estático do MotorMapaNavegacao')
  if (texto.includes('maplibre-gl-worker')) achados.push('referência ao maplibre-gl-worker')
  return achados
}

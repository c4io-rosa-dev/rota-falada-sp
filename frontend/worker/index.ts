import { responderMapa } from './servirMapa'
import type { Env, MetadadosMapa } from './tipos'

// Tamanho e ETag do arquivo do mapa, em memória do isolate (não é dado pessoal; poupa um head por pedido).
const METADADOS: MetadadosMapa = new Map()

// Só /mapa/* chega aqui (assets.run_worker_first); o resto do site são assets estáticos.
export default {
  fetch(pedido: Request, env: Env): Promise<Response> {
    return responderMapa(pedido, env, METADADOS)
  },
}

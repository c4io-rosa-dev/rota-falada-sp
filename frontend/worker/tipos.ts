// Interface mínima do R2, só com o que o Worker do mapa usa (sem @cloudflare/workers-types).

export interface IntervaloBytes {
  offset: number
  length: number
}

export interface ObjetoMapa {
  size: number
  httpEtag: string
}

export interface ObjetoMapaComCorpo extends ObjetoMapa {
  body: ReadableStream
}

export interface BucketMapa {
  head(chave: string): Promise<ObjetoMapa | null>
  get(chave: string, opcoes?: { range?: IntervaloBytes }): Promise<ObjetoMapaComCorpo | null>
}

export interface Env {
  MAPAS?: BucketMapa
}

export type MetadadosMapa = Map<string, ObjetoMapa>

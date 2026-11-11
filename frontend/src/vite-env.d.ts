/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_TILE_URL?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_CONTATO_PRIVACIDADE?: string
  /** Só no build de E2E ou de demonstração: liga a posição simulada da navegação guiada. */
  readonly VITE_PERMITIR_SIMULACAO?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

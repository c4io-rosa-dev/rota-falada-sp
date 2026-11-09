/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { conferirChaves } from './src/auth/guardaChaves.ts'

export default defineConfig(({ mode }) => {
  // process.cwd() é onde estão os .env; o ambiente do processo também entra (build do Cloudflare)
  conferirChaves(loadEnv(mode, process.cwd(), 'VITE_'))
  return {
    plugins: [react()],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      include: ['src/**/*.test.{ts,tsx}'],
      // os testes rodam como o build de E2E: a simulação da navegação guiada existe, mas só liga com ?simular=
      env: { VITE_PERMITIR_SIMULACAO: 'true' },
    },
  }
})

/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { avisosTerceiros } from './scripts/pluginAvisosTerceiros.ts'
import { conferirChaves } from './src/auth/guardaChaves.ts'

export default defineConfig(({ mode }) => {
  // process.cwd() é onde estão os .env; o ambiente do processo também entra (build do Cloudflare)
  conferirChaves(loadEnv(mode, process.cwd(), 'VITE_'))
  return {
    // avisosTerceiros: dist/licencas-terceiros.txt com a licença de cada pacote que entra no bundle
    plugins: [react(), avisosTerceiros()],
    test: {
      globals: true,
      // dois projetos: o setup do app usa sessionStorage/localStorage, que não existem no ambiente node do Worker
      projects: [
        {
          extends: true,
          test: {
            name: 'app',
            environment: 'jsdom',
            setupFiles: ['./src/test/setup.ts'],
            // prazo por teste maior que o findBy de 5 s (setup.ts), para a suíte carregada não estourar
            testTimeout: 15000,
            css: true,
            include: ['src/**/*.test.{ts,tsx}'],
            // os testes rodam como o build de E2E: a simulação da navegação guiada existe, mas só liga com ?simular=
            // a API fica fixa no endereço local, mesmo com um .env.local apontando para outro lugar
            env: { VITE_PERMITIR_SIMULACAO: 'true', VITE_API_URL: 'http://localhost:8000' },
          },
        },
        {
          extends: true,
          test: {
            name: 'worker',
            environment: 'node',
            include: ['worker/**/*.test.ts'],
          },
        },
      ],
    },
  }
})

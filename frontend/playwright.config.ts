import { defineConfig } from '@playwright/test'

/** Build de produção com API e Supabase simulados por page.route. Nada sai para a rede. */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    // localmente usa o Chrome já instalado; no CI, `npx playwright install chromium`
    channel: process.env.CI ? undefined : 'chrome',
  },
  webServer: {
    command: 'npm run build:e2e && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})

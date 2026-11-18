import { defineConfig, devices } from '@playwright/test';

/**
 * Testes do pacote Tizen como ele roda na TV: aberto a partir de arquivo local (file://),
 * em 1280x720 lógicos e operado só por teclas (setas, OK, Voltar e teclas de mídia).
 * Rode `pnpm build` antes. A "fonte remota" é o mesmo servidor de apoio dos testes Web.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 }, trace: 'retain-on-failure' },
  webServer: [{ command: 'node ../web/app/e2e/fixture-server.mjs', url: 'http://127.0.0.1:4801/basic.m3u', reuseExistingServer: true }],
});

import { defineConfig, devices } from '@playwright/test';

/** Testes de ponta a ponta sobre o build estático (o mesmo artefato que vai para a hospedagem). */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4800', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, grepInvert: /@mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: [
    { command: 'serve out -l 4800 --no-clipboard', url: 'http://localhost:4800', reuseExistingServer: true },
    { command: 'node e2e/fixture-server.mjs', url: 'http://127.0.0.1:4801/basic.m3u', reuseExistingServer: true },
  ],
});

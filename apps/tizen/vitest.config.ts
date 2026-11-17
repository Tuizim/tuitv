import { defineConfig } from 'vitest/config';

// Testes unitários (compatibilidade do CSS); os testes de ponta a ponta ficam em e2e/ (Playwright).
export default defineConfig({ test: { include: ['*.test.ts', 'src/**/*.test.ts'] } });

// Garante que o JavaScript do pacote use apenas sintaxe do ES2019 — o que o Chromium 69 (Tizen 5.5) entende.
// Ex.: ?. e ?? (ES2020) quebrariam o aplicativo inteiro na TV com um erro de sintaxe.
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';

const file = process.argv[2] ?? new URL('../dist/assets/tuitv.js', import.meta.url);
const code = readFileSync(file, 'utf8');
try {
  parse(code, { ecmaVersion: 2019, sourceType: 'script' });
  console.log('Sintaxe compatível com ES2019 (Chromium 69).');
} catch (error) {
  const { line, column } = error.loc ?? {};
  const lines = code.split('\n');
  console.error(`Sintaxe incompatível com Chromium 69 em ${line}:${column}: ${error.message}`);
  console.error((lines[line - 1] ?? '').slice(Math.max(0, column - 80), column + 80));
  process.exit(1);
}

// Lista os textos usados em t('…') que ainda não têm tradução em src/lib/i18n-en.ts.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(name) && !name.startsWith('i18n-')) files.push(full);
  }
};
walk(src);
const keys = new Set();
const call = /\bt\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gs;
const mapValue = /^\s*(?:'[\w-]+'|[\w]+):\s*(?:\n\s*)?'((?:\\.|[^'\\])*)',?$/gm;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(call)) keys.add(m[2].replace(/\\'/g, "'"));
  // Textos em tabelas (mensagens de erro, rótulos do menu) passados a t() por variável.
  if (/i18n\.ts$|Player\.tsx$/.test(file)) for (const m of text.matchAll(mapValue)) keys.add(m[1].replace(/\\'/g, "'"));
  if (/AppShell\.tsx$/.test(file)) for (const m of text.matchAll(/label: '([^']+)'/g)) keys.add(m[1]);
}
const en = readFileSync(join(src, 'lib/i18n-en.ts'), 'utf8');
const missing = [...keys].filter((k) => !en.includes(JSON.stringify(k)) && !en.includes(`'${k.replace(/'/g, "\\'")}'`));
if (process.argv.includes('--json')) console.log(JSON.stringify([...keys], null, 0));
else {
  console.log(`${keys.size} textos, ${missing.length} sem tradução`);
  for (const k of missing) console.log(' -', k);
}
process.exitCode = missing.length ? 1 : 0;

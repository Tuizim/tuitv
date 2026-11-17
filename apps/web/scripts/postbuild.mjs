// Gera out/sw.js com a lista de arquivos estáticos da aplicação (cache da interface, PRD §12.4).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../out/', import.meta.url));
const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else files.push(relative(out, full).split('\\').join('/'));
  }
};
walk(out);
const assets = files
  .filter((f) => f !== 'sw.js' && !f.endsWith('.map'))
  .map((f) => `${base}/${f.endsWith('index.html') ? f.slice(0, -'index.html'.length) : f}`);
const version = createHash('sha256').update(assets.join('|')).update(readFileSync(join(out, 'index.html'))).digest('hex').slice(0, 12);
const template = readFileSync(new URL('./sw.template.js', import.meta.url), 'utf8');
writeFileSync(
  join(out, 'sw.js'),
  template.replace('__VERSION__', version).replace('__BASE__', base).replace('"__ASSETS__"', JSON.stringify(assets)),
);
console.log(`service worker gerado: ${assets.length} arquivos, versão ${version}`);

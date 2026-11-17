// Empacota o build (dist/) como aplicativo Tizen (.wgt) em build/.
//
// Instalar numa TV exige um pacote ASSINADO com o certificado Samsung do desenvolvedor
// (Tizen Studio → Certificate Manager, com a conta Samsung e o DUID da TV). Se o CLI do Tizen
// Studio estiver disponível, este script assina; senão, gera um .wgt sem assinatura
// e mostra o comando para assinar depois. Veja docs/TIZEN.md.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import JSZip from 'jszip';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');
const out = join(root, 'build');
// No CI a versão vem da tag do Git (TUITV_VERSION=1.2.3); localmente, do package.json.
// A Tizen só aceita números (x.y.z): sufixos como -beta.1 ficam de fora do config.xml.
const version = (process.env.TUITV_VERSION || JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version)
  .replace(/^v/, '')
  .replace(/-.*$/, '');
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Versão inválida para a Tizen: ${version}`);

// 1. Sintaxe compatível com o navegador da TV.
execFileSync(process.execPath, [join(root, 'scripts/check-syntax.mjs')], { stdio: 'inherit' });

// 2. config.xml (com a versão do package.json) e ícone.
const config = readFileSync(join(root, 'tizen/config.xml'), 'utf8').replace(/(<widget[^>]*\sversion=")[^"]*"/, `$1${version}"`);
writeFileSync(join(dist, 'config.xml'), config);
copyFileSync(join(root, 'tizen/icon.png'), join(dist, 'icon.png'));
mkdirSync(out, { recursive: true });

// 3. Assinatura com o CLI do Tizen Studio, quando disponível.
const candidates = [process.env.TIZEN_CLI, join(homedir(), 'tizen-studio/tools/ide/bin/tizen'), 'tizen'].filter(Boolean);
const cli = candidates.find((c) => c === 'tizen' ? spawnSync('tizen', ['version'], { stdio: 'ignore' }).status === 0 : existsSync(c));
const profile = process.env.TIZEN_PROFILE;

if (cli && profile) {
  rmSync(join(dist, 'TuiTV.wgt'), { force: true });
  execFileSync(cli, ['package', '-t', 'wgt', '-s', profile, '--', dist], { stdio: 'inherit' });
  const signed = readdirSync(dist).find((f) => f.endsWith('.wgt'));
  if (!signed) throw new Error('O Tizen CLI não gerou o pacote .wgt.');
  renameSync(join(dist, signed), join(out, 'TuiTV.wgt'));
  console.log(`\nPacote assinado: ${relative(process.cwd(), join(out, 'TuiTV.wgt'))}`);
} else {
  const zip = new JSZip();
  const add = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) add(path);
      else if (!name.endsWith('.wgt')) zip.file(relative(dist, path), readFileSync(path));
    }
  };
  add(dist);
  const file = join(out, 'TuiTV-sem-assinatura.wgt');
  writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log(`\nPacote SEM assinatura: ${relative(process.cwd(), file)}`);
  console.log(
    cli
      ? 'Para assinar, defina TIZEN_PROFILE com o nome do perfil de certificado Samsung e rode o build de novo.'
      : 'A TV só instala pacotes assinados. Instale o Tizen Studio (CLI), crie o certificado Samsung e rode:\n' +
          '  TIZEN_PROFILE=<perfil> pnpm build:tizen\n(ver docs/TIZEN.md)',
  );
}

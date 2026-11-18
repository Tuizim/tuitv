// Gera os ícones da PWA a partir do símbolo oficial (web/packages/design-system).
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const navy = '#101827';
const cyan = '#38BDF8';
const icon = (r, bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${bg ? `<rect width="512" height="512" fill="${navy}"/>` : ''}<circle cx="256" cy="256" r="${r}" fill="${cyan}"/><path transform="translate(256 256) scale(${r / 256}) translate(-256 -256)" d="M212 168c0-12 13-19 23-13l132 88c9 6 9 20 0 26l-132 88c-10 6-23-1-23-13z" fill="${navy}"/></svg>`;

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('icon.svg', out), icon(256, false));
const jobs = [
  ['icon-192.png', 192, icon(200, true)],
  ['icon-512.png', 512, icon(200, true)],
  ['icon-maskable-512.png', 512, icon(150, true)],
  ['apple-touch-icon.png', 180, icon(190, true)],
];
for (const [name, size, svg] of jobs) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(new URL(name, out).pathname);
}
console.log('ícones gerados');

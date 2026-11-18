// Gera ícones e logotipos das três plataformas a partir da identidade visual em img/:
//   img/tuitv-icone.svg  gato (ícone dos aplicativos, tela de carregamento, menu recolhido)
//   img/tuitv-logo.png   gato + nome (banner da TV, cabeçalho, boas-vindas)
// Os arquivos gerados são versionados; rode `pnpm brand` apenas quando a identidade mudar.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ICON = `${root}img/tuitv-icone.svg`;
const LOGO = `${root}img/tuitv-logo.png`;
const NAVY = '#101827';

const write = async (path, data) => {
  mkdirSync(dirname(root + path), { recursive: true });
  if (data.toFile) await data.toFile(root + path);
  else writeFileSync(root + path, data);
};

/** Gato sem a margem do SVG, contido num quadrado de `size` px (fundo transparente). */
const cat = async (size) => {
  const big = await sharp(ICON, { density: 576 }).resize(2048, 2048).png().toBuffer();
  const trimmed = await sharp(big).trim({ threshold: 1 }).png().toBuffer();
  return sharp(trimmed).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
};
/** Logotipo sem a margem transparente, na altura pedida. */
const logo = (height) => sharp(LOGO).trim({ threshold: 1 }).resize({ height }).png().toBuffer();

/** Gato centralizado num quadro azul-marinho; `scale` é a fração do lado ocupada pelo gato. */
async function tile(width, height, scale, background = NAVY) {
  const size = Math.round(Math.min(width, height) * scale);
  return sharp({ create: { width, height, channels: 4, background } })
    .composite([{ input: await cat(size), left: Math.round((width - size) / 2), top: Math.round((height - size) / 2) }])
    .png();
}

/** Silhueta branca do gato com olhos vazados (ícone monocromático do Android 13+). */
async function silhouette(size, scale) {
  const inner = Math.round(size * scale);
  const { data, info } = await sharp(await cat(inner)).raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4, 255);
  for (let i = 0; i < info.width * info.height; i++) {
    const [r, g, b, a] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]];
    // O branco dos olhos vira transparente; óculos e pupilas continuam desenhados pela borda.
    const white = Math.min(r, g, b) / 255;
    out[i * 4 + 3] = Math.round(a * (white > 0.8 ? 0 : 1));
  }
  const glyph = await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  const offset = Math.round((size - inner) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: glyph, left: offset, top: offset }])
    .png();
}

/** SVG do gato com o viewBox justo ao desenho (sem a margem do arquivo original). */
async function tightSvg() {
  const svg = readFileSync(ICON, 'utf8');
  const big = await sharp(ICON, { density: 288 }).resize(2048, 2048).png().toBuffer();
  const { info } = await sharp(big).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
  const k = 512 / 2048;
  const pad = 4;
  const x = -info.trimOffsetLeft * k - pad;
  const y = -info.trimOffsetTop * k - pad;
  const w = info.width * k + pad * 2;
  const h = info.height * k + pad * 2;
  return svg
    .replace(/<!--.*?-->\s*/gs, '')
    .replace(/width="512" height="512"/, `width="${Math.round(w)}" height="${Math.round(h)}"`)
    .replace(/viewBox="0 0 512 512"/, `viewBox="${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}"`);
}

// ---------- Web (PWA, favicon) ----------
const svgTight = await tightSvg();
await write('web/app/public/icons/icon.svg', svgTight);
await write('web/app/public/icons/icon-192.png', await tile(192, 192, 0.8));
await write('web/app/public/icons/icon-512.png', await tile(512, 512, 0.8));
// Maskable: o sistema pode cortar até um círculo de 80% do lado.
await write('web/app/public/icons/icon-maskable-512.png', await tile(512, 512, 0.62));
await write('web/app/public/icons/apple-touch-icon.png', await tile(180, 180, 0.76));

// Logotipos dentro do código (Web e Samsung): funcionam com qualquer base de endereço, inclusive file:// na TV.
const logoWebp = await sharp(await logo(200)).webp({ quality: 90, alphaQuality: 100 }).toBuffer();
const logoMeta = await sharp(logoWebp).metadata();
const iconSvg = svgTight.replace(/\s*\n\s*/g, ' ').trim();
await write(
  'web/packages/design-system/src/brand.ts',
  `// Gerado por web/app/scripts/brand.mjs a partir de img/ — não edite à mão (rode \`pnpm brand\`).\n\n` +
    `/** Gato do TuiTV (SVG), para ícone e tela de carregamento. */\n` +
    `export const brandIcon = 'data:image/svg+xml;base64,${Buffer.from(iconSvg).toString('base64')}';\n\n` +
    `/** Logotipo com o nome (gato + "TuiTV"), ${logoMeta.width}x${logoMeta.height}. */\n` +
    `export const brandLogo = 'data:image/webp;base64,${logoWebp.toString('base64')}';\n\n` +
    `/** Largura ÷ altura do logotipo. */\n` +
    `export const brandLogoRatio = ${(logoMeta.width / logoMeta.height).toFixed(4)};\n`,
);

// ---------- Samsung (Tizen): ícone 512x423 exigido pelas TVs ----------
await write('samsung/tizen/icon.png', await tile(512, 423, 0.78));

// ---------- Android ----------
const res = 'android/app/src/main/res';
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [dpi, k] of Object.entries(densities)) {
  // Ícone quadrado (Android < 8 e Fire TV).
  await write(`${res}/mipmap-${dpi}/ic_launcher.png`, await tile(48 * k, 48 * k, 0.8));
  // Ícone adaptativo (108dp, área segura de 66dp): gato sobre o fundo azul-marinho do XML.
  const fg = Math.round(108 * k);
  await write(`${res}/mipmap-${dpi}/ic_launcher_foreground.png`, await tile(fg, fg, 0.58, { r: 0, g: 0, b: 0, alpha: 0 }));
  await write(`${res}/mipmap-${dpi}/ic_launcher_monochrome.png`, await silhouette(fg, 0.58));
}
// Banner 16:9 do launcher do Android TV (320x180 dp em xhdpi): logotipo com o nome.
const bannerLogo = await logo(240);
const bannerWidth = 560;
const bannerImg = await sharp(bannerLogo).resize({ width: bannerWidth }).png().toBuffer();
const bannerHeight = (await sharp(bannerImg).metadata()).height;
await write(
  `${res}/drawable-xhdpi/banner.png`,
  sharp({ create: { width: 640, height: 360, channels: 4, background: NAVY } }).composite([
    { input: bannerImg, left: Math.round((640 - bannerWidth) / 2), top: Math.round((360 - bannerHeight) / 2) },
  ]).png(),
);
// Imagens usadas nas telas (tela de abertura, menu, boas-vindas).
await write(`${res}/drawable-nodpi/tuitv_icone.webp`, sharp(await cat(288)).webp({ quality: 92, alphaQuality: 100 }));
await write(`${res}/drawable-nodpi/tuitv_logo.webp`, sharp(await logo(256)).webp({ quality: 92, alphaQuality: 100 }));

console.log('identidade visual gerada para web, samsung e android');

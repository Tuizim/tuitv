// Gera ícones e logotipos das três plataformas a partir da identidade visual em img/:
//   img/tuitv-icone-app.png  ícone dos aplicativos (Android, Fire TV, Samsung): gato + nome em branco sobre degradê
//   img/tuitv-icone.svg      gato: ícone da Web (favicon/PWA), tela de carregamento e menu recolhido
//   img/tuitv-logo.png       gato + nome: cabeçalho e boas-vindas
// Os arquivos gerados são versionados; rode `pnpm brand` apenas quando a identidade mudar.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ICON = `${root}img/tuitv-icone.svg`;
const LOGO = `${root}img/tuitv-logo.png`;
const APP_ICON = `${root}img/tuitv-icone-app.png`;
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

/**
 * Ícone dos aplicativos separado em duas camadas, para caber em qualquer máscara (círculo, squircle, 16:9...):
 *  - desenho: o branco do gato e do nome, com transparência;
 *  - fundo: o degradê original, reconstruído sob o desenho (para o desenho poder mudar de tamanho em cada formato).
 */
async function appIconLayers() {
  const N = 1024;
  const { data } = await sharp(APP_ICON).removeAlpha().resize(N, N).raw().toBuffer({ resolveWithObject: true });
  const art = Buffer.alloc(N * N * 4, 255);
  const known = new Float32Array(N * N); // 1 = pixel de fundo confiável
  // Imagem em quadrado cheio (sem cantos transparentes): só a margem externa fica fora do ajuste do fundo.
  const radius = 0;
  const inset = 12;
  const inside = (x, y) => {
    const cx = Math.min(Math.max(x, radius + inset), N - radius - inset);
    const cy = Math.min(Math.max(y, radius + inset), N - radius - inset);
    return (x - cx) ** 2 + (y - cy) ** 2 <= (radius) ** 2 && x >= inset && y >= inset && x < N - inset && y < N - inset;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const low = Math.min(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
      // Branco: os três canais altos. O degradê sempre tem um canal quase zerado.
      const a = Math.min(1, Math.max(0, (low - 70) / 150));
      art[i * 4 + 3] = inside(x, y) ? Math.round(a * 255) : 0;
      known[i] = inside(x, y) && low < 40 ? 1 : 0;
    }
  }
  // Fundo: o degradê é suave, então um polinômio cúbico (por canal) ajustado sobre o fundo limpo —
  // longe do desenho e das bordas — o reproduz sem os contornos das letras e cobre os cantos pretos.
  const artMask = Buffer.alloc(N * N);
  for (let i = 0; i < N * N; i++) artMask[i] = art[i * 4 + 3] > 5 ? 255 : 0;
  const halo = await sharp(artMask, { raw: { width: N, height: N, channels: 1 } }).blur(14).raw().toBuffer();
  const terms = (u, v) => [1, u, v, u * u, u * v, v * v, u * u * u, u * u * v, u * v * v, v * v * v];
  const T = 10;
  const ata = Array.from({ length: T }, () => new Float64Array(T));
  const atb = [0, 1, 2].map(() => new Float64Array(T));
  for (let y = 0; y < N; y += 4) {
    for (let x = 0; x < N; x += 4) {
      const i = y * N + x;
      if (!known[i] || halo[i] > 2) continue;
      const f = terms((2 * x) / N - 1, (2 * y) / N - 1);
      for (let r = 0; r < T; r++) {
        for (let c = 0; c < T; c++) ata[r][c] += f[r] * f[c];
        for (let ch = 0; ch < 3; ch++) atb[ch][r] += f[r] * data[i * 3 + ch];
      }
    }
  }
  const solve = (A, bvec) => {
    const m = A.map((row, r) => [...row, bvec[r]]);
    for (let c = 0; c < T; c++) {
      let piv = c;
      for (let r = c + 1; r < T; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
      [m[c], m[piv]] = [m[piv], m[c]];
      for (let r = 0; r < T; r++) {
        if (r === c) continue;
        const k = m[r][c] / m[c][c];
        for (let k2 = c; k2 <= T; k2++) m[r][k2] -= k * m[c][k2];
      }
    }
    return m.map((row, r) => row[T] / row[r]);
  };
  const coef = [0, 1, 2].map((ch) => solve(ata, atb[ch]));
  const bg = Buffer.alloc(N * N * 3);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const f = terms((2 * x) / N - 1, (2 * y) / N - 1);
      for (let ch = 0; ch < 3; ch++) {
        let v = 0;
        for (let t = 0; t < T; t++) v += coef[ch][t] * f[t];
        bg[(y * N + x) * 3 + ch] = Math.min(255, Math.max(0, Math.round(v)));
      }
    }
  }
  const background = await sharp(bg, { raw: { width: N, height: N, channels: 3 } }).png().toBuffer();
  const artwork = await sharp(art, { raw: { width: N, height: N, channels: 4 } }).png().trim({ threshold: 1 }).png().toBuffer();
  return { background, artwork };
}
const app = await appIconLayers();

/** Ícone do aplicativo em `width`x`height`: fundo em degradê cobrindo tudo e desenho contido em `scale` do quadro. */
async function appTile(width, height, scale, { background = true, radius = 0 } = {}) {
  const art = await sharp(app.artwork).resize(Math.round(width * scale), Math.round(height * scale), { fit: 'inside' }).png().toBuffer();
  const meta = await sharp(art).metadata();
  const base = background
    ? sharp(app.background).resize(width, height, { fit: 'cover' })
    : sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  const layers = [{ input: art, left: Math.round((width - meta.width) / 2), top: Math.round((height - meta.height) / 2) }];
  let out = await base.ensureAlpha().composite(layers).png().toBuffer();
  if (radius) {
    const mask = Buffer.from(`<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" ry="${radius}"/></svg>`);
    out = await sharp(out).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  }
  return sharp(out).png();
}

// ---------- Web (PWA, favicon) ----------
const svgTight = await tightSvg();
await write('web/app/public/icons/icon.svg', svgTight);
await write('web/app/public/icons/icon-192.png', await tile(192, 192, 0.8));
await write('web/app/public/icons/icon-512.png', await tile(512, 512, 0.8));
// Maskable: o sistema pode cortar até um círculo de 80% do lado.
await write('web/app/public/icons/icon-maskable-512.png', await tile(512, 512, 0.62));
await write('web/app/public/icons/apple-touch-icon.png', await tile(180, 180, 0.76));

// Marca usada nas telas (Web e Samsung) como arquivos, não embutida no código: a política de segurança
// padrão dos aplicativos Tizen (default-src *) bloqueia imagens "data:". PNG (não WebP) pelo mesmo motivo.
await write('web/app/public/brand/tuitv-logo.png', sharp(await logo(200)).png({ palette: true, quality: 95, effort: 10, compressionLevel: 9 }));
await write('web/app/public/brand/tuitv-icone.svg', svgTight);

// ---------- Samsung (Tizen): ícone 512x423 exigido pelas TVs ----------
await write('samsung/tizen/icon.png', await appTile(512, 423, 0.8));

// ---------- Android ----------
const res = 'android/app/src/main/res';
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [dpi, k] of Object.entries(densities)) {
  // Ícone quadrado arredondado (Android < 8 e Fire TV), como no arquivo original.
  await write(`${res}/mipmap-${dpi}/ic_launcher.png`, await appTile(48 * k, 48 * k, 0.74, { radius: 48 * k * 0.225 }));
  // Ícone adaptativo (108dp; o sistema mostra até 72dp e garante um círculo de 66dp): degradê e desenho em camadas.
  const fg = Math.round(108 * k);
  await write(`${res}/mipmap-${dpi}/ic_launcher_background.png`, sharp(app.background).resize(fg, fg).png());
  await write(`${res}/mipmap-${dpi}/ic_launcher_foreground.png`, await appTile(fg, fg, 0.56, { background: false }));
  // Monocromático (Android 13+): o mesmo desenho branco; o sistema aplica a cor do tema.
  await write(`${res}/mipmap-${dpi}/ic_launcher_monochrome.png`, await appTile(fg, fg, 0.56, { background: false }));
}
// Banner 16:9 do launcher do Android TV (320x180 dp em xhdpi): o ícone do aplicativo em formato largo.
await write(`${res}/drawable-xhdpi/banner.png`, await appTile(640, 360, 0.82));
// Imagens usadas nas telas (tela de abertura, menu, boas-vindas).
await write(`${res}/drawable-nodpi/tuitv_icone.webp`, sharp(await cat(288)).webp({ quality: 92, alphaQuality: 100 }));
await write(`${res}/drawable-nodpi/tuitv_logo.webp`, sharp(await logo(256)).webp({ quality: 92, alphaQuality: 100 }));

console.log('identidade visual gerada para web, samsung e android');

import { colors } from './tokens';

/** Símbolo: círculo ciano com "play" em azul-marinho. */
export const iconSvg = (size = 512, padded = false) => {
  const r = padded ? 150 : 256;
  const bg = padded ? `<rect width="512" height="512" fill="${colors.navy}"/>` : '';
  const s = r / 256;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">${bg}<circle cx="256" cy="256" r="${r}" fill="${colors.cyan}"/><path transform="translate(256 256) scale(${s}) translate(-256 -256)" d="M212 168c0-12 13-19 23-13l132 88c9 6 9 20 0 26l-132 88c-10 6-23-1-23-13z" fill="${colors.navy}"/></svg>`;
};

/** Logotipo horizontal "TuiTV". */
export const logoSvg = (textColor: string = colors.white) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 80" role="img" aria-label="TuiTV"><text x="0" y="58" font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif" font-size="56" font-weight="800" letter-spacing="-1"><tspan fill="${textColor}">Tui</tspan><tspan fill="${colors.cyan}">TV</tspan></text></svg>`;

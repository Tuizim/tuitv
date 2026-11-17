/** Normalização usada em buscas e chaves: sem acentos, minúsculas, espaços simples. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[ \t ]+/g, ' ')
    .trim();
}

function fnv1a(text: string, seed: number): number {
  let h = seed | 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const hex8 = (n: number) => n.toString(16).padStart(8, '0');

/** Hash estável de 64 bits (dois FNV-1a de 32 bits sobre unidades UTF-16), em hexadecimal. */
export function stableHash(text: string): string {
  return hex8(fnv1a(text, 0x811c9dc5)) + hex8(fnv1a(text, 0x9747b28c));
}

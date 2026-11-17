/**
 * Interpretador M3U/M3U8 do TuiTV.
 *
 * Regras (espelhadas em packages/android-core/.../parser/M3uParser.kt e validadas
 * pelos mesmos arquivos de referência em packages/m3u-parser/fixtures):
 *
 *  1. BOM inicial é ignorado; linhas terminam em \n, \r\n ou \r.
 *  2. `#EXTM3U` abre a lista; seus atributos (url-tvg, x-tvg-url…) formam o cabeçalho.
 *  3. `#EXTINF:<duração> <atributos>,<nome>` descreve o próximo endereço.
 *     Atributos são pares chave="valor" (ou chave=valor sem aspas); chaves em minúsculas.
 *  4. `#EXTGRP:<grupo>` define a categoria quando não houver group-title.
 *  5. `#EXTVLCOPT:http-user-agent=` / `http-referrer=` são guardados em `options`.
 *  6. Demais linhas iniciadas por `#` são ignoradas.
 *  7. Uma linha com endereço (esquema://…) fecha o registro pendente.
 *     Endereço sem #EXTINF gera um registro com nome derivado do endereço.
 *  8. #EXTINF sem endereço, ou linha que não é endereço, gera um erro individual
 *     e a importação continua.
 *  9. Nome vazio usa tvg-name e, em seguida, o nome derivado do endereço.
 */

export interface M3uEntry {
  name: string;
  url: string;
  /** Segundos; -1 quando desconhecida/ao vivo. */
  duration: number;
  attrs: Record<string, string>;
  tvgId?: string;
  tvgName?: string;
  tvgLogo?: string;
  groupTitle?: string;
  options?: Record<string, string>;
  /** Linha (1-based) do endereço. */
  line: number;
}

export interface M3uError {
  line: number;
  code: 'missing-url' | 'invalid-url' | 'malformed-extinf';
  raw: string;
}

export interface M3uHeader {
  found: boolean;
  attrs: Record<string, string>;
}

export interface M3uResult {
  header: M3uHeader;
  entries: M3uEntry[];
  errors: M3uError[];
  /** O conteúdo é um manifesto HLS de mídia (uma transmissão), não uma lista de canais. */
  isHlsManifest: boolean;
}

const URL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+/;
const MAX_ERRORS = 500;

interface ExtInf {
  duration: number;
  attrs: Record<string, string>;
  name: string;
  line: number;
  raw: string;
  malformed: boolean;
}

/** Lê pares chave="valor" a partir de `start` até encontrar a vírgula que antecede o nome. */
export function parseAttributes(text: string, start = 0): { attrs: Record<string, string>; end: number; ok: boolean } {
  const attrs: Record<string, string> = {};
  let i = start;
  const n = text.length;
  while (i < n) {
    while (i < n && (text[i] === ' ' || text[i] === '\t')) i++;
    if (i >= n) return { attrs, end: n, ok: true };
    if (text[i] === ',') return { attrs, end: i, ok: true };
    const keyStart = i;
    while (i < n && text[i] !== '=' && text[i] !== ',' && text[i] !== ' ' && text[i] !== '\t') i++;
    if (i >= n || text[i] !== '=') return { attrs, end: keyStart, ok: false };
    const key = text.slice(keyStart, i).toLowerCase();
    i++;
    let value: string;
    if (text[i] === '"') {
      const close = text.indexOf('"', i + 1);
      if (close === -1) return { attrs, end: keyStart, ok: false };
      value = text.slice(i + 1, close);
      i = close + 1;
    } else {
      const valueStart = i;
      while (i < n && text[i] !== ' ' && text[i] !== '\t' && text[i] !== ',') i++;
      value = text.slice(valueStart, i);
    }
    if (key) attrs[key] = value.trim();
  }
  return { attrs, end: n, ok: true };
}

function parseExtInf(raw: string, line: number): ExtInf {
  const body = raw.slice('#EXTINF:'.length);
  let i = 0;
  while (i < body.length && body[i] === ' ') i++;
  const durStart = i;
  while (i < body.length && /[0-9.+-]/.test(body[i]!)) i++;
  const parsedDuration = Number.parseFloat(body.slice(durStart, i));
  const duration = Number.isFinite(parsedDuration) ? parsedDuration : -1;

  const { attrs, end, ok } = parseAttributes(body, i);
  let name: string;
  let malformed = false;
  if (ok && body[end] === ',') {
    name = body.slice(end + 1);
  } else if (ok && end >= body.length) {
    name = '';
    malformed = Object.keys(attrs).length === 0 && i === durStart;
  } else {
    // Atributos fora do padrão: usa o texto após a última vírgula como nome.
    const comma = body.lastIndexOf(',');
    name = comma >= 0 ? body.slice(comma + 1) : '';
    malformed = comma < 0;
  }
  return { duration, attrs, name: name.trim(), line, raw, malformed };
}

/** Nome legível derivado do último segmento do endereço. */
export function nameFromUrl(url: string): string {
  const noQuery = url.split(/[?#]/)[0] ?? url;
  const segments = noQuery.split('/').filter(Boolean);
  let last = segments[segments.length - 1] ?? url;
  try {
    last = decodeURIComponent(last);
  } catch {
    /* mantém o segmento bruto */
  }
  const withoutExt = last.replace(/\.[a-zA-Z0-9]{2,5}$/, '');
  const cleaned = withoutExt.replace(/[_]+/g, ' ').trim();
  return cleaned || url;
}

/**
 * Interpretador incremental: alimente com `push(pedaço)` e finalize com `end()`.
 * Permite processar listas extensas sem manter o texto completo em memória.
 */
export class M3uParser {
  readonly header: M3uHeader = { found: false, attrs: {} };
  readonly errors: M3uError[] = [];
  errorCount = 0;
  entryCount = 0;
  isHlsManifest = false;

  private buffer = '';
  private lineNo = 0;
  private started = false;
  private pending: ExtInf | null = null;
  private pendingGroup: string | undefined;
  private pendingOptions: Record<string, string> | undefined;

  push(chunk: string): M3uEntry[] {
    const out: M3uEntry[] = [];
    let data = this.buffer + chunk;
    // Um \r no fim do pedaço pode ser metade de um \r\n: aguarda o próximo pedaço.
    let carry = '';
    if (data.endsWith('\r')) {
      carry = '\r';
      data = data.slice(0, -1);
    }
    const lines = data.split(/\r\n|\n|\r/);
    this.buffer = (lines.pop() ?? '') + carry;
    for (const line of lines) this.handleLine(line, out);
    return out;
  }

  end(): M3uEntry[] {
    const out: M3uEntry[] = [];
    const rest = this.buffer;
    this.buffer = '';
    if (rest.length > 0) {
      for (const line of rest.split(/\r\n|\n|\r/)) this.handleLine(line, out);
    }
    if (this.pending) {
      this.addError(this.pending.line, 'missing-url', this.pending.raw);
      this.pending = null;
    }
    return out;
  }

  private addError(line: number, code: M3uError['code'], raw: string) {
    this.errorCount++;
    if (this.errors.length < MAX_ERRORS) this.errors.push({ line, code, raw: raw.slice(0, 200) });
  }

  private handleLine(rawLine: string, out: M3uEntry[]) {
    this.lineNo++;
    let line = rawLine;
    if (!this.started) {
      if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
    }
    line = line.trim();
    if (!line) return;
    this.started = true;

    if (line[0] === '#') {
      const upper = line.slice(0, 12).toUpperCase();
      if (upper.startsWith('#EXTM3U')) {
        if (!this.header.found) {
          this.header.found = true;
          Object.assign(this.header.attrs, parseAttributes(line, '#EXTM3U'.length).attrs);
        }
      } else if (upper.startsWith('#EXTINF:')) {
        if (this.pending) this.addError(this.pending.line, 'missing-url', this.pending.raw);
        const info = parseExtInf(line, this.lineNo);
        if (info.malformed) this.addError(this.lineNo, 'malformed-extinf', line);
        this.pending = info;
        this.pendingGroup = undefined;
        this.pendingOptions = undefined;
      } else if (upper.startsWith('#EXTGRP:')) {
        this.pendingGroup = line.slice('#EXTGRP:'.length).trim() || undefined;
      } else if (upper.startsWith('#EXTVLCOPT:')) {
        const opt = line.slice('#EXTVLCOPT:'.length);
        const eq = opt.indexOf('=');
        if (eq > 0) {
          const key = opt.slice(0, eq).trim().toLowerCase();
          if (key === 'http-user-agent' || key === 'http-referrer') {
            (this.pendingOptions ??= {})[key] = opt.slice(eq + 1).trim();
          }
        }
      } else if (upper.startsWith('#EXT-X-TARG') || upper.startsWith('#EXT-X-STRE') || upper.startsWith('#EXT-X-MEDI')) {
        this.isHlsManifest = true;
      }
      return;
    }

    if (!URL_RE.test(line)) {
      this.addError(this.lineNo, 'invalid-url', line);
      // O #EXTINF pendente continua aguardando um endereço válido.
      return;
    }

    const info = this.pending;
    this.pending = null;
    const attrs = info?.attrs ?? {};
    const tvgName = attrs['tvg-name'] || undefined;
    const name = info?.name || tvgName || nameFromUrl(line);
    const entry: M3uEntry = {
      name,
      url: line,
      duration: info?.duration ?? -1,
      attrs,
      line: this.lineNo,
    };
    const tvgId = attrs['tvg-id'];
    if (tvgId) entry.tvgId = tvgId;
    if (tvgName) entry.tvgName = tvgName;
    const logo = attrs['tvg-logo'] || attrs['logo'];
    if (logo) entry.tvgLogo = logo;
    const group = attrs['group-title'] || this.pendingGroup;
    if (group) entry.groupTitle = group;
    if (this.pendingOptions) entry.options = this.pendingOptions;
    this.pendingGroup = undefined;
    this.pendingOptions = undefined;
    this.entryCount++;
    out.push(entry);
  }
}

export function parseM3u(text: string): M3uResult {
  const parser = new M3uParser();
  const entries = parser.push(text);
  entries.push(...parser.end());
  return { header: parser.header, entries, errors: parser.errors, isHlsManifest: parser.isHlsManifest };
}

/** Validação rápida de formato sobre o início do conteúdo. */
export function looksLikeM3u(sample: string): boolean {
  const text = sample.charCodeAt(0) === 0xfeff ? sample.slice(1) : sample;
  const head = text.slice(0, 4096).trimStart();
  if (/^#EXTM3U/i.test(head)) return true;
  return /^#EXTINF:/im.test(head);
}

/** Endereço de EPG anunciado no cabeçalho, se houver. */
export function epgUrlFromHeader(header: M3uHeader): string | undefined {
  const raw = header.attrs['url-tvg'] || header.attrs['x-tvg-url'] || header.attrs['tvg-url'];
  if (!raw) return undefined;
  const first = raw.split(',')[0]?.trim();
  return first || undefined;
}

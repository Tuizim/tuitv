import type { Programme } from '@tuitv/shared-models';
import { normalizeText } from './text';

export interface XmltvChannel {
  id: string;
  displayNames: string[];
  icon?: string;
}

export interface XmltvProgramme {
  channelId: string;
  start: number;
  stop: number;
  title: string;
  description?: string;
  category?: string;
}

export interface XmltvBatch {
  channels: XmltvChannel[];
  programmes: XmltvProgramme[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  let value = text;
  if (value.includes('<![CDATA[')) value = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  if (!value.includes('&')) return value.trim();
  return value
    .replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, ref: string) => {
      if (ref[0] === '#') {
        const code = ref[1] === 'x' || ref[1] === 'X' ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
      }
      return ENTITIES[ref] ?? whole;
    })
    .trim();
}

/**
 * Datas XMLTV: `YYYYMMDDHHMMSS ±HHMM` (campos finais opcionais).
 * Sem fuso informado, considera UTC. Retorna epoch em ms ou NaN.
 */
export function parseXmltvDate(value: string): number {
  const m = /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?\s*(?:([+-])(\d{2}):?(\d{2})|Z)?/.exec(value.trim());
  if (!m) return Number.NaN;
  const utc = Date.UTC(
    Number(m[1]),
    m[2] ? Number(m[2]) - 1 : 0,
    m[3] ? Number(m[3]) : 1,
    m[4] ? Number(m[4]) : 0,
    m[5] ? Number(m[5]) : 0,
    m[6] ? Number(m[6]) : 0,
  );
  if (!m[7]) return utc;
  const offset = (Number(m[8]) * 60 + Number(m[9])) * 60_000;
  return m[7] === '+' ? utc - offset : utc + offset;
}

const ATTR_RE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function attributes(openTag: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(openTag))) out[m[1]!] = decodeXml(m[2] ?? m[3] ?? '');
  return out;
}

function firstChild(block: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(block);
  if (!m) return undefined;
  return decodeXml(m[1]!) || undefined;
}

const MAX_BLOCK = 4 * 1024 * 1024;

export interface XmltvWindow {
  /** Descarta programas que terminam antes deste instante. */
  from?: number;
  /** Descarta programas que começam depois deste instante. */
  to?: number;
}

/** Interpretador XMLTV incremental (não constrói DOM; adequado a guias extensos). */
export class XmltvParser {
  channelCount = 0;
  programmeCount = 0;
  skipped = 0;
  private buffer = '';

  constructor(private readonly window: XmltvWindow = {}) {}

  push(chunk: string): XmltvBatch {
    this.buffer += chunk;
    return this.drain(false);
  }

  end(): XmltvBatch {
    const batch = this.drain(true);
    this.buffer = '';
    return batch;
  }

  /** Há indício de que o conteúdo seja XMLTV. */
  static looksLikeXmltv(sample: string): boolean {
    return /<tv[\s>]/.test(sample) || /<(channel|programme)\s/.test(sample);
  }

  private drain(final: boolean): XmltvBatch {
    const batch: XmltvBatch = { channels: [], programmes: [] };
    const buf = this.buffer;
    let pos = 0;
    for (;;) {
      const c = buf.indexOf('<channel', pos);
      const p = buf.indexOf('<programme', pos);
      let start: number;
      let tag: 'channel' | 'programme';
      if (c === -1 && p === -1) {
        // Mantém apenas o fim do buffer (um nome de tag pode estar dividido entre pedaços).
        pos = Math.max(pos, buf.length - 16);
        break;
      }
      if (p === -1 || (c !== -1 && c < p)) {
        start = c;
        tag = 'channel';
      } else {
        start = p;
        tag = 'programme';
      }
      const openEnd = buf.indexOf('>', start);
      if (openEnd === -1) {
        pos = start;
        break;
      }
      const selfClosing = buf[openEnd - 1] === '/';
      let blockEnd: number;
      if (selfClosing) {
        blockEnd = openEnd + 1;
      } else {
        const closeTag = `</${tag}>`;
        const close = buf.indexOf(closeTag, openEnd);
        if (close === -1) {
          if (buf.length - start > MAX_BLOCK) {
            this.skipped++;
            pos = openEnd + 1;
            continue;
          }
          pos = start;
          break;
        }
        blockEnd = close + closeTag.length;
      }
      const open = buf.slice(start, openEnd + 1);
      const inner = selfClosing ? '' : buf.slice(openEnd + 1, blockEnd);
      if (tag === 'channel') this.readChannel(open, inner, batch);
      else this.readProgramme(open, inner, batch);
      pos = blockEnd;
    }
    this.buffer = final ? '' : buf.slice(pos);
    return batch;
  }

  private readChannel(open: string, inner: string, batch: XmltvBatch) {
    const id = attributes(open)['id'];
    if (!id) {
      this.skipped++;
      return;
    }
    const displayNames: string[] = [];
    const re = /<display-name(?:\s[^>]*)?>([\s\S]*?)<\/display-name>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(inner))) {
      const name = decodeXml(m[1]!);
      if (name) displayNames.push(name);
    }
    const channel: XmltvChannel = { id, displayNames };
    const icon = /<icon\s[^>]*>/.exec(inner);
    const src = icon ? attributes(icon[0])['src'] : undefined;
    if (src) channel.icon = src;
    this.channelCount++;
    batch.channels.push(channel);
  }

  private readProgramme(open: string, inner: string, batch: XmltvBatch) {
    const attrs = attributes(open);
    const channelId = attrs['channel'];
    const start = parseXmltvDate(attrs['start'] ?? '');
    let stop = parseXmltvDate(attrs['stop'] ?? '');
    if (!channelId || Number.isNaN(start)) {
      this.skipped++;
      return;
    }
    if (Number.isNaN(stop) || stop <= start) stop = start + 30 * 60_000;
    if (this.window.from !== undefined && stop < this.window.from) return;
    if (this.window.to !== undefined && start > this.window.to) return;
    const programme: XmltvProgramme = { channelId, start, stop, title: firstChild(inner, 'title') ?? '—' };
    const description = firstChild(inner, 'desc');
    if (description) programme.description = description.slice(0, 1500);
    const category = firstChild(inner, 'category');
    if (category) programme.category = category;
    this.programmeCount++;
    batch.programmes.push(programme);
  }
}

export function parseXmltv(text: string, window: XmltvWindow = {}): XmltvBatch {
  const parser = new XmltvParser(window);
  const a = parser.push(text);
  const b = parser.end();
  return { channels: [...a.channels, ...b.channels], programmes: [...a.programmes, ...b.programmes] };
}

export interface EpgIndex {
  byId: Map<string, string>;
  byName: Map<string, string>;
}

/** Índice para associar canais da lista aos canais do guia. O valor é a chave do canal no guia. */
export function buildEpgIndex(channels: { key: string; channelId: string; displayNames: string[] }[]): EpgIndex {
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const channel of channels) {
    const id = channel.channelId.toLowerCase();
    if (!byId.has(id)) byId.set(id, channel.key);
    for (const name of channel.displayNames) {
      const norm = normalizeText(name);
      if (norm && !byName.has(norm)) byName.set(norm, channel.key);
    }
  }
  return { byId, byName };
}

/** Identificação do canal: tvg-id, depois tvg-name, depois o nome exibido. */
export function resolveEpgChannel(
  item: { tvgId?: string; tvgName?: string; name: string },
  index: EpgIndex,
): string | undefined {
  if (item.tvgId) {
    const hit = index.byId.get(item.tvgId.toLowerCase());
    if (hit) return hit;
  }
  if (item.tvgName) {
    const hit = index.byName.get(normalizeText(item.tvgName));
    if (hit) return hit;
  }
  return index.byName.get(normalizeText(item.name));
}

export interface NowNext {
  current?: Programme;
  next: Programme[];
}

/** Programa atual e próximos, a partir de programas ordenados por início. */
export function nowNext(programmes: Programme[], now: number, upcoming = 3): NowNext {
  const result: NowNext = { next: [] };
  for (const programme of programmes) {
    if (programme.stop <= now) continue;
    if (programme.start <= now) {
      if (!result.current) result.current = programme;
    } else if (result.next.length < upcoming) {
      result.next.push(programme);
    } else {
      break;
    }
  }
  return result;
}

export function programmeProgress(programme: Programme, now: number): number {
  const total = programme.stop - programme.start;
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (now - programme.start) / total));
}

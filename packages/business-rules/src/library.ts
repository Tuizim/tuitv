import type { ContentKind, MediaItem, PlaylistCounts } from '@tuitv/shared-models';
import type { M3uEntry } from '@tuitv/m3u-parser';
import { cleanName, safeImageUrl } from '@tuitv/validation';
import { classifyEntry, extractYear } from './classify';
import { normalizeText, stableHash } from './text';

export const itemId = (playlistId: string, key: string) => `${playlistId}:${key}`;
export const seriesId = (playlistId: string, seriesKey: string) => `${playlistId}:s:${seriesKey}`;

/**
 * Chave estável de um registro. Depende de tvg-id, nome e (sem tvg-id) categoria —
 * nunca do endereço de reprodução, que costuma mudar entre atualizações.
 */
export function entryKey(entry: Pick<M3uEntry, 'name' | 'tvgId' | 'groupTitle'>): string {
  const id = entry.tvgId ?? '';
  const group = id ? '' : normalizeText(entry.groupTitle ?? '');
  return stableHash(`${id}\u0001${normalizeText(entry.name)}\u0001${group}`);
}

/**
 * Converte registros do parser em itens da biblioteca, de forma incremental.
 * Registros repetidos recebem sufixo de ocorrência, mantendo ids determinísticos:
 * reimportar a mesma lista produz exatamente os mesmos ids (atualização sem duplicação).
 */
export class ItemBuilder {
  readonly counts: PlaylistCounts = { live: 0, movie: 0, series: 0 };
  total = 0;
  private seen = new Map<string, number>();

  constructor(private readonly playlistId: string) {}

  add(entries: M3uEntry[]): MediaItem[] {
    const out: MediaItem[] = [];
    for (const entry of entries) {
      const name = cleanName(entry.name, 'Sem nome');
      const base = entryKey({ ...entry, name });
      const occurrence = (this.seen.get(base) ?? 0) + 1;
      this.seen.set(base, occurrence);
      const key = occurrence === 1 ? base : `${base}-${occurrence}`;
      const { kind, episode } = classifyEntry({ ...entry, name });

      const item: MediaItem = {
        id: itemId(this.playlistId, key),
        playlistId: this.playlistId,
        key,
        kind,
        name,
        url: entry.url,
        order: this.total++,
      };
      const logo = safeImageUrl(entry.tvgLogo);
      if (logo) item.logo = logo;
      if (entry.groupTitle) item.group = cleanName(entry.groupTitle);
      if (entry.tvgId) item.tvgId = entry.tvgId;
      if (entry.tvgName) item.tvgName = entry.tvgName;
      if (kind !== 'live') {
        const year = extractYear(name);
        if (year) item.year = year;
        if (entry.duration > 0) item.duration = Math.round(entry.duration);
        const description = entry.attrs['description'] || entry.attrs['plot'];
        if (description) item.description = description.slice(0, 2000);
      }
      if (kind === 'series') {
        const title = episode?.title ?? name;
        item.series = {
          title,
          seriesKey: stableHash(normalizeText(title)),
          season: episode?.season ?? 0,
          episode: episode?.episode ?? 0,
        };
      }
      this.counts[kind]++;
      out.push(item);
    }
    return out;
  }
}

export interface SeriesSeason {
  season: number;
  episodes: MediaItem[];
}

export interface SeriesGroup {
  id: string;
  playlistId: string;
  title: string;
  logo?: string;
  group?: string;
  year?: number;
  seasons: SeriesSeason[];
  episodeCount: number;
}

/** Agrupa episódios em séries → temporadas → episódios ordenados. */
export function groupSeries(items: MediaItem[]): SeriesGroup[] {
  const map = new Map<string, { group: SeriesGroup; seasons: Map<number, MediaItem[]> }>();
  for (const item of items) {
    if (item.kind !== 'series' || !item.series) continue;
    const id = seriesId(item.playlistId, item.series.seriesKey);
    let bucket = map.get(id);
    if (!bucket) {
      const group: SeriesGroup = { id, playlistId: item.playlistId, title: item.series.title, seasons: [], episodeCount: 0 };
      if (item.logo) group.logo = item.logo;
      if (item.group) group.group = item.group;
      if (item.year) group.year = item.year;
      bucket = { group, seasons: new Map() };
      map.set(id, bucket);
    }
    const season = bucket.seasons.get(item.series.season) ?? [];
    season.push(item);
    bucket.seasons.set(item.series.season, season);
    bucket.group.episodeCount++;
  }
  const out: SeriesGroup[] = [];
  for (const { group, seasons } of map.values()) {
    group.seasons = [...seasons.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([season, episodes]) => ({
        season,
        episodes: episodes.sort((a, b) => a.series!.episode - b.series!.episode || a.order - b.order),
      }));
    out.push(group);
  }
  return out;
}

/** Próximo episódio na ordem da série, se existir. */
export function nextEpisode(series: SeriesGroup, currentItemId: string): MediaItem | undefined {
  const flat = series.seasons.flatMap((s) => s.episodes);
  const index = flat.findIndex((e) => e.id === currentItemId);
  return index >= 0 ? flat[index + 1] : undefined;
}

export interface GroupCount {
  name: string;
  count: number;
}

/** Categorias na ordem em que aparecem, com contagem. */
export function listGroups(items: { group?: string }[]): GroupCount[] {
  const map = new Map<string, number>();
  for (const item of items) {
    if (!item.group) continue;
    map.set(item.group, (map.get(item.group) ?? 0) + 1);
  }
  return [...map.entries()].map(([name, count]) => ({ name, count }));
}

export interface Searchable<T> {
  norm: string;
  value: T;
}

export function toSearchable<T>(values: T[], text: (value: T) => string): Searchable<T>[] {
  return values.map((value) => ({ norm: normalizeText(text(value)), value }));
}

/**
 * Busca local por termos (todas as palavras precisam aparecer).
 * Ordena: começa com o termo → palavra começa com o termo → contém.
 */
export function searchIn<T>(index: Searchable<T>[], query: string, limit = 50): T[] {
  const q = normalizeText(query);
  if (!q) return [];
  const terms = q.split(' ');
  const ranked: T[][] = [[], [], []];
  let found = 0;
  for (const entry of index) {
    const norm = entry.norm;
    let ok = true;
    for (const term of terms) {
      if (!norm.includes(term)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const rank = norm.startsWith(q) ? 0 : norm.includes(` ${terms[0]}`) || norm.startsWith(terms[0]!) ? 1 : 2;
    const bucket = ranked[rank]!;
    if (bucket.length < limit) {
      bucket.push(entry.value);
      found++;
    }
    if (ranked[0]!.length >= limit) break;
    if (found >= limit * 3) break;
  }
  return [...ranked[0]!, ...ranked[1]!, ...ranked[2]!].slice(0, limit);
}

export function countByKind(items: { kind: ContentKind }[]): PlaylistCounts {
  const counts: PlaylistCounts = { live: 0, movie: 0, series: 0 };
  for (const item of items) counts[item.kind]++;
  return counts;
}

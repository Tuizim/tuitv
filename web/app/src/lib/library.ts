import {
  createRestriction,
  groupSeries,
  listGroups,
  toSearchable,
  type GroupCount,
  type Searchable,
  type SeriesGroup,
} from '@tuitv/business-rules';
import type { MediaItem, ParentalSettings } from '@tuitv/shared-models';

/** Visão em memória da biblioteca (listas ativas, já com o controle parental aplicado). */
export interface Library {
  byId: Map<string, MediaItem>;
  live: MediaItem[];
  movies: MediaItem[];
  series: SeriesGroup[];
  seriesById: Map<string, SeriesGroup>;
  liveGroups: GroupCount[];
  movieGroups: GroupCount[];
  seriesGroups: GroupCount[];
  search: {
    live: Searchable<MediaItem>[];
    movies: Searchable<MediaItem>[];
    series: Searchable<SeriesGroup>[];
  };
  /** Todas as categorias existentes (inclusive bloqueadas), para a tela de controle parental. */
  allGroups: string[];
  hiddenCount: number;
}

/** Conteúdo de logins consultados sob demanda (ver xtream.ts): só o que já foi carregado nesta sessão. */
export interface RemoteView {
  /** Canais e filmes já carregados. */
  items: MediaItem[];
  /** Séries conhecidas (com ou sem episódios carregados). */
  series: SeriesGroup[];
  /** Categorias do servidor, na ordem do servidor — inclusive as ainda não carregadas. */
  groups: { live: string[]; movie: string[]; series: string[] };
}

export const EMPTY_REMOTE: RemoteView = { items: [], series: [], groups: { live: [], movie: [], series: [] } };

export const EMPTY_LIBRARY: Library = buildLibrary([], { enabled: false, hideAdult: true, lockedGroups: [] }, true);

/** Categorias do servidor primeiro (na ordem dele), depois as das listas locais; contagem do que está carregado. */
function mergeGroups(local: GroupCount[], remote: string[], blocked: ((g: { group?: string; name: string }) => boolean) | null): GroupCount[] {
  if (!remote.length) return local;
  const counts = new Map(local.map((g) => [g.name, g.count]));
  const out: GroupCount[] = [];
  const seen = new Set<string>();
  for (const name of remote) {
    if (seen.has(name) || blocked?.({ group: name, name: '' })) continue;
    seen.add(name);
    out.push({ name, count: counts.get(name) ?? 0 });
  }
  for (const g of local) if (!seen.has(g.name)) out.push(g);
  return out;
}

export function buildLibrary(items: MediaItem[], parental: ParentalSettings, unlocked: boolean, remote: RemoteView = EMPTY_REMOTE): Library {
  const blocked = createRestriction(parental, unlocked);
  const byId = new Map<string, MediaItem>();
  const live: MediaItem[] = [];
  const movies: MediaItem[] = [];
  const episodes: MediaItem[] = [];
  const groups = new Set<string>();
  let hiddenCount = 0;
  const all = remote.items.length ? items.concat(remote.items) : items;
  for (const item of all) {
    if (item.group) groups.add(item.group);
    if (blocked?.(item)) {
      hiddenCount++;
      continue;
    }
    byId.set(item.id, item);
    if (item.kind === 'live') live.push(item);
    else if (item.kind === 'movie') movies.push(item);
    else episodes.push(item);
  }
  const series = groupSeries(episodes);
  for (const s of remote.series) {
    if (s.group) groups.add(s.group);
    if (blocked?.({ group: s.group, name: s.title })) {
      hiddenCount++;
      continue;
    }
    series.push(s);
    for (const season of s.seasons) for (const episode of season.episodes) byId.set(episode.id, episode);
  }
  for (const name of [...remote.groups.live, ...remote.groups.movie, ...remote.groups.series]) groups.add(name);
  return {
    byId,
    live,
    movies,
    series,
    seriesById: new Map(series.map((s) => [s.id, s])),
    liveGroups: mergeGroups(listGroups(live), remote.groups.live, blocked),
    movieGroups: mergeGroups(listGroups(movies), remote.groups.movie, blocked),
    seriesGroups: mergeGroups(listGroups(series), remote.groups.series, blocked),
    search: {
      live: toSearchable(live, (i) => i.name),
      movies: toSearchable(movies, (i) => i.name),
      series: toSearchable(series, (s) => s.title),
    },
    allGroups: [...groups].sort((a, b) => a.localeCompare(b)),
    hiddenCount,
  };
}

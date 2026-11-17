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

export const EMPTY_LIBRARY: Library = buildLibrary([], { enabled: false, hideAdult: true, lockedGroups: [] }, true);

export function buildLibrary(items: MediaItem[], parental: ParentalSettings, unlocked: boolean): Library {
  const blocked = createRestriction(parental, unlocked);
  const byId = new Map<string, MediaItem>();
  const live: MediaItem[] = [];
  const movies: MediaItem[] = [];
  const episodes: MediaItem[] = [];
  const groups = new Set<string>();
  let hiddenCount = 0;
  for (const item of items) {
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
  return {
    byId,
    live,
    movies,
    series,
    seriesById: new Map(series.map((s) => [s.id, s])),
    liveGroups: listGroups(live),
    movieGroups: listGroups(movies),
    seriesGroups: listGroups(series),
    search: {
      live: toSearchable(live, (i) => i.name),
      movies: toSearchable(movies, (i) => i.name),
      series: toSearchable(series, (s) => s.title),
    },
    allGroups: [...groups].sort((a, b) => a.localeCompare(b)),
    hiddenCount,
  };
}

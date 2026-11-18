import type { HistoryEntry, MediaItem } from '@tuitv/shared-models';
import type { SeriesGroup } from './library';

/**
 * Histórico e "continuar assistindo" de séries no estilo Netflix: a série aparece uma única vez e
 * continuar leva sempre ao episódio mais adiante que o usuário já assistiu.
 * Mesmas regras em Kotlin: android/core/.../History.kt.
 */

/** Uma linha do histórico: um canal, um filme ou uma série inteira (com todos os episódios vistos). */
export interface HistoryRow<T extends HistoryEntry = HistoryEntry> {
  /** Entrada que representa a linha. Na série, o episódio mais adiante já assistido. */
  entry: T;
  /** Série: todas as entradas dela, da mais recente para a mais antiga. */
  episodes?: T[];
}

type Progress = Pick<HistoryEntry, 'season' | 'episode' | 'playedAt'>;

const numbered = (e: Progress) => (e.season ?? 0) > 0 || (e.episode ?? 0) > 0;

/** `a` está mais adiante na série que `b`? Pela temporada e episódio; sem números, o assistido por último. */
export function isFurtherEpisode(a: Progress, b: Progress): boolean {
  if (numbered(a) && numbered(b)) {
    const season = (a.season ?? 0) - (b.season ?? 0);
    if (season !== 0) return season > 0;
    const episode = (a.episode ?? 0) - (b.episode ?? 0);
    if (episode !== 0) return episode > 0;
  }
  return a.playedAt > b.playedAt;
}

/**
 * Junta os episódios de cada série numa única linha, na posição do episódio visto por último.
 * `entries` vem do mais recente para o mais antigo (ordem do histórico).
 */
export function collapseSeriesHistory<T extends HistoryEntry>(entries: readonly T[]): HistoryRow<T>[] {
  const rows: HistoryRow<T>[] = [];
  const bySeries = new Map<string, HistoryRow<T>>();
  for (const entry of entries) {
    const sid = entry.kind === 'series' ? entry.seriesId : undefined;
    if (!sid) {
      rows.push({ entry });
      continue;
    }
    const row = bySeries.get(sid);
    if (!row) {
      const created: HistoryRow<T> = { entry, episodes: [entry] };
      bySeries.set(sid, created);
      rows.push(created);
      continue;
    }
    row.episodes!.push(entry);
    if (isFurtherEpisode(entry, row.entry)) row.entry = entry;
  }
  return rows;
}

export interface ContinueTarget {
  episode: MediaItem;
  /** Retomar da posição salva (episódio iniciado e não concluído). */
  resume: boolean;
}

/**
 * Episódio para continuar a série: o mais adiante (na ordem da série) que já foi assistido;
 * se ele foi concluído, o seguinte. Sem nada assistido, ou com a série toda vista, o primeiro.
 */
export function continueEpisode(
  series: SeriesGroup,
  progress: (itemId: string) => Pick<HistoryEntry, 'position' | 'completed'> | undefined,
): ContinueTarget | undefined {
  const flat = series.seasons.flatMap((s) => s.episodes);
  if (flat.length === 0) return undefined;
  for (let i = flat.length - 1; i >= 0; i--) {
    const episode = flat[i]!;
    const entry = progress(episode.id);
    if (!entry) continue;
    if (!entry.completed) return { episode, resume: entry.position > 0 };
    const next = flat[i + 1];
    return next ? { episode: next, resume: false } : { episode: flat[0]!, resume: false };
  }
  return { episode: flat[0]!, resume: false };
}

/**
 * Fileira "Continuar assistindo" (estilo Netflix): uma linha por série, representada pelo episódio mais
 * adiante já assistido. Entram filmes e séries iniciados e não concluídos, séries em andamento (algum episódio
 * concluído) e, se o episódio mais adiante já terminou, a série com um próximo episódio. Canais ficam de fora.
 */
export function continueWatching<T extends HistoryEntry>(
  entries: readonly T[],
  { minPosition, hasNextEpisode }: { minPosition: number; hasNextEpisode?: (entry: T) => boolean },
): HistoryRow<T>[] {
  return collapseSeriesHistory(entries).filter(({ entry, episodes }) => {
    if (entry.kind === 'live') return false;
    if (!entry.completed) {
      if (entry.position > minPosition && entry.duration > 0) return true;
      // Série já em andamento (algum episódio concluído), mesmo que o seguinte mal tenha começado.
      return !!episodes?.some((e) => e.completed);
    }
    return !!episodes && (hasNextEpisode?.(entry) ?? false);
  });
}

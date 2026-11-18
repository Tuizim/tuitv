import { describe, expect, it } from 'vitest';
import type { HistoryEntry, MediaItem } from '@tuitv/shared-models';
import { collapseSeriesHistory, continueEpisode, groupSeries } from './index';

const episode = (season: number, ep: number): MediaItem => ({
  id: `p:e${season}x${ep}`,
  playlistId: 'p',
  key: `e${season}x${ep}`,
  kind: 'series',
  name: `Ep ${season}x${ep}`,
  url: `http://x/${season}/${ep}`,
  series: { title: 'Série', seriesKey: 'serie', season, episode: ep },
  order: season * 100 + ep,
});

const entry = (itemId: string, playedAt: number, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  itemId,
  playlistId: 'p',
  kind: 'movie',
  name: itemId,
  playedAt,
  position: 0,
  duration: 0,
  completed: false,
  ...extra,
});

const ep = (season: number, n: number, playedAt: number, extra: Partial<HistoryEntry> = {}) =>
  entry(`p:e${season}x${n}`, playedAt, { kind: 'series', seriesId: 'p:s:serie', season, episode: n, ...extra });

describe('histórico de séries', () => {
  it('mostra a série uma vez, no lugar do episódio visto por último, representada pelo mais adiante', () => {
    const history = [ep(1, 2, 90), entry('p:filme', 80), ep(2, 1, 70), entry('p:canal', 60, { kind: 'live' }), ep(1, 1, 50)];
    const rows = collapseSeriesHistory(history);
    expect(rows.map((r) => r.entry.itemId)).toEqual(['p:e2x1', 'p:filme', 'p:canal']);
    expect(rows[0]!.episodes!.map((e) => e.itemId)).toEqual(['p:e1x2', 'p:e2x1', 'p:e1x1']);
  });

  it('sem temporada/episódio conhecidos, vale o visto por último', () => {
    const rows = collapseSeriesHistory([ep(0, 0, 90, { itemId: 'p:a' }), ep(0, 0, 50, { itemId: 'p:b' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entry.itemId).toBe('p:a');
  });

  it('séries diferentes ficam em linhas diferentes', () => {
    const rows = collapseSeriesHistory([ep(1, 1, 90), ep(1, 1, 80, { itemId: 'p:outra', seriesId: 'p:s:outra' })]);
    expect(rows).toHaveLength(2);
  });
});

describe('continuar série', () => {
  const series = groupSeries([episode(1, 1), episode(1, 2), episode(2, 1), episode(2, 2)])[0]!;
  const progress = (map: Record<string, Partial<HistoryEntry>>) => (id: string) =>
    map[id] ? { position: 0, completed: false, ...map[id] } : undefined;

  it('retoma o episódio mais adiante iniciado, mesmo que outro tenha sido visto depois', () => {
    const target = continueEpisode(series, progress({ 'p:e2x1': { position: 300 }, 'p:e1x1': { completed: true } }));
    expect(target).toEqual({ episode: expect.objectContaining({ id: 'p:e2x1' }), resume: true });
  });

  it('episódio mais adiante concluído: segue para o próximo, inclusive na outra temporada', () => {
    const target = continueEpisode(series, progress({ 'p:e1x2': { completed: true } }));
    expect(target).toEqual({ episode: expect.objectContaining({ id: 'p:e2x1' }), resume: false });
  });

  it('nada assistido ou série inteira vista: começa do primeiro', () => {
    expect(continueEpisode(series, progress({}))?.episode.id).toBe('p:e1x1');
    expect(continueEpisode(series, progress({ 'p:e2x2': { completed: true } }))?.episode.id).toBe('p:e1x1');
  });
});

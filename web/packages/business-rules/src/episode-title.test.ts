import { describe, expect, it } from 'vitest';
import type { MediaItem } from '@tuitv/shared-models';
import { episodeTitle, hasEpisodeDetails } from './index';

/** Mesmos casos de android/core/src/test/kotlin/tv/tui/core/RulesTest.kt (título do episódio). */
describe('título do episódio', () => {
  it.each([
    ['A Série S02 E01 - O Retorno', 'A Série', 'O Retorno'],
    ['A Série S01E01', 'A Série', null],
    ['A Série - S01E02 - Piloto', 'A Série', 'Piloto'],
    ['Risadas 1x05: A Festa', 'Risadas', 'A Festa'],
    ['T1 E2', 'Qualquer', null],
    ['O Começo', 'Outra Série', 'O Começo'],
    ['Outra Série - O Começo', 'Outra Série', 'O Começo'],
  ])('%s → %s', (name, series, expected) => {
    expect(episodeTitle(name, series)).toBe(expected);
  });
});

describe('dados próprios dos episódios', () => {
  const ep = (extra: Partial<MediaItem>): MediaItem => ({ id: 'p:e', playlistId: 'p', key: 'e', kind: 'series', name: 'E', url: 'http://x', order: 0, ...extra });
  it('miniatura diferente da capa ou sinopse: cartões; só a capa repetida: grade', () => {
    expect(hasEpisodeDetails([ep({ logo: 'capa.jpg' }), ep({})], 'capa.jpg')).toBe(false);
    expect(hasEpisodeDetails([ep({ logo: 'capa.jpg' }), ep({ logo: 'ep2.jpg' })], 'capa.jpg')).toBe(true);
    expect(hasEpisodeDetails([ep({ description: '  ' }), ep({ description: 'Sinopse' })], undefined)).toBe(true);
    expect(hasEpisodeDetails([ep({ description: '  ' })], undefined)).toBe(false);
  });
});

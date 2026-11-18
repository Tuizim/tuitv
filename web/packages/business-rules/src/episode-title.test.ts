import { describe, expect, it } from 'vitest';
import { episodeTitle } from './index';

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

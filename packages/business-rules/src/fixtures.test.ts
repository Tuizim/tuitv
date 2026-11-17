import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseM3u } from '@tuitv/m3u-parser';
import { ItemBuilder } from './library';

/**
 * Arquivos de referência compartilhados entre plataformas (PRD RF-004).
 * O resultado canônico em fixtures/expected/*.json é conferido aqui (TypeScript)
 * e em packages/android-core (Kotlin). Para regenerar: `pnpm fixtures:update`.
 */
const dir = fileURLToPath(new URL('../../m3u-parser/fixtures/', import.meta.url));
const expectedDir = `${dir}expected/`;

function canonical(text: string) {
  const { header, entries, errors } = parseM3u(text);
  const items = new ItemBuilder('p').add(entries).map((item) => ({
    key: item.key,
    kind: item.kind,
    name: item.name,
    url: item.url,
    logo: item.logo ?? null,
    group: item.group ?? null,
    tvgId: item.tvgId ?? null,
    seriesTitle: item.series?.title ?? null,
    seriesKey: item.series?.seriesKey ?? null,
    season: item.series?.season ?? null,
    episode: item.series?.episode ?? null,
    year: item.year ?? null,
    duration: item.duration ?? null,
  }));
  return {
    headerFound: header.found,
    headerAttrs: header.attrs,
    errors: errors.map((e) => ({ line: e.line, code: e.code })),
    items,
  };
}

describe('arquivos de referência', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.m3u'));
  it('existem', () => expect(files.length).toBeGreaterThanOrEqual(4));

  for (const file of files) {
    it(file, () => {
      const result = canonical(readFileSync(dir + file, 'utf8'));
      const expectedPath = `${expectedDir}${file.replace(/\.m3u$/, '.json')}`;
      if (process.env.UPDATE_FIXTURES) {
        if (!existsSync(expectedDir)) mkdirSync(expectedDir);
        writeFileSync(expectedPath, `${JSON.stringify(result, null, 2)}\n`);
      }
      expect(result).toEqual(JSON.parse(readFileSync(expectedPath, 'utf8')));
    });
  }
});

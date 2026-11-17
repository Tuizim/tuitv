import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseM3u } from '@tuitv/m3u-parser';
import { DEFAULT_SETTINGS, type BackupData } from '@tuitv/shared-models';
import { validateBackupEnvelope } from '@tuitv/validation';
import { ItemBuilder, createBackup, openBackup } from './index';

/**
 * Backup cifrado de referência: gerado pela Web e restaurado também pelo teste Kotlin
 * (packages/kotlin-core), garantindo o mesmo formato entre plataformas.
 */
const fixtures = fileURLToPath(new URL('../../m3u-parser/fixtures/', import.meta.url));
const path = `${fixtures}backup/web-encrypted.json`;
const PASSWORD = 'tuitv-fixture';

describe('backup de referência entre plataformas', () => {
  it('é restaurável', async () => {
    if (process.env.UPDATE_FIXTURES || !existsSync(path)) {
      const items = new ItemBuilder('ref').add(parseM3u(readFileSync(`${fixtures}basic.m3u`, 'utf8')).entries);
      const data: BackupData = {
        playlists: [
          {
            playlist: { id: 'ref', name: 'Referência', source: 'file', fileName: 'basic.m3u', active: true, createdAt: 1, updatedAt: 1, itemCount: items.length, counts: { live: 6, movie: 0, series: 0 } },
            items,
          },
        ],
        favorites: [{ id: items[0]!.id, kind: 'live', playlistId: 'ref', addedAt: 1 }],
        history: [],
        epgSources: [],
        settings: DEFAULT_SETTINGS,
      };
      if (!existsSync(`${fixtures}backup`)) mkdirSync(`${fixtures}backup`);
      writeFileSync(path, await createBackup(data, { platform: 'web', password: PASSWORD, now: 1 }));
    }
    const { ok, envelope } = validateBackupEnvelope(readFileSync(path, 'utf8'));
    expect(ok).toBe(true);
    const restored = await openBackup(envelope!, PASSWORD);
    expect(restored.playlists[0]!.playlist.name).toBe('Referência');
    expect(restored.playlists[0]!.items).toHaveLength(6);
  });
});

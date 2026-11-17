/**
 * Banco local do TuiTV Web (IndexedDB) — PRD §8.
 * Todos os dados do usuário ficam neste navegador; nada é enviado a servidores.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { EpgChannel, EpgSource, Favorite, HistoryEntry, MediaItem, Playlist, Programme, Settings } from '@tuitv/shared-models';

export interface Sealed {
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}
type Secret = Sealed | string;

type StoredPlaylist = Omit<Playlist, 'url'> & { urlSecret?: Secret };
type StoredEpgSource = Omit<EpgSource, 'url'> & { urlSecret?: Secret };

interface TuiDB extends DBSchema {
  playlists: { key: string; value: StoredPlaylist };
  items: { key: string; value: MediaItem };
  favorites: { key: string; value: Favorite };
  history: { key: string; value: HistoryEntry };
  epgSources: { key: string; value: StoredEpgSource };
  epgChannels: { key: string; value: EpgChannel };
  programmes: { key: [string, string, number]; value: Programme };
  kv: { key: string; value: unknown };
}

const DB_NAME = 'tuitv';
const DB_VERSION = 1;
const STORES = ['playlists', 'items', 'favorites', 'history', 'epgSources', 'epgChannels', 'programmes', 'kv'] as const;

let dbPromise: Promise<IDBPDatabase<TuiDB>> | null = null;

export function db(): Promise<IDBPDatabase<TuiDB>> {
  dbPromise ??= openDB<TuiDB>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      database.createObjectStore('playlists', { keyPath: 'id' });
      database.createObjectStore('items', { keyPath: 'id' });
      database.createObjectStore('favorites', { keyPath: 'id' });
      database.createObjectStore('history', { keyPath: 'itemId' });
      database.createObjectStore('epgSources', { keyPath: 'id' });
      database.createObjectStore('epgChannels', { keyPath: 'id' });
      database.createObjectStore('programmes', { keyPath: ['sourceId', 'channelId', 'start'] });
      database.createObjectStore('kv');
    },
    terminated() {
      dbPromise = null;
    },
  });
  return dbPromise;
}

const prefixRange = (prefix: string) => IDBKeyRange.bound(prefix, `${prefix}￿`);

/* ── Proteção de credenciais locais (PRD §10) ─────────────────────────────
 * Os endereços das listas costumam carregar usuário, senha ou token. Eles são
 * cifrados com AES-GCM usando uma chave NÃO extraível guardada no próprio
 * IndexedDB: o valor em disco não é legível e a chave não pode ser exportada
 * por scripts. Em contexto inseguro (http), o WebCrypto não existe e o endereço
 * é guardado sem cifra.
 */
let keyPromise: Promise<CryptoKey | null> | null = null;

function secretKey(): Promise<CryptoKey | null> {
  keyPromise ??= (async () => {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    const database = await db();
    const existing = (await database.get('kv', 'secretKey')) as CryptoKey | undefined;
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await database.put('kv', key, 'secretKey');
    return key;
  })();
  return keyPromise;
}

async function seal(text: string | undefined): Promise<Secret | undefined> {
  if (!text) return undefined;
  const key = await secretKey();
  if (!key) return text;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return { iv, data };
}

async function unseal(secret: Secret | undefined): Promise<string | undefined> {
  if (!secret) return undefined;
  if (typeof secret === 'string') return secret;
  const key = await secretKey();
  if (!key) return undefined;
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: secret.iv }, key, secret.data));
  } catch {
    return undefined;
  }
}

/* ── Leitura inicial ───────────────────────────────────────────────────── */

export interface PersistedState {
  playlists: Playlist[];
  favorites: Favorite[];
  history: HistoryEntry[];
  epgSources: EpgSource[];
  epgChannels: EpgChannel[];
  settings: Partial<Settings> | undefined;
  unavailable: string[];
  hadData: boolean;
}

export async function loadState(): Promise<PersistedState> {
  const database = await db();
  const [storedPlaylists, favorites, history, storedSources, epgChannels, settings, unavailable, hadData] = await Promise.all([
    database.getAll('playlists'),
    database.getAll('favorites'),
    database.getAll('history'),
    database.getAll('epgSources'),
    database.getAll('epgChannels'),
    database.get('kv', 'settings') as Promise<Partial<Settings> | undefined>,
    database.get('kv', 'unavailable') as Promise<string[] | undefined>,
    database.get('kv', 'hadData') as Promise<boolean | undefined>,
  ]);
  const playlists = await Promise.all(
    storedPlaylists.map(async ({ urlSecret, ...rest }) => ({ ...rest, url: await unseal(urlSecret) }) as Playlist),
  );
  const epgSources = await Promise.all(
    storedSources.map(async ({ urlSecret, ...rest }) => ({ ...rest, url: await unseal(urlSecret) }) as EpgSource),
  );
  playlists.sort((a, b) => a.createdAt - b.createdAt);
  history.sort((a, b) => b.playedAt - a.playedAt);
  return { playlists, favorites, history, epgSources, epgChannels, settings, unavailable: unavailable ?? [], hadData: !!hadData };
}

export async function loadItems(playlistIds: string[]): Promise<MediaItem[]> {
  const database = await db();
  const chunks = await Promise.all(playlistIds.map((id) => database.getAll('items', prefixRange(`${id}:`))));
  const out: MediaItem[] = [];
  for (const chunk of chunks) {
    chunk.sort((a, b) => a.order - b.order);
    for (const item of chunk) out.push(item);
  }
  return out;
}

/* ── Listas e itens ────────────────────────────────────────────────────── */

export async function putPlaylist(playlist: Playlist): Promise<void> {
  const { url, ...rest } = playlist;
  const stored: StoredPlaylist = { ...rest, urlSecret: await seal(url) };
  const database = await db();
  await database.put('playlists', stored);
  await database.put('kv', true, 'hadData');
}

export async function putItems(items: MediaItem[]): Promise<void> {
  if (!items.length) return;
  const tx = (await db()).transaction('items', 'readwrite');
  for (const item of items) void tx.store.put(item);
  await tx.done;
}

/** Remove da lista os itens que não constam mais após uma atualização. */
export async function pruneItems(playlistId: string, keep: Set<string>): Promise<number> {
  const tx = (await db()).transaction('items', 'readwrite');
  const keys = await tx.store.getAllKeys(prefixRange(`${playlistId}:`));
  let removed = 0;
  for (const key of keys) {
    if (!keep.has(key)) {
      void tx.store.delete(key);
      removed++;
    }
  }
  await tx.done;
  return removed;
}

export async function deletePlaylistItems(playlistId: string): Promise<void> {
  await (await db()).delete('items', prefixRange(`${playlistId}:`));
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  const database = await db();
  await database.delete('items', prefixRange(`${playlistId}:`));
  await database.delete('playlists', playlistId);
  const tx = database.transaction(['favorites', 'history'], 'readwrite');
  for (const fav of await tx.objectStore('favorites').getAll()) {
    if (fav.playlistId === playlistId) void tx.objectStore('favorites').delete(fav.id);
  }
  for (const entry of await tx.objectStore('history').getAll()) {
    if (entry.playlistId === playlistId) void tx.objectStore('history').delete(entry.itemId);
  }
  await tx.done;
}

/* ── Favoritos, histórico e preferências ───────────────────────────────── */

export const putFavorite = async (favorite: Favorite) => void (await (await db()).put('favorites', favorite));
export const deleteFavorite = async (id: string) => (await db()).delete('favorites', id);
export const putHistory = async (entry: HistoryEntry) => void (await (await db()).put('history', entry));
export const deleteHistory = async (itemId: string) => (await db()).delete('history', itemId);
export const clearHistory = async () => (await db()).clear('history');
export const kvSet = async (key: string, value: unknown) => void (await (await db()).put('kv', value, key));
export const kvGet = async <T>(key: string) => (await (await db()).get('kv', key)) as T | undefined;

/* ── EPG ───────────────────────────────────────────────────────────────── */

export async function putEpgSource(source: EpgSource): Promise<void> {
  const { url, ...rest } = source;
  await (await db()).put('epgSources', { ...rest, urlSecret: await seal(url) });
}

export async function deleteEpgData(sourceId: string, keepSource = false): Promise<void> {
  const database = await db();
  await database.delete('programmes', IDBKeyRange.bound([sourceId], [sourceId, []]));
  await database.delete('epgChannels', prefixRange(`${sourceId}|`));
  if (!keepSource) await database.delete('epgSources', sourceId);
}

export async function putEpgBatch(channels: EpgChannel[], programmes: Programme[]): Promise<void> {
  const tx = (await db()).transaction(['epgChannels', 'programmes'], 'readwrite');
  for (const channel of channels) void tx.objectStore('epgChannels').put(channel);
  for (const programme of programmes) void tx.objectStore('programmes').put(programme);
  await tx.done;
}

/** Programas de um canal que intersectam [from, to], ordenados por início. */
export async function getProgrammes(sourceId: string, channelId: string, from: number, to: number): Promise<Programme[]> {
  const lookBehind = 8 * 3_600_000;
  const range = IDBKeyRange.bound([sourceId, channelId, from - lookBehind], [sourceId, channelId, to]);
  const rows = await (await db()).getAll('programmes', range);
  return rows.filter((p) => p.stop > from);
}

/** Remove programas já encerrados (manutenção de armazenamento). */
export async function pruneOldProgrammes(before: number): Promise<number> {
  const tx = (await db()).transaction('programmes', 'readwrite');
  let removed = 0;
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (cursor.value.stop < before) {
      void cursor.delete();
      removed++;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return removed;
}

/* ── Manutenção ────────────────────────────────────────────────────────── */

export async function storeCounts(): Promise<Record<(typeof STORES)[number], number>> {
  const database = await db();
  const counts = await Promise.all(STORES.map((s) => database.count(s)));
  return Object.fromEntries(STORES.map((s, i) => [s, counts[i]])) as Record<(typeof STORES)[number], number>;
}

/** Exclui todos os dados locais do TuiTV neste navegador (PRD RF-015). */
export async function wipeAll(): Promise<void> {
  const database = await db();
  const tx = database.transaction([...STORES], 'readwrite');
  for (const store of STORES) void tx.objectStore(store).clear();
  await tx.done;
  keyPromise = null;
}

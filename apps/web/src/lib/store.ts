'use client';

import { create } from 'zustand';
import {
  backupHasCredentials,
  buildEpgIndex,
  createBackup,
  hashPin,
  openBackup,
  seriesId as makeSeriesId,
  verifyPin,
  type EpgIndex,
} from '@tuitv/business-rules';
import {
  DEFAULT_SETTINGS,
  type BackupData,
  type BackupEnvelope,
  type ContentKind,
  type EpgChannel,
  type EpgSource,
  type Favorite,
  type HistoryEntry,
  type MediaItem,
  type Playlist,
  type Settings,
} from '@tuitv/shared-models';
import { MAX_EPG_BYTES, MAX_PLAYLIST_BYTES, cleanName } from '@tuitv/validation';
import * as local from './db';
import { importEpg, importPlaylistItems } from './importer';
import { EMPTY_LIBRARY, buildLibrary, type Library } from './library';
import { ImportError, checkedUrl, fetchSource, fileSource, uid, type ByteSource } from './net';

export interface Job {
  id: string;
  kind: 'playlist' | 'epg';
  name: string;
  status: 'running' | 'done' | 'error';
  loaded: number;
  total?: number;
  count: number;
  error?: ImportError;
  finishedAt?: number;
}

export interface Toast {
  id: string;
  tone: 'info' | 'success' | 'error';
  text: string;
}

interface State {
  ready: boolean;
  /** Existiam dados, mas o armazenamento do navegador foi limpo. */
  dataLost: boolean;
  playlists: Playlist[];
  items: MediaItem[];
  lib: Library;
  favorites: Map<string, Favorite>;
  history: HistoryEntry[];
  historyById: Map<string, HistoryEntry>;
  settings: Settings;
  epgSources: EpgSource[];
  epgChannels: Map<string, EpgChannel>;
  epgIndex: EpgIndex;
  epgVersion: number;
  unavailable: Set<string>;
  parentalUnlocked: boolean;
  jobs: Job[];
  toasts: Toast[];
}

interface Actions {
  init(): Promise<void>;
  toast(text: string, tone?: Toast['tone']): void;
  dismissToast(id: string): void;
  dismissJob(id: string): void;

  importPlaylist(input: { name: string; url?: string; file?: File }): Promise<Playlist>;
  refreshPlaylist(id: string, file?: File): Promise<void>;
  renamePlaylist(id: string, name: string): Promise<void>;
  setPlaylistActive(id: string, active: boolean): Promise<void>;
  deletePlaylist(id: string): Promise<void>;

  toggleFavorite(id: string, kind: ContentKind, playlistId: string): void;
  recordPlayback(item: MediaItem, position: number, duration: number): void;
  setWatched(item: MediaItem, watched: boolean): void;
  removeHistory(itemId: string): void;
  clearHistory(): void;
  markUnavailable(itemId: string, unavailable: boolean): void;

  updateSettings(patch: Partial<Settings>): void;
  resetSettings(): void;
  setPin(pin: string): Promise<void>;
  disableParental(): void;
  unlock(pin: string): Promise<boolean>;
  lock(): void;

  addEpg(input: { name: string; url?: string; file?: File }): Promise<void>;
  refreshEpg(id: string, file?: File): Promise<void>;
  deleteEpg(id: string): Promise<void>;

  collectBackup(): Promise<BackupData>;
  exportBackup(password?: string): Promise<{ text: string; hasCredentials: boolean }>;
  restoreBackup(envelope: BackupEnvelope, password?: string): Promise<{ playlists: number; pendingRefresh: number }>;

  /** Atualiza em segundo plano as listas e guias remotos vencidos (PRD: atualização de listas). */
  autoRefresh(): Promise<void>;
  clearCaches(): Promise<void>;
  deleteAllData(): Promise<void>;
}

const emptyIndex: EpgIndex = { byId: new Map(), byName: new Map() };

function indexEpg(channels: Iterable<EpgChannel>): { map: Map<string, EpgChannel>; index: EpgIndex } {
  const map = new Map<string, EpgChannel>();
  for (const channel of channels) map.set(channel.id, channel);
  return { map, index: buildEpgIndex([...map.values()].map((c) => ({ key: c.id, channelId: c.channelId, displayNames: c.displayNames }))) };
}

const mergeSettings = (stored: Partial<Settings> | undefined): Settings => ({
  ...DEFAULT_SETTINGS,
  ...stored,
  parental: { ...DEFAULT_SETTINGS.parental, ...stored?.parental },
});

const LOST_FLAG = 'tuitv-has-data';
const THEME_FLAG = 'tuitv-theme';

function flag(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* armazenamento indisponível */
  }
}

function applyTheme(settings: Settings) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.lang = settings.language;
  flag(THEME_FLAG, settings.theme);
}

let initPromise: Promise<void> | null = null;
let autoRefreshing = false;
const autoAttempts = new Map<string, number>();
/** Evita repetir a cada verificação uma atualização automática que acabou de falhar. */
function recentlyTried(id: string): boolean {
  const last = autoAttempts.get(id) ?? 0;
  if (Date.now() - last < 3_600_000) return true;
  autoAttempts.set(id, Date.now());
  return false;
}

export const useStore = create<State & Actions>((set, get) => {
  const relib = (items: MediaItem[], settings = get().settings, unlocked = get().parentalUnlocked) =>
    buildLibrary(items, settings.parental, unlocked);

  const job = (id: string, patch: Partial<Job>) =>
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));

  const startJob = (kind: Job['kind'], name: string): string => {
    const id = uid();
    set((s) => ({ jobs: [...s.jobs.filter((j) => j.status === 'running'), { id, kind, name, status: 'running', loaded: 0, count: 0 }] }));
    return id;
  };

  const openSource = async (url: string | undefined, file: File | undefined, maxBytes: number): Promise<ByteSource> => {
    if (file) return fileSource(file, maxBytes);
    const settings = get().settings;
    return fetchSource(checkedUrl(url ?? '', settings.allowPrivateHosts), settings.connectionTimeout, maxBytes);
  };

  const saveHistory = (entry: HistoryEntry) => {
    set((s) => {
      const historyById = new Map(s.historyById);
      historyById.set(entry.itemId, entry);
      const history = [entry, ...s.history.filter((h) => h.itemId !== entry.itemId)];
      return { history, historyById };
    });
    void local.putHistory(entry);
  };

  const historyEntry = (item: MediaItem, position: number, duration: number, completed: boolean): HistoryEntry => {
    const entry: HistoryEntry = {
      itemId: item.id,
      playlistId: item.playlistId,
      kind: item.kind,
      name: item.name,
      playedAt: Date.now(),
      position,
      duration,
      completed,
    };
    if (item.logo) entry.logo = item.logo;
    if (item.series) entry.seriesId = makeSeriesId(item.playlistId, item.series.seriesKey);
    return entry;
  };

  /** Importa (ou reimporta) o conteúdo de uma lista e atualiza o estado em memória. */
  const runPlaylistImport = async (playlist: Playlist, file: File | undefined, isNew: boolean): Promise<Playlist> => {
    const jobId = startJob('playlist', playlist.name);
    try {
      const source = await openSource(playlist.url, file, MAX_PLAYLIST_BYTES);
      const result = await importPlaylistItems(playlist.id, source, (p) => job(jobId, p));
      if (!isNew) await local.pruneItems(playlist.id, new Set(result.items.map((i) => i.id)));
      const updated: Playlist = {
        ...playlist,
        updatedAt: Date.now(),
        itemCount: result.items.length,
        counts: result.counts,
        skipped: result.skipped,
      };
      if (result.epgUrl) updated.epgUrl = result.epgUrl;
      if (file) updated.fileName = file.name;
      await local.putPlaylist(updated);
      flag(LOST_FLAG, '1');
      set((s) => {
        const playlists = isNew ? [...s.playlists, updated] : s.playlists.map((p) => (p.id === updated.id ? updated : p));
        const items = updated.active ? [...s.items.filter((i) => i.playlistId !== updated.id), ...result.items] : s.items;
        return { playlists, items, lib: relib(items), dataLost: false };
      });
      job(jobId, { status: 'done', count: result.items.length, finishedAt: Date.now() });
      void navigator.storage?.persist?.().catch(() => false);
      return updated;
    } catch (error) {
      const importError = error instanceof ImportError ? error : new ImportError('storage', error instanceof Error ? error.name : undefined);
      if (!(error instanceof ImportError)) console.error('[TuiTV] erro de importação:', error instanceof Error ? error.name : 'desconhecido');
      if (isNew) await local.deletePlaylistItems(playlist.id).catch(() => undefined);
      job(jobId, { status: 'error', error: importError, finishedAt: Date.now() });
      throw importError;
    }
  };

  const runEpgImport = async (source: EpgSource, file: File | undefined): Promise<void> => {
    const jobId = startJob('epg', source.name);
    try {
      const bytes = await openSource(source.url, file, MAX_EPG_BYTES);
      const result = await importEpg(source.id, bytes, (p) => job(jobId, p));
      const updated: EpgSource = { ...source, updatedAt: Date.now(), channelCount: result.channels.length, programmeCount: result.programmeCount };
      if (file) updated.fileName = file.name;
      await local.putEpgSource(updated);
      set((s) => {
        const others = [...s.epgChannels.values()].filter((c) => c.sourceId !== source.id);
        const { map, index } = indexEpg([...others, ...result.channels]);
        return {
          epgSources: [...s.epgSources.filter((e) => e.id !== source.id), updated],
          epgChannels: map,
          epgIndex: index,
          epgVersion: s.epgVersion + 1,
        };
      });
      job(jobId, { status: 'done', count: result.programmeCount, finishedAt: Date.now() });
    } catch (error) {
      const importError = error instanceof ImportError ? error : new ImportError('storage');
      job(jobId, { status: 'error', error: importError, finishedAt: Date.now() });
      throw importError;
    }
  };

  return {
    ready: false,
    dataLost: false,
    playlists: [],
    items: [],
    lib: EMPTY_LIBRARY,
    favorites: new Map(),
    history: [],
    historyById: new Map(),
    settings: DEFAULT_SETTINGS,
    epgSources: [],
    epgChannels: new Map(),
    epgIndex: emptyIndex,
    epgVersion: 0,
    unavailable: new Set(),
    parentalUnlocked: false,
    jobs: [],
    toasts: [],

    init() {
      initPromise ??= (async () => {
        let hadFlag = false;
        try {
          hadFlag = localStorage.getItem(LOST_FLAG) === '1';
        } catch {
          /* ignore */
        }
        try {
          const persisted = await local.loadState();
          const settings = mergeSettings(persisted.settings);
          applyTheme(settings);
          const active = persisted.playlists.filter((p) => p.active).map((p) => p.id);
          const items = await local.loadItems(active);
          const { map, index } = indexEpg(persisted.epgChannels);
          set({
            ready: true,
            dataLost: hadFlag && persisted.playlists.length === 0 && !persisted.hadData,
            playlists: persisted.playlists,
            items,
            lib: buildLibrary(items, settings.parental, false),
            favorites: new Map(persisted.favorites.map((f) => [f.id, f])),
            history: persisted.history,
            historyById: new Map(persisted.history.map((h) => [h.itemId, h])),
            settings,
            epgSources: persisted.epgSources,
            epgChannels: map,
            epgIndex: index,
            unavailable: new Set(persisted.unavailable),
          });
        } catch (error) {
          console.error('[TuiTV] armazenamento local indisponível:', error instanceof Error ? error.name : 'erro');
          applyTheme(DEFAULT_SETTINGS);
          set({ ready: true });
        }
      })();
      return initPromise;
    },

    toast(text, tone = 'info') {
      const id = uid();
      set((s) => ({ toasts: [...s.toasts.slice(-3), { id, tone, text }] }));
      setTimeout(() => get().dismissToast(id), tone === 'error' ? 8000 : 4000);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    dismissJob: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })),

    async importPlaylist({ name, url, file }) {
      const now = Date.now();
      const playlist: Playlist = {
        id: uid(),
        name: cleanName(name, file?.name.replace(/\.[^.]+$/, '') || 'Minha lista'),
        source: file ? 'file' : 'url',
        active: true,
        createdAt: now,
        updatedAt: now,
        itemCount: 0,
        counts: { live: 0, movie: 0, series: 0 },
      };
      if (file) playlist.fileName = file.name;
      else playlist.url = checkedUrl(url ?? '', get().settings.allowPrivateHosts);
      return runPlaylistImport(playlist, file, true);
    },

    async refreshPlaylist(id, file) {
      const playlist = get().playlists.find((p) => p.id === id);
      if (!playlist) return;
      if (playlist.source === 'file' && !file) throw new ImportError('url-empty');
      await runPlaylistImport(playlist, file, false);
    },

    async renamePlaylist(id, name) {
      const playlist = get().playlists.find((p) => p.id === id);
      if (!playlist) return;
      const updated = { ...playlist, name: cleanName(name, playlist.name) };
      await local.putPlaylist(updated);
      set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? updated : p)) }));
    },

    async setPlaylistActive(id, active) {
      const playlist = get().playlists.find((p) => p.id === id);
      if (!playlist || playlist.active === active) return;
      const updated = { ...playlist, active };
      await local.putPlaylist(updated);
      const others = get().items.filter((i) => i.playlistId !== id);
      const items = active ? [...others, ...(await local.loadItems([id]))] : others;
      set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? updated : p)), items, lib: relib(items) }));
    },

    async deletePlaylist(id) {
      await local.deletePlaylist(id);
      set((s) => {
        const items = s.items.filter((i) => i.playlistId !== id);
        const favorites = new Map([...s.favorites].filter(([, f]) => f.playlistId !== id));
        const history = s.history.filter((h) => h.playlistId !== id);
        return {
          playlists: s.playlists.filter((p) => p.id !== id),
          items,
          lib: relib(items),
          favorites,
          history,
          historyById: new Map(history.map((h) => [h.itemId, h])),
        };
      });
    },

    toggleFavorite(id, kind, playlistId) {
      const favorites = new Map(get().favorites);
      if (favorites.has(id)) {
        favorites.delete(id);
        void local.deleteFavorite(id);
      } else {
        const favorite: Favorite = { id, kind, playlistId, addedAt: Date.now() };
        favorites.set(id, favorite);
        void local.putFavorite(favorite);
      }
      set({ favorites });
    },

    recordPlayback(item, position, duration) {
      const finite = Number.isFinite(duration) && duration > 0;
      const previous = get().historyById.get(item.id);
      const completed = item.kind !== 'live' && (!!previous?.completed || (finite && position / duration > 0.92));
      const entry = historyEntry(item, item.kind === 'live' ? 0 : Math.floor(position), finite ? Math.floor(duration) : 0, completed);
      saveHistory(entry);
    },

    setWatched(item, watched) {
      const previous = get().historyById.get(item.id);
      saveHistory({
        ...historyEntry(item, watched ? (previous?.duration ?? 0) : 0, previous?.duration ?? 0, watched),
        playedAt: previous?.playedAt ?? Date.now(),
      });
    },

    removeHistory(itemId) {
      set((s) => {
        const historyById = new Map(s.historyById);
        historyById.delete(itemId);
        return { history: s.history.filter((h) => h.itemId !== itemId), historyById };
      });
      void local.deleteHistory(itemId);
    },

    clearHistory() {
      set({ history: [], historyById: new Map() });
      void local.clearHistory();
    },

    markUnavailable(itemId, unavailable) {
      const current = get().unavailable;
      if (current.has(itemId) === unavailable) return;
      const next = new Set(current);
      if (unavailable) next.add(itemId);
      else next.delete(itemId);
      set({ unavailable: next });
      void local.kvSet('unavailable', [...next]);
    },

    updateSettings(patch) {
      const settings = { ...get().settings, ...patch };
      applyTheme(settings);
      const parentalChanged = patch.parental !== undefined;
      set((s) => ({ settings, lib: parentalChanged ? buildLibrary(s.items, settings.parental, s.parentalUnlocked) : s.lib }));
      void local.kvSet('settings', settings);
    },

    resetSettings() {
      // O controle parental é preservado: restaurar preferências não pode servir de atalho para removê-lo.
      get().updateSettings({ ...DEFAULT_SETTINGS, parental: get().settings.parental });
    },

    async setPin(pin) {
      const hashed = await hashPin(pin);
      set({ parentalUnlocked: true });
      get().updateSettings({ parental: { ...get().settings.parental, ...hashed, enabled: true } });
    },

    disableParental() {
      const { hideAdult, lockedGroups } = get().settings.parental;
      get().updateSettings({ parental: { enabled: false, hideAdult, lockedGroups } });
      set({ parentalUnlocked: false });
    },

    async unlock(pin) {
      const ok = await verifyPin(pin, get().settings.parental);
      if (ok) set((s) => ({ parentalUnlocked: true, lib: buildLibrary(s.items, s.settings.parental, true) }));
      return ok;
    },

    lock() {
      set((s) => ({ parentalUnlocked: false, lib: buildLibrary(s.items, s.settings.parental, false) }));
    },

    async addEpg({ name, url, file }) {
      const source: EpgSource = {
        id: uid(),
        name: cleanName(name, file?.name ?? 'Guia'),
        source: file ? 'file' : 'url',
        updatedAt: Date.now(),
        channelCount: 0,
        programmeCount: 0,
      };
      if (file) source.fileName = file.name;
      else source.url = checkedUrl(url ?? '', get().settings.allowPrivateHosts);
      try {
        await runEpgImport(source, file);
      } catch (error) {
        await local.deleteEpgData(source.id).catch(() => undefined);
        throw error;
      }
    },

    async refreshEpg(id, file) {
      const source = get().epgSources.find((e) => e.id === id);
      if (!source) return;
      if (source.source === 'file' && !file) throw new ImportError('url-empty');
      await runEpgImport(source, file);
    },

    async deleteEpg(id) {
      await local.deleteEpgData(id);
      set((s) => {
        const { map, index } = indexEpg([...s.epgChannels.values()].filter((c) => c.sourceId !== id));
        return { epgSources: s.epgSources.filter((e) => e.id !== id), epgChannels: map, epgIndex: index, epgVersion: s.epgVersion + 1 };
      });
    },

    async collectBackup() {
      const s = get();
      const playlists = await Promise.all(
        s.playlists.map(async (playlist) =>
          playlist.source === 'file' ? { playlist, items: await local.loadItems([playlist.id]) } : { playlist },
        ),
      );
      return {
        playlists,
        favorites: [...s.favorites.values()],
        history: s.history,
        epgSources: s.epgSources.filter((e) => e.source === 'url'),
        settings: s.settings,
      };
    },

    async exportBackup(password) {
      const data = await get().collectBackup();
      const text = await createBackup(data, { platform: 'web', password: password || undefined });
      return { text, hasCredentials: backupHasCredentials(data) };
    },

    async restoreBackup(envelope, password) {
      const data = await openBackup(envelope, password);
      const current = get();
      const existing = new Set(current.playlists.map((p) => p.id));
      let pendingRefresh = 0;
      let restored = 0;
      for (const { playlist, items } of data.playlists) {
        if (existing.has(playlist.id)) continue;
        const safe: Playlist = { ...playlist, name: cleanName(playlist.name, 'Lista') };
        if (safe.source === 'url') {
          // Listas remotas voltam com o endereço; o conteúdo é baixado de novo na próxima atualização.
          safe.itemCount = 0;
          safe.counts = { live: 0, movie: 0, series: 0 };
          pendingRefresh++;
        } else if (items?.length) {
          for (let i = 0; i < items.length; i += 2000) await local.putItems(items.slice(i, i + 2000));
        }
        await local.putPlaylist(safe);
        restored++;
      }
      for (const favorite of data.favorites) await local.putFavorite(favorite);
      for (const entry of data.history) if (!current.historyById.has(entry.itemId)) await local.putHistory(entry);
      for (const source of data.epgSources) {
        if (!current.epgSources.some((e) => e.id === source.id)) await local.putEpgSource({ ...source, channelCount: 0, programmeCount: 0 });
      }
      // Preferências do backup, preservando o controle parental deste dispositivo.
      const settings: Settings = { ...data.settings, parental: current.settings.parental };
      await local.kvSet('settings', settings);
      flag(LOST_FLAG, '1');
      initPromise = null;
      const unlocked = current.parentalUnlocked;
      await get().init();
      if (unlocked) set((s) => ({ parentalUnlocked: true, lib: buildLibrary(s.items, s.settings.parental, true) }));
      return { playlists: restored, pendingRefresh };
    },

    async autoRefresh() {
      const hours = get().settings.autoRefreshHours;
      if (!hours || autoRefreshing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
      autoRefreshing = true;
      try {
        const limit = Date.now() - hours * 3_600_000;
        for (const playlist of get().playlists) {
          if (playlist.source !== 'url' || !playlist.active || playlist.updatedAt > limit || recentlyTried(playlist.id)) continue;
          // Falhas ficam registradas no cartão de importação; a biblioteca anterior é preservada.
          await get().refreshPlaylist(playlist.id).catch(() => undefined);
        }
        for (const source of get().epgSources) {
          if (source.source !== 'url' || source.updatedAt > limit || recentlyTried(source.id)) continue;
          await get().refreshEpg(source.id).catch(() => undefined);
        }
      } finally {
        autoRefreshing = false;
      }
    },

    async clearCaches() {
      if (typeof caches !== 'undefined') {
        for (const key of await caches.keys()) await caches.delete(key);
      }
      await local.pruneOldProgrammes(Date.now() - 6 * 3_600_000);
      set((s) => ({ unavailable: new Set(), epgVersion: s.epgVersion + 1 }));
      await local.kvSet('unavailable', []);
    },

    async deleteAllData() {
      await local.wipeAll();
      if (typeof caches !== 'undefined') {
        for (const key of await caches.keys()) await caches.delete(key);
      }
      flag(LOST_FLAG, null);
      flag(THEME_FLAG, null);
      initPromise = null;
      applyTheme(DEFAULT_SETTINGS);
      set({
        dataLost: false,
        playlists: [],
        items: [],
        lib: EMPTY_LIBRARY,
        favorites: new Map(),
        history: [],
        historyById: new Map(),
        settings: DEFAULT_SETTINGS,
        epgSources: [],
        epgChannels: new Map(),
        epgIndex: emptyIndex,
        epgVersion: 0,
        unavailable: new Set(),
        parentalUnlocked: false,
        jobs: [],
      });
    },
  };
});

export const seriesIdOf = (item: MediaItem) => (item.series ? makeSeriesId(item.playlistId, item.series.seriesKey) : undefined);

'use client';

import { useMemo } from 'react';
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
import { MAX_EPG_BYTES, MAX_PLAYLIST_BYTES, cleanName, parseXtreamUrl, xtreamEpgUrl } from '@tuitv/validation';
import * as local from './db';
import { importEpg, importPlaylistItems } from './importer';
import { EMPTY_LIBRARY, EMPTY_REMOTE, buildLibrary, type Library, type RemoteView } from './library';
import { ImportError, checkedUrl, fetchSource, fileSource, uid, type ByteSource } from './net';
import * as xtream from './xtream';
import type { SeriesGroup } from '@tuitv/business-rules';

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
  /** Falha ao conectar a um login consultado sob demanda, por lista. */
  remoteErrors: Map<string, ImportError>;
  /** Logins conectando agora (conta e categorias a caminho). */
  connecting: Set<string>;
  parentalUnlocked: boolean;
  jobs: Job[];
  toasts: Toast[];
}

interface Actions {
  init(): Promise<void>;
  toast(text: string, tone?: Toast['tone']): void;
  dismissToast(id: string): void;
  dismissJob(id: string): void;

  importPlaylist(input: { name: string; url?: string; file?: File; epgUrl?: string }): Promise<Playlist>;
  refreshPlaylist(id: string, file?: File): Promise<void>;
  renamePlaylist(id: string, name: string): Promise<void>;
  setPlaylistActive(id: string, active: boolean): Promise<void>;
  deletePlaylist(id: string): Promise<void>;

  /** Conecta os logins Xtream ativos (conta e categorias), sem baixar o catálogo. */
  connectRemote(): Promise<void>;
  /** Carrega do servidor uma categoria (ou todas, com group = null) dos logins ativos. */
  loadRemote(kind: xtream.RemoteKind, group: string | null): Promise<void>;
  /** Carrega os episódios de uma série de um login. */
  loadRemoteSeries(seriesId: string): Promise<void>;

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

/** Catálogo remoto de um login, só em memória (nada disso é gravado no dispositivo). */
interface RemoteCache {
  categories: Record<xtream.RemoteKind, xtream.RemoteCategory[]>;
  names: Record<xtream.RemoteKind, Map<string, string>>;
  /** `${kind}|${categoryId}` já carregados; `${kind}|*` = todas. */
  loaded: Set<string>;
  items: Map<string, MediaItem>;
  series: Map<string, SeriesGroup>;
  /** Séries com episódios carregados. */
  full: Set<string>;
}
const remotes = new Map<string, RemoteCache>();
const inflight = new Map<string, Promise<void>>();

function remoteCache(categories: Record<xtream.RemoteKind, xtream.RemoteCategory[]>): RemoteCache {
  const names = (kind: xtream.RemoteKind) => new Map(categories[kind].map((c) => [c.id, c.name]));
  return {
    categories,
    names: { live: names('live'), movie: names('movie'), series: names('series') },
    loaded: new Set(),
    items: new Map(),
    series: new Map(),
    full: new Set(),
  };
}

/** Conteúdo remoto já carregado dos logins ativos, para montar a biblioteca. */
function remoteView(playlists: Playlist[]): RemoteView {
  const active = playlists.filter((p) => p.active && xtream.isXtream(p)).map((p) => remotes.get(p.id)).filter((c): c is RemoteCache => !!c);
  if (!active.length) return EMPTY_REMOTE;
  const view: RemoteView = { items: [], series: [], groups: { live: [], movie: [], series: [] } };
  for (const cache of active) {
    for (const item of cache.items.values()) view.items.push(item);
    for (const series of cache.series.values()) view.series.push(series);
    for (const kind of xtream.REMOTE_KINDS) for (const c of cache.categories[kind]) view.groups[kind].push(c.name);
  }
  return view;
}

/** Executa uma vez por chave enquanto estiver em andamento. */
/** Logins: consultar por categoria (TV Samsung) ou o catálogo inteiro de cada tipo (Web). */
const BY_CATEGORY = process.env.NEXT_PUBLIC_REMOTE_BY_CATEGORY === '1';

function once(key: string, run: () => Promise<void>): Promise<void> {
  let job = inflight.get(key);
  if (!job) {
    job = run().finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  return job;
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
  const relib = (items: MediaItem[] = get().items, settings = get().settings, unlocked = get().parentalUnlocked, playlists = get().playlists) =>
    buildLibrary(items, settings.parental, unlocked, remoteView(playlists));

  const timeout = () => get().settings.connectionTimeout;

  /** Conecta um login: valida a conta e lê as categorias. */
  const connectPlaylist = (playlist: Playlist): Promise<void> =>
    once(`connect|${playlist.id}`, async () => {
      const login = xtream.loginOf(playlist);
      if (!login) return;
      set((s) => ({ connecting: new Set(s.connecting).add(playlist.id) }));
      try {
        const connection = await xtream.connect(login, Math.max(timeout(), 20));
        remotes.set(playlist.id, remoteCache(connection.categories));
        const updated: Playlist = { ...playlist, account: connection.account, updatedAt: Date.now() };
        await local.putPlaylist(updated).catch(() => undefined);
        set((s) => {
          const remoteErrors = new Map(s.remoteErrors);
          remoteErrors.delete(playlist.id);
          const playlists = s.playlists.map((p) => (p.id === playlist.id ? { ...updated, name: p.name, active: p.active } : p));
          return { playlists, remoteErrors, lib: relib(s.items, s.settings, s.parentalUnlocked, playlists) };
        });
      } catch (error) {
        const importError =
          error instanceof ImportError ? error : error instanceof xtream.NoXtreamApi ? new ImportError('http', '404') : new ImportError('network-or-cors');
        set((s) => ({ remoteErrors: new Map(s.remoteErrors).set(playlist.id, importError) }));
        throw importError;
      } finally {
        set((s) => {
          const connecting = new Set(s.connecting);
          connecting.delete(playlist.id);
          return { connecting };
        });
      }
    });

  /** Cache do login, conectando se ainda não estiver conectado. */
  const cacheOf = async (playlist: Playlist): Promise<RemoteCache | undefined> => {
    if (!remotes.has(playlist.id)) await connectPlaylist(playlist).catch(() => undefined);
    return remotes.get(playlist.id);
  };

  const activeRemotes = () => get().playlists.filter((p) => p.active && xtream.isXtream(p));

  /** Lista convertida (ou criada) como login consultado sob demanda. */
  const saveRemotePlaylist = async (playlist: Playlist, connection: xtream.Connection, isNew: boolean): Promise<Playlist> => {
    const updated: Playlist = {
      ...playlist,
      provider: 'xtream',
      account: connection.account,
      updatedAt: Date.now(),
      itemCount: 0,
      counts: { live: 0, movie: 0, series: 0 },
    };
    delete updated.skipped;
    remotes.set(updated.id, remoteCache(connection.categories));
    if (!isNew) await local.deletePlaylistItems(updated.id);
    await local.putPlaylist(updated);
    flag(LOST_FLAG, '1');
    set((s) => {
      const playlists = isNew ? [...s.playlists, updated] : s.playlists.map((p) => (p.id === updated.id ? updated : p));
      const items = s.items.filter((i) => i.playlistId !== updated.id);
      const remoteErrors = new Map(s.remoteErrors);
      remoteErrors.delete(updated.id);
      return { playlists, items, remoteErrors, lib: relib(items, s.settings, s.parentalUnlocked, playlists), dataLost: false };
    });
    return updated;
  };

  /** Tenta usar a API do login; null quando o servidor não a oferece (segue com a lista M3U). */
  const tryConnect = async (url: string | undefined): Promise<xtream.Connection | null> => {
    const login = url ? parseXtreamUrl(url) : undefined;
    if (!login) return null;
    try {
      return await xtream.connect(login, Math.max(timeout(), 20));
    } catch (error) {
      if (error instanceof xtream.NoXtreamApi) return null;
      throw error;
    }
  };

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
    remoteErrors: new Map(),
    connecting: new Set(),
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
          // Logins consultados sob demanda não têm itens guardados.
          const active = persisted.playlists.filter((p) => p.active && !xtream.isXtream(p)).map((p) => p.id);
          const items = await local.loadItems(active);
          const { map, index } = indexEpg(persisted.epgChannels);
          set({
            ready: true,
            dataLost: hadFlag && persisted.playlists.length === 0 && !persisted.hadData,
            playlists: persisted.playlists,
            items,
            lib: buildLibrary(items, settings.parental, false, remoteView(persisted.playlists)),
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
        // Conecta os logins em segundo plano: a interface abre sem esperar o servidor.
        void get().connectRemote();
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

    async importPlaylist({ name, url, file, epgUrl }) {
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
      // Guia conhecido de antemão (login Xtream); um guia anunciado pela própria lista tem prioridade.
      if (epgUrl && !file) playlist.epgUrl = epgUrl;
      // Login Xtream: nada é importado, o conteúdo é consultado no servidor quando a tela precisa.
      const connection = file ? null : await tryConnect(playlist.url);
      if (connection) {
        playlist.epgUrl ??= xtreamEpg(playlist.url!);
        return saveRemotePlaylist(playlist, connection, true);
      }
      return runPlaylistImport(playlist, file, true);
    },

    async refreshPlaylist(id, file) {
      const playlist = get().playlists.find((p) => p.id === id);
      if (!playlist) return;
      if (playlist.source === 'file' && !file) throw new ImportError('url-empty');
      if (xtream.isXtream(playlist)) {
        // Reconecta e descarta o que foi carregado: categorias e conteúdo voltam a ser lidos do servidor.
        remotes.delete(id);
        await connectPlaylist(playlist);
        set((s) => ({ lib: relib(s.items) }));
        return;
      }
      // Lista antiga importada de um login: passa a ser consultada sob demanda (libera o armazenamento).
      const connection = file ? null : await tryConnect(playlist.url);
      if (connection) {
        await saveRemotePlaylist(playlist, connection, false);
        return;
      }
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
      const remote = xtream.isXtream(playlist);
      const items = active && !remote ? [...others, ...(await local.loadItems([id]))] : others;
      const playlists = get().playlists.map((p) => (p.id === id ? updated : p));
      set((s) => ({ playlists, items, lib: relib(items, s.settings, s.parentalUnlocked, playlists) }));
      if (active && remote) void connectPlaylist(updated).catch(() => undefined);
    },

    async deletePlaylist(id) {
      await local.deletePlaylist(id);
      remotes.delete(id);
      set((s) => {
        const items = s.items.filter((i) => i.playlistId !== id);
        const favorites = new Map([...s.favorites].filter(([, f]) => f.playlistId !== id));
        const history = s.history.filter((h) => h.playlistId !== id);
        const playlists = s.playlists.filter((p) => p.id !== id);
        return {
          playlists,
          items,
          lib: relib(items, s.settings, s.parentalUnlocked, playlists),
          favorites,
          history,
          historyById: new Map(history.map((h) => [h.itemId, h])),
        };
      });
    },

    async connectRemote() {
      // Antes da primeira resposta, as telas já sabem que há logins conectando.
      const pending = activeRemotes().filter((p) => !remotes.has(p.id));
      if (pending.length) set((s) => ({ connecting: new Set([...s.connecting, ...pending.map((p) => p.id)]) }));
      await Promise.all(activeRemotes().map((p) => cacheOf(p)));
    },

    async loadRemote(kind, requested) {
      // Web: o catálogo de cada tipo vem numa consulta só (menos consultas, sem esbarrar no limite
      // dos servidores). A TV Samsung pede por categoria, para não carregar catálogos grandes de uma vez.
      const group = BY_CATEGORY ? requested : null;
      const jobs = activeRemotes().map(async (playlist) => {
        const cache = await cacheOf(playlist);
        const login = xtream.loginOf(playlist);
        if (!cache || !login || cache.loaded.has(`${kind}|*`)) return false;
        const ids = group === null ? [undefined] : cache.categories[kind].filter((c) => c.name === group).map((c) => c.id);
        const pending = ids.filter((cid) => !cache.loaded.has(`${kind}|${cid ?? '*'}`));
        if (!pending.length) return false;
        const load = (cid: string | undefined) =>
          once(`load|${playlist.id}|${kind}|${cid ?? '*'}`, async () => {
            const names = cache.names[kind];
            if (kind === 'series') {
              for (const series of await xtream.seriesList(playlist.id, login, names, cid, timeout())) {
                if (!cache.full.has(series.id)) cache.series.set(series.id, series);
              }
            } else {
              for (const item of await xtream.streams(playlist.id, login, kind, names, cid, timeout())) cache.items.set(item.id, item);
            }
            cache.loaded.add(`${kind}|${cid ?? '*'}`);
          });
        try {
          await Promise.all(pending.map(load));
        } catch (error) {
          // Servidores que limitam consultas recusam parte das categorias (o navegador vê a recusa
          // como erro de rede/CORS). Uma única consulta com tudo, como a da busca, costuma passar.
          if (group === null || !(error instanceof ImportError) || error.code !== 'network-or-cors' || cache.loaded.has(`${kind}|*`)) throw error;
          await load(undefined);
        }
        return true;
      });
      const results = await Promise.allSettled(jobs);
      if (results.some((r) => r.status === 'fulfilled' && r.value)) set((s) => ({ lib: relib(s.items) }));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) throw failed.reason instanceof ImportError ? failed.reason : new ImportError('network-or-cors');
    },

    async loadRemoteSeries(seriesId) {
      const playlist = activeRemotes().find((p) => xtream.remoteSeriesId(p.id, seriesId));
      const login = playlist && xtream.loginOf(playlist);
      if (!playlist || !login) return;
      const cache = await cacheOf(playlist);
      if (!cache || cache.full.has(seriesId)) return;
      await once(`series|${seriesId}`, async () => {
        const sid = xtream.remoteSeriesId(playlist.id, seriesId)!;
        const series = await xtream.seriesEpisodes(playlist.id, login, sid, cache.series.get(seriesId), cache.names.series, timeout());
        cache.series.set(seriesId, series);
        cache.full.add(seriesId);
      });
      set((s) => ({ lib: relib(s.items) }));
    },

    toggleFavorite(id, kind, playlistId) {
      const favorites = new Map(get().favorites);
      if (favorites.has(id)) {
        favorites.delete(id);
        void local.deleteFavorite(id);
      } else {
        const favorite: Favorite = { id, kind, playlistId, addedAt: Date.now() };
        // Nome e capa guardados com o favorito: itens de logins não ficam no dispositivo.
        const lib = get().lib;
        const series = kind === 'series' ? lib.seriesById.get(id) : undefined;
        const item = kind !== 'series' ? lib.byId.get(id) : undefined;
        const source = series ? { name: series.title, logo: series.logo, group: series.group, year: series.year } : item;
        if (source) {
          const snapshot: NonNullable<Favorite['snapshot']> = { name: source.name };
          if (source.logo) snapshot.logo = source.logo;
          if (source.group) snapshot.group = source.group;
          if (source.year) snapshot.year = source.year;
          favorite.snapshot = snapshot;
        }
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
      set((s) => ({ settings, lib: parentalChanged ? relib(s.items, settings, s.parentalUnlocked) : s.lib }));
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
      if (ok) set((s) => ({ parentalUnlocked: true, lib: relib(s.items, s.settings, true) }));
      return ok;
    },

    lock() {
      set((s) => ({ parentalUnlocked: false, lib: relib(s.items, s.settings, false) }));
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
        if (safe.provider === 'xtream') {
          // Login consultado sob demanda: não há conteúdo a baixar, conecta ao abrir.
        } else if (safe.source === 'url') {
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
      if (unlocked) set((s) => ({ parentalUnlocked: true, lib: relib(s.items, s.settings, true) }));
      return { playlists: restored, pendingRefresh };
    },

    async autoRefresh() {
      const hours = get().settings.autoRefreshHours;
      if (!hours || autoRefreshing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
      autoRefreshing = true;
      try {
        const limit = Date.now() - hours * 3_600_000;
        for (const playlist of get().playlists) {
          if (playlist.source !== 'url' || xtream.isXtream(playlist) || !playlist.active || playlist.updatedAt > limit || recentlyTried(playlist.id)) continue;
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
      remotes.clear();
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
        remoteErrors: new Map(),
        connecting: new Set(),
        parentalUnlocked: false,
        jobs: [],
      });
    },
  };
});

export const seriesIdOf = (item: MediaItem) => (item.series ? makeSeriesId(item.playlistId, item.series.seriesKey) : undefined);

/** Endereço do guia (xmltv.php) do mesmo login de uma lista get.php. */
function xtreamEpg(url: string): string | undefined {
  const login = parseXtreamUrl(url);
  return login ? xtreamEpgUrl(login) : undefined;
}

type StoreState = State & Actions;

/**
 * Item por id: da biblioteca carregada ou, para logins consultados sob demanda, reconstruído a partir do id
 * com nome e capa do favorito/histórico (sem consultar o servidor).
 */
type Resolvable = Pick<StoreState, 'lib' | 'playlists' | 'historyById' | 'favorites'>;

export function resolveItem(s: Resolvable, id: string): MediaItem | undefined {
  const loaded = s.lib.byId.get(id);
  if (loaded) return loaded;
  const playlist = s.playlists.find((p) => p.active && xtream.isXtream(p) && id.startsWith(`${p.id}:`));
  if (!playlist) return undefined;
  const history = s.historyById.get(id);
  const favorite = s.favorites.get(id)?.snapshot;
  const meta = favorite ?? (history ? { name: history.name, logo: history.logo } : undefined);
  if (!meta?.name) return undefined;
  return xtream.itemFromId(playlist, id, meta);
}

/** Série por id: da biblioteca ou, de um login, um resumo com o nome e a capa do favorito (episódios carregam ao abrir). */
export function resolveSeries(s: Resolvable, id: string): SeriesGroup | undefined {
  const loaded = s.lib.seriesById.get(id);
  if (loaded) return loaded;
  const playlist = s.playlists.find((p) => p.active && xtream.isXtream(p) && xtream.remoteSeriesId(p.id, id));
  const snapshot = s.favorites.get(id)?.snapshot;
  if (!playlist || !snapshot) return undefined;
  const series: SeriesGroup = { id, playlistId: playlist.id, title: snapshot.name, seasons: [], episodeCount: 0 };
  if (snapshot.logo) series.logo = snapshot.logo;
  if (snapshot.group) series.group = snapshot.group;
  if (snapshot.year) series.year = snapshot.year;
  return series;
}

/** Resolvedores ligados ao estado atual (para listas de favoritos e histórico). */
export function useResolver() {
  const lib = useStore((s) => s.lib);
  const playlists = useStore((s) => s.playlists);
  const historyById = useStore((s) => s.historyById);
  const favorites = useStore((s) => s.favorites);
  return useMemo(() => {
    const state = { lib, playlists, historyById, favorites };
    return { item: (id: string) => resolveItem(state, id), series: (id: string) => resolveSeries(state, id) };
  }, [lib, playlists, historyById, favorites]);
}

/** Algum login consultado sob demanda está ativo. */
export const hasRemote = (s: StoreState) => s.playlists.some((p) => p.active && xtream.isXtream(p));

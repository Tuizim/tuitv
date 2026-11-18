'use client';

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { nowNext, resolveEpgChannel, type NowNext } from '@tuitv/business-rules';
import type { MediaItem, Programme } from '@tuitv/shared-models';
import { getProgrammes } from './db';
import type { ImportError } from './net';
import { hasRemote, useStore } from './store';
import type { RemoteKind } from './xtream';

/** Estado efêmero de interface (não persistido). */
export const useUi = create<{ query: string; setQuery: (query: string) => void }>((set) => ({
  query: '',
  setQuery: (query) => set({ query }),
}));

interface CacheEntry {
  version: number;
  from: number;
  to: number;
  at: number;
  rows: Promise<Programme[]>;
}
const programmeCache = new Map<string, CacheEntry>();

/** Programas de um canal do guia (chave `${sourceId}|${channelId}`), com cache em memória. */
export function loadProgrammes(channelKey: string, from: number, to: number, version: number): Promise<Programme[]> {
  const hit = programmeCache.get(channelKey);
  if (hit && hit.version === version && hit.from <= from && hit.to >= to && Date.now() - hit.at < 10 * 60_000) return hit.rows;
  const separator = channelKey.indexOf('|');
  const rows = getProgrammes(channelKey.slice(0, separator), channelKey.slice(separator + 1), from, to).catch(() => []);
  if (programmeCache.size > 600) programmeCache.clear();
  programmeCache.set(channelKey, { version, from, to, at: Date.now(), rows });
  return rows;
}

/** Relógio compartilhado, atualizado a cada 30 s. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Chave do canal correspondente no guia de programação, se houver. */
export function useEpgKey(item: Pick<MediaItem, 'tvgId' | 'tvgName' | 'name'> | undefined): string | undefined {
  return useStore((s) => (item && s.epgChannels.size > 0 ? resolveEpgChannel(item, s.epgIndex) : undefined));
}

const EMPTY: NowNext = { next: [] };

/** Programa atual e próximos de um canal. */
export function useNowNext(item: MediaItem | undefined, upcoming = 3): NowNext {
  const key = useEpgKey(item);
  const version = useStore((s) => s.epgVersion);
  const now = useNow();
  const [rows, setRows] = useState<Programme[] | null>(null);
  useEffect(() => {
    setRows(null);
    if (!key) return;
    let alive = true;
    const base = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    void loadProgrammes(key, base - 3_600_000, base + 12 * 3_600_000, version).then((list) => alive && setRows(list));
    return () => {
      alive = false;
    };
  }, [key, version]);
  return rows ? nowNext(rows, now, upcoming) : EMPTY;
}

export interface RemoteLoad {
  loading: boolean;
  error: ImportError | null;
  retry: () => void;
}

/**
 * Pede ao servidor de um login uma categoria (ou todas, com group = null) quando a tela precisa dela.
 * Sem logins ativos, ou com `enabled` falso, não faz nada. Repetir o pedido não refaz a consulta.
 */
export function useRemoteGroup(kind: RemoteKind, group: string | null, enabled = true): RemoteLoad {
  const remote = useStore(hasRemote);
  const loadRemote = useStore((s) => s.loadRemote);
  const [state, setState] = useState<{ loading: boolean; error: ImportError | null }>({ loading: false, error: null });
  const [attempt, setAttempt] = useState(0);
  const active = remote && enabled;
  useEffect(() => {
    if (!active) {
      setState({ loading: false, error: null });
      return;
    }
    let alive = true;
    setState({ loading: true, error: null });
    loadRemote(kind, group).then(
      () => alive && setState({ loading: false, error: null }),
      (error: ImportError) => alive && setState({ loading: false, error }),
    );
    return () => {
      alive = false;
    };
  }, [active, kind, group, loadRemote, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

/**
 * Conexão dos logins ativos (conta e categorias). `loading` enquanto as categorias não chegaram;
 * `error` quando nenhum login conectou.
 */
export function useRemoteConnection(): RemoteLoad & { pending: boolean } {
  const connecting = useStore((s) => s.connecting.size > 0);
  const playlists = useStore((s) => s.playlists);
  const errors = useStore((s) => s.remoteErrors);
  const connectRemote = useStore((s) => s.connectRemote);
  const active = playlists.filter((p) => p.active && p.provider === 'xtream');
  const failed = active.filter((p) => errors.has(p.id));
  const error = !connecting && active.length > 0 && failed.length === active.length ? errors.get(failed[0]!.id)! : null;
  return { pending: connecting || !!error, loading: connecting, error, retry: () => void connectRemote().catch(() => undefined) };
}

/** Episódios de uma série de login, carregados ao abrir a série. */
export function useRemoteSeries(seriesId: string | undefined): RemoteLoad {
  const loadRemoteSeries = useStore((s) => s.loadRemoteSeries);
  const [state, setState] = useState<{ loading: boolean; error: ImportError | null }>({ loading: false, error: null });
  const [attempt, setAttempt] = useState(0);
  const remote = !!seriesId && seriesId.includes(':s:x');
  useEffect(() => {
    if (!remote || !seriesId) return;
    let alive = true;
    setState({ loading: true, error: null });
    loadRemoteSeries(seriesId).then(
      () => alive && setState({ loading: false, error: null }),
      (error: ImportError) => alive && setState({ loading: false, error }),
    );
    return () => {
      alive = false;
    };
  }, [remote, seriesId, loadRemoteSeries, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

/** Aplicativo de TV (Tizen): mesma interface, com ficha do título e player em tela cheia próprios. */
export const isTv = (): boolean => typeof document !== 'undefined' && document.documentElement.dataset.platform === 'tizen';

/** Ficha do filme (capa, sinopse, Assistir e Favoritar) — a etapa antes do player na TV. */
export const titleHref = (item: MediaItem): string => `/title?id=${encodeURIComponent(item.id)}`;
export const watchHref = (item: MediaItem): string => `/watch?id=${encodeURIComponent(item.id)}`;

export const itemHref = (item: MediaItem): string =>
  item.kind === 'live' ? `/live?c=${encodeURIComponent(item.id)}` : item.kind === 'movie' && isTv() ? titleHref(item) : watchHref(item);
export const seriesHref = (id: string): string => `/series/view?id=${encodeURIComponent(id)}`;

export function download(filename: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

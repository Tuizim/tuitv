'use client';

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { nowNext, resolveEpgChannel, type NowNext } from '@tuitv/business-rules';
import type { MediaItem, Programme } from '@tuitv/shared-models';
import { getProgrammes } from './db';
import { useStore } from './store';

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

export const itemHref = (item: MediaItem): string =>
  item.kind === 'live' ? `/live?c=${encodeURIComponent(item.id)}` : `/watch?id=${encodeURIComponent(item.id)}`;
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

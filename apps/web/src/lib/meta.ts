'use client';

import { useEffect, useState } from 'react';
import { normalizeText, type SeriesGroup } from '@tuitv/business-rules';
import type { MediaItem } from '@tuitv/shared-models';
import { safeImageUrl } from '@tuitv/validation';
import { kvGet, kvSet } from './db';
import { remoteSeriesInfo } from './xtream';

/**
 * Informações complementares (sinopse, gênero, elenco…).
 *
 * Listas M3U quase nunca trazem sinopse. Quando os endereços seguem o padrão
 * `/movie/usuario/senha/id.ext` ou `/series/usuario/senha/id.ext`, o próprio servidor da lista
 * costuma oferecer esses dados em `player_api.php`. A consulta é feita diretamente a esse servidor
 * — o mesmo que já entrega os vídeos — e o resultado fica guardado neste dispositivo.
 * Nenhum serviço de terceiros é usado.
 */
export interface ExtraInfo {
  plot?: string;
  genre?: string;
  cast?: string;
  director?: string;
  rating?: string;
  year?: string;
  backdrop?: string;
}

interface Provider {
  base: string;
  user: string;
  pass: string;
  kind: 'movie' | 'series';
  id: string;
}

export function providerOf(url: string): Provider | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const match = /^\/(movie|series)\/([^/]+)\/([^/]+)\/(\d+)\.\w+$/.exec(parsed.pathname);
    if (!match) return null;
    // Usuário e senha vêm codificados no caminho; a consulta os codifica de novo.
    const decode = (part: string) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    };
    return { base: parsed.origin, kind: match[1] as Provider['kind'], user: decode(match[2]!), pass: decode(match[3]!), id: match[4]! };
  } catch {
    return null;
  }
}

const text = (value: unknown, max = 400): string | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const clean = String(value).replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : undefined;
};

function toInfo(raw: Record<string, unknown>): ExtraInfo {
  const info: ExtraInfo = {};
  const plot = text(raw.plot, 3000) ?? text(raw.description, 3000);
  if (plot) info.plot = plot;
  const genre = text(raw.genre);
  if (genre) info.genre = genre;
  const cast = text(raw.cast) ?? text(raw.actors);
  if (cast) info.cast = cast;
  const director = text(raw.director);
  if (director) info.director = director;
  const rating = Number(raw.rating);
  if (Number.isFinite(rating) && rating > 0) info.rating = rating.toFixed(1);
  const year = /\d{4}/.exec(text(raw.releasedate) ?? text(raw.releaseDate) ?? text(raw.release_date) ?? text(raw.year) ?? '')?.[0];
  if (year) info.year = year;
  const backdrops = Array.isArray(raw.backdrop_path) ? raw.backdrop_path : [raw.backdrop_path];
  const backdrop = safeImageUrl(backdrops.find((b): b is string => typeof b === 'string' && b.length > 0));
  if (backdrop) info.backdrop = backdrop;
  return info;
}

async function api(provider: Provider, action: string, extra = ''): Promise<unknown> {
  // Página em https não pode consultar servidor http (conteúdo misto).
  if (location.protocol === 'https:' && provider.base.startsWith('http:')) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const url = `${provider.base}/player_api.php?username=${encodeURIComponent(provider.user)}&password=${encodeURIComponent(provider.pass)}&action=${action}${extra}`;
    const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null; // servidor sem esse recurso, bloqueio de CORS ou sem conexão
  } finally {
    clearTimeout(timer);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const pending = new Map<string, Promise<ExtraInfo | null>>();
const WEEK = 7 * 86_400_000;

/** Evita consultas repetidas: cada chave é buscada uma vez por sessão e guardada localmente. */
function once(key: string, load: () => Promise<ExtraInfo | null>): Promise<ExtraInfo | null> {
  let job = pending.get(key);
  if (!job) {
    job = load().catch(() => null);
    pending.set(key, job);
  }
  return job;
}

export function movieInfo(item: MediaItem): Promise<ExtraInfo | null> {
  const provider = providerOf(item.url);
  if (!provider || provider.kind !== 'movie') return Promise.resolve(null);
  const key = `meta:${item.id}`;
  return once(key, async () => {
    const cached = await kvGet<ExtraInfo>(key);
    if (cached) return cached;
    const data = await api(provider, 'get_vod_info', `&vod_id=${provider.id}`);
    if (!isObject(data) || !isObject(data.info)) return null;
    const info = toInfo(data.info);
    if (Object.keys(info).length) await kvSet(key, info);
    return info;
  });
}

const seriesName = (name: string) => normalizeText(name.replace(/[([]\d{4}[)\]]/g, ' ').replace(/\s+/g, ' '));
const catalogs = new Map<string, Promise<Record<string, ExtraInfo> | null>>();

/** Catálogo de séries do servidor (uma consulta por lista, renovada semanalmente). */
function seriesCatalog(playlistId: string, provider: Provider): Promise<Record<string, ExtraInfo> | null> {
  const key = `seriesmeta:${playlistId}`;
  let job = catalogs.get(key);
  if (!job) {
    job = (async () => {
      const cached = await kvGet<{ at: number; map: Record<string, ExtraInfo> }>(key);
      if (cached && Date.now() - cached.at < WEEK) return cached.map;
      const data = await api(provider, 'get_series');
      if (!Array.isArray(data)) return cached?.map ?? null;
      const map: Record<string, ExtraInfo> = {};
      for (const entry of data) {
        if (!isObject(entry) || typeof entry.name !== 'string') continue;
        const info = toInfo(entry);
        if (Object.keys(info).length) map[seriesName(entry.name)] = info;
      }
      await kvSet(key, { at: Date.now(), map });
      return map;
    })().catch(() => null);
    catalogs.set(key, job);
  }
  return job;
}

export async function seriesInfo(series: SeriesGroup): Promise<ExtraInfo | null> {
  // Login consultado sob demanda: as informações vieram junto com a série.
  const remote = remoteSeriesInfo(series.id);
  if (remote) return toInfo(remote);
  const first = series.seasons[0]?.episodes[0];
  const provider = first ? providerOf(first.url) : null;
  if (!provider || provider.kind !== 'series') return null;
  const catalog = await seriesCatalog(series.playlistId, provider);
  return catalog?.[seriesName(series.title)] ?? null;
}

/** `undefined` enquanto carrega; `null` quando a lista não fornece informações. */
export function useMovieInfo(item: MediaItem | undefined): ExtraInfo | null | undefined {
  const [info, setInfo] = useState<ExtraInfo | null | undefined>(undefined);
  useEffect(() => {
    setInfo(undefined);
    if (!item || item.kind !== 'movie') {
      setInfo(null);
      return;
    }
    let alive = true;
    void movieInfo(item).then((result) => alive && setInfo(result));
    return () => {
      alive = false;
    };
  }, [item]);
  return info;
}

export function useSeriesInfo(series: SeriesGroup | undefined): ExtraInfo | null | undefined {
  const [info, setInfo] = useState<ExtraInfo | null | undefined>(undefined);
  useEffect(() => {
    setInfo(undefined);
    if (!series) {
      setInfo(null);
      return;
    }
    let alive = true;
    void seriesInfo(series).then((result) => alive && setInfo(result));
    return () => {
      alive = false;
    };
  }, [series?.id, series?.seasons.length]);
  return info;
}

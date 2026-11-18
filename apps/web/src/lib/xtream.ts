/**
 * Login Xtream Codes consultado sob demanda (player_api.php).
 *
 * Em vez de baixar a lista M3U inteira (que inclui cada episódio de cada série), o TuiTV pede ao servidor
 * do provedor apenas o que a tela precisa: categorias ao conectar, canais e filmes de uma categoria ao abri-la,
 * episódios de uma série ao abrir a série. Nada disso é guardado no dispositivo.
 *
 * Ids estáveis embutem o tipo e o id do servidor; com eles um favorito ou um item do histórico pode ser
 * reaberto sem consultar o catálogo:
 *   canal    `${playlistId}:x:l:${streamId}`
 *   filme    `${playlistId}:x:m:${streamId}.${extensão}`
 *   episódio `${playlistId}:x:e:${seriesId}:${episodeId}.${extensão}`
 *   série    `${playlistId}:s:x${seriesId}`
 */
import { extractYear, groupSeries, itemId, seriesId as makeSeriesId, type SeriesGroup } from '@tuitv/business-rules';
import type { MediaItem, Playlist, PlaylistAccount, PlaylistCounts } from '@tuitv/shared-models';
import { cleanName, maskUrl, parseXtreamUrl, safeImageUrl, type XtreamLogin } from '@tuitv/validation';
import { corsFetch, hasCorsProxy, ImportError } from './net';

export type RemoteKind = 'live' | 'movie' | 'series';
export const REMOTE_KINDS: RemoteKind[] = ['live', 'movie', 'series'];

export interface RemoteCategory {
  id: string;
  name: string;
}

/** O servidor não oferece a API (player_api.php ausente ou resposta inesperada): usar a lista M3U. */
export class NoXtreamApi extends Error {}

export const isXtream = (playlist: Playlist) => playlist.provider === 'xtream';

export function loginOf(playlist: Playlist): XtreamLogin | undefined {
  return playlist.url ? parseXtreamUrl(playlist.url) : undefined;
}

const ACTIONS: Record<RemoteKind, { categories: string; list: string }> = {
  live: { categories: 'get_live_categories', list: 'get_live_streams' },
  movie: { categories: 'get_vod_categories', list: 'get_vod_streams' },
  series: { categories: 'get_series_categories', list: 'get_series' },
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (value: unknown): string | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const clean = String(value).trim();
  return clean || undefined;
};

/**
 * Servidores Xtream costumam derrubar conexões quando recebem muitas consultas ao mesmo tempo
 * (cada fileira de categoria na tela faz a sua). Por isso há um limite de consultas simultâneas
 * por servidor, e uma falha de rede é repetida algumas vezes antes de virar erro na tela.
 */
const MAX_PARALLEL = 2;
const RETRY_DELAYS = [1500, 4000];
const lanes = new Map<string, { active: number; queue: (() => void)[] }>();

async function inLane<T>(host: string, task: () => Promise<T>): Promise<T> {
  let lane = lanes.get(host);
  if (!lane) lanes.set(host, (lane = { active: 0, queue: [] }));
  if (lane.active >= MAX_PARALLEL) await new Promise<void>((resolve) => lane.queue.push(resolve));
  lane.active++;
  try {
    return await task();
  } finally {
    lane.active--;
    lane.queue.shift()?.();
  }
}

const isNetworkFailure = (error: unknown) => error instanceof ImportError && error.code === 'network-or-cors';

/** Consulta o player_api.php, respeitando o limite por servidor e repetindo falhas de rede. */
async function call(login: XtreamLogin, params: Record<string, string>, timeoutSeconds: number): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await inLane(login.host, () => callOnce(login, params, timeoutSeconds));
    } catch (error) {
      const delay = RETRY_DELAYS[attempt];
      if (delay === undefined || !isNetworkFailure(error) || (typeof navigator !== 'undefined' && navigator.onLine === false)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/** Uma consulta ao player_api.php. Credenciais nunca aparecem em logs. */
async function callOnce(login: XtreamLogin, params: Record<string, string>, timeoutSeconds: number): Promise<unknown> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ImportError('offline');
  const query = new URLSearchParams({ username: login.username, password: login.password, ...params });
  const url = `${login.host}/player_api.php?${query.toString()}`;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutSeconds * 1000);
  let response: Response;
  let body: string;
  try {
    response = await corsFetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal });
    body = await response.text();
  } catch {
    if (timedOut) throw new ImportError('timeout');
    if (!hasCorsProxy && typeof location !== 'undefined' && location.protocol === 'https:' && url.startsWith('http:')) throw new ImportError('mixed-content');
    console.warn('[TuiTV] falha ao consultar', maskUrl(url));
    throw new ImportError('network-or-cors');
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 404) throw new NoXtreamApi();
  if (response.status === 401 || response.status === 403) throw new ImportError('login-invalid');
  if (!response.ok) throw new ImportError('http', String(response.status));
  if (!body.trim()) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new NoXtreamApi();
  }
}

/** Alguns servidores respondem `{}` ou `null` no lugar de uma lista vazia. */
const asList = (data: unknown): Record<string, unknown>[] => (Array.isArray(data) ? data.filter(isObject) : []);

async function categories(login: XtreamLogin, kind: RemoteKind, timeout: number): Promise<RemoteCategory[]> {
  const out: RemoteCategory[] = [];
  const seen = new Set<string>();
  for (const entry of asList(await call(login, { action: ACTIONS[kind].categories }, timeout))) {
    const id = str(entry.category_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: cleanName(str(entry.category_name) ?? '', 'Outros') });
  }
  return out;
}

export interface Connection {
  account: PlaylistAccount;
  categories: Record<RemoteKind, RemoteCategory[]>;
}

/** Valida a conta e lê as categorias. Lança NoXtreamApi quando o servidor não oferece a API. */
export async function connect(login: XtreamLogin, timeout: number): Promise<Connection> {
  const data = await call(login, {}, timeout);
  if (!isObject(data) || !isObject(data.user_info)) throw new NoXtreamApi();
  const user = data.user_info;
  if (Number(user.auth) !== 1) throw new ImportError('login-invalid');
  const status = str(user.status);
  if (status && status.toLowerCase() !== 'active') throw new ImportError('account-inactive', status);
  const [live, movie, series] = await Promise.all(REMOTE_KINDS.map((kind) => categories(login, kind, timeout)));
  const counts: PlaylistCounts = { live: live!.length, movie: movie!.length, series: series!.length };
  const account: PlaylistAccount = { categories: counts };
  if (status) account.status = status;
  const expires = Number(user.exp_date);
  if (Number.isFinite(expires) && expires > 0) account.expiresAt = expires * 1000;
  const connections = Number(user.max_connections);
  if (Number.isFinite(connections) && connections > 0) account.maxConnections = connections;
  return { account, categories: { live: live!, movie: movie!, series: series! } };
}

const seg = encodeURIComponent;
const EXT = /^[a-z0-9]{1,5}$/i;
const ext = (value: unknown, fallback: string) => {
  const e = str(value);
  return e && EXT.test(e) ? e : fallback;
};

function streamUrl(login: XtreamLogin, path: 'live' | 'movie' | 'series', file: string): string {
  return `${login.host}/${path}/${seg(login.username)}/${seg(login.password)}/${file}`;
}

/** Canais ou filmes de uma categoria (ou de todas, sem categoryId). */
export async function streams(
  playlistId: string,
  login: XtreamLogin,
  kind: 'live' | 'movie',
  categoryNames: Map<string, string>,
  categoryId: string | undefined,
  timeout: number,
): Promise<MediaItem[]> {
  const params: Record<string, string> = { action: ACTIONS[kind].list };
  if (categoryId) params.category_id = categoryId;
  const out: MediaItem[] = [];
  let order = 0;
  for (const entry of asList(await call(login, params, timeout))) {
    const sid = str(entry.stream_id);
    if (!sid || !/^\d+$/.test(sid)) continue;
    const fallbackName = kind === 'live' ? `Canal ${sid}` : `Filme ${sid}`;
    const name = cleanName(str(entry.name) ?? '', fallbackName);
    const key = kind === 'live' ? `x:l:${sid}` : `x:m:${sid}.${ext(entry.container_extension, 'mp4')}`;
    const item: MediaItem = {
      id: itemId(playlistId, key),
      playlistId,
      key,
      kind,
      name,
      url: kind === 'live' ? streamUrl(login, 'live', `${sid}.ts`) : streamUrl(login, 'movie', `${sid}.${ext(entry.container_extension, 'mp4')}`),
      order: order++,
    };
    const logo = safeImageUrl(str(entry.stream_icon));
    if (logo) item.logo = logo;
    const group = categoryNames.get(str(entry.category_id) ?? '');
    if (group) item.group = group;
    const tvgId = kind === 'live' ? str(entry.epg_channel_id) : undefined;
    if (tvgId) item.tvgId = tvgId;
    if (kind === 'movie') {
      const year = Number(str(entry.year)) || extractYear(name);
      if (year && year > 1900 && year < 2100) item.year = year;
    }
    out.push(item);
  }
  return out;
}

/** Informações de cada série (sinopse, gênero…), para a tela da série e o destaque. */
const seriesRaw = new Map<string, Record<string, unknown>>();
export const remoteSeriesInfo = (id: string) => seriesRaw.get(id);

/** Séries de uma categoria (ou de todas), ainda sem episódios. */
export async function seriesList(
  playlistId: string,
  login: XtreamLogin,
  categoryNames: Map<string, string>,
  categoryId: string | undefined,
  timeout: number,
): Promise<SeriesGroup[]> {
  const params: Record<string, string> = { action: ACTIONS.series.list };
  if (categoryId) params.category_id = categoryId;
  const out: SeriesGroup[] = [];
  for (const entry of asList(await call(login, params, timeout))) {
    const sid = str(entry.series_id);
    if (!sid || !/^\d+$/.test(sid)) continue;
    const title = cleanName(str(entry.name) ?? '', `Série ${sid}`);
    const series: SeriesGroup = { id: makeSeriesId(playlistId, `x${sid}`), playlistId, title, seasons: [], episodeCount: 0 };
    const logo = safeImageUrl(str(entry.cover));
    if (logo) series.logo = logo;
    const group = categoryNames.get(str(entry.category_id) ?? '');
    if (group) series.group = group;
    const year = Number(/\d{4}/.exec(str(entry.releaseDate) ?? str(entry.release_date) ?? str(entry.year) ?? '')?.[0]) || extractYear(title);
    if (year && year > 1900 && year < 2100) series.year = year;
    seriesRaw.set(series.id, entry);
    out.push(series);
  }
  return out;
}

/** Id do servidor de uma série remota (`${playlistId}:s:x${id}`). */
export function remoteSeriesId(playlistId: string, id: string): string | undefined {
  const prefix = `${playlistId}:s:x`;
  return id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length)) ? id.slice(prefix.length) : undefined;
}

/** Série completa, com temporadas e episódios. */
export async function seriesEpisodes(
  playlistId: string,
  login: XtreamLogin,
  sid: string,
  stub: SeriesGroup | undefined,
  categoryNames: Map<string, string>,
  timeout: number,
): Promise<SeriesGroup> {
  const data = await call(login, { action: 'get_series_info', series_id: sid }, timeout);
  const info = isObject(data) && isObject(data.info) ? data.info : {};
  const id = makeSeriesId(playlistId, `x${sid}`);
  if (Object.keys(info).length) seriesRaw.set(id, { ...seriesRaw.get(id), ...info });
  const title = stub?.title ?? cleanName(str(info.name) ?? '', `Série ${sid}`);
  const cover = stub?.logo ?? safeImageUrl(str(info.cover));
  const group = stub?.group ?? categoryNames.get(str(info.category_id) ?? '');
  // "episodes" costuma ser { "1": [...], "2": [...] }; alguns servidores usam uma lista de listas.
  const raw = isObject(data) ? data.episodes : undefined;
  const buckets: unknown[] = isObject(raw) ? Object.values(raw) : Array.isArray(raw) ? raw : [];
  const episodes: MediaItem[] = [];
  let order = 0;
  for (const bucket of buckets) {
    for (const entry of asList(bucket)) {
      const epId = str(entry.id);
      if (!epId || !/^\d+$/.test(epId)) continue;
      const extension = ext(entry.container_extension, 'mp4');
      const season = Number(str(entry.season)) || 0;
      const number = Number(str(entry.episode_num)) || 0;
      const details = isObject(entry.info) ? entry.info : {};
      const key = `x:e:${sid}:${epId}.${extension}`;
      const episode: MediaItem = {
        id: itemId(playlistId, key),
        playlistId,
        key,
        kind: 'series',
        name: cleanName(str(entry.title) ?? '', season ? `T${season} E${number}` : `Episódio ${number || epId}`),
        url: streamUrl(login, 'series', `${epId}.${extension}`),
        series: { title, seriesKey: `x${sid}`, season, episode: number },
        order: order++,
      };
      const logo = safeImageUrl(str(details.movie_image)) ?? cover;
      if (logo) episode.logo = logo;
      if (group) episode.group = group;
      const duration = Number(str(details.duration_secs));
      if (duration > 0) episode.duration = duration;
      const plot = str(details.plot);
      if (plot) episode.description = plot.slice(0, 2000);
      episodes.push(episode);
    }
  }
  const built = groupSeries(episodes)[0];
  const series: SeriesGroup = built ?? { id, playlistId, title, seasons: [], episodeCount: 0 };
  series.id = id;
  series.title = title;
  if (cover) series.logo = cover;
  if (group) series.group = group;
  if (stub?.year) series.year = stub.year;
  return series;
}

/**
 * Reconstrói um item remoto a partir do id (para favoritos, histórico e o último canal),
 * sem consultar o servidor. Nome e capa vêm do que foi guardado com o favorito/histórico.
 */
export function itemFromId(playlist: Playlist, id: string, meta?: { name?: string; logo?: string; group?: string }): MediaItem | undefined {
  const login = loginOf(playlist);
  if (!login || !id.startsWith(`${playlist.id}:`)) return undefined;
  const key = id.slice(playlist.id.length + 1);
  const base = { id, playlistId: playlist.id, key, order: 0, name: meta?.name ?? '' } as const;
  const extra: Partial<MediaItem> = {};
  if (meta?.logo) extra.logo = meta.logo;
  if (meta?.group) extra.group = meta.group;
  let m = /^x:l:(\d+)$/.exec(key);
  if (m) return { ...base, ...extra, kind: 'live', url: streamUrl(login, 'live', `${m[1]}.ts`) };
  m = /^x:m:(\d+)\.([a-z0-9]{1,5})$/i.exec(key);
  if (m) return { ...base, ...extra, kind: 'movie', url: streamUrl(login, 'movie', `${m[1]}.${m[2]}`) };
  m = /^x:e:(\d+):(\d+)\.([a-z0-9]{1,5})$/i.exec(key);
  if (m) {
    return {
      ...base,
      ...extra,
      kind: 'series',
      url: streamUrl(login, 'series', `${m[2]}.${m[3]}`),
      series: { title: '', seriesKey: `x${m[1]}`, season: 0, episode: 0 },
    };
  }
  return undefined;
}

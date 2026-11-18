import {
  BACKUP_APP_ID,
  BACKUP_SCHEMA_VERSION,
  type BackupData,
  type BackupEnvelope,
} from '@tuitv/shared-models';

/** Limites de importação (bytes). */
export const MAX_PLAYLIST_BYTES = 200 * 1024 * 1024;
export const MAX_EPG_BYTES = 400 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 300 * 1024 * 1024;
export const MAX_NAME_LENGTH = 80;

export type UrlProblem = 'empty' | 'malformed' | 'scheme' | 'private-host' | 'embedded-credentials';

export interface UrlCheck {
  ok: boolean;
  url?: string;
  problem?: UrlProblem;
}

function parseIpv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

/** Indica se o host aponta para loopback, rede privada, link-local ou nomes internos. */
export function isPrivateHost(hostname: string): boolean {
  let host = hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home')) return true;
  const v4 = parseIpv4(host);
  if (v4) {
    const [a, b] = v4 as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true;
    if (/^f[cd]/.test(host)) return true; // fc00::/7
    if (/^fe[89ab]/.test(host)) return true; // fe80::/10
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
    if (mapped) return isPrivateHost(mapped[1]!);
    return false;
  }
  // Nome sem ponto (ex.: "roteador") resolve apenas na rede interna.
  return !host.includes('.');
}

export interface UrlOptions {
  /** Permite endereços de rede local/privada (decisão explícita do usuário). */
  allowPrivate?: boolean;
}

/** Valida um endereço remoto a ser baixado pelo aplicativo (lista ou EPG). */
export function validateRemoteUrl(input: string, opts: UrlOptions = {}): UrlCheck {
  const raw = input.trim();
  if (!raw) return { ok: false, problem: 'empty' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, problem: 'malformed' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, problem: 'scheme' };
  if (!url.hostname) return { ok: false, problem: 'malformed' };
  if (!opts.allowPrivate && isPrivateHost(url.hostname)) return { ok: false, problem: 'private-host' };
  return { ok: true, url: url.toString() };
}

const SECRET_PARAMS = /^(username|user|login|password|pass|pwd|token|key|apikey|api_key|auth|signature|sig|secret|hash)$/i;

/** Caminho direto no estilo `/usuario/senha/123` ou `/usuario/senha/123.ts`. */
const DIRECT_PATH = /^\/[^/.]+\/[^/.]+\/(\d+(?:\.\w+)?)$/;

/** O endereço carrega credenciais ou tokens (userinfo, parâmetros ou caminho no estilo /usuario/senha/). */
export function hasCredentials(input: string): boolean {
  try {
    const url = new URL(input);
    if (url.username || url.password) return true;
    for (const key of url.searchParams.keys()) if (SECRET_PARAMS.test(key)) return true;
    return /^\/(live|movie|series)\/[^/]+\/[^/]+\//.test(url.pathname) || DIRECT_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

/** Versão do endereço segura para exibição e registros: oculta credenciais e tokens. */
export function maskUrl(input: string): string {
  try {
    const url = new URL(input);
    let out = `${url.protocol}//`;
    if (url.username || url.password) out += '•••@';
    out += url.host;
    out += url.pathname.replace(/^\/(live|movie|series)\/[^/]+\/[^/]+\//, '/$1/•••/•••/').replace(DIRECT_PATH, '/•••/•••/$1');
    const params: string[] = [];
    for (const [key, value] of url.searchParams) {
      params.push(`${key}=${SECRET_PARAMS.test(key) || value.length > 24 ? '•••' : value}`);
    }
    if (params.length) out += `?${params.join('&')}`;
    return out;
  } catch {
    return '•••';
  }
}

/**
 * Login no formato Xtream Codes (host + usuário + senha), usado pela maioria dos provedores IPTV.
 * O aplicativo monta o endereço da lista M3U a partir desses dados; nada é enviado a outro servidor.
 */
export interface XtreamLogin {
  /** Base normalizada, sem barra final (ex.: "http://servidor.com:8080"). */
  host: string;
  username: string;
  password: string;
}

const XTREAM_ENDPOINT = /\/(get|player_api|xmltv)\.php$/i;

/**
 * Normaliza o host digitado: aceita "servidor.com:8080", "http://servidor.com:8080/" ou até um endereço
 * completo de get.php. Sem esquema, assume http://. Retorna undefined se não for http(s) válido.
 */
export function normalizeXtreamHost(input: string): string | undefined {
  let raw = input.trim();
  if (!raw) return undefined;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) raw = `http://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  if (!parsed.hostname) return undefined;
  const path = parsed.pathname.replace(XTREAM_ENDPOINT, '').replace(/\/+$/, '');
  return `${parsed.protocol}//${parsed.host}${path}`;
}

const enc = (value: string) => encodeURIComponent(value.trim());

/** Endereço da lista M3U (canais, filmes e séries) para o login informado. */
export function xtreamPlaylistUrl(login: XtreamLogin): string {
  return `${login.host}/get.php?username=${enc(login.username)}&password=${enc(login.password)}&type=m3u_plus&output=ts`;
}

/** Endereço do guia de programação (XMLTV) do mesmo login. */
export function xtreamEpgUrl(login: XtreamLogin): string {
  return `${login.host}/xmltv.php?username=${enc(login.username)}&password=${enc(login.password)}`;
}

/** Recupera host, usuário e senha de um endereço get.php (para exibir "usuário em host"). */
export function parseXtreamUrl(input: string): XtreamLogin | undefined {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return undefined;
  }
  if (!/\/get\.php$/i.test(parsed.pathname)) return undefined;
  const username = parsed.searchParams.get('username');
  const password = parsed.searchParams.get('password');
  if (!username || !password) return undefined;
  const host = normalizeXtreamHost(input);
  return host ? { host, username, password } : undefined;
}

/** Endereços de imagem aceitos em logotipos e capas. */
export function safeImageUrl(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(value)) return value;
  return undefined;
}

export function cleanName(input: string, fallback = ''): string {
  // eslint-disable-next-line no-control-regex
  const value = input.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (value || fallback).slice(0, MAX_NAME_LENGTH);
}

export type BackupProblem = 'not-json' | 'not-tuitv' | 'newer-version' | 'invalid-structure';

export interface BackupCheck {
  ok: boolean;
  envelope?: BackupEnvelope;
  problem?: BackupProblem;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateBackupData(data: unknown): data is BackupData {
  if (!isObject(data)) return false;
  if (!Array.isArray(data.playlists) || !Array.isArray(data.favorites) || !Array.isArray(data.history)) return false;
  if (!isObject(data.settings)) return false;
  for (const entry of data.playlists) {
    if (!isObject(entry) || !isObject(entry.playlist)) return false;
    const p = entry.playlist;
    if (typeof p.id !== 'string' || typeof p.name !== 'string') return false;
    if (p.source !== 'url' && p.source !== 'file') return false;
    if (p.source === 'url' && typeof p.url !== 'string') return false;
    if (entry.items !== undefined && !Array.isArray(entry.items)) return false;
  }
  for (const fav of data.favorites) {
    if (!isObject(fav) || typeof fav.id !== 'string' || typeof fav.playlistId !== 'string') return false;
  }
  for (const h of data.history) {
    if (!isObject(h) || typeof h.itemId !== 'string' || typeof h.playedAt !== 'number') return false;
  }
  return true;
}

/** Valida o envelope de um arquivo de backup (antes de decifrar, se protegido por senha). */
export function validateBackupEnvelope(text: string): BackupCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'not-json' };
  }
  if (!isObject(parsed) || parsed.app !== BACKUP_APP_ID) return { ok: false, problem: 'not-tuitv' };
  if (typeof parsed.schemaVersion !== 'number') return { ok: false, problem: 'invalid-structure' };
  if (parsed.schemaVersion > BACKUP_SCHEMA_VERSION) return { ok: false, problem: 'newer-version' };
  if (parsed.encrypted === true) {
    const c = parsed.cipher;
    if (
      !isObject(c) ||
      typeof c.salt !== 'string' ||
      typeof c.iv !== 'string' ||
      typeof c.payload !== 'string' ||
      typeof c.iterations !== 'number'
    ) {
      return { ok: false, problem: 'invalid-structure' };
    }
  } else if (!validateBackupData(parsed.data)) {
    return { ok: false, problem: 'invalid-structure' };
  }
  return { ok: true, envelope: parsed as unknown as BackupEnvelope };
}

/**
 * Modelos de dados compartilhados do TuiTV.
 * As versões Android (Room) espelham estes mesmos campos.
 */

export type ContentKind = 'live' | 'movie' | 'series';

export type PlaylistSource = 'url' | 'file';

export interface PlaylistCounts {
  live: number;
  movie: number;
  series: number;
}

export interface Playlist {
  id: string;
  name: string;
  source: PlaylistSource;
  /** Endereço remoto (somente para source = 'url'). Pode conter credenciais. */
  url?: string;
  /** Nome do arquivo original (somente para source = 'file'). */
  fileName?: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  itemCount: number;
  counts: PlaylistCounts;
  /** Endereço de EPG anunciado pelo cabeçalho da lista (url-tvg / x-tvg-url). */
  epgUrl?: string;
  /** Quantidade de registros ignorados na última importação. */
  skipped?: number;
  /**
   * Como o conteúdo é obtido:
   *  - ausente / 'm3u': lista importada e guardada no dispositivo;
   *  - 'xtream': login Xtream Codes consultado sob demanda no servidor (player_api.php). Nada do catálogo é
   *    guardado: categorias, canais, filmes e episódios são buscados quando a tela precisa.
   */
  provider?: 'm3u' | 'xtream';
  /** Dados da conta informados pelo servidor (somente provider = 'xtream'). */
  account?: PlaylistAccount;
}

export interface PlaylistAccount {
  /** Situação informada pelo servidor (ex.: "Active"). */
  status?: string;
  /** Vencimento da assinatura (epoch em ms), quando informado. */
  expiresAt?: number;
  maxConnections?: number;
  /** Quantidade de categorias de cada tipo no servidor. */
  categories: PlaylistCounts;
}

export interface SeriesInfo {
  /** Título da série, sem a marcação de temporada/episódio. */
  title: string;
  /** Identificador estável da série dentro da lista. */
  seriesKey: string;
  season: number;
  episode: number;
}

export interface MediaItem {
  /** `${playlistId}:${key}` */
  id: string;
  playlistId: string;
  /** Chave estável derivada dos metadados (não depende do endereço de reprodução). */
  key: string;
  kind: ContentKind;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  tvgId?: string;
  tvgName?: string;
  series?: SeriesInfo;
  year?: number;
  /** Duração em segundos, quando informada pela lista. */
  duration?: number;
  description?: string;
  /** Posição original na lista. */
  order: number;
}

export type FavoriteKind = ContentKind;

export interface Favorite {
  /** Id do item (canal/filme) ou id da série (`${playlistId}:s:${seriesKey}`). */
  id: string;
  kind: FavoriteKind;
  playlistId: string;
  addedAt: number;
  /**
   * Nome e capa no momento em que foi favoritado. Itens de listas consultadas sob demanda (login Xtream)
   * não ficam guardados no dispositivo: o favorito precisa se mostrar sem consultar o servidor.
   */
  snapshot?: { name: string; logo?: string; group?: string; year?: number };
}

export interface HistoryEntry {
  itemId: string;
  playlistId: string;
  kind: ContentKind;
  name: string;
  logo?: string;
  /** Id da série, para episódios. */
  seriesId?: string;
  /** Episódios: título e capa da série (o histórico mostra a série, não o episódio). */
  seriesTitle?: string;
  seriesLogo?: string;
  /** Episódios: temporada e número (0 quando a lista não informa). */
  season?: number;
  episode?: number;
  playedAt: number;
  /** Posição em segundos (filmes e episódios). */
  position: number;
  duration: number;
  completed: boolean;
}

export interface EpgSource {
  id: string;
  name: string;
  source: PlaylistSource;
  url?: string;
  fileName?: string;
  updatedAt: number;
  channelCount: number;
  programmeCount: number;
}

export interface EpgChannel {
  /** `${sourceId}|${channelId}` */
  id: string;
  sourceId: string;
  channelId: string;
  displayNames: string[];
  icon?: string;
}

export interface Programme {
  sourceId: string;
  channelId: string;
  /** Epoch em milissegundos (UTC). */
  start: number;
  stop: number;
  title: string;
  description?: string;
  category?: string;
}

export type AspectMode = 'contain' | 'cover' | 'fill';
export type Language = 'pt-BR' | 'en';
export type Theme = 'dark' | 'light';

export interface ParentalSettings {
  enabled: boolean;
  /** Derivação PBKDF2 do PIN (base64). O PIN nunca é armazenado. */
  pinHash?: string;
  pinSalt?: string;
  /** Oculta automaticamente categorias identificadas como conteúdo adulto. */
  hideAdult: boolean;
  /** Categorias bloqueadas manualmente (nomes normalizados). */
  lockedGroups: string[];
}

export interface Settings {
  theme: Theme;
  language: Language;
  autoplay: boolean;
  autoReconnect: boolean;
  /** Segundos. */
  connectionTimeout: number;
  /** Código de idioma preferido (ex.: "por", "pt", "en") ou vazio. */
  audioLanguage: string;
  subtitlesEnabled: boolean;
  subtitleLanguage: string;
  aspect: AspectMode;
  volume: number;
  /** Atualiza listas e guias remotos automaticamente quando mais antigos que este intervalo (horas). 0 desativa. */
  autoRefreshHours: number;
  /** Permite importar de endereços de rede local/privada. */
  allowPrivateHosts: boolean;
  parental: ParentalSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  language: 'pt-BR',
  autoplay: true,
  autoReconnect: true,
  connectionTimeout: 15,
  audioLanguage: '',
  subtitlesEnabled: false,
  subtitleLanguage: '',
  aspect: 'contain',
  volume: 1,
  autoRefreshHours: 24,
  allowPrivateHosts: false,
  parental: { enabled: false, hideAdult: true, lockedGroups: [] },
};

/** Versão do esquema do arquivo de backup. */
export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_APP_ID = 'tuitv';

export interface BackupPlaylist {
  playlist: Playlist;
  /** Itens incluídos apenas para listas importadas por arquivo (não podem ser baixadas de novo). */
  items?: MediaItem[];
}

export interface BackupData {
  playlists: BackupPlaylist[];
  favorites: Favorite[];
  history: HistoryEntry[];
  epgSources: EpgSource[];
  settings: Settings;
}

export interface BackupEnvelope {
  app: typeof BACKUP_APP_ID;
  schemaVersion: number;
  createdAt: number;
  platform: 'web' | 'android' | 'android-tv';
  encrypted: boolean;
  /** Presente quando encrypted = false. */
  data?: BackupData;
  /** Presentes quando encrypted = true (AES-256-GCM + PBKDF2-SHA256, base64). */
  cipher?: { kdf: 'PBKDF2-SHA256'; iterations: number; salt: string; iv: string; payload: string };
}

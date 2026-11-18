import type { ContentKind } from '@tuitv/shared-models';
import type { M3uEntry } from '@tuitv/m3u-parser';

/**
 * Regras de classificação (iguais em Kotlin — ver Classifier.kt):
 *  1. Atributo explícito tvg-type/type.
 *  2. Caminho do endereço: /series/ → série, /movie(s)/ → filme, /live/ → ao vivo.
 *  3. Extensão de arquivo de vídeo: com marcação de episódio → série; senão → filme.
 *  4. Marcação de episódio + categoria de séries → série.
 *  5. Caso contrário → ao vivo.
 */

const VOD_EXT = /\.(mp4|mkv|avi|mov|webm|m4v|wmv|flv|mpg|mpeg|ogv|3gp)$/i;
const SERIES_GROUP = /(s[eé]ries?|novelas?|animes?|doramas?|temporadas?|tv shows?)/i;

const SEP = '(?:^|[ \\t._\\-\\[(|:])';
const EPISODE_PATTERNS: RegExp[] = [
  new RegExp(`^(.*?)${SEP}[ST](\\d{1,2})[ \\t._-]*E(?:P)?(\\d{1,4})(?![0-9])`, 'i'),
  new RegExp(`^(.*?)${SEP}(\\d{1,2})x(\\d{2,4})(?![0-9])`, 'i'),
  new RegExp(
    `^(.*?)${SEP}(?:temporada|season)[ \\t]*(\\d{1,2})[^0-9]{1,14}?(?:epis[oó]dio|episode|ep\\.?)[ \\t]*(\\d{1,4})`,
    'i',
  ),
];
const YEAR_BRACKET = /[([]((?:19|20)\d{2})[)\]]/;
const YEAR_TRAILING = / - ((?:19|20)\d{2})$/;

export interface EpisodeMatch {
  title: string;
  season: number;
  episode: number;
}

export function urlPath(url: string): string {
  const afterScheme = url.indexOf('://');
  const rest = afterScheme >= 0 ? url.slice(afterScheme + 3) : url;
  const end = rest.search(/[?#]/);
  const noQuery = end >= 0 ? rest.slice(0, end) : rest;
  const slash = noQuery.indexOf('/');
  return slash >= 0 ? noQuery.slice(slash) : '/';
}

export function matchEpisode(name: string): EpisodeMatch | null {
  for (const pattern of EPISODE_PATTERNS) {
    const m = pattern.exec(name);
    if (m) {
      const title = (m[1] ?? '').replace(/[ \t._\-|:[(]+$/, '').trim();
      return { title: title || name.trim(), season: Number(m[2]), episode: Number(m[3]) };
    }
  }
  return null;
}

export function extractYear(name: string): number | undefined {
  const m = YEAR_BRACKET.exec(name) ?? YEAR_TRAILING.exec(name);
  return m ? Number(m[1]) : undefined;
}

function explicitKind(attrs: Record<string, string>): ContentKind | null {
  const raw = (attrs['tvg-type'] ?? attrs['type'] ?? '').toLowerCase();
  if (!raw) return null;
  if (raw === 'live' || raw === 'stream' || raw === 'channel') return 'live';
  if (raw === 'movie' || raw === 'movies' || raw === 'vod') return 'movie';
  if (raw === 'series' || raw === 'serie' || raw === 'tvshow') return 'series';
  return null;
}

export interface Classification {
  kind: ContentKind;
  episode: EpisodeMatch | null;
}

export function classifyEntry(entry: Pick<M3uEntry, 'name' | 'url' | 'attrs' | 'groupTitle'>): Classification {
  const episode = matchEpisode(entry.name);
  const explicit = explicitKind(entry.attrs);
  if (explicit) return { kind: explicit, episode: explicit === 'series' ? episode : null };

  const path = urlPath(entry.url).toLowerCase();
  if (path.includes('/series/')) return { kind: 'series', episode };
  if (path.includes('/movie/') || path.includes('/movies/')) return { kind: 'movie', episode: null };
  if (path.includes('/live/')) return { kind: 'live', episode: null };

  if (VOD_EXT.test(path)) return episode ? { kind: 'series', episode } : { kind: 'movie', episode: null };
  if (episode && SERIES_GROUP.test(entry.groupTitle ?? '')) return { kind: 'series', episode };
  return { kind: 'live', episode: null };
}

'use client';

import { Check, CheckCheck, Clapperboard, Play } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { continueEpisode, episodeTitle, hasEpisodeDetails } from '@tuitv/business-rules';
import type { MediaItem } from '@tuitv/shared-models';
import { AmbientBackdrop } from '@/components/AmbientBackdrop';
import { FavoriteButton } from '@/components/cards';
import { Synopsis } from '@/components/Synopsis';
import { Thumb } from '@/components/Thumb';
import { Chip, Empty, IconButton, cx } from '@/components/ui';
import { RemoteStatus } from '@/components/Catalog';
import { itemHref, useRemoteSeries } from '@/lib/hooks';
import { formatDuration, useT } from '@/lib/i18n';
import { useSeriesInfo } from '@/lib/meta';
import { useResolver, useStore } from '@/lib/store';

export default function SeriesViewPage() {
  return (
    <Suspense>
      <SeriesView />
    </Suspense>
  );
}

function SeriesView() {
  const t = useT();
  const id = useSearchParams().get('id') ?? '';
  const resolve = useResolver();
  const series = resolve.series(id);
  // Login: episódios pedidos ao servidor ao abrir a série.
  const load = useRemoteSeries(id);
  const historyById = useStore((s) => s.historyById);
  const setWatched = useStore((s) => s.setWatched);
  const [seasonIndex, setSeasonIndex] = useState<number | null>(null);
  const info = useSeriesInfo(series);

  // Mesma regra do histórico: o episódio mais adiante já assistido ou, se ele terminou, o seguinte.
  const upNext = useMemo(() => (series ? continueEpisode(series, (id) => historyById.get(id))?.episode : undefined), [series, historyById]);

  if (!series || series.seasons.length === 0) {
    if (load.loading || load.error) return <RemoteStatus load={load} />;
    if (series) {
      return (
        <Empty icon={<Clapperboard className="size-10" />} title={series.title}>
          <p>{t('Nenhum episódio disponível no servidor.')}</p>
        </Empty>
      );
    }
    return (
      <Empty icon={<Clapperboard className="size-10" />} title={t('Série não encontrada')}>
        <p>{t('Ela pode pertencer a uma lista desativada ou removida.')}</p>
      </Empty>
    );
  }

  const defaultSeason = Math.max(0, series.seasons.findIndex((s) => s.episodes.some((e) => e.id === upNext?.id)));
  const season = series.seasons[seasonIndex ?? defaultSeason] ?? series.seasons[0]!;
  const seasonLabel = (n: number) => (n > 0 ? t('Temporada {n}', { n }) : t('Episódios'));
  const allWatched = season.episodes.every((e) => historyById.get(e.id)?.completed);

  return (
    // Fundo como na ficha do filme: a capa da série preenche a tela, desfocada e escurecida.
    <div className="relative -mx-4 -mt-20 min-h-screen overflow-hidden lg:-mx-12" data-testid="series-page">
      <AmbientBackdrop src={info?.backdrop ?? series.logo} />
      <div className="relative mx-auto max-w-5xl px-4 pt-24 pb-12 lg:px-12">
        <header className="mb-8 flex gap-5 sm:gap-8">
          <Thumb src={series.logo} name={series.title} fit="cover" className="aspect-[2/3] w-28 shrink-0 rounded-xl shadow-2xl shadow-black/60 text-2xl sm:w-44" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-4xl">{series.title}</h1>
            <p className="mt-2 text-sm text-muted sm:text-base">
              {[series.year, series.group, t('{n} temporadas', { n: series.seasons.length }), t('{n} episódios', { n: series.episodeCount })].filter(Boolean).join(' · ')}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {upNext && (
                <Link href={itemHref(upNext)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-accent-ink hover:brightness-110">
                  <Play className="size-4" fill="currentColor" />
                  {upNext.series && upNext.series.season > 0
                    ? t('Assistir T{s} E{e}', { s: upNext.series.season, e: upNext.series.episode })
                    : t('Assistir')}
                </Link>
              )}
              <FavoriteButton id={series.id} kind="series" playlistId={series.playlistId} withLabel />
            </div>
            <Synopsis info={info} />
          </div>
        </header>

        <div className="mb-3 flex items-center gap-2">
          <div className="no-scrollbar flex flex-1 gap-2 overflow-x-auto p-0.5">
            {series.seasons.map((s, index) => (
              <Chip key={s.season} active={s === season} onClick={() => setSeasonIndex(index)}>
                {seasonLabel(s.season)}
              </Chip>
            ))}
          </div>
          <IconButton
            label={allWatched ? t('Marcar temporada como não assistida') : t('Marcar temporada como assistida')}
            onClick={() => season.episodes.forEach((e) => setWatched(e, !allWatched))}
            active={allWatched}
          >
            <CheckCheck className="size-5" />
          </IconButton>
        </div>

        {/* Com miniaturas ou sinopses próprias, cartões no estilo Netflix; sem, uma grade compacta e fácil de percorrer. */}
        {hasEpisodeDetails(season.episodes, series.logo) ? (
          <ul className="flex flex-col gap-1" data-testid="episodes" data-layout="cards">
            {season.episodes.map((episode) => (
              <EpisodeCard
                key={episode.id}
                episode={episode}
                seriesTitle={series.title}
                fallbackImage={series.logo}
                entry={historyById.get(episode.id)}
                onWatched={(watched) => setWatched(episode, watched)}
              />
            ))}
          </ul>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="episodes" data-layout="grid">
            {season.episodes.map((episode) => (
              <EpisodeTile
                key={episode.id}
                episode={episode}
                seriesTitle={series.title}
                entry={historyById.get(episode.id)}
                next={episode.id === upNext?.id}
                onWatched={(watched) => setWatched(episode, watched)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Cartão de episódio no estilo Netflix: número, miniatura 16:9 (com o progresso), título próprio do episódio,
 * duração e sinopse, quando a lista informa. Sem miniatura do episódio, usa a capa da série.
 */
function EpisodeCard({
  episode,
  seriesTitle,
  fallbackImage,
  entry,
  onWatched,
}: {
  episode: MediaItem;
  seriesTitle: string;
  fallbackImage?: string;
  entry?: { completed: boolean; position: number; duration: number };
  onWatched: (watched: boolean) => void;
}) {
  const t = useT();
  const number = episode.series?.episode ?? 0;
  const title = episodeTitle(episode.name, seriesTitle) ?? (number ? t('Episódio {n}', { n: number }) : episode.name);
  const watched = !!entry?.completed;
  const progress = entry && !watched && entry.duration > 0 ? entry.position / entry.duration : 0;
  const duration = episode.duration ? formatDuration(episode.duration, t) : null;
  return (
    <li className="flex items-center gap-1 rounded-xl pr-2 hover:bg-white/5">
      <Link
        href={itemHref(episode)}
        aria-label={`${number ? `${number}. ` : ''}${title}`}
        className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 -outline-offset-2 sm:gap-4 sm:p-3"
        data-episode={episode.id}
      >
        <span className="hidden w-7 shrink-0 text-center text-2xl font-bold text-muted tabular-nums sm:block">{number || '•'}</span>
        <span className="relative w-32 shrink-0 overflow-hidden rounded-lg bg-surface ring-1 ring-line transition group-hover:ring-2 group-hover:ring-accent group-focus-visible:ring-2 group-focus-visible:ring-accent sm:w-48">
          <Thumb src={episode.logo ?? fallbackImage} name={title} fit="cover" className="aspect-video w-full text-lg" />
          <span className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
            <span className="flex size-10 items-center justify-center rounded-full border-2 border-white bg-black/40">
              <Play className="size-5 text-white" fill="currentColor" />
            </span>
          </span>
          {progress > 0 && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
              <span className="block h-full bg-danger" style={{ width: `${Math.min(100, progress * 100)}%` }} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className={cx('line-clamp-2 text-sm font-semibold sm:text-base', watched && 'text-muted')}>
              <span className="sm:hidden">{number ? `${number}. ` : ''}</span>
              {title}
            </span>
            {duration && <span className="shrink-0 text-xs text-muted sm:text-sm">{duration}</span>}
          </span>
          {episode.description && <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted sm:line-clamp-3 sm:text-sm">{episode.description}</span>}
        </span>
      </Link>
      <IconButton
        label={watched ? t('Marcar como não assistido') : t('Marcar como assistido')}
        aria-pressed={watched}
        onClick={() => onWatched(!watched)}
        className={watched ? 'text-success' : ''}
      >
        <Check className="size-5" />
      </IconButton>
    </li>
  );
}

/**
 * Bloco da grade de episódios (quando a lista não traz miniatura nem sinopse por episódio): número grande,
 * título próprio (se houver), duração e o estado — "Próximo"/"Continuar" em destaque, progresso ou assistido.
 */
function EpisodeTile({
  episode,
  seriesTitle,
  entry,
  next,
  onWatched,
}: {
  episode: MediaItem;
  seriesTitle: string;
  entry?: { completed: boolean; position: number; duration: number };
  next: boolean;
  onWatched: (watched: boolean) => void;
}) {
  const t = useT();
  const number = episode.series?.episode ?? 0;
  const own = episodeTitle(episode.name, seriesTitle);
  const label = own ?? (number ? t('Episódio {n}', { n: number }) : episode.name);
  const watched = !!entry?.completed;
  const progress = entry && !watched && entry.duration > 0 ? entry.position / entry.duration : 0;
  const duration = episode.duration ? formatDuration(episode.duration, t) : null;
  return (
    <li className="relative">
      <Link
        href={itemHref(episode)}
        aria-label={`${number ? `${number}. ` : ''}${label}`}
        data-episode={episode.id}
        className={cx(
          'group flex h-full min-h-32 flex-col rounded-xl border p-3 transition sm:p-4',
          next ? 'border-accent bg-accent/12' : 'border-line bg-surface/70 hover:border-accent/70',
          watched && !next && 'opacity-60',
        )}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block text-[0.65rem] font-semibold tracking-[0.15em] text-muted uppercase">{t('Episódio')}</span>
            <span className="mt-1 block text-3xl leading-none font-extrabold tabular-nums">{number || '•'}</span>
          </span>
          {next && (
            <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[0.65rem] font-bold tracking-wide text-accent-ink uppercase">
              {progress > 0 ? t('Continuar') : t('Próximo')}
            </span>
          )}
        </span>
        {own && <span className="mt-2 line-clamp-2 text-sm leading-snug font-medium">{own}</span>}
        <span className="mt-auto flex items-center gap-1.5 pt-3 pr-8 text-xs text-muted">
          {watched ? (
            <>
              <Check className="size-3.5 text-success" /> {t('Assistido')}
            </>
          ) : (
            duration
          )}
        </span>
        {progress > 0 && (
          <span className="absolute inset-x-3 bottom-1.5 h-1 overflow-hidden rounded-full bg-black/40">
            <span className="block h-full bg-danger" style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </span>
        )}
      </Link>
      <IconButton
        label={watched ? t('Marcar como não assistido') : t('Marcar como assistido')}
        aria-pressed={watched}
        onClick={() => onWatched(!watched)}
        className={cx('absolute right-1 bottom-1', watched ? 'text-success' : 'text-muted')}
      >
        <Check className="size-4" />
      </IconButton>
    </li>
  );
}

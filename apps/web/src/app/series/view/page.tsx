'use client';

import { Check, CheckCheck, Clapperboard, Play } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { FavoriteButton } from '@/components/cards';
import { Synopsis } from '@/components/Synopsis';
import { Thumb } from '@/components/Thumb';
import { Chip, Empty, IconButton, cx } from '@/components/ui';
import { itemHref } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { useSeriesInfo } from '@/lib/meta';
import { useStore } from '@/lib/store';

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
  const series = useStore((s) => s.lib.seriesById.get(id));
  const historyById = useStore((s) => s.historyById);
  const setWatched = useStore((s) => s.setWatched);
  const [seasonIndex, setSeasonIndex] = useState<number | null>(null);
  const info = useSeriesInfo(series);

  const upNext = useMemo(() => {
    if (!series) return undefined;
    const all = series.seasons.flatMap((s) => s.episodes);
    return all.find((e) => !historyById.get(e.id)?.completed) ?? all[0];
  }, [series, historyById]);

  if (!series) {
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
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex gap-5">
        <Thumb src={series.logo} name={series.title} fit="cover" className="aspect-[2/3] w-28 shrink-0 rounded-xl border border-line text-2xl sm:w-40" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{series.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {[series.year, series.group, t('{n} temporadas', { n: series.seasons.length }), t('{n} episódios', { n: series.episodeCount })].filter(Boolean).join(' · ')}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {upNext && (
              <Link href={itemHref(upNext)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink hover:brightness-110">
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

      <ul className="overflow-hidden rounded-xl border border-line bg-surface">
        {season.episodes.map((episode) => {
          const entry = historyById.get(episode.id);
          const watched = !!entry?.completed;
          const progress = entry && !watched && entry.duration > 0 ? entry.position / entry.duration : 0;
          return (
            <li key={episode.id} className="flex items-center gap-1 border-b border-line/60 pr-2 last:border-0">
              <Link href={itemHref(episode)} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 -outline-offset-2 hover:bg-surface-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-bg text-sm font-bold tabular-nums text-muted">
                  {episode.series!.episode || '•'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx('block truncate text-sm font-medium', watched && 'text-muted')}>{episode.name}</span>
                  {progress > 0 && (
                    <span className="mt-1.5 block h-1 w-40 max-w-full overflow-hidden rounded-full bg-bg">
                      <span className="block h-full bg-accent" style={{ width: `${progress * 100}%` }} />
                    </span>
                  )}
                </span>
              </Link>
              <IconButton
                label={watched ? t('Marcar como não assistido') : t('Marcar como assistido')}
                aria-pressed={watched}
                onClick={() => setWatched(episode, !watched)}
                className={watched ? 'text-success' : ''}
              >
                <Check className="size-5" />
              </IconButton>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

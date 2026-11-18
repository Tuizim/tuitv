'use client';

import { ArrowLeft, Film, SkipForward } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useRef } from 'react';
import { nextEpisode } from '@tuitv/business-rules';
import { FavoriteButton, UnavailableBadge } from '@/components/cards';
import { Player } from '@/components/Player';
import { Synopsis } from '@/components/Synopsis';
import { Empty } from '@/components/ui';
import { itemHref, seriesHref, useRemoteSeries } from '@/lib/hooks';
import { formatDuration, useT } from '@/lib/i18n';
import { useMovieInfo, useSeriesInfo } from '@/lib/meta';
import { seriesIdOf, useResolver, useStore } from '@/lib/store';

export default function WatchPage() {
  return (
    <Suspense>
      <Watch />
    </Suspense>
  );
}

function Watch() {
  const t = useT();
  const router = useRouter();
  const id = useSearchParams().get('id') ?? '';
  const resolve = useResolver();
  const item = resolve.item(id);
  const autoplay = useStore((s) => s.settings.autoplay);
  const recordPlayback = useStore((s) => s.recordPlayback);

  // A posição de retomada é lida uma única vez por item (não deve mudar enquanto o vídeo toca).
  const resume = useRef<{ id: string; at: number } | null>(null);
  if (item && resume.current?.id !== item.id) {
    const entry = useStore.getState().historyById.get(item.id);
    resume.current = { id: item.id, at: entry && !entry.completed && entry.position > 10 ? entry.position : 0 };
  }

  const sid = item ? seriesIdOf(item) : undefined;
  // Login: os episódios da série (para o próximo episódio) vêm do servidor.
  useRemoteSeries(sid);
  const series = useMemo(() => (sid ? resolve.series(sid) : undefined), [sid, resolve]);
  const next = item && series ? nextEpisode(series, item.id) : undefined;
  const movieInfo = useMovieInfo(item);
  const seriesInfo = useSeriesInfo(series);

  if (!item) {
    return (
      <Empty icon={<Film className="size-10" />} title={t('Conteúdo não encontrado')}>
        <p>{t('Ele pode pertencer a uma lista desativada ou removida.')}</p>
      </Empty>
    );
  }

  const back = series ? seriesHref(series.id) : item.kind === 'movie' ? '/movies' : '/live';
  const episodeLabel = item.series && item.series.season > 0 ? t('Temporada {s} · Episódio {e}', { s: item.series.season, e: item.series.episode }) : undefined;

  return (
    <div className="mx-auto max-w-6xl">
      <Link href={back} className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> {series ? series.title : t('Voltar')}
      </Link>
      <Player
        item={item}
        startAt={resume.current?.at ?? 0}
        subtitle={episodeLabel}
        className="-mx-4 aspect-video max-h-[75dvh] w-[calc(100%+2rem)] sm:mx-0 sm:w-full sm:rounded-2xl"
        onProgress={recordPlayback}
        onEnded={() => {
          if (next && autoplay) router.replace(itemHref(next));
        }}
        onNext={next ? () => router.replace(itemHref(next)) : undefined}
      />
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-extrabold tracking-tight sm:text-2xl">
            {item.name} <UnavailableBadge id={item.id} />
          </h1>
          <p className="mt-1 text-sm text-muted">
            {[episodeLabel, item.year, item.duration ? formatDuration(item.duration, t) : null, item.group].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex gap-2">
          {next && (
            <Link href={itemHref(next)} replace className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-surface-2 px-4 text-sm font-semibold hover:brightness-110">
              <SkipForward className="size-4" /> {t('Próximo episódio')}
            </Link>
          )}
          {item.kind !== 'series' && <FavoriteButton id={item.id} kind={item.kind} playlistId={item.playlistId} withLabel />}
        </div>
      </div>
      {item.kind !== 'live' && <Synopsis info={item.kind === 'movie' ? movieInfo : seriesInfo} fallback={item.description} />}
    </div>
  );
}

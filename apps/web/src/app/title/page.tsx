'use client';

import { Film, Play, RotateCcw, Star } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';
import { UnavailableBadge } from '@/components/cards';
import { Synopsis } from '@/components/Synopsis';
import { Thumb } from '@/components/Thumb';
import { AmbientBackdrop } from '@/components/AmbientBackdrop';
import { Empty, cx } from '@/components/ui';
import { watchHref } from '@/lib/hooks';
import { formatClock, formatDuration, useT } from '@/lib/i18n';
import { useMovieInfo } from '@/lib/meta';
import { useResolver, useStore } from '@/lib/store';

/**
 * Ficha do filme (usada no aplicativo de TV): capa, sinopse e as ações Assistir e Favoritar,
 * como na Netflix. Assistir abre o player em tela cheia.
 */
export default function TitlePage() {
  return (
    <Suspense>
      <Title />
    </Suspense>
  );
}

/** Botão padrão da ficha: mesma altura e largura mínima, sem borda; branco no foco. */
const action =
  'tv-action inline-flex h-12 min-w-40 items-center justify-center gap-2.5 rounded-full px-7 text-base font-bold transition-transform duration-150';

function Title() {
  const t = useT();
  const router = useRouter();
  const id = useSearchParams().get('id') ?? '';
  const resolve = useResolver();
  const item = resolve.item(id);
  const entry = useStore((s) => s.historyById.get(id));
  const favorite = useStore((s) => s.favorites.has(id));
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const info = useMovieInfo(item);
  const play = useRef<HTMLButtonElement>(null);

  // O foco começa sempre em Assistir.
  useEffect(() => {
    const timer = window.setTimeout(() => play.current?.focus({ preventScroll: true }), 120);
    return () => window.clearTimeout(timer);
  }, [id]);

  if (!item) {
    return (
      <Empty icon={<Film className="size-10" />} title={t('Conteúdo não encontrado')}>
        <p>{t('Ele pode pertencer a uma lista desativada ou removida.')}</p>
      </Empty>
    );
  }

  const resume = entry && !entry.completed && entry.position > 10 ? entry.position : 0;
  const progress = resume && entry && entry.duration > 0 ? resume / entry.duration : 0;
  const backdrop = info?.backdrop ?? item.logo;
  const meta = [info?.year ?? item.year, item.duration ? formatDuration(item.duration, t) : null, info?.genre ?? item.group].filter(Boolean);

  const watch = (from: 'resume' | 'start') => {
    // "Do início" zera a posição salva antes de abrir o player.
    if (from === 'start' && entry) useStore.getState().recordPlayback(item, 0, entry.duration);
    router.push(watchHref(item));
  };

  return (
    <div className="relative -mx-4 -mt-20 min-h-screen overflow-hidden lg:-mx-12" data-testid="title-page">
      <AmbientBackdrop src={backdrop} />
      <div className="relative flex gap-10 px-4 pt-28 pb-12 lg:px-12">
        <div className="relative hidden w-56 shrink-0 overflow-hidden rounded-xl shadow-2xl shadow-black/60 sm:block">
          <Thumb src={item.logo} name={item.name} fit="cover" className="aspect-[2/3] w-full text-3xl" />
          {progress > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/60">
              <div className="h-full bg-danger" style={{ width: `${Math.min(100, progress * 100)}%` }} />
            </div>
          )}
        </div>
        <div className="min-w-0 max-w-3xl">
          <h1 className="flex flex-wrap items-center gap-3 text-4xl font-extrabold tracking-tight lg:text-5xl">
            {item.name} <UnavailableBadge id={item.id} />
          </h1>
          {meta.length > 0 && <p className="mt-3 text-lg text-muted">{meta.join('  ·  ')}</p>}
          {info?.rating && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-base font-semibold text-warning">
              <Star className="size-4" fill="currentColor" /> {info.rating}
            </p>
          )}
          <div className="mt-7 flex flex-wrap items-center gap-4">
            <button ref={play} type="button" autoFocus onClick={() => watch('resume')} className={cx(action, 'bg-accent text-accent-ink')}>
              <Play className="size-5" fill="currentColor" />
              {resume ? t('Continuar de {time}', { time: formatClock(resume) }) : t('Assistir')}
            </button>
            {resume > 0 && (
              <button type="button" onClick={() => watch('start')} className={cx(action, 'bg-white/12 text-ink')}>
                <RotateCcw className="size-5" /> {t('Do início')}
              </button>
            )}
            <button
              type="button"
              aria-pressed={favorite}
              onClick={() => toggleFavorite(item.id, 'movie', item.playlistId)}
              className={cx(action, 'bg-white/12', favorite ? 'text-warning' : 'text-ink')}
            >
              <Star className="size-5" fill={favorite ? 'currentColor' : 'none'} />
              {favorite ? t('Nos favoritos') : t('Favoritar')}
            </button>
          </div>
          <Synopsis info={info} fallback={item.description} />
        </div>
      </div>
    </div>
  );
}

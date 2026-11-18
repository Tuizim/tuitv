'use client';

import { Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { SeriesGroup } from '@tuitv/business-rules';
import type { ContentKind, MediaItem } from '@tuitv/shared-models';
import { ChannelCard, MovieCard, SeriesCard, VirtualGrid } from '@/components/cards';
import { Chip, Empty, PageHeader } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { useResolver, useStore } from '@/lib/store';

export default function FavoritesPage() {
  const t = useT();
  const favorites = useStore((s) => s.favorites);
  const resolve = useResolver();
  const [tab, setTab] = useState<ContentKind | null>(null);

  const { live, movies, series } = useMemo(() => {
    const sorted = [...favorites.values()].sort((a, b) => b.addedAt - a.addedAt);
    const live: MediaItem[] = [];
    const movies: MediaItem[] = [];
    const series: SeriesGroup[] = [];
    for (const favorite of sorted) {
      if (favorite.kind === 'series') {
        const group = resolve.series(favorite.id);
        if (group) series.push(group);
      } else {
        const item = resolve.item(favorite.id);
        if (item) (item.kind === 'live' ? live : movies).push(item);
      }
    }
    return { live, movies, series };
  }, [favorites, resolve]);

  const tabs: { kind: ContentKind; label: string; count: number }[] = [
    { kind: 'live', label: t('Canais'), count: live.length },
    { kind: 'movie', label: t('Filmes'), count: movies.length },
    { kind: 'series', label: t('Séries'), count: series.length },
  ];
  const active = tab ?? tabs.find((x) => x.count > 0)?.kind ?? 'live';

  if (live.length + movies.length + series.length === 0) {
    return (
      <Empty icon={<Star className="size-10" />} title={t('Nenhum favorito ainda')}>
        <p>{t('Toque na estrela de um canal, filme ou série para guardá-lo aqui. Os favoritos ficam salvos neste dispositivo.')}</p>
      </Empty>
    );
  }

  return (
    <>
      <PageHeader title={t('Favoritos')} />
      <div className="mb-5 flex gap-2" role="tablist">
        {tabs.map((x) => (
          <Chip key={x.kind} role="tab" aria-selected={active === x.kind} active={active === x.kind} onClick={() => setTab(x.kind)}>
            {x.label} <span className="ml-1 opacity-70">{x.count}</span>
          </Chip>
        ))}
      </div>
      {active === 'live' && <VirtualGrid items={live} minWidth={170} ratio={0.5625} extra={52} render={(item) => <ChannelCard key={item.id} item={item} />} />}
      {active === 'movie' && <VirtualGrid items={movies} render={(item) => <MovieCard key={item.id} item={item} />} />}
      {active === 'series' && <VirtualGrid items={series} render={(s) => <SeriesCard key={s.id} series={s} />} />}
      {tabs.find((x) => x.kind === active)?.count === 0 && <p className="py-10 text-center text-sm text-muted">{t('Nenhum favorito deste tipo.')}</p>}
    </>
  );
}

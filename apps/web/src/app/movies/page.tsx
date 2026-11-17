'use client';

import { Film } from 'lucide-react';
import { Suspense } from 'react';
import type { MediaItem } from '@tuitv/shared-models';
import { MovieCard } from '@/components/cards';
import { Catalog } from '@/components/Catalog';
import { useT } from '@/lib/i18n';
import { useStore } from '@/lib/store';

const titleOf = (item: MediaItem) => item.name;
const render = (item: MediaItem) => <MovieCard key={item.id} item={item} />;

function Movies() {
  const t = useT();
  const lib = useStore((s) => s.lib);
  return (
    <Catalog
      title={t('Filmes')}
      items={lib.movies}
      groups={lib.movieGroups}
      titleOf={titleOf}
      render={render}
      emptyIcon={<Film className="size-10" />}
      emptyTitle={t('Nenhum filme disponível')}
    />
  );
}

export default function MoviesPage() {
  return (
    <Suspense>
      <Movies />
    </Suspense>
  );
}

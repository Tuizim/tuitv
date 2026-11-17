'use client';

import { Clapperboard } from 'lucide-react';
import { Suspense } from 'react';
import type { SeriesGroup } from '@tuitv/business-rules';
import { SeriesCard } from '@/components/cards';
import { Catalog } from '@/components/Catalog';
import { useT } from '@/lib/i18n';
import { useStore } from '@/lib/store';

const titleOf = (series: SeriesGroup) => series.title;
const render = (series: SeriesGroup) => <SeriesCard key={series.id} series={series} />;

function Series() {
  const t = useT();
  const lib = useStore((s) => s.lib);
  return (
    <Catalog
      title={t('Séries')}
      items={lib.series}
      groups={lib.seriesGroups}
      titleOf={titleOf}
      render={render}
      emptyIcon={<Clapperboard className="size-10" />}
      emptyTitle={t('Nenhuma série disponível')}
    />
  );
}

export default function SeriesPage() {
  return (
    <Suspense>
      <Series />
    </Suspense>
  );
}

'use client';

import { Clapperboard } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo } from 'react';
import { continueEpisode } from '@tuitv/business-rules';
import { RemoteStatus } from '@/components/Catalog';
import { Empty } from '@/components/ui';
import { useRemoteSeries, watchHref } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { useResolver, useStore } from '@/lib/store';

/**
 * Continuar uma série (estilo Netflix): abre o player no episódio mais adiante já assistido
 * ou, se ele terminou, no seguinte. Substitui a si mesma no histórico de navegação: Voltar no player
 * retorna à tela de onde se veio.
 */
export default function SeriesContinuePage() {
  return (
    <Suspense>
      <SeriesContinue />
    </Suspense>
  );
}

function SeriesContinue() {
  const t = useT();
  const router = useRouter();
  const id = useSearchParams().get('id') ?? '';
  const resolve = useResolver();
  const series = resolve.series(id);
  // Login: episódios pedidos ao servidor antes de escolher o episódio.
  const load = useRemoteSeries(id);
  const historyById = useStore((s) => s.historyById);
  const target = useMemo(() => (series ? continueEpisode(series, (itemId) => historyById.get(itemId)) : undefined), [series, historyById]);

  useEffect(() => {
    if (target) router.replace(watchHref(target.episode));
  }, [target, router]);

  if (target) return null;
  if (load.loading || load.error) return <RemoteStatus load={load} />;
  return (
    <Empty icon={<Clapperboard className="size-10" />} title={series ? series.title : t('Série não encontrada')}>
      <p>{series ? t('Nenhum episódio disponível no servidor.') : t('Ela pode pertencer a uma lista desativada ou removida.')}</p>
    </Empty>
  );
}

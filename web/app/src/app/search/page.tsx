'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useMemo } from 'react';
import { normalizeText, searchIn } from '@tuitv/business-rules';
import { ChannelCard, MovieCard, SeriesCard } from '@/components/cards';
import { Chip, Empty, Notice, Spinner } from '@/components/ui';
import { useRemoteGroup, useUi } from '@/lib/hooks';
import { importErrorText, useT } from '@/lib/i18n';
import { hasRemote, useStore } from '@/lib/store';

/**
 * Pesquisa global (PRD RF-010): resolvida sobre a biblioteca local.
 * Logins não têm busca no servidor: na primeira busca da sessão, o catálogo de cada tipo é pedido
 * ao servidor e mantido só em memória.
 */
export default function SearchPage() {
  const t = useT();
  const query = useDeferredValue(useUi((s) => s.query));
  const lib = useStore((s) => s.lib);
  const favorites = useStore((s) => s.favorites);
  const remote = useStore(hasRemote);
  const searching = remote && !!normalizeText(query);
  const live = useRemoteGroup('live', null, searching);
  const movies = useRemoteGroup('movie', null, searching);
  const series = useRemoteGroup('series', null, searching);
  const loading = live.loading || movies.loading || series.loading;
  const error = live.error ?? movies.error ?? series.error;

  const results = useMemo(() => {
    const q = normalizeText(query);
    if (!q) return null;
    const live = searchIn(lib.search.live, query, 60);
    const movies = searchIn(lib.search.movies, query, 60);
    const series = searchIn(lib.search.series, query, 60);
    const match = (name: string) => normalizeText(name).includes(q);
    const groups = [
      ...lib.liveGroups.filter((g) => match(g.name)).map((g) => ({ ...g, href: `/live?g=${encodeURIComponent(g.name)}` })),
      ...lib.movieGroups.filter((g) => match(g.name)).map((g) => ({ ...g, href: `/movies?g=${encodeURIComponent(g.name)}` })),
      ...lib.seriesGroups.filter((g) => match(g.name)).map((g) => ({ ...g, href: `/series?g=${encodeURIComponent(g.name)}` })),
    ].slice(0, 30);
    const favoriteHits = [...live, ...movies].filter((i) => favorites.has(i.id)).slice(0, 12);
    const favoriteSeries = series.filter((s) => favorites.has(s.id)).slice(0, 12);
    return { live, movies, series, groups, favoriteHits, favoriteSeries };
  }, [query, lib, favorites]);

  if (!results) {
    return (
      <Empty icon={<Search className="size-10" />} title={t('Buscar')}>
        <p>{t('Digite no campo de busca para encontrar canais, filmes, séries e categorias da sua biblioteca.')}</p>
      </Empty>
    );
  }

  const status = (loading || error) && (
    <div className="mb-5">
      {error ? (
        <Notice tone="danger">{importErrorText(t, error)}</Notice>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner className="size-4 text-accent" /> {t('Buscando no catálogo do servidor…')}
        </p>
      )}
    </div>
  );

  const total = results.live.length + results.movies.length + results.series.length + results.groups.length;
  if (total === 0) {
    if (loading) return status;
    return (
      <Empty icon={<Search className="size-10" />} title={t('Nenhum resultado para “{q}”', { q: query })}>
        <p>{t('A busca considera apenas o conteúdo das listas ativas.')}</p>
      </Empty>
    );
  }

  const grid = 'grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3.5';
  const wide = 'grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3.5';
  const section = (title: string, count: number, children: React.ReactNode) =>
    count > 0 && (
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-bold">
          {title} <span className="text-sm font-normal text-muted">{count >= 60 ? '60+' : count}</span>
        </h2>
        {children}
      </section>
    );

  return (
    <>
      <h1 className="mb-5 text-2xl font-extrabold tracking-tight">{t('Resultados para “{q}”', { q: query })}</h1>
      {status}
      {section(
        t('Favoritos'),
        results.favoriteHits.length + results.favoriteSeries.length,
        <div className={wide}>
          {results.favoriteHits.map((item) => (item.kind === 'live' ? <ChannelCard key={item.id} item={item} /> : <MovieCard key={item.id} item={item} />))}
          {results.favoriteSeries.map((s) => (
            <SeriesCard key={s.id} series={s} />
          ))}
        </div>,
      )}
      {section(
        t('Categorias'),
        results.groups.length,
        <div className="flex flex-wrap gap-2">
          {results.groups.map((g) => (
            <Link key={g.href} href={g.href} tabIndex={-1}>
              <Chip>
                {g.name} {g.count > 0 && <span className="ml-1 opacity-70">{g.count}</span>}
              </Chip>
            </Link>
          ))}
        </div>,
      )}
      {section(t('Canais'), results.live.length, <div className={wide}>{results.live.map((item) => <ChannelCard key={item.id} item={item} />)}</div>)}
      {section(t('Filmes'), results.movies.length, <div className={grid}>{results.movies.map((item) => <MovieCard key={item.id} item={item} />)}</div>)}
      {section(t('Séries'), results.series.length, <div className={grid}>{results.series.map((s) => <SeriesCard key={s.id} series={s} />)}</div>)}
    </>
  );
}

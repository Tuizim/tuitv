'use client';

import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { ChevronLeft, ChevronRight, CircleAlert, Star } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { SeriesGroup } from '@tuitv/business-rules';
import type { ContentKind, MediaItem } from '@tuitv/shared-models';
import { itemHref, seriesHref } from '@/lib/hooks';
import { isTv } from '@/lib/platform';
import { useT } from '@/lib/i18n';
import { useStore } from '@/lib/store';
import { Thumb } from './Thumb';
import { cx } from './ui';

export function FavoriteButton({
  id,
  kind,
  playlistId,
  className,
  withLabel,
}: {
  id: string;
  kind: ContentKind;
  playlistId: string;
  className?: string;
  withLabel?: boolean;
}) {
  const t = useT();
  const on = useStore((s) => s.favorites.has(id));
  const toggle = useStore((s) => s.toggleFavorite);
  const label = on ? t('Remover dos favoritos') : t('Adicionar aos favoritos');
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggle(id, kind, playlistId);
      }}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg transition',
        withLabel ? 'min-h-10 border border-line bg-surface-2 px-4 text-sm font-semibold' : 'size-9 hover:bg-surface-2',
        on ? 'text-warning' : 'text-muted hover:text-ink',
        className,
      )}
    >
      <Star className="size-[18px]" fill={on ? 'currentColor' : 'none'} />
      {withLabel && (on ? t('Favorito') : t('Favoritar'))}
    </button>
  );
}

export function UnavailableBadge({ id }: { id: string }) {
  const t = useT();
  const unavailable = useStore((s) => s.unavailable.has(id));
  if (!unavailable) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-bold text-danger uppercase" title={t('A última tentativa de reprodução falhou')}>
      <CircleAlert className="size-3" /> {t('Indisponível')}
    </span>
  );
}

/** Capa vertical (filmes e séries). */
export function PosterCard({
  href,
  title,
  image,
  meta,
  progress,
  action,
}: {
  href: string;
  title: string;
  image?: string;
  meta?: ReactNode;
  progress?: number;
  action?: ReactNode;
}) {
  return (
    <Link href={href} className="group block min-w-0 rounded-xl focus-visible:outline-offset-4" title={title}>
      <div className="relative overflow-hidden rounded-lg bg-surface ring-1 ring-line transition duration-200 group-hover:-translate-y-1 group-hover:shadow-xl group-hover:shadow-black/50 group-hover:ring-2 group-hover:ring-accent group-focus-visible:ring-2 group-focus-visible:ring-accent">
        <Thumb src={image} name={title} fit="cover" className="aspect-[2/3] w-full text-2xl" />
        {action && <div className="absolute top-1 right-1 rounded-lg bg-black/55 backdrop-blur-sm">{action}</div>}
        {progress !== undefined && progress > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
            <div className="h-full bg-accent" style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </div>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-sm leading-snug font-medium">{title}</p>
      {meta && <p className="mt-0.5 truncate text-xs text-muted">{meta}</p>}
    </Link>
  );
}

/** Cartão de canal (logotipo + nome). */
export function ChannelCard({ item }: { item: MediaItem }) {
  return (
    <Link href={itemHref(item)} className="group block min-w-0 rounded-xl" title={item.name}>
      <div className="relative overflow-hidden rounded-lg bg-surface ring-1 ring-line transition duration-200 group-hover:-translate-y-1 group-hover:shadow-xl group-hover:shadow-black/50 group-hover:ring-2 group-hover:ring-accent group-focus-visible:ring-2 group-focus-visible:ring-accent">
        <Thumb src={item.logo} name={item.name} className="aspect-video w-full text-xl" />
        <div className="absolute top-1 left-1">
          <UnavailableBadge id={item.id} />
        </div>
      </div>
      <p className="mt-2 truncate text-sm font-medium">{item.name}</p>
      {item.group && <p className="truncate text-xs text-muted">{item.group}</p>}
    </Link>
  );
}

export function MovieCard({ item }: { item: MediaItem }) {
  const entry = useStore((s) => s.historyById.get(item.id));
  const progress = entry && entry.duration > 0 && !entry.completed ? entry.position / entry.duration : undefined;
  return (
    <PosterCard
      href={itemHref(item)}
      title={item.name}
      image={item.logo}
      meta={[item.year, item.group].filter(Boolean).join(' · ')}
      progress={progress}
      action={<FavoriteButton id={item.id} kind="movie" playlistId={item.playlistId} className="text-white" />}
    />
  );
}

export function SeriesCard({ series }: { series: SeriesGroup }) {
  return (
    <PosterCard
      href={seriesHref(series.id)}
      title={series.title}
      image={series.logo}
      action={<FavoriteButton id={series.id} kind="series" playlistId={series.playlistId} className="text-white" />}
    />
  );
}

/**
 * Fileira horizontal de cartões, com setas de rolagem no desktop.
 * O título não é clicável; "Ver tudo" leva à lista completa.
 */
export function Row({ title, href, action, children }: { title: string; href?: string; action?: ReactNode; children: ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const tv = isTv();
  const update = () => {
    const node = ref.current;
    if (!node) return;
    // Setas só existem no desktop; na TV a fileira não re-renderiza a cada quadro de rolagem.
    if (tv) return;
    const left = node.scrollLeft > 4;
    const right = node.scrollLeft + node.clientWidth < node.scrollWidth - 4;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  };
  useEffect(() => {
    update();
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [children]);

  const scroll = (direction: number) => ref.current?.scrollBy({ left: direction * ref.current.clientWidth * 0.85, behavior: 'smooth' });
  const arrow =
    'absolute top-0 bottom-6 z-10 hidden w-10 items-center justify-center bg-bg/70 text-ink opacity-0 backdrop-blur-sm transition group-hover/row:opacity-100 hover:bg-bg/90 focus-visible:opacity-100 lg:flex';

  return (
    <section className="group/row mb-7">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h2 className="truncate text-lg font-bold">{title}</h2>
        {action ??
          (href && (
            <Link href={href} className="shrink-0 text-sm font-semibold text-accent hover:underline">
              {t('Ver tudo')}
            </Link>
          ))}
      </div>
      <div className="relative -mx-4 lg:-mx-12">
        {edges.left && (
          <button type="button" aria-label={t('Anterior')} onClick={() => scroll(-1)} className={cx(arrow, 'left-0 rounded-r-lg')}>
            <ChevronLeft className="size-6" />
          </button>
        )}
        <div
          ref={ref}
          onScroll={update}
          // Memória das telas: a rolagem horizontal da fileira volta junto (lib/screens.ts).
          data-row-scroll={tv ? undefined : title}
          className={
            tv ? 'no-scrollbar overflow-hidden px-4 pt-1 pb-2 lg:px-12' : 'no-scrollbar flex gap-3 overflow-x-auto scroll-smooth px-4 pt-1 pb-2 lg:px-12'
          }
          // TV: a fileira não rola — a trilha de cartões desliza com transform, animado pela GPU
          // (sem redesenhar a fileira a cada quadro). O controle (remote.ts) define o deslocamento.
          data-tv-carousel={tv ? '' : undefined}
        >
          {tv ? (
            <div className="tv-track flex gap-3">{children}</div>
          ) : (
            children
          )}
        </div>
        {edges.right && (
          <button type="button" aria-label={t('Próximo')} onClick={() => scroll(1)} className={cx(arrow, 'right-0 rounded-l-lg')}>
            <ChevronRight className="size-6" />
          </button>
        )}
      </div>
    </section>
  );
}

/** Larguras padrão dos cartões dentro de fileiras. */
export const POSTER_SLOT = 'w-32 shrink-0 sm:w-40';
export const CHANNEL_SLOT = 'w-44 shrink-0 sm:w-52';

/**
 * Grade virtualizada (rolagem da janela): apenas as linhas visíveis existem no DOM,
 * o que mantém bibliotecas com dezenas de milhares de itens fluidas (PRD RNF-007).
 */
export function VirtualGrid<T>({
  items,
  render,
  minWidth = 150,
  ratio = 1.5,
  extra = 62,
  // TV: mais espaço entre as capas — a capa em foco cresce 18% a partir do centro e o respiro
  // até as vizinhas fica parecido com o das fileiras.
  gap = isTv() ? 38 : 14,
}: {
  items: T[];
  render: (item: T) => ReactNode;
  /** Largura mínima de cada cartão. */
  minWidth?: number;
  /** Altura da imagem ÷ largura. */
  ratio?: number;
  /** Altura reservada ao texto. */
  extra?: number;
  gap?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [margin, setMargin] = useState(0);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      setWidth(node.clientWidth);
      setMargin(node.getBoundingClientRect().top + window.scrollY);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const columns = Math.max(2, Math.floor((width + gap) / (minWidth + gap)));
  const columnWidth = width > 0 ? (width - gap * (columns - 1)) / columns : minWidth;
  const rowHeight = Math.round(columnWidth * ratio + extra + gap);
  const rows = Math.ceil(items.length / columns);

  const virtualizer = useWindowVirtualizer({ count: rows, estimateSize: () => rowHeight, overscan: 3, scrollMargin: margin });
  useEffect(() => {
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowHeight]);

  return (
    <div ref={ref} style={{ height: width > 0 ? virtualizer.getTotalSize() : undefined, position: 'relative' }}>
      {width > 0 &&
        virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className="tv-grid-row"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: rowHeight - gap,
              transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gap,
            }}
          >
            {items.slice(row.index * columns, row.index * columns + columns).map(render)}
          </div>
        ))}
    </div>
  );
}

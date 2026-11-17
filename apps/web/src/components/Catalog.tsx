'use client';

import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useSearchParams } from 'next/navigation';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GroupCount } from '@tuitv/business-rules';
import { useT } from '@/lib/i18n';
import { POSTER_SLOT, Row, VirtualGrid } from './cards';
import { Dropdown, Empty } from './ui';

const ALL = '\u0000all';
const ROW_HEIGHT = 372;
const ROW_ITEMS = 24;

/**
 * Catálogo de filmes ou séries.
 * Sem filtro: fileiras por categoria (cada uma com os primeiros títulos e “Ver tudo”).
 * Com uma categoria escolhida: grade completa, com ordenação.
 */
export function Catalog<T extends { group?: string; year?: number }>({
  title,
  items,
  groups,
  titleOf,
  render,
  emptyIcon,
  emptyTitle,
}: {
  title: string;
  items: T[];
  groups: GroupCount[];
  titleOf: (item: T) => string;
  render: (item: T) => ReactNode;
  emptyIcon: ReactNode;
  emptyTitle: string;
}) {
  const t = useT();
  const params = useSearchParams();
  const [group, setGroup] = useState(params.get('g') ?? ALL);
  const [sort, setSort] = useState<'list' | 'az' | 'year'>('list');

  const byGroup = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const item of items) {
      const key = item.group ?? '';
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return map;
  }, [items]);

  const rows = useMemo(() => [...byGroup.entries()].map(([name, list]) => ({ name, list })), [byGroup]);
  const showRows = group === ALL && rows.length > 1;

  const visible = useMemo(() => {
    const list = group === ALL ? items : (byGroup.get(group) ?? []);
    if (sort === 'az') return [...list].sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
    if (sort === 'year') return [...list].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    return list;
  }, [items, byGroup, group, sort, titleOf]);

  if (items.length === 0) {
    return (
      <Empty icon={emptyIcon} title={emptyTitle}>
        <p>{t('Este conteúdo aparece quando uma lista ativa o inclui.')}</p>
      </Empty>
    );
  }

  return (
    <>
      <header className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3">
        <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
        <Dropdown
          label={t('Categoria')}
          value={group}
          onChange={(value) => {
            setGroup(value);
            window.scrollTo({ top: 0 });
          }}
          className="w-56 max-w-full"
          options={[
            { value: ALL, label: t('Todas as categorias'), hint: items.length.toLocaleString() },
            ...groups.map((g) => ({ value: g.name, label: g.name, hint: g.count.toLocaleString() })),
          ]}
        />
        {!showRows && (
          <Dropdown
            label={t('Ordenar')}
            value={sort}
            onChange={setSort}
            className="w-44"
            options={[
              { value: 'list', label: t('Ordem da lista') },
              { value: 'az', label: t('A–Z') },
              { value: 'year', label: t('Mais recentes') },
            ]}
          />
        )}
        {!showRows && <p className="text-sm text-muted">{t('{n} títulos', { n: visible.length.toLocaleString() })}</p>}
      </header>

      {showRows ? (
        <CategoryRows rows={rows} render={render} onOpen={setGroup} untitled={t('Outros')} />
      ) : (
        <VirtualGrid items={visible} render={render} minWidth={150} />
      )}
    </>
  );
}

/** Fileiras por categoria, virtualizadas: listas com centenas de categorias continuam leves. */
function CategoryRows<T>({
  rows,
  render,
  onOpen,
  untitled,
}: {
  rows: { name: string; list: T[] }[];
  render: (item: T) => ReactNode;
  onOpen: (group: string) => void;
  untitled: string;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    if (ref.current) setMargin(ref.current.getBoundingClientRect().top + window.scrollY);
  }, []);
  const virtualizer = useWindowVirtualizer({ count: rows.length, estimateSize: () => ROW_HEIGHT, overscan: 2, scrollMargin: margin });

  return (
    <div ref={ref} style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtualizer.getVirtualItems().map((virtual) => {
        const row = rows[virtual.index]!;
        return (
          <div
            key={row.name}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: ROW_HEIGHT, transform: `translateY(${virtual.start - virtualizer.options.scrollMargin}px)` }}
          >
            <Row
              title={row.name || untitled}
              action={
                row.name ? (
                  <button type="button" onClick={() => { onOpen(row.name); window.scrollTo({ top: 0 }); }} className="shrink-0 text-sm font-semibold text-accent hover:underline">
                    {t('Ver tudo')} · {row.list.length.toLocaleString()}
                  </button>
                ) : undefined
              }
            >
              {row.list.slice(0, ROW_ITEMS).map((item, index) => (
                <div key={index} className={POSTER_SLOT}>
                  {render(item)}
                </div>
              ))}
            </Row>
          </div>
        );
      })}
    </div>
  );
}

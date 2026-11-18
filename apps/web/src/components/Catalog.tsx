'use client';

import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useSearchParams } from 'next/navigation';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GroupCount } from '@tuitv/business-rules';
import { useRemoteConnection, useRemoteGroup, type RemoteLoad } from '@/lib/hooks';
import { importErrorText, useT } from '@/lib/i18n';
import { hasRemote, useStore } from '@/lib/store';
import { POSTER_SLOT, Row, VirtualGrid } from './cards';
import { Button, Dropdown, Empty, Notice, Spinner } from './ui';

const ALL = '\u0000all';
const ROW_HEIGHT = 372;
const ROW_ITEMS = 24;

/**
 * Catálogo de filmes ou séries.
 * Sem filtro: fileiras por categoria (cada uma com os primeiros títulos e “Ver tudo”).
 * Com uma categoria escolhida: grade completa, com ordenação.
 * Com login (consulta sob demanda), cada categoria é pedida ao servidor quando aparece na tela.
 */
export function Catalog<T extends { group?: string; year?: number }>({
  kind,
  title,
  items,
  groups,
  titleOf,
  render,
  emptyIcon,
  emptyTitle,
}: {
  kind: 'movie' | 'series';
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
  const remote = useStore(hasRemote);

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

  // Com login, as fileiras seguem as categorias do servidor (inclusive as ainda não carregadas).
  const rows = useMemo(() => {
    if (!remote) return [...byGroup.entries()].map(([name, list]) => ({ name, list }));
    const out = groups.map((g) => ({ name: g.name, list: byGroup.get(g.name) ?? [] }));
    const untitled = byGroup.get('');
    if (untitled) out.push({ name: '', list: untitled });
    return out;
  }, [byGroup, groups, remote]);
  const showRows = group === ALL && rows.length > 1;
  // Sem categorias ainda (login conectando), "Todas" não pede a lista inteira ao servidor.
  const load = useRemoteGroup(kind, group === ALL ? null : group, !showRows && !(group === ALL && groups.length === 0));
  const connection = useRemoteConnection();

  const visible = useMemo(() => {
    const list = group === ALL ? items : (byGroup.get(group) ?? []);
    if (sort === 'az') return [...list].sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
    if (sort === 'year') return [...list].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    return list;
  }, [items, byGroup, group, sort, titleOf]);

  if (items.length === 0 && groups.length === 0) {
    if (connection.pending) return <RemoteStatus load={connection} />;
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
            { value: ALL, label: t('Todas as categorias'), hint: remote ? undefined : items.length.toLocaleString() },
            ...groups.map((g) => ({ value: g.name, label: g.name, hint: g.count ? g.count.toLocaleString() : undefined })),
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
        <CategoryRows kind={kind} remote={remote} rows={rows} render={render} onOpen={setGroup} untitled={t('Outros')} />
      ) : visible.length === 0 && (load.loading || load.error) ? (
        <RemoteStatus load={load} />
      ) : (
        <VirtualGrid items={visible} render={render} minWidth={150} />
      )}
    </>
  );
}

/** Fileiras por categoria, virtualizadas: listas com centenas de categorias continuam leves. */
function CategoryRows<T>({
  kind,
  remote,
  rows,
  render,
  onOpen,
  untitled,
}: {
  kind: 'movie' | 'series';
  remote: boolean;
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
            {remote && row.list.length === 0 ? (
              <PendingRow kind={kind} name={row.name} />
            ) : (
              <Row
                title={row.name || untitled}
                action={
                  row.name ? (
                    <button type="button" onClick={() => { onOpen(row.name); window.scrollTo({ top: 0 }); }} className="shrink-0 text-sm font-semibold text-accent hover:underline">
                      {t('Ver tudo')}
                      {!remote && ` · ${row.list.length.toLocaleString()}`}
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
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Fileira de uma categoria do servidor ainda não carregada: é pedida quando aparece na tela. */
function PendingRow({ kind, name }: { kind: 'movie' | 'series'; name: string }) {
  const t = useT();
  const load = useRemoteGroup(kind, name);
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-bold">{name}</h2>
      {load.error ? (
        <RemoteStatus load={load} />
      ) : load.loading ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner className="size-4 text-accent" /> {t('Carregando do servidor…')}
        </p>
      ) : (
        <p className="text-sm text-muted">{t('Nenhum título nesta categoria.')}</p>
      )}
    </section>
  );
}

/** Carregando ou falha ao consultar o servidor do login. */
export function RemoteStatus({ load }: { load: RemoteLoad }) {
  const t = useT();
  if (load.error) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Notice tone="danger">{importErrorText(t, load.error)}</Notice>
        <Button onClick={load.retry}>{t('Tentar novamente')}</Button>
      </div>
    );
  }
  return (
    <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
      <Spinner className="size-5 text-accent" /> {t('Carregando do servidor…')}
    </p>
  );
}

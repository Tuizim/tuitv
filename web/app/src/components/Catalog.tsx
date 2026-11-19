'use client';

import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GroupCount } from '@tuitv/business-rules';
import { useRemoteConnection, useRemoteGroup, type RemoteLoad } from '@/lib/hooks';
import { importErrorText, useT } from '@/lib/i18n';
import { hasRemote, useStore } from '@/lib/store';
import { POSTER_SLOT, Row, VirtualGrid } from './cards';
import { Button, Dropdown, Empty, Notice, Spinner, cx } from './ui';
import { isTv } from '@/lib/platform';
import { whenIdle } from '@/lib/idle';
import { replaceQuery, useScreenState } from '@/lib/screens';

const ALL = '\u0000all';
type Sort = 'list' | 'az' | 'year';
const SORTS: Sort[] = ['list', 'az', 'year'];
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
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  // Categoria e ordem ficam no endereço (?g=Terror&o=az): ao voltar de um título, a tela reabre
  // nelas — e a memória das telas (lib/screens.ts) devolve a rolagem e o cartão em foco.
  const [group, setGroupState] = useState(params.get('g') ?? ALL);
  const [sort, setSortState] = useState<Sort>(() => SORTS.find((s) => s === params.get('o')) ?? 'list');
  const syncUrl = (g: string, o: Sort) => {
    const query = new URLSearchParams();
    if (g !== ALL) query.set('g', g);
    if (o !== 'list') query.set('o', o);
    replaceQuery(router, pathname, query);
  };
  // Link para a mesma tela com outra busca (ex.: "Filmes" no menu estando em Filmes › Terror):
  // a tela não é remontada, então acompanha o endereço e volta ao topo.
  const urlGroup = params.get('g') ?? ALL;
  const urlSort = SORTS.find((s) => s === params.get('o')) ?? 'list';
  useEffect(() => {
    if (urlGroup === group && urlSort === sort) return;
    setGroupState(urlGroup);
    setSortState(urlSort);
    window.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlGroup, urlSort]);
  const setGroup = (value: string) => {
    setGroupState(value);
    syncUrl(value, sort);
  };
  const setSort = (value: Sort) => {
    setSortState(value);
    syncUrl(group, value);
  };
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
        <h1 className="text-3xl font-extrabold tracking-tight max-md:sr-only">{title}</h1>
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
        isTv() ? (
          <TvCategoryRows kind={kind} remote={remote} rows={rows} render={render} onOpen={setGroup} untitled={t('Outros')} />
        ) : (
          <CategoryRows kind={kind} remote={remote} rows={rows} render={render} onOpen={setGroup} untitled={t('Outros')} />
        )
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

/** Fileiras montadas logo ao abrir a tela na TV. */
const TV_ROWS_FIRST = 6;
/** Fileiras acrescentadas a cada pausa do controle. */
const TV_ROWS_STEP = 3;
/** Quantas fileiras ficam montadas à frente da fileira em foco (o resto espera). */
const TV_ROWS_AHEAD = 12;
/** Categorias do servidor pedidas com antecedência, abaixo da fileira em foco. */
const TV_PREFETCH = 4;

/**
 * Fileiras por categoria na TV, com a técnica das plataformas de streaming: em vez de montar a
 * fileira na hora em que ela aparece (o que pesava justamente enquanto o usuário navegava), as
 * próximas fileiras são montadas antes, nas pausas do controle (lib/idle.ts), sempre algumas à
 * frente do foco — e nunca desmontadas. As capas só são baixadas perto da tela (lib/lazyImages.ts)
 * e as categorias do login são pedidas ao servidor com antecedência.
 */
function TvCategoryRows<T>({
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
  // Voltando de um título, as fileiras já montadas e a posição do foco voltam junto.
  const [count, setCount] = useScreenState('tvRows', TV_ROWS_FIRST);
  const [reached, setReached] = useScreenState('tvReached', 0);
  // Monta as próximas fileiras nas pausas, até [TV_ROWS_AHEAD] à frente do foco.
  const limit = Math.min(rows.length, reached + TV_ROWS_AHEAD);
  useEffect(() => {
    if (count >= limit) return;
    return whenIdle(() => setCount((n) => Math.min(limit, n + TV_ROWS_STEP)));
  }, [count, limit]);
  return (
    <div
      onFocus={(event) => {
        const holder = (event.target as HTMLElement).closest<HTMLElement>('[data-row-index]');
        const index = Number(holder?.dataset.rowIndex ?? -1);
        if (index < 0) return;
        if (index > reached) setReached(index);
        // Segurança: se o usuário descer mais rápido que as pausas, garante fileiras à frente.
        if (index >= count - 2) setCount((n) => Math.min(rows.length, n + TV_ROWS_STEP));
      }}
    >
      {rows.slice(0, count).map((row, index) => (
        <div key={row.name} data-row-index={index}>
          <TvCategoryRow
            kind={kind}
            name={row.name}
            list={row.list}
            remote={remote}
            fetch={index <= reached + TV_PREFETCH}
            render={render}
            onOpen={onOpen}
            untitled={untitled}
          />
        </div>
      ))}
    </div>
  );
}

type TvRowProps<T> = {
  kind: 'movie' | 'series';
  name: string;
  list: T[];
  remote: boolean;
  fetch: boolean;
  render: (item: T) => ReactNode;
  onOpen: (group: string) => void;
  untitled: string;
};

/** Uma fileira da TV; só re-renderiza quando o conteúdo dela muda (não a cada categoria que chega). */
const TvCategoryRow = memo(
  function TvCategoryRow<T>({ kind, name, list, remote, fetch, render, onOpen, untitled }: TvRowProps<T>) {
    const t = useT();
    const pending = remote && list.length === 0;
    const load = useRemoteGroup(kind, name, pending && fetch);
    if (pending) {
      // Ainda não chegou: o título e capas vazias no lugar (sem texto de "carregando").
      if (load.error) {
        return (
          <section className="mb-8">
            <h2 className="mb-3 text-lg font-bold">{name}</h2>
            <RemoteStatus load={load} />
          </section>
        );
      }
      if (!load.loading && fetch) return null; // categoria vazia no servidor
      return (
        <section className="group/row mb-7" aria-busy="true">
          <h2 className="mb-2.5 text-lg font-bold">{name}</h2>
          <div className="flex gap-3 overflow-hidden pt-1 pb-2">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className={cx(POSTER_SLOT, 'aspect-[2/3] rounded-lg bg-surface')} />
            ))}
          </div>
        </section>
      );
    }
    return (
      <Row
        title={name || untitled}
        action={
          name ? (
            <button type="button" onClick={() => { onOpen(name); window.scrollTo({ top: 0 }); }} className="shrink-0 text-sm font-semibold text-accent hover:underline">
              {t('Ver tudo')}
            </button>
          ) : undefined
        }
      >
        {list.slice(0, ROW_ITEMS).map((item, index) => (
          <div key={index} className={POSTER_SLOT}>
            {render(item)}
          </div>
        ))}
      </Row>
    );
  },
  (a, b) =>
    a.name === b.name &&
    a.fetch === b.fetch &&
    a.remote === b.remote &&
    a.render === b.render &&
    a.list.length === b.list.length &&
    a.list[0] === b.list[0],
) as <T>(props: TvRowProps<T>) => ReactNode;

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

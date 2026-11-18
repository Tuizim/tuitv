'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, Tv } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBackLayer } from '@/lib/back';
import { isTv } from '@/lib/platform';
import { normalizeText, programmeProgress } from '@tuitv/business-rules';
import type { MediaItem } from '@tuitv/shared-models';
import { FavoriteButton, UnavailableBadge } from '@/components/cards';
import { Player } from '@/components/Player';
import { Thumb } from '@/components/Thumb';
import { Dropdown, Empty, cx } from '@/components/ui';
import { kvGet, kvSet } from '@/lib/db';
import { RemoteStatus } from '@/components/Catalog';
import { useNow, useNowNext, useRemoteConnection, useRemoteGroup } from '@/lib/hooks';
import { formatHour, useT } from '@/lib/i18n';
import { hasRemote, useResolver, useStore } from '@/lib/store';

const ALL = '\u0000all';
/** Login conectando: as categorias ainda não chegaram (nada é pedido até lá). */
const PENDING = '\u0000pending';
const FAVORITES = '\u0000fav';

export default function LivePage() {
  return (
    <Suspense>
      <Live />
    </Suspense>
  );
}

function Live() {
  const t = useT();
  const params = useSearchParams();
  const lib = useStore((s) => s.lib);
  const favorites = useStore((s) => s.favorites);
  const recordPlayback = useStore((s) => s.recordPlayback);
  const remote = useStore(hasRemote);
  const resolve = useResolver();

  // Com login, "Todas as categorias" pediria ao servidor a lista inteira: abre numa categoria.
  const [chosen, setGroup] = useState<string | null>(params.get('g'));
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(params.get('c'));
  const restored = useRef(false);

  // Recupera o último canal assistido (PRD RF-001).
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (params.get('c')) return;
    void kvGet<string>('lastLive').then((id) => {
      if (id) setSelectedId((current) => current ?? id);
    });
  }, [params]);

  const selected = selectedId ? resolve.item(selectedId) : undefined;
  const current = selected?.kind === 'live' ? selected : undefined;
  const group = chosen ?? (remote ? (current?.group ?? lib.liveGroups[0]?.name ?? PENDING) : ALL);
  const load = useRemoteGroup('live', group === ALL ? null : group, group !== FAVORITES && group !== PENDING);
  const connection = useRemoteConnection();

  const channels = useMemo(() => {
    let list = lib.live;
    if (group === FAVORITES) {
      // Favoritos de logins não precisam estar carregados: vêm com nome e capa guardados.
      list = [...favorites.values()]
        .filter((f) => f.kind === 'live')
        .map((f) => resolve.item(f.id))
        .filter((c): c is MediaItem => c?.kind === 'live');
    } else if (group !== ALL) list = list.filter((c) => c.group === group);
    const q = normalizeText(filter);
    if (q) {
      const index = new Map(lib.search.live.map((s) => [s.value, s.norm]));
      list = list.filter((c) => (index.get(c) ?? normalizeText(c.name)).includes(q));
    }
    return list;
  }, [lib, group, filter, favorites, resolve]);

  // TV: OK no canal abre o player em tela cheia; Voltar fecha e devolve o foco ao canal na lista.
  const tv = isTv();
  const [full, setFull] = useState(false);
  const closeFull = () => {
    setFull(false);
    window.setTimeout(() => {
      document.querySelector<HTMLElement>('[data-testid="channel-list"] [aria-current="true"], [data-testid="channel-list"] button')?.focus({ preventScroll: true });
    }, 60);
  };
  useBackLayer(full, closeFull);

  const select = (item: MediaItem) => {
    setSelectedId(item.id);
    void kvSet('lastLive', item.id);
    if (tv) setFull(true);
  };

  /** Troca rápida de canais dentro da lista filtrada. */
  const step = (delta: number) => {
    if (!channels.length) return;
    const index = current ? channels.findIndex((c) => c.id === current.id) : -1;
    const next = channels[(index + delta + channels.length) % channels.length];
    if (next) {
      setSelectedId(next.id);
      void kvSet('lastLive', next.id);
    }
  };

  if (lib.live.length === 0 && lib.liveGroups.length === 0 && !current) {
    if (connection.pending) return <RemoteStatus load={connection} />;
    return (
      <Empty icon={<Tv className="size-10" />} title={t('Nenhum canal disponível')}>
        <p>{t('Adicione uma lista em “Minhas listas” para ver os canais aqui.')}</p>
      </Empty>
    );
  }

  const fullscreen =
    tv && full && current
      ? createPortal(
          <div className="fixed inset-0 z-[65] bg-black" data-testid="tv-watch">
            <Player
              tv
              key="tv-live"
              item={current}
              subtitle={current.group}
              className="size-full"
              onPrev={() => step(-1)}
              onNext={() => step(1)}
              onProgress={(played) => recordPlayback(played, 0, 0)}
            />
          </div>,
          document.body,
        )
      : null;

  const categoryOptions = [
    { value: ALL, label: t('Todas as categorias'), hint: remote ? undefined : lib.live.length.toLocaleString() },
    { value: FAVORITES, label: `★ ${t('Favoritos')}` },
    ...lib.liveGroups.map((g) => ({ value: g.name, label: g.name, hint: g.count ? g.count.toLocaleString() : undefined })),
  ];

  if (tv) {
    return (
      <>
        {fullscreen}
        <TvLive
          inert={full}
          options={categoryOptions}
          group={group}
          onGroup={setGroup}
          channels={channels}
          current={current}
          onSelect={select}
          status={channels.length === 0 && (group === PENDING || load.loading || load.error) ? <RemoteStatus load={group === PENDING ? connection : load} /> : null}
        />
      </>
    );
  }

  return (
    <>
    {fullscreen}
    <div className="-mx-4 -mt-4 grid lg:mx-0 lg:mt-0 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      {/* No celular o topo inclui as pílulas fixas (Séries, Filmes, TV ao vivo). */}
      <div className="sticky top-16 z-20 bg-bg max-md:top-28 lg:static">
        {current ? (
          <Player
            key="player"
            item={current}
            className="aspect-video w-full lg:rounded-2xl"
            onPrev={() => step(-1)}
            onNext={() => step(1)}
            onProgress={(played) => recordPlayback(played, 0, 0)}
          />
        ) : (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-black text-center text-white/70 lg:rounded-2xl">
            <Tv className="size-10" />
            <p className="text-sm">{t('Escolha um canal para começar a assistir.')}</p>
          </div>
        )}
        {current && <NowPlaying item={current} />}
      </div>

      <div className="flex min-h-0 flex-col px-4 pt-3 lg:sticky lg:top-20 lg:h-[calc(100dvh-104px)] lg:px-0 lg:pt-0">
        <div className="mb-2 grid grid-cols-2 gap-2">
          <Dropdown
            label={t('Categoria')}
            value={group}
            onChange={setGroup}
            options={categoryOptions}
          />
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('Filtrar canais')}
              aria-label={t('Filtrar canais')}
              className="h-10 w-full rounded-lg border border-line bg-surface pr-3 pl-9 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none"
            />
          </div>
        </div>
        {channels.length === 0 && (group === PENDING || load.loading || load.error) ? (
          <div className="rounded-xl border border-line bg-surface p-4">
            <RemoteStatus load={group === PENDING ? connection : load} />
          </div>
        ) : (
          <ChannelList channels={channels} selectedId={current?.id} onSelect={select} />
        )}
      </div>
    </div>
    </>
  );
}

function ChannelList({
  channels,
  selectedId,
  onSelect,
  tv = false,
  onFocusChannel,
}: {
  channels: MediaItem[];
  selectedId?: string;
  onSelect: (item: MediaItem) => void;
  tv?: boolean;
  onFocusChannel?: (item: MediaItem) => void;
}) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: channels.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (tv ? 76 : 60),
    overscan: 8,
  });

  // Mantém o canal atual visível ao trocar por teclado/controle.
  useEffect(() => {
    if (!selectedId) return;
    const index = channels.findIndex((c) => c.id === selectedId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  if (channels.length === 0) return <p className="px-2 py-8 text-center text-sm text-muted">{t('Nenhum canal encontrado.')}</p>;

  return (
    <div
      ref={scrollRef}
      className={tv ? 'min-h-0 flex-1 overflow-y-auto px-2 py-1' : 'h-[55dvh] overflow-y-auto rounded-xl border border-line bg-surface lg:h-auto lg:flex-1'}
      data-testid="channel-list"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => {
          const channel = channels[row.index]!;
          return (
            <div key={channel.id} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: row.size, transform: `translateY(${row.start}px)` }}>
              {tv ? (
                <TvChannelRow
                  number={row.index + 1}
                  channel={channel}
                  selected={channel.id === selectedId}
                  // Alvo ao descer do cabeçalho: o canal atual (ou o primeiro).
                  isDefault={selectedId ? channel.id === selectedId : row.index === 0}
                  onSelect={onSelect}
                  onFocus={onFocusChannel}
                />
              ) : (
                <ChannelRow channel={channel} selected={channel.id === selectedId} onSelect={onSelect} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChannelRow({ channel, selected, onSelect }: { channel: MediaItem; selected: boolean; onSelect: (item: MediaItem) => void }) {
  const { current } = useNowNext(channel, 0);
  return (
    <div className={cx('flex h-full items-center gap-1 border-b border-line/60 pr-1', selected && 'bg-accent/15')}>
      <button
        type="button"
        onClick={() => onSelect(channel)}
        aria-current={selected ? 'true' : undefined}
        className="flex h-full min-w-0 flex-1 items-center gap-3 px-3 text-left -outline-offset-2 hover:bg-surface-2"
      >
        <Thumb src={channel.logo} name={channel.name} className="size-10 shrink-0 rounded-lg" />
        <span className="min-w-0 flex-1">
          <span className={cx('flex items-center gap-2 text-sm font-medium', selected && 'text-accent')}>
            <span className="truncate">{channel.name}</span>
            <UnavailableBadge id={channel.id} />
          </span>
          <span className="block truncate text-xs text-muted">{current?.title ?? channel.group ?? ''}</span>
        </span>
      </button>
      <FavoriteButton id={channel.id} kind="live" playlistId={channel.playlistId} />
    </div>
  );
}

/** Informações de programação do canal em reprodução (PRD RF-005 / RF-009). */
function NowPlaying({ item }: { item: MediaItem }) {
  const t = useT();
  const language = useStore((s) => s.settings.language);
  const { current, next } = useNowNext(item, 3);
  const now = useNow();
  return (
    <div className="border-b border-line px-4 py-3 lg:mt-3 lg:rounded-2xl lg:border lg:bg-surface">
      <div className="flex items-center gap-3">
        <Thumb src={item.logo} name={item.name} className="hidden size-12 shrink-0 rounded-lg sm:flex" />
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-base font-bold">
            <span className="truncate">{item.name}</span>
            <UnavailableBadge id={item.id} />
          </h1>
          <p className="truncate text-xs text-muted">{item.group ?? t('Sem categoria')}</p>
        </div>
        <FavoriteButton id={item.id} kind="live" playlistId={item.playlistId} withLabel />
      </div>
      {current && (
        <div className="mt-3 hidden sm:block">
          <p className="text-sm">
            <span className="mr-2 rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-bold text-accent uppercase">{t('Agora')}</span>
            <span className="font-semibold">{current.title}</span>
            <span className="ml-2 text-xs text-muted">
              {formatHour(current.start, language)} – {formatHour(current.stop, language)}
            </span>
          </p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-bg">
            <div className="h-full bg-accent" style={{ width: `${programmeProgress(current, now) * 100}%` }} />
          </div>
          {current.description && <p className="mt-2 line-clamp-2 text-xs text-muted">{current.description}</p>}
          {next.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-muted">
              {next.map((programme) => (
                <li key={programme.start} className="truncate">
                  <span className="tabular-nums">{formatHour(programme.start, language)}</span> · {programme.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ── TV ao vivo para televisores (Tizen) ─────────────────────────────────── */

type CategoryOption = { value: string; label: string; hint?: string };

/**
 * Canal em foco na lista (TV). Fica fora do estado do React da página: mover o foco atualiza só o
 * painel da direita — e com uma pequena pausa —, não a lista inteira a cada tecla.
 */
const focusedChannel = (() => {
  let item: MediaItem | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  return {
    get: () => item,
    set(next: MediaItem) {
      if (item?.id === next.id) return;
      item = next;
      clearTimeout(timer);
      timer = setTimeout(() => listeners.forEach((listener) => listener()), 120);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})();

function useFocusedChannel() {
  return useSyncExternalStore(focusedChannel.subscribe, focusedChannel.get, focusedChannel.get);
}

/** Devolve o foco ao canal que estava em foco na lista (ex.: ◀ a partir do painel). */
function focusChannelInList() {
  const id = focusedChannel.get()?.id;
  const list = document.querySelector('[data-testid="channel-list"]');
  const target =
    (id && list?.querySelector<HTMLElement>(`[data-channel-id="${CSS.escape(id)}"]`)) || list?.querySelector<HTMLElement>('[data-nav-default]');
  target?.focus({ preventScroll: true });
}

/**
 * Layout de TV em três colunas: categorias | canais | ficha do canal em foco (agora e a seguir).
 * OK no canal abre o player em tela cheia; ▲▼ trocam de canal lá dentro e Voltar retorna aqui.
 * Sem prévia de vídeo na página: as TVs reproduzem um vídeo por vez e a lista fica leve.
 */
function TvLive({
  inert,
  options,
  group,
  onGroup,
  channels,
  current,
  onSelect,
  status,
}: {
  inert: boolean;
  options: CategoryOption[];
  group: string;
  onGroup: (value: string) => void;
  channels: MediaItem[];
  current?: MediaItem;
  onSelect: (item: MediaItem) => void;
  status: ReactNode;
}) {
  const t = useT();
  const wantChannels = useRef(true);
  // Callback estável: as linhas (memo) não re-renderizam quando a página re-renderiza.
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const select = useCallback((item: MediaItem) => selectRef.current(item), []);
  const categoryLabel = options.find((o) => o.value === group)?.label ?? '';

  // Ao abrir a tela (ou confirmar uma categoria com OK), o foco vai para os canais.
  useEffect(() => {
    if (!wantChannels.current || channels.length === 0) return;
    const timer = window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>('[data-testid="channel-list"] [data-nav-default]');
      if (target) {
        target.focus({ preventScroll: true });
        wantChannels.current = false;
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [channels, group]);

  return (
    <div inert={inert} className="-mt-2 flex h-[calc(100vh-7rem)] gap-6" data-testid="tv-live">
      <nav aria-label={t('Categoria')} className="flex w-64 shrink-0 flex-col" data-testid="tv-categories">
        <h1 className="mb-3 px-3 text-2xl font-extrabold tracking-tight">{t('TV ao vivo')}</h1>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {options.map((option) => {
            const active = option.value === group;
            return (
              <button
                key={option.value}
                type="button"
                aria-current={active ? 'true' : undefined}
                // A categoria só muda com OK (passar por ela com o controle não troca a lista).
                onClick={() => {
                  wantChannels.current = true;
                  onGroup(option.value);
                  if (active) {
                    document.querySelector<HTMLElement>('[data-testid="channel-list"] [data-nav-default]')?.focus({ preventScroll: true });
                    wantChannels.current = false;
                  }
                }}
                className={cx(
                  'mb-1 flex h-12 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-base',
                  active ? 'bg-surface-2 font-bold text-accent' : 'text-ink/80',
                )}
              >
                <span className="truncate">{option.label}</span>
                {option.hint && <span className="shrink-0 text-sm text-muted tabular-nums">{option.hint}</span>}
              </button>
            );
          })}
        </div>
      </nav>

      <section className="flex min-w-0 flex-1 flex-col" aria-label={categoryLabel}>
        <p className="mb-3 truncate px-3 text-lg text-muted">
          {categoryLabel}
          {channels.length > 0 && <span className="ml-2 text-base">· {t('{n} canais', { n: channels.length.toLocaleString() })}</span>}
        </p>
        {status ? (
          <div className="px-3">{status}</div>
        ) : (
          <ChannelList tv channels={channels} selectedId={current?.id} onSelect={select} onFocusChannel={focusedChannel.set} />
        )}
      </section>

      <aside className="w-[22rem] shrink-0">
        <TvChannelPanel channels={channels} current={current} />
      </aside>
    </div>
  );
}

/** Painel da direita: o canal em foco (só este componente re-renderiza ao mover o foco). */
function TvChannelPanel({ channels, current }: { channels: MediaItem[]; current?: MediaItem }) {
  const focused = useFocusedChannel();
  const shown = focused && channels.some((c) => c.id === focused.id) ? focused : (current ?? channels[0]);
  if (!shown) return null;
  return <TvChannelInfo item={shown} playing={shown.id === current?.id} />;
}

const TvChannelRow = memo(function TvChannelRow({
  number,
  channel,
  selected,
  isDefault,
  onSelect,
  onFocus,
}: {
  number: number;
  channel: MediaItem;
  selected: boolean;
  isDefault: boolean;
  onSelect: (item: MediaItem) => void;
  onFocus?: (item: MediaItem) => void;
}) {
  const { current } = useNowNext(channel, 0);
  const now = useNow();
  return (
    <button
      type="button"
      onClick={() => onSelect(channel)}
      onFocus={() => onFocus?.(channel)}
      aria-current={selected ? 'true' : undefined}
      data-channel-id={channel.id}
      data-nav-default={isDefault ? '' : undefined}
      className="flex h-[68px] w-full items-center gap-4 rounded-xl px-3 text-left"
    >
      <span className="w-9 shrink-0 text-right text-base text-muted tabular-nums">{number}</span>
      <Thumb src={channel.logo} name={channel.name} className="h-12 w-20 shrink-0 rounded-lg" />
      <span className="min-w-0 flex-1">
        <span className={cx('flex items-center gap-2 text-lg font-semibold', selected && 'text-accent')}>
          <span className="truncate">{channel.name}</span>
          <UnavailableBadge id={channel.id} />
        </span>
        <span className="block truncate text-sm text-muted">{current?.title ?? channel.group ?? ''}</span>
        {current && (
          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/10">
            <span className="block h-full bg-accent" style={{ width: `${programmeProgress(current, now) * 100}%` }} />
          </span>
        )}
      </span>
    </button>
  );
});

/** Ficha do canal em foco: logotipo, agora (com progresso), a seguir e favoritar. */
function TvChannelInfo({ item, playing }: { item: MediaItem; playing: boolean }) {
  const t = useT();
  const language = useStore((s) => s.settings.language);
  const { current, next } = useNowNext(item, 3);
  const now = useNow();
  return (
    <div className="rounded-2xl bg-surface p-6">
      <Thumb src={item.logo} name={item.name} className="mb-4 aspect-video w-full rounded-xl text-3xl" />
      <h2 className="flex items-center gap-2 text-2xl font-bold">
        <span className="truncate">{item.name}</span>
      </h2>
      <p className="mt-1 truncate text-base text-muted">{item.group ?? t('Sem categoria')}</p>
      {/* Favoritar pela TV: ▶ a partir do canal chega aqui; ◀ volta ao mesmo canal na lista. */}
      <div
        className="mt-4"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft') return;
          event.preventDefault();
          focusChannelInList();
        }}
      >
        <FavoriteButton id={item.id} kind="live" playlistId={item.playlistId} withLabel className="tv-action h-12 w-full rounded-full text-base" />
      </div>
      {current ? (
        <div className="mt-4">
          <p className="text-xs font-bold tracking-wide text-accent uppercase">{t('Agora')}</p>
          <p className="mt-1 line-clamp-2 text-lg font-semibold">{current.title}</p>
          <p className="text-sm text-muted tabular-nums">
            {formatHour(current.start, language)} – {formatHour(current.stop, language)}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-accent" style={{ width: `${programmeProgress(current, now) * 100}%` }} />
          </div>
          {next.length > 0 && (
            <ul className="mt-4 space-y-1 text-sm text-muted">
              {next.map((programme) => (
                <li key={programme.start} className="truncate">
                  <span className="tabular-nums">{formatHour(programme.start, language)}</span> · {programme.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">{t('Sem programação para este canal.')}</p>
      )}
      <p className="mt-4 text-sm text-muted">
        {playing ? t('OK para voltar à tela cheia') : t('OK para assistir em tela cheia')} · {t('▶ favoritar')}
      </p>
    </div>
  );
}

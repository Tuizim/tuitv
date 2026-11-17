'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { CalendarDays, FileUp, Link2, Play, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { resolveEpgChannel } from '@tuitv/business-rules';
import type { EpgSource, MediaItem, Programme } from '@tuitv/shared-models';
import { maskUrl } from '@tuitv/validation';
import { AddSourceDialog, ConfirmDialog } from '@/components/dialogs';
import { Thumb } from '@/components/Thumb';
import { Button, Dropdown, Empty, IconButton, Modal, Notice, PageHeader, cx } from '@/components/ui';
import { itemHref, loadProgrammes, useNow } from '@/lib/hooks';
import { formatDate, formatHour, importErrorText, useT } from '@/lib/i18n';
import { useStore } from '@/lib/store';

const HOUR = 3_600_000;
const PX_PER_MIN = 4;
const HOURS = 24;
const CHANNEL_WIDTH = 168;
const ROW = 64;
const ALL = '\u0000all';

/** Guia de programação (PRD RF-009): XMLTV por endereço ou arquivo; horários no fuso do dispositivo. */
export default function GuidePage() {
  const t = useT();
  const sources = useStore((s) => s.epgSources);
  const playlists = useStore((s) => s.playlists);
  const [dialog, setDialog] = useState<{ mode: 'url' | 'file'; url?: string } | null>(null);

  // Endereços de guia anunciados pelas próprias listas (url-tvg) e ainda não adicionados.
  const suggestions = useMemo(() => {
    const known = new Set(sources.map((s) => s.url));
    return [...new Set(playlists.map((p) => p.epgUrl).filter((u): u is string => !!u && !known.has(u)))];
  }, [sources, playlists]);

  return (
    <>
      <PageHeader
        title={t('Guia de programação')}
        subtitle={t('Horários exibidos no fuso horário deste dispositivo.')}
        actions={
          <>
            <Button onClick={() => setDialog({ mode: 'file' })}>
              <FileUp className="size-4" /> {t('Importar arquivo')}
            </Button>
            <Button variant="primary" onClick={() => setDialog({ mode: 'url' })}>
              <Link2 className="size-4" /> {t('Adicionar guia')}
            </Button>
          </>
        }
      />

      {suggestions.map((url) => (
        <div key={url} className="mb-3">
          <Notice>
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 break-all">{t('Uma das suas listas indica um guia de programação:')} <strong>{maskUrl(url)}</strong></span>
              <Button variant="primary" onClick={() => setDialog({ mode: 'url', url })}>
                {t('Adicionar')}
              </Button>
            </span>
          </Notice>
        </div>
      ))}

      {sources.length === 0 ? (
        <Empty icon={<CalendarDays className="size-10" />} title={t('Nenhum guia importado')}>
          <p>{t('Adicione um guia no formato XMLTV (por endereço ou arquivo) para ver o programa atual e os próximos de cada canal.')}</p>
        </Empty>
      ) : (
        <>
          <div className="mb-5 grid gap-3 lg:grid-cols-2">
            {sources.map((source) => (
              <SourceCard key={source.id} source={source} />
            ))}
          </div>
          <Grid />
        </>
      )}
      {dialog && <AddSourceDialog kind="epg" initialMode={dialog.mode} initialUrl={dialog.url} onClose={() => setDialog(null)} />}
    </>
  );
}

function SourceCard({ source }: { source: EpgSource }) {
  const t = useT();
  const language = useStore((s) => s.settings.language);
  const refreshEpg = useStore((s) => s.refreshEpg);
  const deleteEpg = useStore((s) => s.deleteEpg);
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async (file?: File) => {
    setBusy(true);
    try {
      await refreshEpg(source.id, file);
      toast(t('Guia atualizado.'), 'success');
    } catch (err) {
      toast(importErrorText(t, err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{source.name}</p>
        <p className="truncate text-xs text-muted">
          {source.channelCount === 0 && source.programmeCount === 0
            ? t('Atualize para baixar a programação.')
            : `${t('{n} canais', { n: source.channelCount.toLocaleString() })} · ${t('{n} programas', { n: source.programmeCount.toLocaleString() })} · ${formatDate(source.updatedAt, language)}`}
        </p>
      </div>
      <input ref={fileRef} type="file" accept=".xml,.gz,.xmltv" className="sr-only" onChange={(e) => e.target.files?.[0] && void refresh(e.target.files[0])} />
      <IconButton label={t('Atualizar')} disabled={busy} onClick={() => (source.source === 'url' ? void refresh() : fileRef.current?.click())}>
        <RefreshCw className={cx('size-5', busy && 'animate-spin')} />
      </IconButton>
      <IconButton label={t('Excluir')} disabled={busy} onClick={() => setRemoving(true)}>
        <Trash2 className="size-5" />
      </IconButton>
      {removing && (
        <ConfirmDialog
          title={t('Excluir guia')}
          message={t('O guia “{name}” e sua programação serão apagados deste dispositivo.', { name: source.name })}
          confirmLabel={t('Excluir')}
          danger
          onConfirm={() => deleteEpg(source.id)}
          onClose={() => setRemoving(false)}
        />
      )}
    </div>
  );
}

function Grid() {
  const t = useT();
  const lib = useStore((s) => s.lib);
  const epgIndex = useStore((s) => s.epgIndex);
  const language = useStore((s) => s.settings.language);
  const now = useNow();
  const [group, setGroup] = useState(ALL);
  const [detail, setDetail] = useState<{ programme: Programme; channel: MediaItem } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A grade começa uma hora antes da hora cheia atual e cobre 24 horas.
  const [start] = useState(() => Math.floor(Date.now() / HOUR) * HOUR - HOUR);
  const end = start + HOURS * HOUR;

  const rows = useMemo(() => {
    const out: { channel: MediaItem; key: string }[] = [];
    for (const channel of lib.live) {
      if (group !== ALL && channel.group !== group) continue;
      const key = resolveEpgChannel(channel, epgIndex);
      if (key) out.push({ channel, key });
    }
    return out;
  }, [lib, epgIndex, group]);

  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW, overscan: 6 });

  useEffect(() => {
    scrollRef.current?.scrollTo({ left: ((Date.now() - start) / 60_000) * PX_PER_MIN - 80 });
  }, [start]);

  const width = HOURS * 60 * PX_PER_MIN;
  const nowLeft = ((now - start) / 60_000) * PX_PER_MIN;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{t('{n} canais com programação', { n: rows.length.toLocaleString() })}</p>
        <Dropdown
          label={t('Categoria')}
          value={group}
          onChange={setGroup}
          align="right"
          className="w-56"
          options={[{ value: ALL, label: t('Todas as categorias') }, ...lib.liveGroups.map((g) => ({ value: g.name, label: g.name }))]}
        />
      </div>
      {rows.length === 0 ? (
        <Notice>{t('Nenhum canal das listas ativas corresponde aos canais deste guia. A associação usa o tvg-id e o nome do canal.')}</Notice>
      ) : (
        <div ref={scrollRef} className="h-[calc(100dvh-330px)] min-h-80 overflow-auto rounded-xl border border-line bg-surface" data-testid="epg-grid">
          <div style={{ width: width + CHANNEL_WIDTH, position: 'relative' }}>
            <div className="sticky top-0 z-20 flex h-9 border-b border-line bg-bg-deep text-xs font-semibold text-muted">
              <div className="sticky left-0 z-10 shrink-0 bg-bg-deep" style={{ width: CHANNEL_WIDTH }} />
              {Array.from({ length: HOURS }, (_, hour) => (
                <div key={hour} className="flex shrink-0 items-center border-l border-line px-2 tabular-nums" style={{ width: 60 * PX_PER_MIN }}>
                  {formatHour(start + hour * HOUR, language)}
                </div>
              ))}
            </div>
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {nowLeft > 0 && nowLeft < width && (
                <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-danger" style={{ left: CHANNEL_WIDTH + nowLeft }} />
              )}
              {virtualizer.getVirtualItems().map((row) => {
                const entry = rows[row.index]!;
                return (
                  <div key={entry.channel.id} className="absolute left-0 flex w-full border-b border-line/60" style={{ height: ROW, transform: `translateY(${row.start}px)` }}>
                    <Link
                      href={itemHref(entry.channel)}
                      title={entry.channel.name}
                      className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line bg-surface px-2 -outline-offset-2 hover:bg-surface-2"
                      style={{ width: CHANNEL_WIDTH }}
                    >
                      <Thumb src={entry.channel.logo} name={entry.channel.name} className="size-9 shrink-0 rounded-md" />
                      <span className="line-clamp-2 text-xs font-semibold">{entry.channel.name}</span>
                    </Link>
                    <Timeline channelKey={entry.key} start={start} end={end} now={now} onOpen={(programme) => setDetail({ programme, channel: entry.channel })} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {detail && (
        <Modal
          title={detail.programme.title}
          onClose={() => setDetail(null)}
          footer={
            <Link href={itemHref(detail.channel)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink">
              <Play className="size-4" fill="currentColor" /> {t('Assistir {name}', { name: detail.channel.name })}
            </Link>
          }
        >
          <p className="text-sm font-semibold">
            {formatDate(detail.programme.start, language)} – {formatHour(detail.programme.stop, language)}
          </p>
          <p className="mt-1 text-xs text-muted">{[detail.channel.name, detail.programme.category].filter(Boolean).join(' · ')}</p>
          <p className="mt-3 text-sm leading-relaxed text-muted">{detail.programme.description ?? t('Sem descrição disponível.')}</p>
        </Modal>
      )}
    </section>
  );
}

const Timeline = memo(function Timeline({
  channelKey,
  start,
  end,
  now,
  onOpen,
}: {
  channelKey: string;
  start: number;
  end: number;
  now: number;
  onOpen: (programme: Programme) => void;
}) {
  const t = useT();
  const version = useStore((s) => s.epgVersion);
  const [programmes, setProgrammes] = useState<Programme[] | null>(null);
  useEffect(() => {
    let alive = true;
    void loadProgrammes(channelKey, start, end, version).then((rows) => alive && setProgrammes(rows));
    return () => {
      alive = false;
    };
  }, [channelKey, start, end, version]);

  return (
    <div className="relative flex-1">
      {programmes?.length === 0 && <span className="absolute top-1/2 left-3 -translate-y-1/2 text-xs text-muted">{t('Sem programação neste período')}</span>}
      {programmes?.map((programme) => {
        const from = Math.max(programme.start, start);
        const to = Math.min(programme.stop, end);
        if (to <= from) return null;
        const live = programme.start <= now && programme.stop > now;
        return (
          <button
            key={programme.start}
            type="button"
            onClick={() => onOpen(programme)}
            title={programme.title}
            className={cx(
              'absolute top-1 bottom-1 overflow-hidden rounded-md border px-2 text-left text-xs -outline-offset-2 transition hover:border-accent',
              live ? 'border-accent/60 bg-accent/15' : programme.stop <= now ? 'border-line bg-bg/40 text-muted' : 'border-line bg-surface-2',
            )}
            style={{ left: ((from - start) / 60_000) * PX_PER_MIN + 1, width: Math.max(4, ((to - from) / 60_000) * PX_PER_MIN - 2) }}
          >
            <span className="block truncate font-semibold">{programme.title}</span>
          </button>
        );
      })}
    </div>
  );
});

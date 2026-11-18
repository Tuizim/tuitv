'use client';

import { History as HistoryIcon, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { ContentKind } from '@tuitv/shared-models';
import { ConfirmDialog } from '@/components/dialogs';
import { Thumb } from '@/components/Thumb';
import { Button, Chip, Empty, IconButton, PageHeader } from '@/components/ui';
import { itemHref } from '@/lib/hooks';
import { formatClock, formatDate, useT } from '@/lib/i18n';
import { useResolver, useStore } from '@/lib/store';

export default function HistoryPage() {
  const t = useT();
  const history = useStore((s) => s.history);
  const resolve = useResolver();
  const language = useStore((s) => s.settings.language);
  const removeHistory = useStore((s) => s.removeHistory);
  const clearHistory = useStore((s) => s.clearHistory);
  const [tab, setTab] = useState<ContentKind | null>(null);
  const [confirm, setConfirm] = useState(false);

  if (history.length === 0) {
    return (
      <Empty icon={<HistoryIcon className="size-10" />} title={t('Histórico vazio')}>
        <p>{t('Os canais, filmes e episódios que você assistir aparecem aqui. O histórico fica apenas neste dispositivo.')}</p>
      </Empty>
    );
  }

  const tabs: { kind: ContentKind | null; label: string }[] = [
    { kind: null, label: t('Tudo') },
    { kind: 'live', label: t('Canais') },
    { kind: 'movie', label: t('Filmes') },
    { kind: 'series', label: t('Episódios') },
  ];
  const visible = history.filter((h) => !tab || h.kind === tab).slice(0, 500);

  return (
    <>
      <PageHeader
        title={t('Histórico')}
        actions={
          <Button variant="danger" onClick={() => setConfirm(true)}>
            <Trash2 className="size-4" /> {t('Limpar histórico')}
          </Button>
        }
      />
      <div className="mb-5 flex gap-2">
        {tabs.map((x) => (
          <Chip key={x.label} active={tab === x.kind} onClick={() => setTab(x.kind)}>
            {x.label}
          </Chip>
        ))}
      </div>
      <ul className="overflow-hidden rounded-xl border border-line bg-surface">
        {visible.map((entry) => {
          const item = resolve.item(entry.itemId);
          const body = (
            <>
              <Thumb src={entry.logo} name={entry.name} className="size-11 shrink-0 rounded-lg" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{entry.name}</span>
                <span className="block truncate text-xs text-muted">
                  {formatDate(entry.playedAt, language)}
                  {entry.kind !== 'live' && entry.duration > 0 && ` · ${entry.completed ? t('Assistido') : `${formatClock(entry.position)} / ${formatClock(entry.duration)}`}`}
                  {!item && ` · ${t('indisponível nas listas ativas')}`}
                </span>
              </span>
            </>
          );
          return (
            <li key={entry.itemId} className="flex items-center gap-1 border-b border-line/60 pr-2 last:border-0">
              {item ? (
                <Link href={itemHref(item)} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 -outline-offset-2 hover:bg-surface-2">
                  {body}
                </Link>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 opacity-60">{body}</div>
              )}
              <IconButton label={t('Remover do histórico')} onClick={() => removeHistory(entry.itemId)}>
                <X className="size-4" />
              </IconButton>
            </li>
          );
        })}
      </ul>
      {visible.length === 0 && <p className="py-10 text-center text-sm text-muted">{t('Nada por aqui.')}</p>}
      {confirm && (
        <ConfirmDialog
          title={t('Limpar histórico')}
          message={t('Todo o histórico de reprodução e as posições de continuação serão apagados deste dispositivo.')}
          confirmLabel={t('Limpar histórico')}
          danger
          onConfirm={clearHistory}
          onClose={() => setConfirm(false)}
        />
      )}
    </>
  );
}

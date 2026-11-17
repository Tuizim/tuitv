'use client';

import { Star } from 'lucide-react';
import { useT } from '@/lib/i18n';
import type { ExtraInfo } from '@/lib/meta';

/** Sinopse e ficha (gênero, nota, elenco, direção) de um filme ou série. */
export function Synopsis({ info, fallback }: { info: ExtraInfo | null | undefined; fallback?: string }) {
  const t = useT();
  const plot = info?.plot ?? fallback;
  if (info === undefined && !fallback) return <div className="mt-4 h-16 max-w-3xl animate-pulse rounded-lg bg-surface" aria-hidden />;
  return (
    <div className="mt-4 max-w-3xl space-y-3" data-testid="synopsis">
      {(info?.rating || info?.genre) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {info.rating && (
            <span className="inline-flex items-center gap-1 font-semibold text-warning">
              <Star className="size-4" fill="currentColor" /> {info.rating}
            </span>
          )}
          {info.genre && <span className="text-muted">{info.genre}</span>}
        </p>
      )}
      {plot ? (
        <p className="text-sm leading-relaxed text-ink/85">{plot}</p>
      ) : (
        <p className="text-sm text-muted">{t('Esta lista não informa a sinopse deste título.')}</p>
      )}
      {(info?.cast || info?.director) && (
        <dl className="space-y-1 text-sm text-muted">
          {info.cast && (
            <div>
              <dt className="inline font-semibold text-ink/80">{t('Elenco')}: </dt>
              <dd className="inline">{info.cast}</dd>
            </div>
          )}
          {info.director && (
            <div>
              <dt className="inline font-semibold text-ink/80">{t('Direção')}: </dt>
              <dd className="inline">{info.director}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

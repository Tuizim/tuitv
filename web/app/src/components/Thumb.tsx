'use client';

import { useState } from 'react';
import { cx } from './ui';
import { lazyImageRef } from '@/lib/lazyImages';
import { isTv } from '@/lib/platform';

/** Logotipo/capa com substituto quando a imagem não existe ou falha. */
export function Thumb({
  src,
  name,
  className,
  fit = 'contain',
}: {
  src?: string;
  name: string;
  className?: string;
  fit?: 'contain' | 'cover';
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const tv = isTv();
  const show = src && failed !== src;
  const initials = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <span className={cx('flex items-center justify-center overflow-hidden bg-bg-deep text-muted', className)}>
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          // TV: a capa só é baixada perto da tela (ver lib/lazyImages.ts).
          {...(tv ? { 'data-lazy-src': src, ref: lazyImageRef } : { src })}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(src)}
          className={cx('size-full', fit === 'cover' ? 'object-cover' : 'object-contain p-1')}
        />
      ) : (
        <span className="px-1 text-center text-sm font-bold select-none">{initials || '•'}</span>
      )}
    </span>
  );
}

/**
 * Substituto de `next/link` para o aplicativo Tizen: o mesmo componente <Link href="/live">,
 * renderizado como âncora para o hash ("#/live"). Ver ../router.ts.
 */
import type { AnchorHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';
import { navigate, toHash } from '../router';

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string | { pathname?: string; query?: Record<string, string> };
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean | null;
  children?: ReactNode;
  ref?: Ref<HTMLAnchorElement>;
};

function hrefOf(href: Props['href']): string {
  if (typeof href === 'string') return href;
  const query = href.query ? `?${new URLSearchParams(href.query).toString()}` : '';
  return `${href.pathname ?? '/'}${query}`;
}

export default function Link({ href, replace, scroll: _scroll, prefetch: _prefetch, onClick, children, ...rest }: Props) {
  const target = hrefOf(href);
  return (
    <a
      {...rest}
      href={toHash(target)}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(target, { replace });
      }}
    >
      {children}
    </a>
  );
}

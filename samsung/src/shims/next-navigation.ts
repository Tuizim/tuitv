/**
 * Substituto de `next/navigation` para o aplicativo Tizen (roteamento por hash, ver ../router.ts).
 * Implementa apenas o que a interface Web usa: useRouter, usePathname e useSearchParams.
 */
import { useMemo } from 'react';
import { navigate, useLocation } from '../router';

export interface AppRouter {
  push(href: string): void;
  replace(href: string): void;
  back(): void;
  forward(): void;
  refresh(): void;
  prefetch(href: string): void;
}

const router: AppRouter = {
  push: (href) => navigate(href),
  replace: (href) => navigate(href, { replace: true }),
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  refresh: () => undefined,
  prefetch: () => undefined,
};

export function useRouter(): AppRouter {
  return router;
}

export function usePathname(): string {
  return useLocation().pathname;
}

export function useSearchParams(): URLSearchParams {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function redirect(href: string): never {
  navigate(href, { replace: true });
  throw new Error('redirect');
}

export function notFound(): never {
  navigate('/', { replace: true });
  throw new Error('not-found');
}

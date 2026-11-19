/**
 * Roteamento por hash para o aplicativo Tizen.
 *
 * Na TV o aplicativo é aberto a partir de um arquivo local (file://…/index.html): rotas por caminho
 * (/live/, /movies/…) do Next.js não existem ali. Os mesmos endereços passam a viver no hash:
 * "/live?g=Esportes" ⇄ "index.html#/live?g=Esportes". O histórico do navegador continua valendo,
 * e o botão Voltar do controle usa history.back().
 */
import { useSyncExternalStore } from 'react';
import { notePush } from '@/lib/screens';

export interface RouteLocation {
  /** Sempre com "/" inicial e sem "/" final (exceto a raiz). */
  pathname: string;
  /** Sem "?" inicial. */
  search: string;
}

const listeners = new Set<() => void>();
let current = read();
/** Âncora (#id) pedida junto com a rota, rolada até ficar visível depois da renderização. */
let pendingAnchor: string | null = null;

function normalize(path: string): string {
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash;
}

/** Separa um href ("/settings/?x=1#backup") em caminho, busca e âncora. */
export function splitHref(href: string): { pathname: string; search: string; anchor: string | null } {
  let rest = href;
  let anchor: string | null = null;
  const hash = rest.indexOf('#');
  if (hash >= 0) {
    anchor = rest.slice(hash + 1) || null;
    rest = rest.slice(0, hash);
  }
  const q = rest.indexOf('?');
  const path = q >= 0 ? rest.slice(0, q) : rest;
  const search = q >= 0 ? rest.slice(q + 1) : '';
  return { pathname: normalize(path || '/'), search, anchor };
}

function read(): RouteLocation {
  const raw = window.location.hash.replace(/^#/, '');
  const { pathname, search } = splitHref(raw || '/');
  return { pathname, search };
}

/** Href no formato usado em <a href>: "#/live?g=x". */
export function toHash(href: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href; // endereço externo, sem alteração
  const { pathname, search } = splitHref(href);
  return `#${pathname}${search ? `?${search}` : ''}`;
}

function update() {
  const next = read();
  if (next.pathname === current.pathname && next.search === current.search) return;
  current = next;
  listeners.forEach((listener) => listener());
}

window.addEventListener('hashchange', update);

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getLocation = () => current;

export function navigate(href: string, options: { replace?: boolean } = {}) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    window.open(href, '_blank', 'noopener');
    return;
  }
  pendingAnchor = splitHref(href).anchor;
  const target = toHash(href);
  if (options.replace) {
    // replaceState não dispara hashchange: atualiza o estado manualmente.
    window.history.replaceState(window.history.state, '', target);
    update();
  } else if (window.location.hash !== target) {
    // Navegação nova: o popstate que a troca de hash dispara não é uma volta (lib/screens.ts).
    notePush(target.slice(1));
    window.location.hash = target;
  } else {
    update();
  }
}

/** Âncora pendente da última navegação (consumida uma única vez). */
export function takeAnchor(): string | null {
  const anchor = pendingAnchor;
  pendingAnchor = null;
  return anchor;
}

export function useLocation(): RouteLocation {
  return useSyncExternalStore(subscribe, getLocation, getLocation);
}

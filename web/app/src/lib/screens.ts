'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';

/**
 * Memória das telas, no estilo Netflix: ao voltar (Voltar do navegador, do celular ou do controle)
 * para uma tela já visitada, ela reaparece como o usuário a deixou — mesma rolagem, mesmo cartão
 * em foco e as mesmas fileiras montadas. Ex.: Filmes › Terror, descer bastante, abrir um filme,
 * voltar: o usuário continua no mesmo ponto da lista, e não no topo.
 *
 * Cada endereço (caminho + busca) tem uma lembrança. Abrir uma tela de novo pelo menu ou por um
 * link começa do zero; só a volta pelo histórico (popstate) restaura.
 */
interface Snapshot {
  /** Rolagem vertical da página. */
  y: number;
  /** Elemento em foco: href do link e qual deles (o mesmo título pode estar em duas fileiras). */
  focus?: { href: string; nth: number };
  /** Rolagem horizontal das fileiras (celular e desktop), pelo título da fileira. */
  rows: Record<string, number>;
  /** Estado de componentes que precisa voltar junto (ex.: quantas fileiras a TV já montou). */
  data: Record<string, unknown>;
}

/** Telas lembradas; as mais antigas são esquecidas. */
const LIMIT = 40;
/** Por quanto tempo a restauração espera o conteúdo carregar (listas grandes, login remoto). */
const RESTORE_MS = 4000;
const TICK_MS = 50;
/** Mínimo antes de concluir: o conteúdo ainda pode crescer logo depois de aparecer. */
const MIN_MS = 300;

const saved = new Map<string, Snapshot>();
/** Tela da visita atual: a primeira gravação numa tela nova (sem ser volta) começa do zero. */
let visit: string | null = null;
/** Tela a que se chegou pelo histórico e que ainda não foi restaurada. */
let returning: string | null = null;
let restoring = false;
/** Restauração atual (as anteriores param ao ver outro número). */
let session = 0;
/** Destino da última navegação nova pedida pelo roteador por hash (ver notePush). */
let pushed: string | null = null;
let installed = false;

/** Normaliza "/movies/?g=A%20B" e "/movies?g=A+B" para a mesma chave. */
export function screenKey(pathname: string, search: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const query = new URLSearchParams(search).toString();
  return query ? `${path}?${query}` : path;
}

/** Chave da tela atual a partir do endereço (rotas por hash do aplicativo de TV incluídas). */
function currentKey(): string {
  const hash = window.location.hash;
  if (hash.startsWith('#/')) {
    const raw = hash.slice(1);
    const q = raw.indexOf('?');
    return screenKey(q >= 0 ? raw.slice(0, q) : raw, q >= 0 ? raw.slice(q + 1) : '');
  }
  const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
  const path = base && window.location.pathname.startsWith(base) ? window.location.pathname.slice(base.length) || '/' : window.location.pathname;
  return screenKey(path, window.location.search);
}

/** Lembrança da tela atual, para gravar. */
function current(): Snapshot {
  const key = currentKey();
  if (visit !== key) {
    visit = key;
    if (returning !== key || !saved.has(key)) saved.set(key, { y: 0, rows: {}, data: {} });
  }
  const snap = saved.get(key)!;
  // Mais recente por último (ordem de inserção do Map): a mais antiga sai primeiro.
  saved.delete(key);
  saved.set(key, snap);
  if (saved.size > LIMIT) saved.delete(saved.keys().next().value!);
  return snap;
}

/** Uma restauração está em andamento (o controle da TV não deve levar a tela ao topo). */
export const isRestoringScreen = () => restoring;

function focusTarget(snap: Snapshot): HTMLElement | null {
  if (!snap.focus) return null;
  const all = document.querySelectorAll<HTMLElement>('main a[href]');
  let nth = 0;
  for (const el of all) {
    if (el.getAttribute('href') !== snap.focus.href) continue;
    if (nth++ === snap.focus.nth) return el.offsetParent !== null ? el : null;
  }
  return null;
}

function restoreRows(snap: Snapshot) {
  for (const el of document.querySelectorAll<HTMLElement>('[data-row-scroll]')) {
    const left = snap.rows[el.dataset.rowScroll!];
    if (left && Math.abs(el.scrollLeft - left) > 1) el.scrollTo({ left, behavior: 'instant' as ScrollBehavior });
  }
}

/**
 * Restaura a tela [key] quando o conteúdo dela existir: rola até a posição guardada e devolve o
 * foco ao cartão. Tenta por alguns segundos (os dados chegam do IndexedDB ou do servidor) e
 * desiste assim que o usuário mexer na tela.
 */
function restore(key: string, focus: (el: HTMLElement) => void) {
  // Uma restauração por vez: a de uma tela anterior ainda em andamento é abandonada.
  const id = ++session;
  const snap = saved.get(key);
  if (!snap) {
    restoring = false;
    returning = null;
    return;
  }
  returning = key;
  restoring = true;
  const started = Date.now();
  let stable = 0;
  const stop = () => {
    window.removeEventListener('keydown', stop, true);
    window.removeEventListener('pointerdown', stop, true);
    window.removeEventListener('wheel', stop, true);
    window.removeEventListener('touchstart', stop, true);
    if (id !== session) return;
    restoring = false;
    if (returning === key) returning = null;
  };
  window.addEventListener('keydown', stop, true);
  window.addEventListener('pointerdown', stop, true);
  window.addEventListener('wheel', stop, true);
  window.addEventListener('touchstart', stop, true);

  const tick = () => {
    if (id !== session || !restoring || currentKey() !== key) return stop();
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const y = Math.min(snap.y, Math.max(0, max));
    if (Math.abs(window.scrollY - y) > 1) window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
    restoreRows(snap);
    const target = focusTarget(snap);
    if (target && document.activeElement !== target) focus(target);
    // Pronto quando a página já tem altura para a posição guardada e o foco (se havia) voltou.
    const reached = max >= snap.y - 1 && Math.abs(window.scrollY - snap.y) <= 1;
    const focused = !snap.focus || document.activeElement === target;
    stable = reached && focused ? stable + 1 : 0;
    const elapsed = Date.now() - started;
    if ((stable >= 3 && elapsed >= MIN_MS) || elapsed > RESTORE_MS) return stop();
    window.setTimeout(tick, TICK_MS);
  };
  window.setTimeout(tick, 0);
}

/**
 * Avisa que a próxima troca de endereço é uma navegação nova, não uma volta. No aplicativo de TV
 * (rotas por hash) mudar o hash também dispara popstate; sem o aviso, toda tela seria "restaurada".
 */
export function notePush(href: string) {
  const q = href.indexOf('?');
  pushed = screenKey(q >= 0 ? href.slice(0, q) : href, q >= 0 ? href.slice(q + 1) : '');
}

/**
 * Liga a memória das telas (uma vez, no AppShell). [focus] devolve o foco a um elemento: na TV, o
 * controle remoto passa a própria função, que também desliza o carrossel até o cartão.
 */
export function installScreenMemory(focus: (el: HTMLElement) => void = (el) => el.focus({ preventScroll: true })) {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // A rolagem é restaurada aqui, quando o conteúdo carrega; a do navegador chegaria cedo demais.
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';

  window.addEventListener('popstate', () => {
    const key = currentKey();
    if (pushed !== null) {
      const push = pushed === key;
      pushed = null;
      if (push) return;
    }
    // O endereço já é o da tela de destino; espera a nova tela ser desenhada.
    session++;
    returning = key;
    restoring = saved.has(returning);
    window.setTimeout(() => restore(key, focus), 0);
  });
  window.addEventListener(
    'scroll',
    (event) => {
      if (restoring) return;
      const target = event.target;
      if (target === document || target === window) {
        current().y = window.scrollY;
      } else if (target instanceof HTMLElement && target.dataset.rowScroll) {
        current().rows[target.dataset.rowScroll] = target.scrollLeft;
      }
    },
    { capture: true, passive: true },
  );
  window.addEventListener('focusin', (event) => {
    if (restoring) return;
    const el = event.target instanceof HTMLElement ? event.target : null;
    const link = el?.closest<HTMLAnchorElement>('main a[href]');
    const snap = current();
    if (!link) {
      // Foco no cabeçalho ou num botão: o cartão lembrado continua o anterior.
      if (el?.closest('main')) snap.focus = undefined;
      return;
    }
    const href = link.getAttribute('href')!;
    const same = [...document.querySelectorAll<HTMLElement>('main a[href]')].filter((a) => a.getAttribute('href') === href);
    snap.focus = { href, nth: Math.max(0, same.indexOf(link)) };
  });
}

/**
 * Estado que volta junto com a tela: igual a useState, mas ao retornar pelo histórico começa com
 * o valor que tinha quando o usuário saiu (dentro da mesma visita, também sobrevive a remontagens).
 */
export function useScreenState<T>(name: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const pathname = usePathname() ?? '/';
  const search = useSearchParams()?.toString() ?? '';
  const key = screenKey(pathname, search);
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    const snap = saved.get(key);
    const known = returning === key || visit === key;
    return known && snap && name in snap.data ? (snap.data[name] as T) : initial;
  });
  const set = useCallback(
    (next: T | ((prev: T) => T)) =>
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        if (currentKey() === key) current().data[name] = resolved;
        return resolved;
      }),
    [key, name],
  );
  return [value, set];
}

/**
 * Troca a busca do endereço sem criar uma entrada no histórico (ex.: a categoria escolhida no
 * catálogo): assim a volta de um filme reabre a mesma categoria. Na Web usa o History API (o
 * Next.js acompanha sem recarregar a tela); no aplicativo de TV, o roteador por hash.
 */
export function replaceQuery(router: { replace(href: string): void }, pathname: string, query: URLSearchParams) {
  const search = query.toString();
  if (window.location.hash.startsWith('#/')) {
    router.replace(`${pathname}${search ? `?${search}` : ''}`);
    return;
  }
  window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}`);
}

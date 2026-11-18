'use client';

import { isTv } from '@/lib/platform';
import {
  ArrowLeft,
  CalendarDays,
  Clapperboard,
  Download,
  Film,
  History,
  Home,
  ListVideo,
  Lock,
  LockOpen,
  Menu,
  Search,
  Settings as SettingsIcon,
  Star,
  Tv,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useBackLayer } from '@/lib/back';
import { useUi } from '@/lib/hooks';
import { importErrorText, useT } from '@/lib/i18n';
import { useStore } from '@/lib/store';
import { PinDialog } from './dialogs';
import { CatMark, Logo, Wordmark } from './Logo';
import { IconButton, Notice, Spinner, cx } from './ui';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Navegação principal (barra superior) e secundária (menu), cobrindo os nove destinos do PRD §6. */
export const PRIMARY: NavItem[] = [
  { href: '/', label: 'Início', icon: Home },
  { href: '/live', label: 'TV ao vivo', icon: Tv },
  { href: '/movies', label: 'Filmes', icon: Film },
  { href: '/series', label: 'Séries', icon: Clapperboard },
  { href: '/favorites', label: 'Favoritos', icon: Star },
];
export const SECONDARY: NavItem[] = [
  { href: '/history', label: 'Histórico', icon: History },
  { href: '/guide', label: 'Guia de programação', icon: CalendarDays },
  { href: '/playlists', label: 'Minhas listas', icon: ListVideo },
  { href: '/settings', label: 'Configurações', icon: SettingsIcon },
];

/** Celular: barra inferior enxuta, como nos apps de streaming. Filmes e Séries ficam nos atalhos do topo do Início. */
const BOTTOM = ['/', '/live', '/favorites'];
/** Celular: atalhos em pílula fixos abaixo do cabeçalho, como os filtros do topo dos apps da Netflix, Prime e HBO. */
const CHIPS = ['/series', '/movies', '/live'];
/** Telas de um item (ficha, série, player, busca): no celular o topo mostra só o voltar e a busca. */
const DETAIL = ['/series/view', '/series/continue', '/title', '/watch', '/search'];

const clean = (path: string) => (path.length > 1 ? path.replace(/\/$/, '') : path);
const isActive = (pathname: string, href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const pathname = clean(usePathname() ?? '/');
  const ready = useStore((s) => s.ready);
  const init = useStore((s) => s.init);
  const autoRefresh = useStore((s) => s.autoRefresh);
  const parental = useStore((s) => s.settings.parental);
  const unlocked = useStore((s) => s.parentalUnlocked);
  const lock = useStore((s) => s.lock);
  const dataLost = useStore((s) => s.dataLost);
  const query = useUi((s) => s.query);
  const setQuery = useUi((s) => s.setQuery);

  const [menu, setMenu] = useState(false);
  const [searching, setSearching] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [pin, setPin] = useState(false);
  const [online, setOnline] = useState(true);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [nearLimit, setNearLimit] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  /** Fecha o menu e devolve o foco ao botão que o abriu (controle remoto e teclado não se perdem). */
  const closeMenu = () => {
    setMenu(false);
    if (menuRef.current?.contains(document.activeElement)) menuButtonRef.current?.focus({ preventScroll: true });
  };
  // Voltar do controle fecha o menu antes de sair da tela.
  useBackLayer(menu, closeMenu);
  // Ao abrir, o foco entra no primeiro item: as setas do controle andam pelo menu.
  useEffect(() => {
    if (!menu) return;
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menu"] a, [role="menu"] button');
    if (first && first.offsetParent !== null) first.focus({ preventScroll: true });
  }, [menu]);

  useEffect(() => {
    void init();
  }, [init]);

  // Atualização automática das listas e guias remotos: ao abrir e a cada 30 minutos.
  useEffect(() => {
    if (!ready) return;
    const first = setTimeout(() => void autoRefresh(), 3000);
    const every = setInterval(() => void autoRefresh(), 30 * 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [ready, autoRefresh]);

  useEffect(() => setMenu(false), [pathname]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const onScroll = () => setScrolled(window.scrollY > 8);
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallPrompt);
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!menuRef.current?.contains(target) && !target.closest?.('[data-menu-sheet]')) setMenu(false);
    };
    onScroll();
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('beforeinstallprompt', onInstall);
    document.addEventListener('mousedown', onDown);
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
      navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` }).catch(() => undefined);
    }
    void navigator.storage?.estimate?.().then((estimate) => {
      if (estimate.quota && estimate.usage) setNearLimit(estimate.usage / estimate.quota > 0.8);
    });
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('beforeinstallprompt', onInstall);
      document.removeEventListener('mousedown', onDown);
    };
  }, []);

  const onSearch = (value: string) => {
    setQuery(value);
    clearTimeout(searchTimer.current);
    if (value.trim() && pathname !== '/search') searchTimer.current = setTimeout(() => router.push('/search'), 250);
  };
  const searchOpen = searching || query.length > 0;
  const home = pathname === '/';
  const detail = DETAIL.some((href) => isActive(pathname, href));
  // Início, Séries, Filmes e TV ao vivo: a marca no topo e as pílulas fixas logo abaixo.
  const withChips = home || CHIPS.includes(pathname);
  const section = detail || withChips ? undefined : [...PRIMARY, ...SECONDARY].find((n) => n.href !== '/' && isActive(pathname, n.href));

  const extras = (
    <>
      {install && (
        <button
          type="button"
          onClick={() => {
            void install.prompt();
            setInstall(null);
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-accent hover:bg-surface-2"
        >
          <Download className="size-5 shrink-0" /> {t('Instalar aplicativo')}
        </button>
      )}
      {parental.enabled && (
        <button
          type="button"
          onClick={() => {
            setMenu(false);
            if (unlocked) lock();
            else setPin(true);
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium hover:bg-surface-2"
        >
          {unlocked ? <LockOpen className="size-5 shrink-0 text-warning" /> : <Lock className="size-5 shrink-0 text-muted" />}
          {unlocked ? t('Bloquear conteúdo restrito') : t('Desbloquear conteúdo restrito')}
        </button>
      )}
    </>
  );

  const secondaryLinks = SECONDARY.map(({ href, label, icon: Icon }) => (
    <Link
      key={href}
      href={href}
      role="menuitem"
      aria-current={isActive(pathname, href) ? 'page' : undefined}
      className={cx('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-surface-2', isActive(pathname, href) ? 'text-accent' : 'text-ink')}
    >
      <Icon className="size-5 shrink-0 text-muted" /> {t(label)}
    </Link>
  ));

  return (
    <>
      {!ready && <Splash />}

      <header
        className={cx(
          'fixed inset-x-0 top-0 z-40 px-4 transition-colors duration-300 lg:px-12',
          scrolled || menu ? 'border-b border-line/60 bg-bg/95 backdrop-blur' : 'bg-gradient-to-b from-black/90 via-black/60 to-transparent',
        )}
      >
        <div className="flex h-16 items-center gap-2">
          {/* Celular: a marca nas abas principais, o nome da seção nas demais e o voltar nas fichas. */}
          {detail ? (
            <button
              type="button"
              onClick={() => router.back()}
              aria-label={t('Voltar')}
              className={cx('-ml-2 flex size-10 shrink-0 items-center justify-center rounded-full bg-black/30 backdrop-blur md:hidden', searchOpen && 'max-sm:hidden')}
            >
              <ArrowLeft className="size-5" />
            </button>
          ) : section ? (
            <p className={cx('min-w-0 truncate text-2xl font-extrabold tracking-tight md:hidden', searchOpen && 'max-sm:hidden')}>{t(section.label)}</p>
          ) : (
            <Link href="/" aria-label="TuiTV" className={cx('shrink-0 rounded-lg md:hidden', searchOpen && 'max-sm:hidden')}>
              <Wordmark />
            </Link>
          )}
          {/* Na TV o logotipo é só marca: não recebe o foco do controle (Início fica no menu). */}
          <Link href="/" aria-label="TuiTV" tabIndex={isTv() ? -1 : undefined} className="shrink-0 rounded-lg max-md:hidden">
            <Logo className="text-2xl" />
          </Link>

          <nav className="ml-6 hidden items-center gap-1 md:flex" aria-label={t('Menu principal')}>
            {PRIMARY.map(({ href, label }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cx('rounded-lg px-3 py-2 text-sm transition', active ? 'font-bold text-ink' : 'font-medium text-muted hover:text-ink')}
                >
                  {t(label)}
                </Link>
              );
            })}
          </nav>

          <span className="flex-1" />

          {!online && (
            <span className="hidden shrink-0 items-center gap-1.5 text-xs font-medium text-warning sm:inline-flex">
              <WifiOff className="size-4" /> {t('Sem internet')}
            </span>
          )}

          <form
            role="search"
            className={cx(
              'flex h-10 items-center overflow-hidden rounded-full border transition-all duration-200',
              searchOpen ? 'w-full border-line bg-bg/90 sm:w-72' : 'w-10 border-transparent',
            )}
            onSubmit={(event) => {
              event.preventDefault();
              clearTimeout(searchTimer.current);
              if (query.trim()) router.push('/search');
            }}
          >
            <button
              type="button"
              aria-label={t('Buscar')}
              title={t('Buscar')}
              onClick={() => {
                setSearching(true);
                searchRef.current?.focus();
              }}
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-ink hover:bg-surface-2"
            >
              <Search className="size-5" />
            </button>
            <input
              ref={searchRef}
              type="search"
              value={query}
              tabIndex={searchOpen ? 0 : -1}
              onChange={(event) => onSearch(event.target.value)}
              onFocus={() => setSearching(true)}
              onBlur={() => setSearching(false)}
              placeholder={t('Canais, filmes, séries…')}
              aria-label={t('Buscar canais, filmes e séries')}
              className="h-full min-w-0 flex-1 bg-transparent pr-4 text-sm placeholder:text-muted/80 focus:outline-none"
            />
          </form>

          {/* Celular: atalho para o histórico ao lado da busca, como os ícones do topo dos apps de streaming. */}
          {!detail && !searchOpen && (
            <Link
              href="/history"
              aria-label={t('Histórico')}
              title={t('Histórico')}
              aria-current={isActive(pathname, '/history') ? 'page' : undefined}
              className={cx('flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-surface-2 md:hidden', isActive(pathname, '/history') && 'text-accent')}
            >
              <History className="size-5" />
            </Link>
          )}

          <div
            ref={menuRef}
            className="relative hidden md:block"
            onKeyDown={(event) => {
              if (menu && event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                closeMenu();
              }
            }}
            onBlur={(event) => {
              // O foco saiu do menu (setas, Tab): fecha, como nos aplicativos de TV.
              const next = event.relatedTarget as Node | null;
              if (menu && next && !event.currentTarget.contains(next)) setMenu(false);
            }}
          >
            <button
              ref={menuButtonRef}
              type="button"
              aria-label={t('Menu')}
              title={t('Menu')}
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
              className={cx('flex size-10 items-center justify-center rounded-full hover:bg-surface-2', SECONDARY.some((n) => isActive(pathname, n.href)) && 'text-accent')}
            >
              <Menu className="size-5" />
            </button>
            {menu && (
              <div role="menu" onClick={() => setMenu(false)} className="tui-fade absolute right-0 mt-2 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-2xl shadow-black/60">
                {secondaryLinks}
                {extras}
                <p className="mt-1 border-t border-line px-3 pt-2 pb-1 text-[11px] text-muted">{t('100% local · sem conta · sem login')}</p>
              </div>
            )}
          </div>
      </div>

      {withChips && (
        <nav
          aria-label={t('Explorar')}
          className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-3 md:hidden"
        >
          {/* As três pílulas ficam sempre à vista; a da seção atual fica preenchida e tocá-la de novo volta ao Início. */}
          {CHIPS.map((href) => {
            const item = PRIMARY.find((n) => n.href === href)!;
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={active ? '/' : href}
                aria-current={active ? 'page' : undefined}
                className={cx('flex h-9 shrink-0 items-center rounded-full border px-4 text-sm font-semibold', active ? 'border-white bg-white text-[#070c16]' : 'border-white/30 bg-white/5 text-ink')}
              >
                {t(item.label)}
              </Link>
            );
          })}
        </nav>
      )}
      </header>

      <main className={cx('tui-fade min-h-dvh px-4 pt-20 pb-24 md:pb-10 lg:px-12', withChips && 'max-md:pt-32')} key={pathname}>
        <div className="mb-4 space-y-2 empty:hidden">
          {!online && (
            <Notice tone="warning">
              {t('Você está sem internet. Listas, favoritos, histórico e configurações continuam disponíveis; a reprodução de transmissões e as atualizações dependem de conexão.')}
            </Notice>
          )}
          {dataLost && (
            <Notice tone="warning">
              {t('Os dados locais do TuiTV neste navegador parecem ter sido apagados. Se você tem um arquivo de backup, restaure-o em Configurações.')}
            </Notice>
          )}
          {nearLimit && (
            <Notice tone="warning">
              {t('O armazenamento do navegador está quase cheio. Faça um backup e remova listas ou guias que não usa em Configurações.')}
            </Notice>
          )}
        </div>
        {ready ? children : null}
      </main>

      {/* Menu móvel */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line/60 bg-bg-deep/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label={t('Menu principal')}>
        {PRIMARY.filter((n) => BOTTOM.includes(n.href)).map(({ href, label, icon: Icon }) => {
          // Filmes e Séries abrem pelas pílulas do Início: o Início continua aceso.
          const active = isActive(pathname, href) || (href === '/' && (isActive(pathname, '/movies') || isActive(pathname, '/series')));
          return (
            <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={cx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', active ? 'text-ink' : 'text-muted')}>
              <Icon className="size-5" />
              <span className="max-w-full truncate px-1">{t(label)}</span>
            </Link>
          );
        })}
        <button type="button" onClick={() => setMenu(true)} aria-expanded={menu} className={cx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', !detail && SECONDARY.some((n) => isActive(pathname, n.href)) ? 'text-ink' : 'text-muted')}>
          <Menu className="size-5" />
          <span>{t('Mais')}</span>
        </button>
      </nav>
      {menu && (
        <div data-menu-sheet className="fixed inset-0 z-50 flex items-end bg-black/70 md:hidden" onClick={() => setMenu(false)}>
          <div role="menu" className="w-full rounded-t-2xl border-t border-line bg-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]" onClick={(event) => event.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between px-2">
              <Logo className="text-lg" />
              <IconButton label={t('Fechar')} onClick={() => setMenu(false)}>
                <X className="size-5" />
              </IconButton>
            </div>
            {secondaryLinks}
            {extras}
          </div>
        </div>
      )}

      {pin && <PinDialog onClose={() => setPin(false)} />}
      <Jobs />
      <Toasts />
    </>
  );
}

/** Tela de abertura (PRD RF-001). */
function Splash() {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-bg" role="status" aria-label="TuiTV">
      <CatMark className="h-28 w-auto animate-pulse" />
      <p className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">Seu entretenimento em um só lugar.</p>
    </div>
  );
}

/** Progresso das importações em andamento. */
function Jobs() {
  const t = useT();
  const jobs = useStore((s) => s.jobs);
  const dismiss = useStore((s) => s.dismissJob);
  const running = jobs.filter((j) => j.status === 'running');
  useEffect(() => {
    const finished = jobs.filter((j) => j.status !== 'running');
    if (!finished.length) return;
    const timer = setTimeout(() => finished.forEach((j) => dismiss(j.id)), 15_000);
    return () => clearTimeout(timer);
  }, [jobs, dismiss]);
  if (!running.length) return null;
  return (
    <div className="fixed right-4 bottom-20 z-40 w-72 space-y-2 md:bottom-4" aria-live="polite">
      {running.map((job) => (
        <div key={job.id} className="rounded-xl border border-line bg-surface p-3 shadow-xl">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Spinner className="size-4 text-accent" />
            <span className="truncate">{job.kind === 'epg' ? t('Importando guia…') : t('Importando lista…')}</span>
          </div>
          <p className="mt-1 truncate text-xs text-muted">
            {job.name} · {t('{n} itens', { n: job.count.toLocaleString() })}
          </p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-bg">
            <div className={cx('h-full bg-accent transition-all', !job.total && 'w-1/3 animate-pulse')} style={job.total ? { width: `${Math.min(100, (job.loaded / job.total) * 100)}%` } : undefined} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Toasts() {
  const t = useT();
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  if (!toasts.length) return null;
  return (
    // data-nav-skip: na TV os avisos somem sozinhos e não "roubam" o foco da navegação pelo controle.
    <div className="pointer-events-none fixed inset-x-0 top-16 z-[70] flex flex-col items-center gap-2 px-4" aria-live="polite" data-nav-skip="">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cx(
            'tui-fade pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border bg-surface px-4 py-3 text-sm shadow-xl',
            toast.tone === 'error' ? 'border-danger/50' : toast.tone === 'success' ? 'border-success/50' : 'border-line',
          )}
        >
          <span>{toast.text}</span>
          <button type="button" onClick={() => dismiss(toast.id)} aria-label={t('Fechar')} className="text-muted hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

export { importErrorText };

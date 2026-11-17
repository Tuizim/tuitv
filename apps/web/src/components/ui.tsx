'use client';

import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { useT } from '@/lib/i18n';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110',
  secondary: 'bg-surface-2 text-ink hover:brightness-110 border border-line',
  ghost: 'text-ink hover:bg-surface-2',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25 border border-danger/30',
};

export function Button({
  variant = 'secondary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
    />
  );
}

export function IconButton({
  label,
  className,
  active,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={cx(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-lg transition hover:bg-surface-2 disabled:opacity-40',
        active ? 'text-accent' : 'text-muted hover:text-ink',
        className,
      )}
    />
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusable = node?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button:not([data-close])');
    (focusable ?? node)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          'flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-2xl outline-none sm:rounded-2xl',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
          <h2 id={titleId} className="text-base font-bold">
            {title}
          </h2>
          <IconButton label={t('Fechar')} onClick={onClose} data-close>
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

const fieldClass =
  'w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none';

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(fieldClass, props.className)} />;
}

export interface Option<T extends string | number> {
  value: T;
  label: string;
  /** Texto secundário à direita (contagem, por exemplo). */
  hint?: string;
}

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Seletor do TuiTV: substitui a caixa de seleção nativa do navegador.
 * Com muitas opções (categorias de listas extensas), inclui um campo de filtro.
 */
export function Dropdown<T extends string | number>({
  value,
  onChange,
  options,
  label,
  className,
  align = 'left',
}: {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  /** Nome acessível do seletor. */
  label: string;
  className?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value);
  const searchable = options.length > 10;

  const visible = useMemo(() => {
    const q = normalize(filter.trim());
    const list = q ? options.filter((option) => normalize(option.label).includes(q)) : options;
    return list.slice(0, 300);
  }, [options, filter]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    const selected = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    selected?.scrollIntoView({ block: 'nearest' });
    if (!searchable) (selected ?? listRef.current?.querySelector<HTMLElement>('[role="option"]'))?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, searchable]);

  const close = (focusButton = true) => {
    setOpen(false);
    setFilter('');
    if (focusButton) rootRef.current?.querySelector<HTMLElement>('button')?.focus();
  };

  const move = (delta: number) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[Math.min(items.length - 1, Math.max(0, index + delta))]?.focus();
  };

  return (
    <div
      ref={rootRef}
      className={cx('relative', className)}
      onKeyDown={(event) => {
        if (!open) return;
        if (event.key === 'Escape') {
          event.stopPropagation();
          close();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          move(1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => (open ? close(false) : setOpen(true))}
        className={cx(
          'flex h-10 w-full items-center justify-between gap-2 rounded-lg border bg-surface px-3.5 text-sm font-medium transition hover:border-accent/60',
          open ? 'border-accent' : 'border-line',
        )}
      >
        <span className="truncate">{current?.label ?? label}</span>
        <ChevronDown className={cx('size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          className={cx(
            'tui-fade absolute z-40 mt-2 w-max max-w-[min(88vw,22rem)] min-w-full overflow-hidden rounded-xl border border-line bg-surface shadow-2xl shadow-black/60',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {searchable && (
            <div className="relative border-b border-line">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <input
                autoFocus
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                aria-label={label}
                className="h-10 w-full bg-transparent pr-3 pl-9 text-sm placeholder:text-muted/70 focus:outline-none"
                placeholder="…"
              />
            </div>
          )}
          <div ref={listRef} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto p-1">
            {visible.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(option.value);
                    close();
                  }}
                  className={cx(
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm -outline-offset-2 hover:bg-surface-2 focus:bg-surface-2',
                    selected ? 'font-semibold text-accent' : 'text-ink',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.hint && <span className="shrink-0 text-xs text-muted tabular-nums">{option.hint}</span>}
                  {selected && <Check className="size-4 shrink-0" />}
                </button>
              );
            })}
            {visible.length === 0 && <p className="px-3 py-3 text-sm text-muted">—</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-accent' : 'bg-line')}
    >
      <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}

export function Chip({ active, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      {...props}
      className={cx(
        'shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium whitespace-nowrap transition',
        active ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface text-muted hover:text-ink',
        props.className,
      )}
    >
      {children}
    </button>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <h2 className="text-lg font-bold">{title}</h2>
      {children && <div className="space-y-4 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('inline-block size-5 animate-spin rounded-full border-2 border-current border-r-transparent', className)} role="status" />;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'danger'; children: ReactNode }) {
  const tones = {
    info: 'border-accent/30 bg-accent/10',
    warning: 'border-warning/40 bg-warning/10',
    danger: 'border-danger/40 bg-danger/10',
  };
  return <div className={cx('rounded-lg border px-3 py-2 text-sm', tones[tone])}>{children}</div>;
}

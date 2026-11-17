import { cx } from './ui';

export function PlayMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true">
      <circle cx="256" cy="256" r="256" fill="#38BDF8" />
      <path d="M212 168c0-12 13-19 23-13l132 88c9 6 9 20 0 26l-132 88c-10 6-23-1-23-13z" fill="#101827" />
    </svg>
  );
}

export function Logo({ className, mark = true }: { className?: string; mark?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-2 font-extrabold tracking-tight', className)} aria-label="TuiTV">
      {mark && <PlayMark className="size-[1.1em]" />}
      <span>
        Tui<span className="text-accent">TV</span>
      </span>
    </span>
  );
}

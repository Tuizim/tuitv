import { brandIcon, brandLogo } from '@tuitv/design-system';
import { cx } from './ui';

/** Gato do TuiTV (ícone), para telas de carregamento e marcas pequenas. */
export function CatMark({ className }: { className?: string }) {
  return <img src={brandIcon} alt="" aria-hidden="true" draggable={false} className={cx('select-none', className)} />;
}

/** Logotipo com o nome (gato + "TuiTV"). A altura acompanha o tamanho de fonte (`text-2xl`, `text-5xl`...). */
export function Logo({ className }: { className?: string }) {
  return <img src={brandLogo} alt="TuiTV" draggable={false} className={cx('inline-block h-[1.6em] w-auto max-w-none select-none', className)} />;
}

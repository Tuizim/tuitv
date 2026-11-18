import { brandIcon, brandLogo } from '@/lib/brand';
import { cx } from './ui';

/** Gato do TuiTV (ícone), para telas de carregamento e marcas pequenas. */
export function CatMark({ className }: { className?: string }) {
  return <img src={brandIcon} alt="" aria-hidden="true" draggable={false} data-brand="icon" className={cx('select-none', className)} />;
}

/**
 * Logotipo (img/tuitv-logo.png). A altura acompanha o tamanho de fonte (`text-2xl`, `text-5xl`...).
 * Sem texto alternativo visível: o nome fica no aria-label de quem o envolve (link do cabeçalho) ou no título da tela.
 */
export function Logo({ className }: { className?: string }) {
  return <img src={brandLogo} alt="" aria-hidden="true" draggable={false} data-brand="logo" className={cx('inline-block h-[1.6em] w-auto max-w-none select-none', className)} />;
}

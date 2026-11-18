/**
 * Imagens sob demanda no aplicativo de TV, como nas plataformas de streaming: a capa só é baixada
 * e decodificada quando chega perto da tela. O Chromium das TVs Samsung mais antigas (Tizen 5.5,
 * Chromium 69) ignora `loading="lazy"` e baixaria todas as capas da página de uma vez — o que
 * disputa a CPU com a navegação.
 *
 * A capa fica em `data-lazy-src`; um único IntersectionObserver troca para `src` perto da tela.
 * Nas fileiras (que deslizam dentro de uma janela recortada), o controle remoto pré-carrega as
 * próximas capas com [preloadImages].
 */
let observer: IntersectionObserver | null = null;

function load(img: HTMLImageElement) {
  const src = img.dataset.lazySrc;
  if (src && img.getAttribute('src') !== src) img.src = src;
}

function getObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        load(entry.target as HTMLImageElement);
        observer!.unobserve(entry.target);
      }
    },
    // Uma tela abaixo e acima: chega pronta quando o usuário desce.
    { rootMargin: '100% 0px' },
  );
  return observer;
}

/** `ref` da imagem: observa enquanto ela existir (limpeza automática no React 19). */
export function lazyImageRef(img: HTMLImageElement | null): (() => void) | undefined {
  if (!img) return;
  const io = getObserver();
  if (!io) {
    load(img);
    return;
  }
  io.observe(img);
  return () => io.unobserve(img);
}

/** Carrega já as capas pendentes dentro de [root] (ex.: os próximos cartões de uma fileira). */
export function preloadImages(root: ParentNode) {
  root.querySelectorAll<HTMLImageElement>('img[data-lazy-src]').forEach(load);
}

/**
 * `gap` em flex só existe a partir do Chromium 84 (Tizen 6.5+). Nas TVs mais antigas (Tizen 5.5/6.0):
 *  - <html class="no-flex-gap"> ativa a alternativa por margens gerada no build (css-compat.ts), que cobre
 *    o espaço ENTRE ELEMENTOS;
 *  - texto solto ao lado de um elemento (`<Icone /> {t('Importar')}`) não pode receber margem por CSS:
 *    este módulo aplica a margem no elemento vizinho do texto (ícone, ponto de "ao vivo" etc.).
 */
export function detectFlexGap(doc: Document = document): boolean {
  let forced = false;
  try {
    // Diagnóstico: localStorage "tuitv-no-flex-gap" = "1" simula uma TV antiga (usado nos testes).
    forced = localStorage.getItem('tuitv-no-flex-gap') === '1';
  } catch {
    /* armazenamento indisponível */
  }
  if (forced) {
    doc.documentElement.classList.add('no-flex-gap');
    return false;
  }
  const box = doc.createElement('div');
  box.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
  box.appendChild(doc.createElement('div'));
  box.appendChild(doc.createElement('div'));
  doc.body.appendChild(box);
  const supported = box.scrollHeight === 1;
  box.remove();
  if (!supported) doc.documentElement.classList.add('no-flex-gap');
  return supported;
}

const isText = (node: Node | null) => !!node && node.nodeType === Node.TEXT_NODE && !!node.nodeValue?.trim();

/** Nó vizinho ignorando textos só com espaços (que o flex descarta). */
function sibling(node: Node, dir: 'previousSibling' | 'nextSibling'): Node | null {
  let n = node[dir];
  while (n && n.nodeType === Node.TEXT_NODE && !n.nodeValue?.trim()) n = n[dir];
  return n;
}

/** Aplica a margem nos elementos encostados em texto, dentro de contêineres flex (em linha) com gap. */
export function fixTextGaps(root: ParentNode) {
  const containers = root instanceof Element && root.matches('[class*="gap-"]') ? [root, ...root.querySelectorAll('[class*="gap-"]')] : [...root.querySelectorAll('[class*="gap-"]')];
  for (const container of containers) {
    const style = getComputedStyle(container);
    if (!style.display.includes('flex') || style.flexDirection.startsWith('column')) continue;
    const gap = style.columnGap;
    if (!gap || gap === 'normal' || gap === '0px') continue;
    for (const child of container.children) {
      const el = child as HTMLElement | SVGElement;
      const textAfter = isText(sibling(el, 'nextSibling'));
      const textBefore = isText(sibling(el, 'previousSibling'));
      // margem à esquerda vinda do CSS (*+*) não se aplica quando o anterior é texto: completa aqui.
      if (textAfter && el.style.marginRight !== gap) el.style.marginRight = gap;
      if (textBefore && el.style.marginLeft !== gap) el.style.marginLeft = gap;
    }
  }
}

/** Mantém a correção enquanto a interface muda (uma passada por quadro, só nos trechos alterados). */
export function installFlexGapFallback(doc: Document = document) {
  if (detectFlexGap(doc)) return;
  const pending = new Set<ParentNode>();
  let scheduled = false;
  const run = () => {
    scheduled = false;
    const roots = [...pending];
    pending.clear();
    for (const root of roots) if (!(root instanceof Node) || root.isConnected) fixTextGaps(root);
  };
  new MutationObserver((records) => {
    for (const r of records) {
      const target = r.target.nodeType === Node.TEXT_NODE ? r.target.parentElement?.parentElement : (r.target as Element).parentElement ?? r.target;
      if (target) pending.add(target as ParentNode);
    }
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(run);
    }
  }).observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  // Mudança de tamanho pode trocar o gap (classes sm:, lg:).
  window.addEventListener('resize', () => {
    pending.add(doc.body);
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(run);
    }
  });
}

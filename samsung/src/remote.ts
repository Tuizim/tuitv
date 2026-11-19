/**
 * Controle remoto das Smart TVs Samsung (Tizen).
 *
 *  - Navegação espacial: as setas movem o foco para o elemento mais próximo naquela direção
 *    (a interface Web foi feita para mouse, toque e Tab; a TV só tem setas e OK).
 *  - Teclas de mídia e de canal do controle são traduzidas para as teclas que o player Web já trata.
 *  - Voltar, como na Netflix: fecha o que estiver aberto (seletor, menu, player em tela cheia, diálogo)
 *    → volta ao topo da tela se ela estiver rolada → volta uma tela → na tela inicial, fecha o aplicativo.
 */
import { runBack } from '@/lib/back';
import { installScreenMemory, isRestoringScreen } from '@/lib/screens';
import { preloadImages } from '@/lib/lazyImages';
import { getLocation, subscribe, takeAnchor } from './router';

interface TizenApi {
  tvinputdevice?: { registerKeyBatch(keys: string[]): void; registerKey(key: string): void };
  application?: { getCurrentApplication(): { exit(): void } };
}

declare global {
  interface Window {
    tizen?: TizenApi;
  }
}

/** Códigos de tecla do controle Samsung (Tizen TV). */
export const TizenKey = {
  BACK: 10009,
  EXIT: 10182,
  PLAY_PAUSE: 10252,
  PLAY: 415,
  PAUSE: 19,
  STOP: 413,
  FAST_FORWARD: 417,
  REWIND: 412,
  CHANNEL_UP: 427,
  CHANNEL_DOWN: 428,
} as const;

/** Teclas que precisam ser registradas para chegar ao aplicativo (as setas, OK e Voltar já chegam). */
const REGISTERED = [
  'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
  'ChannelUp', 'ChannelDown', 'Info',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
];

/** Tecla do controle → tecla que a interface Web já entende (Player.tsx). */
const TRANSLATE: Record<number, string> = {
  [TizenKey.PLAY_PAUSE]: 'k',
  [TizenKey.PLAY]: 'k',
  [TizenKey.PAUSE]: 'k',
  [TizenKey.FAST_FORWARD]: 'ArrowRight',
  [TizenKey.REWIND]: 'ArrowLeft',
  [TizenKey.CHANNEL_UP]: 'ChannelUp',
  [TizenKey.CHANNEL_DOWN]: 'ChannelDown',
};

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

type Direction = 'up' | 'down' | 'left' | 'right';
const ARROWS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

function isVisible(el: HTMLElement): boolean {
  // Também ignora o que está transparente (setas das fileiras, controles do player escondidos).
  if (el.closest('[inert], [aria-hidden="true"], .opacity-0, .invisible')) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

/** Menu suspenso aberto e visível (o do cabeçalho), se houver. */
function openMenu(): HTMLElement | null {
  const menus = document.querySelectorAll<HTMLElement>('[role="menu"]');
  for (let i = menus.length - 1; i >= 0; i--) {
    const rect = menus[i]!.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return menus[i]!;
  }
  return null;
}

/** Região ativa: o diálogo aberto por último, senão o menu aberto, senão a página inteira. */
function scope(): ParentNode {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"]');
  if (dialogs.length) return dialogs[dialogs.length - 1]!;
  return openMenu() ?? document;
}

/** Elementos que o controle pode focar (tabindex="-1" fica de fora, ex.: o logotipo). */
function reachable(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.tabIndex >= 0 && !el.closest('[data-nav-skip]'));
}

export function focusables(root: ParentNode = scope()): HTMLElement[] {
  return reachable(root).filter(isVisible);
}

/** Distância entre intervalos [a1,a2] e [b1,b2] (0 se sobrepostos). */
const gap = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, b1 - a2, a1 - b2);

/** Elemento mais próximo na direção pedida (heurística de navegação espacial). */
export function nearest(from: DOMRect, candidates: HTMLElement[], dir: Direction, visible: (el: HTMLElement) => boolean = () => true): HTMLElement | null {
  // Pontua só pela geometria (barato) e confere a visibilidade (cara: estilo computado) apenas
  // dos melhores colocados — com centenas de cartões na tela, cada tecla fica bem mais leve.
  const scored: { el: HTMLElement; score: number }[] = [];
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const ex = r.left + r.width / 2;
    const ey = r.top + r.height / 2;
    let primary: number;
    let cross: number;
    switch (dir) {
      case 'right':
        if (ex <= cx + 1 || r.right <= from.right) continue;
        primary = Math.max(0, r.left - from.right);
        cross = gap(from.top, from.bottom, r.top, r.bottom);
        break;
      case 'left':
        if (ex >= cx - 1 || r.left >= from.left) continue;
        primary = Math.max(0, from.left - r.right);
        cross = gap(from.top, from.bottom, r.top, r.bottom);
        break;
      case 'down':
        if (ey <= cy + 1 || r.bottom <= from.bottom) continue;
        primary = Math.max(0, r.top - from.bottom);
        cross = gap(from.left, from.right, r.left, r.right);
        break;
      default:
        if (ey >= cy - 1 || r.top >= from.top) continue;
        primary = Math.max(0, from.top - r.bottom);
        cross = gap(from.left, from.right, r.left, r.right);
    }
    // Prioriza o que está alinhado (mesma linha/coluna); entre alinhados, o mais perto.
    // Saindo de um elemento bem maior (ex.: campo de largura total para uma linha com duas colunas),
    // alinha pela borda inicial: o foco vai para a primeira coluna, na ordem de leitura.
    const horizontal = dir === 'left' || dir === 'right';
    const align = horizontal
      ? from.height > r.height * 1.5 ? Math.abs(r.top - from.top) : Math.abs(ey - cy)
      : from.width > r.width * 1.5 ? Math.abs(r.left - from.left) : Math.abs(ex - cx);
    scored.push({ el, score: primary + cross * 4 + align * 0.1 });
  }
  scored.sort((a, b) => a.score - b.score);
  for (const { el } of scored) if (visible(el)) return el;
  return null;
}

/* ── Fileiras e rolagem no estilo Netflix ───────────────────────────────── */

/** Fileira horizontal (carrossel de cartões) que contém o elemento. */
export function rowOf(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>('[data-nav-row], .no-scrollbar');
}

/** Último elemento focado em cada fileira: voltar a ela com ▲▼ devolve o foco ao mesmo cartão. */
const lastInRow = new WeakMap<HTMLElement, HTMLElement>();

function remember(el: HTMLElement) {
  const row = rowOf(el);
  if (row) lastInRow.set(row, el);
}

/** Ao entrar numa fileira vinda de outra parte da tela (▲▼), prefere o cartão lembrado. */
export function preferRemembered(active: HTMLElement, next: HTMLElement, dir: Direction): HTMLElement {
  if (dir !== 'up' && dir !== 'down') return next;
  const row = rowOf(next);
  if (!row || row === rowOf(active)) return next;
  const remembered = lastInRow.get(row);
  return remembered && remembered !== next && row.contains(remembered) && document.contains(remembered) ? remembered : next;
}

/**
 * Contêiner com rolagem vertical própria (diálogo, menu, lista lateral), se houver.
 * Guardado em cache por elemento: evita percorrer os ancestrais com getComputedStyle a cada tecla.
 */
const scrollParents = new WeakMap<HTMLElement, HTMLElement | null>();
function scrollParent(el: HTMLElement): HTMLElement | null {
  const cached = scrollParents.get(el);
  if (cached !== undefined && (cached === null || document.contains(cached))) return cached;
  let found: HTMLElement | null = null;
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
      found = node;
      break;
    }
  }
  scrollParents.set(el, found);
  return found;
}

/** Cartões à frente do foco cujas capas já são pedidas (chegam prontas ao deslizar a fileira). */
const PRELOAD_AHEAD = 8;

/** Filho direto da trilha (o "slot" do cartão) que contém o elemento. */
function slotIn(el: HTMLElement | null, track: HTMLElement): HTMLElement | null {
  let slot: HTMLElement | null = el;
  while (slot && slot.parentElement !== track) slot = slot.parentElement;
  return slot;
}

function preloadAhead(track: HTMLElement, el: HTMLElement) {
  let slot: Element | null = slotIn(el, track);
  for (let i = 0; slot && i <= PRELOAD_AHEAD; i++, slot = slot.nextElementSibling) preloadImages(slot);
}

/** Distância horizontal do elemento até o início da trilha (layout, sem transform). */
function offsetIn(el: HTMLElement, track: HTMLElement): number {
  let x = 0;
  for (let node: HTMLElement | null = el; node && node !== track; node = node.offsetParent as HTMLElement | null) {
    x += node.offsetLeft;
    if (node.offsetParent === track) return x;
  }
  return x;
}

/** Recuo interno de cada fileira (não muda durante o uso). */
const rowPadding = new WeakMap<HTMLElement, number>();
function paddingOf(row: HTMLElement): number {
  let pad = rowPadding.get(row);
  if (pad === undefined) {
    pad = parseFloat(window.getComputedStyle(row).paddingLeft) || 0;
    rowPadding.set(row, pad);
  }
  return pad;
}

/** Faixa da tela em que o foco pode andar sem rolar a página (abaixo do cabeçalho fixo). */
const TOP_SAFE = 96;
const BOTTOM_SAFE = 0.78;
/** Ao sair da faixa, o elemento é levado a ~30% da altura: sobra espaço para ver o que vem depois. */
const PIVOT = 0.3;

/**
 * Move o foco e rola até ele. Desempenho: primeiro todas as leituras de layout (já calculado nesta
 * tecla, ao escolher o destino), depois as escritas (foco e rolagem). Ler medidas depois de mudar
 * o foco obrigaria o navegador a recalcular estilo e layout no meio da tecla — o "engasgo".
 */
function focus(el: HTMLElement, smooth = true) {
  // Tecla segurada: rolagem instantânea, para a tela acompanhar o foco sem acumular animações.
  const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto';

  // 1. Leituras.
  const row = rowOf(el);
  const rect = el.getBoundingClientRect();
  let rowLeft: number | null = null;
  // Fileira de TV (carrossel): a trilha desliza com transform; posição pelo layout, não pela tela,
  // para que passos rápidos no meio de uma animação calculem o destino certo.
  const track = row?.hasAttribute('data-tv-carousel') ? (row.firstElementChild as HTMLElement | null) : null;
  let trackX: number | null = null;
  if (row && track) {
    const visible = row.clientWidth - paddingOf(row) * 2;
    const max = Math.max(0, track.scrollWidth - visible);
    // O cartão em foco atual tem um espaço extra à direita (styles.css); ele some quando o foco
    // muda, então é descontado se esse cartão estiver antes do novo.
    let shift = 0;
    const current = slotIn(document.activeElement as HTMLElement | null, track);
    const next = slotIn(el, track);
    if (current && next && current !== next && current.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING) {
      shift = parseFloat(window.getComputedStyle(current).marginRight) || 0;
    }
    trackX = Math.min(max, Math.max(0, offsetIn(el, track) - shift));
  } else if (row) {
    // Cartão em foco sempre no início da fileira: a fileira desliza por baixo dele.
    const delta = rect.left - row.getBoundingClientRect().left - paddingOf(row);
    if (Math.abs(delta) > 1) rowLeft = Math.max(0, row.scrollLeft + delta);
  }
  const parent = scrollParent(row ?? el);
  let pageTop: number | null = null;
  // Itens do menu suspenso ficam no cabeçalho fixo: andar por eles não rola a página.
  if (!parent && !el.closest('[role="menu"]')) {
    const height = window.innerHeight;
    if (rect.top < TOP_SAFE || rect.bottom > height * BOTTOM_SAFE) {
      const target = rect.height > height * 0.6 ? TOP_SAFE : Math.max(TOP_SAFE, height * PIVOT);
      pageTop = Math.max(0, window.scrollY + rect.top - target);
    }
  }

  // 2. Escritas.
  el.focus({ preventScroll: true });
  remember(el);
  if (track && trackX !== null) {
    if (track.dataset.x !== String(trackX)) {
      track.dataset.x = String(trackX);
      track.style.transform = `translate3d(${-trackX}px, 0, 0)`;
    }
    preloadAhead(track, el);
  } else if (row && rowLeft !== null) row.scrollTo({ left: rowLeft, behavior });
  if (parent) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  else if (pageTop !== null) window.scrollTo({ top: pageTop, behavior });
}

/** Em campos de texto, ← → movem o cursor até a borda do texto; só então o foco sai do campo. */
function caretAllowsLeaving(el: Element, dir: Direction): boolean {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return true;
  if (el instanceof HTMLInputElement && !['text', 'search', 'url', 'email', 'password', 'tel', 'number'].includes(el.type)) return true;
  if (dir === 'up' || dir === 'down') return !(el instanceof HTMLTextAreaElement);
  try {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    return dir === 'left' ? start === 0 && end === 0 : start === el.value.length;
  } catch {
    return true; // tipos sem seleção (number) deixam sair
  }
}

/** Foca o primeiro elemento útil da tela atual (player, conteúdo principal ou qualquer focável). */
export function focusFirst() {
  const player = document.querySelector<HTMLElement>('[data-testid="player"]');
  if (player && player.tabIndex >= 0 && isVisible(player)) {
    player.focus({ preventScroll: true });
    return;
  }
  const main = document.querySelector('main');
  const target = (main && focusables(main)[0]) || focusables()[0];
  if (target) focus(target);
}

function activeIsLost(): boolean {
  const active = document.activeElement as HTMLElement | null;
  return !active || active === document.body || !document.contains(active) || !isVisible(active);
}

/** Tecla segurada: no máximo um passo a cada [REPEAT_MS], para a tela acompanhar sem fila de passos. */
const REPEAT_MS = 90;
let lastMove = 0;

function onArrow(event: KeyboardEvent) {
  const dir = ARROWS[event.key];
  if (!dir || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const now = Date.now();
  if (event.repeat && now - lastMove < REPEAT_MS) {
    event.preventDefault();
    return;
  }
  lastMove = now;
  const active = document.activeElement as HTMLElement | null;
  if (activeIsLost()) {
    event.preventDefault();
    focusFirst();
    return;
  }
  if (!caretAllowsLeaving(active!, dir)) return;
  event.preventDefault();
  // Carrossel: ◀▶ andam só dentro da fileira; no fim dela o foco fica onde está.
  const row = rowOf(active!);
  const carousel = row?.closest('[class~="group/row"], [data-nav-row]') ? row : null;
  const horizontal = dir === 'left' || dir === 'right';
  const region = scope();
  const pool = carousel && horizontal ? reachable(carousel) : reachable(region);
  // Com o menu aberto as setas ficam nos itens dele (Voltar fecha), como nos aplicativos de TV.
  const menu = region instanceof HTMLElement && region.getAttribute('role') === 'menu' ? region : null;
  if (menu && !menu.contains(active)) {
    // Foco ainda no botão que abriu o menu: qualquer seta entra no primeiro item.
    const first = focusables(menu)[0];
    if (first) focus(first, false);
    return;
  }
  // Do cabeçalho para baixo: vai direto ao alvo principal da tela, se ela indicar um (ex.: canal atual).
  if (dir === 'down' && !menu && active!.closest('header')) {
    // Sem indicação, o primeiro cartão da tela (ou o lembrado na fileira dele), não links laterais.
    const marked = document.querySelector<HTMLElement>('main [data-nav-default]');
    const card = document.querySelector<HTMLElement>('main a.group');
    const target = marked ?? (card && rowOf(card) ? (lastInRow.get(rowOf(card)!) ?? card) : card);
    if (target && isVisible(target) && target.getBoundingClientRect().top < window.innerHeight) {
      focus(target, !event.repeat);
      return;
    }
  }
  // ◀▶ não saltam para o menu do topo a partir da tela (só ▲ leva até ele).
  const fromHeader = !!active!.closest('header');
  // Dentro do menu, só ▲▼ entre os itens; no fim da lista o foco fica onde está.
  if (menu && horizontal) return;
  const candidates = pool.filter(
    (el) => el !== active && !el.contains(active) && !active!.contains(el) && (!horizontal || fromHeader || !el.closest('header')),
  );
  const found = nearest(active!.getBoundingClientRect(), candidates, dir, isVisible);
  if (found) focus(preferRemembered(active!, found, dir), !event.repeat);
}

function exitApp() {
  try {
    window.tizen?.application?.getCurrentApplication().exit();
  } catch {
    /* fora da TV */
  }
}

/** Botão Voltar do controle. */
export function goBack() {
  // 1. O que estiver aberto por cima (seletor, menu, player em tela cheia).
  if (runBack()) return;
  const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
  if (dialogs.length) {
    // Os diálogos da interface Web fecham com Escape.
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return;
  }
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
    return;
  }
  // 2. Tela rolada para baixo: volta ao topo e ao primeiro item, antes de sair dela.
  if (window.scrollY > 120 && !document.querySelector('[data-testid="tv-watch"]')) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const main = document.querySelector('main');
    const first = main && focusables(main)[0];
    if (first) {
      first.focus({ preventScroll: true });
      remember(first);
    }
    return;
  }
  if (getLocation().pathname !== '/') {
    window.history.back();
    return;
  }
  exitApp();
}

function isBack(event: KeyboardEvent) {
  return event.keyCode === TizenKey.BACK || event.key === 'XF86Back' || event.key === 'GoBack' || event.key === 'BrowserBack';
}

function onKey(event: KeyboardEvent) {
  if (isBack(event)) {
    event.preventDefault();
    event.stopPropagation();
    goBack();
    return;
  }
  if (event.keyCode === TizenKey.EXIT) {
    exitApp();
    return;
  }
  if (event.keyCode === TizenKey.STOP) {
    event.preventDefault();
    goBack();
    return;
  }
  const mapped = TRANSLATE[event.keyCode];
  if (mapped && event.key !== mapped && event.isTrusted) {
    // Reenvia como a tecla que a interface já trata (ex.: Play/Pause → "k" no player).
    event.preventDefault();
    event.stopPropagation();
    const target = (document.activeElement as HTMLElement | null) ?? document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: mapped, bubbles: true, cancelable: true }));
  }
}

/** Ativa o controle remoto. Fora da TV (navegador comum) as setas também funcionam, útil para testes. */
export function installRemote() {
  try {
    window.tizen?.tvinputdevice?.registerKeyBatch(REGISTERED);
  } catch {
    for (const key of REGISTERED) {
      try {
        window.tizen?.tvinputdevice?.registerKey(key);
      } catch {
        /* tecla não suportada neste modelo */
      }
    }
  }
  // Foco vindo de qualquer lugar (clique, autoFocus) também é lembrado na fileira.
  window.addEventListener('focusin', (event) => {
    if (event.target instanceof HTMLElement) remember(event.target);
  });
  // Captura: Voltar e teclas de mídia são tratados antes da interface.
  window.addEventListener('keydown', onKey, true);
  // Bolha: a interface (player, listas, menus) tem prioridade sobre a navegação espacial.
  window.addEventListener('keydown', onArrow);

  // Voltar para uma tela já visitada: ela reaparece como foi deixada (rolagem e cartão em foco);
  // o foco volta pelo mesmo caminho das setas, que também desliza o carrossel até o cartão.
  installScreenMemory((el) => focus(el, false));
  // A cada troca de tela: rola para a âncora pedida ou devolve o foco ao conteúdo.
  subscribe(() => {
    window.setTimeout(() => {
      // Volta com memória: a tela é restaurada por lib/screens.ts, não levada ao topo.
      if (isRestoringScreen()) return;
      const anchor = takeAnchor();
      const el = anchor ? document.getElementById(anchor) : null;
      if (el) {
        el.scrollIntoView({ block: 'start' });
        const first = focusables(el)[0];
        if (first) first.focus({ preventScroll: true });
      } else {
        window.scrollTo(0, 0);
        if (activeIsLost() || document.querySelector('[data-testid="player"]')) focusFirst();
      }
    }, 80);
  });
  // Primeira tela: espera a interface carregar os dados e foca o primeiro elemento.
  const start = window.setInterval(() => {
    if (!activeIsLost()) return window.clearInterval(start);
    if (focusables().length) {
      focusFirst();
      window.clearInterval(start);
    }
  }, 150);
  window.setTimeout(() => window.clearInterval(start), 10_000);
}

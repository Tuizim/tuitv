/**
 * Trabalho "nas pausas" (aplicativo de TV): tarefas de fundo, como montar as próximas fileiras,
 * só rodam quando o navegador está ocioso E o usuário não está apertando o controle — assim nunca
 * disputam a CPU com a navegação. Mesma ideia das plataformas de streaming.
 */
let lastKey = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', () => (lastKey = Date.now()), true);
}

/** Tempo sem teclas para considerar o controle "parado". */
const QUIET_MS = 350;

type Idle = (callback: () => void, options?: { timeout: number }) => number;

export function whenIdle(task: () => void): () => void {
  let cancelled = false;
  let handle: number | undefined;
  const ric = (typeof window !== 'undefined' && (window as unknown as { requestIdleCallback?: Idle }).requestIdleCallback) || null;
  const attempt = () => {
    if (cancelled) return;
    const wait = lastKey + QUIET_MS - Date.now();
    if (wait > 0) {
      handle = window.setTimeout(attempt, wait);
      return;
    }
    if (ric) handle = ric(() => !cancelled && (Date.now() - lastKey < QUIET_MS ? attempt() : task()), { timeout: 1000 });
    else handle = window.setTimeout(task, 50);
  };
  attempt();
  return () => {
    cancelled = true;
    if (handle !== undefined) {
      window.clearTimeout(handle);
      (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(handle);
    }
  };
}

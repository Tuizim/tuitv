import { maskUrl, validateRemoteUrl, type UrlProblem } from '@tuitv/validation';

export type ImportErrorCode =
  | 'url-empty'
  | 'url-malformed'
  | 'url-scheme'
  | 'url-private'
  | 'login-missing'
  | 'login-invalid'
  | 'account-inactive'
  | 'offline'
  | 'mixed-content'
  | 'network-or-cors'
  | 'timeout'
  | 'http'
  | 'too-large'
  | 'not-m3u'
  | 'hls-manifest'
  | 'empty'
  | 'not-xmltv'
  | 'storage'
  | 'cancelled';

export class ImportError extends Error {
  constructor(
    public readonly code: ImportErrorCode,
    public readonly detail?: string,
  ) {
    super(code);
  }
}

const URL_PROBLEMS: Record<UrlProblem, ImportErrorCode> = {
  empty: 'url-empty',
  malformed: 'url-malformed',
  scheme: 'url-scheme',
  'private-host': 'url-private',
  'embedded-credentials': 'url-malformed',
};

export function checkedUrl(input: string, allowPrivate: boolean): string {
  const check = validateRemoteUrl(input, { allowPrivate });
  if (!check.ok) throw new ImportError(URL_PROBLEMS[check.problem!]);
  return check.url!;
}

export interface ByteSource {
  stream: ReadableStream<Uint8Array>;
  /** Tamanho total em bytes, quando conhecido. */
  total?: number;
}

/**
 * Baixa um endereço remoto diretamente do navegador (sem servidor intermediário).
 * Nunca envia cookies nem o endereço do aplicativo; o endereço completo não é registrado em logs.
 */
export async function fetchSource(url: string, timeoutSeconds: number, maxBytes: number, signal?: AbortSignal): Promise<ByteSource> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ImportError('offline');
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutSeconds * 1000);
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch {
    if (timedOut) throw new ImportError('timeout');
    if (signal?.aborted) throw new ImportError('cancelled');
    if (typeof location !== 'undefined' && location.protocol === 'https:' && url.startsWith('http:')) {
      throw new ImportError('mixed-content');
    }
    // O navegador não distingue falha de rede de bloqueio por CORS. Sem detalhes do endereço no console.
    console.warn('[TuiTV] falha ao baixar', maskUrl(url));
    throw new ImportError('network-or-cors');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok || !response.body) throw new ImportError('http', String(response.status));
  const length = Number(response.headers.get('content-length'));
  // Com content-encoding o tamanho anunciado é o comprimido; serve apenas como estimativa.
  const total = Number.isFinite(length) && length > 0 && !response.headers.get('content-encoding') ? length : undefined;
  if (total && total > maxBytes) {
    controller.abort();
    throw new ImportError('too-large');
  }
  return { stream: response.body, total };
}

export function fileSource(file: File, maxBytes: number): ByteSource {
  if (file.size > maxBytes) throw new ImportError('too-large');
  return { stream: file.stream() as ReadableStream<Uint8Array>, total: file.size };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/**
 * Lê a fonte como texto, em pedaços:
 *  - descomprime gzip quando o conteúdo começa com a assinatura 1F 8B;
 *  - detecta a codificação (UTF-8; se inválido, Windows-1252);
 *  - interrompe ao exceder `maxBytes`.
 */
export async function* readText(
  source: ByteSource,
  maxBytes: number,
  onBytes?: (loaded: number, total?: number) => void,
): AsyncGenerator<string> {
  let loaded = 0;
  let total = source.total;
  const counted = source.stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        loaded += chunk.byteLength;
        onBytes?.(loaded, total);
        controller.enqueue(chunk);
      },
    }),
  );
  let reader = counted.getReader();
  let first: Uint8Array = new Uint8Array(0);
  // Junta ao menos alguns bytes para as detecções.
  while (first.length < 4096) {
    const { done, value } = await reader.read();
    if (done) break;
    first = concat(first, value);
  }
  if (first.length >= 2 && first[0] === 0x1f && first[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
    reader.releaseLock();
    const head = first;
    first = new Uint8Array(0);
    let pushedHead = false;
    const rest = counted.getReader();
    const merged = new ReadableStream<Uint8Array<ArrayBuffer>>({
      async pull(controller) {
        if (!pushedHead) {
          pushedHead = true;
          controller.enqueue(new Uint8Array(head));
          return;
        }
        const { done, value } = await rest.read();
        if (done) controller.close();
        else controller.enqueue(new Uint8Array(value));
      },
      cancel: (reason) => rest.cancel(reason),
    });
    reader = merged.pipeThrough(new DecompressionStream('gzip')).getReader();
    total = undefined;
    while (first.length < 4096) {
      const { done, value } = await reader.read();
      if (done) break;
      first = concat(first, value);
    }
  }

  let encoding = 'utf-8';
  try {
    // Ignora os últimos bytes: um caractere multibyte pode estar cortado.
    new TextDecoder('utf-8', { fatal: true }).decode(first.subarray(0, Math.max(0, first.length - 4)));
  } catch {
    encoding = 'windows-1252';
  }
  const decoder = new TextDecoder(encoding);
  let produced = first.length;
  try {
    if (first.length) yield decoder.decode(first, { stream: true });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      produced += value.byteLength;
      if (produced > maxBytes || loaded > maxBytes) throw new ImportError('too-large');
      yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

export const uid = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** Cede o controle ao navegador para manter a interface responsiva durante importações longas. */
export const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

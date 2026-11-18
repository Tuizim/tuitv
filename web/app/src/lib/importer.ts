import { ItemBuilder, XmltvParser } from '@tuitv/business-rules';
import { M3uParser, epgUrlFromHeader, looksLikeM3u } from '@tuitv/m3u-parser';
import type { EpgChannel, MediaItem, PlaylistCounts, Programme } from '@tuitv/shared-models';
import { MAX_EPG_BYTES, MAX_PLAYLIST_BYTES } from '@tuitv/validation';
import * as store from './db';
import { ImportError, breathe, readText, type ByteSource } from './net';

export interface ImportProgress {
  loaded: number;
  total?: number;
  count: number;
}

export interface PlaylistImportResult {
  items: MediaItem[];
  counts: PlaylistCounts;
  skipped: number;
  epgUrl?: string;
}

const BATCH = 2000;

function isQuota(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

/**
 * Importa uma lista M3U/M3U8 de forma incremental: o conteúdo é lido, interpretado e
 * gravado em lotes, com progresso. Erros em registros individuais não interrompem a importação.
 * Os ids são determinísticos; gravar por cima de uma importação anterior não gera duplicados.
 */
export async function importPlaylistItems(
  playlistId: string,
  source: ByteSource,
  onProgress: (progress: ImportProgress) => void,
): Promise<PlaylistImportResult> {
  const parser = new M3uParser();
  const builder = new ItemBuilder(playlistId);
  const all: MediaItem[] = [];
  let pending: MediaItem[] = [];
  let loaded = 0;
  let total = source.total;
  let checked = false;
  let head = '';

  const flush = async () => {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    try {
      await store.putItems(batch);
    } catch (error) {
      throw isQuota(error) ? new ImportError('storage') : error;
    }
    onProgress({ loaded, total, count: all.length });
    await breathe();
  };

  const accept = (entries: ReturnType<M3uParser['push']>) => {
    for (const item of builder.add(entries)) {
      all.push(item);
      pending.push(item);
    }
  };

  for await (const text of readText(source, MAX_PLAYLIST_BYTES, (l, t) => {
    loaded = l;
    total = t;
  })) {
    if (!checked) {
      head += text;
      if (head.length < 2048) continue;
      if (!looksLikeM3u(head)) throw new ImportError('not-m3u');
      checked = true;
      accept(parser.push(head));
      head = '';
    } else {
      accept(parser.push(text));
    }
    if (pending.length >= BATCH) await flush();
    else onProgress({ loaded, total, count: all.length });
  }
  if (!checked) {
    if (!looksLikeM3u(head)) throw new ImportError('not-m3u');
    accept(parser.push(head));
  }
  accept(parser.end());
  if (all.length === 0) throw new ImportError(parser.isHlsManifest ? 'hls-manifest' : 'empty');
  await flush();
  onProgress({ loaded, total, count: all.length });
  return { items: all, counts: builder.counts, skipped: parser.errorCount, epgUrl: epgUrlFromHeader(parser.header) };
}

export interface EpgImportResult {
  channels: EpgChannel[];
  programmeCount: number;
}

/** Janela de programas mantida localmente: do início de ontem até três dias à frente. */
export const epgWindow = (now = Date.now()) => ({ from: now - 12 * 3_600_000, to: now + 72 * 3_600_000 });

export async function importEpg(
  sourceId: string,
  source: ByteSource,
  onProgress: (progress: ImportProgress) => void,
): Promise<EpgImportResult> {
  const parser = new XmltvParser(epgWindow());
  const channels: EpgChannel[] = [];
  let pendingChannels: EpgChannel[] = [];
  let pendingProgrammes: Programme[] = [];
  let loaded = 0;
  let total = source.total;
  let checked = false;
  let cleared = false;
  let head = '';

  const flush = async () => {
    if (!cleared) {
      // Só substitui o guia anterior depois de confirmar que o novo conteúdo é válido.
      await store.deleteEpgData(sourceId, true);
      cleared = true;
    }
    const c = pendingChannels;
    const p = pendingProgrammes;
    pendingChannels = [];
    pendingProgrammes = [];
    try {
      await store.putEpgBatch(c, p);
    } catch (error) {
      throw isQuota(error) ? new ImportError('storage') : error;
    }
    onProgress({ loaded, total, count: parser.programmeCount });
    await breathe();
  };

  const accept = (batch: ReturnType<XmltvParser['push']>) => {
    for (const channel of batch.channels) {
      const stored: EpgChannel = {
        id: `${sourceId}|${channel.id}`,
        sourceId,
        channelId: channel.id,
        displayNames: channel.displayNames.slice(0, 6),
      };
      if (channel.icon) stored.icon = channel.icon;
      channels.push(stored);
      pendingChannels.push(stored);
    }
    for (const programme of batch.programmes) pendingProgrammes.push({ sourceId, ...programme });
  };

  for await (const text of readText(source, MAX_EPG_BYTES, (l, t) => {
    loaded = l;
    total = t;
  })) {
    if (!checked) {
      head += text;
      if (head.length < 2048) continue;
      if (!XmltvParser.looksLikeXmltv(head)) throw new ImportError('not-xmltv');
      checked = true;
      accept(parser.push(head));
      head = '';
    } else {
      accept(parser.push(text));
    }
    if (pendingProgrammes.length >= BATCH) await flush();
  }
  if (!checked) {
    if (!XmltvParser.looksLikeXmltv(head)) throw new ImportError('not-xmltv');
    accept(parser.push(head));
  }
  accept(parser.end());
  if (channels.length === 0 && parser.programmeCount === 0) throw new ImportError('empty');
  await flush();
  return { channels, programmeCount: parser.programmeCount };
}

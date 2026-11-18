'use client';

import type Hls from 'hls.js';
import {
  AlertTriangle,
  AudioLines,
  Captions,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RectangleHorizontal,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { AspectMode, MediaItem } from '@tuitv/shared-models';
import { maskUrl } from '@tuitv/validation';
import { formatClock, useT } from '@/lib/i18n';
import { useStore } from '@/lib/store';
import { Button, Spinner, cx } from './ui';

type Engine = 'hls' | 'mpegts' | 'native';
type Phase = 'loading' | 'ready' | 'playing' | 'buffering' | 'reconnecting' | 'error';
type FailReason = 'network' | 'cors' | 'http' | 'format' | 'timeout' | 'protocol' | 'mixed' | 'offline';

interface Candidate {
  engine: Engine;
  url: string;
}

interface TrackOption {
  id: number;
  label: string;
}

const VOD_EXT = /\.(mp4|mkv|avi|mov|webm|m4v|wmv|flv|mpg|mpeg|ogv|3gp|mp3|aac|ogg|m4a)$/i;
const ASPECTS: AspectMode[] = ['contain', 'cover', 'fill'];
const ASPECT_CLASS: Record<AspectMode, string> = { contain: 'object-contain', cover: 'object-cover', fill: 'object-fill' };

type Probe = { kind: 'hls' | 'mpegts' | 'native' | 'unknown' | 'blocked' } | { kind: 'http'; status: number };

/**
 * Descobre o formato real de uma transmissão cujo endereço não o revela (comum em listas IPTV):
 * lê o tipo de conteúdo e os primeiros bytes e encerra a conexão.
 */
export async function probeStream(url: string, timeoutMs: number): Promise<Probe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal });
    if (!response.ok) return { kind: 'http', status: response.status };
    const type = (response.headers.get('content-type') ?? '').toLowerCase();
    if (type.includes('mpegurl')) return { kind: 'hls' };
    if (type.includes('mp2t')) return { kind: 'mpegts' };
    if (/^(video\/(mp4|webm|ogg|x-matroska|quicktime)|audio\/)/.test(type)) return { kind: 'native' };
    const chunk = (await response.body?.getReader().read())?.value;
    if (!chunk || chunk.length < 8) return { kind: 'unknown' };
    if (new TextDecoder().decode(chunk.subarray(0, 16)).replace(/^﻿/, '').startsWith('#EXTM3U')) return { kind: 'hls' };
    if (chunk[0] === 0x47 && (chunk.length <= 188 || chunk[188] === 0x47)) return { kind: 'mpegts' };
    const isMp4 = chunk[4] === 0x66 && chunk[5] === 0x74 && chunk[6] === 0x79 && chunk[7] === 0x70;
    const isWebm = chunk[0] === 0x1a && chunk[1] === 0x45 && chunk[2] === 0xdf && chunk[3] === 0xa3;
    return { kind: isMp4 || isWebm ? 'native' : 'unknown' };
  } catch {
    return { kind: 'blocked' };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** Variante HLS do mesmo canal: troca `.ts` por `.m3u8` ou monta o caminho `/live/usuario/senha/id.m3u8`. */
export function hlsVariant(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (/\.ts$/i.test(parsed.pathname)) {
      parsed.pathname = parsed.pathname.replace(/\.ts$/i, '.m3u8');
      return parsed.toString();
    }
    const direct = /^\/([^/.]+)\/([^/.]+)\/(\d+)$/.exec(parsed.pathname);
    if (direct) {
      parsed.pathname = `/live/${direct[1]}/${direct[2]}/${direct[3]}.m3u8`;
      return parsed.toString();
    }
  } catch {
    /* endereço inválido */
  }
  return null;
}

interface Plan {
  candidates: Candidate[];
  /** Motivo imediato de falha, quando nada pode ser tentado. */
  failure?: FailReason;
  /** O servidor recusou o acesso direto do navegador (CORS) ou está inacessível. */
  blocked?: boolean;
  detail?: string;
}

/**
 * Estratégias de reprodução, em ordem (PRD RF-014):
 *  - `.m3u8` → HLS.js (ou HLS nativo, como no Safari);
 *  - arquivos de vídeo → HTML5 nativo;
 *  - demais endereços → o formato é detectado: HLS → HLS.js; MPEG-TS → mpegts.js; vídeo → HTML5.
 *    Se o servidor não permitir a detecção, tenta a variante HLS do canal e a reprodução nativa.
 */
export async function planPlayback(url: string, support: { hls: boolean; mpegts: boolean }, timeoutMs: number): Promise<Plan> {
  if (!/^https?:\/\//i.test(url)) return { candidates: [], failure: 'protocol', detail: url.split(':')[0] };
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return { candidates: [], failure: 'protocol' };
  }
  const native: Candidate = { engine: 'native', url };
  const hls = (target: string): Candidate => ({ engine: support.hls ? 'hls' : 'native', url: target });
  if (/\.m3u8$/i.test(path)) return { candidates: [hls(url)] };
  if (VOD_EXT.test(path)) return { candidates: [native] };

  const variant = hlsVariant(url);
  const probe = await probeStream(url, timeoutMs);
  switch (probe.kind) {
    case 'hls':
      return { candidates: [hls(url)], detail: 'HLS' };
    case 'mpegts':
      return {
        candidates: [...(support.mpegts ? [{ engine: 'mpegts', url } as Candidate] : []), ...(variant ? [hls(variant)] : [])],
        detail: 'MPEG-TS',
        failure: 'format',
      };
    case 'native':
      return { candidates: [native] };
    case 'http':
      return { candidates: [], failure: 'http', detail: `HTTP ${probe.status}` };
    case 'blocked':
      return { candidates: [...(variant ? [hls(variant)] : []), native], blocked: true };
    default:
      return { candidates: [hls(url), ...(support.mpegts ? [{ engine: 'mpegts', url } as Candidate] : []), native] };
  }
}

const REASON_TEXT: Record<FailReason, string> = {
  network: 'Não foi possível conectar a esta transmissão. Ela pode estar fora do ar.',
  cors: 'O servidor desta transmissão não permite a reprodução em navegadores (bloqueio de CORS) ou está fora do ar. Canais assim costumam funcionar apenas em aplicativos, como o TuiTV para Android.',
  http: 'O servidor recusou a transmissão ({detail}). O endereço pode ter expirado: atualize a lista.',
  format: 'Este conteúdo está indisponível ou usa um formato que este navegador não reproduz.',
  timeout: 'A transmissão não respondeu dentro do tempo limite.',
  protocol: 'Este tipo de endereço não pode ser reproduzido em navegadores. Use o TuiTV para Android.',
  mixed: 'O navegador bloqueou esta transmissão http:// porque o TuiTV está aberto em https://.',
  offline: 'Sem conexão com a internet. A reprodução de transmissões depende de conexão.',
};

export interface PlayerProps {
  item: MediaItem;
  /** Posição inicial em segundos (continuação de filmes e episódios). */
  startAt?: number;
  /** Recebe o item ao qual a posição pertence (o componente pode já estar exibindo outro). */
  onProgress?: (item: MediaItem, position: number, duration: number) => void;
  onEnded?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** Texto secundário (programa atual, temporada/episódio…). */
  subtitle?: ReactNode;
  className?: string;
  /**
   * Player de TV (Tizen), no estilo Netflix: tela cheia, ◀▶ avançam/voltam com saltos crescentes
   * aplicados só quando o usuário para, OK pausa, ▼ leva aos botões e ▲ volta à barra de progresso.
   */
  tv?: boolean;
  /** Rótulo do botão "próximo" no modo TV (ex.: "Próximo episódio"). */
  nextLabel?: string;
}

type Flash = 'play' | 'pause' | 'back' | 'forward';

export function Player({ item, startAt = 0, onProgress, onEnded, onPrev, onNext, subtitle, className, tv = false, nextLabel }: PlayerProps) {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const markUnavailable = useStore((s) => s.markUnavailable);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const live = useRef({ settings, onProgress, onEnded, startAt, markUnavailable });
  live.current = { settings, onProgress, onEnded, startAt, markUnavailable };

  const [phase, setPhase] = useState<Phase>('loading');
  const [reason, setReason] = useState<FailReason>('network');
  const [attempt, setAttempt] = useState(0);
  const [detail, setDetail] = useState('');
  const [nonce, setNonce] = useState(0);
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(settings.volume);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);
  const [audio, setAudio] = useState<TrackOption[]>([]);
  const [audioId, setAudioId] = useState(-1);
  const [subs, setSubs] = useState<TrackOption[]>([]);
  const [subId, setSubId] = useState(-1);
  const [menu, setMenu] = useState<'audio' | 'subs' | null>(null);

  const isLive = item.kind === 'live';
  const seekable = !isLive && Number.isFinite(duration) && duration > 0;

  /* ── Ciclo de reprodução ─────────────────────────────────────────────── */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    let hls: Hls | null = null;
    let index = 0;
    let retries = 0;
    let everPlayed = false;
    let mediaRecovered = false;
    let seeked = false;
    let dead = false;
    let lastReport = 0;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let candidates: Candidate[] = [];
    let plan: Plan = { candidates };
    let engine: Engine | null = null;
    let ts: { destroy(): void; pause(): void; unload(): void; detachMediaElement(): void } | null = null;

    setPhase('loading');
    setAttempt(0);
    setDetail('');
    setTime(0);
    setDuration(0);
    setAudio([]);
    setSubs([]);
    setAudioId(-1);
    setSubId(-1);
    setMenu(null);
    video.volume = live.current.settings.volume;

    const clearTimers = () => {
      clearTimeout(timeoutTimer);
      clearTimeout(retryTimer);
    };

    const teardown = () => {
      if (hls) {
        hls.destroy();
        hls = null;
        hlsRef.current = null;
      }
      if (ts) {
        try {
          ts.pause();
          ts.unload();
          ts.detachMediaElement();
          ts.destroy();
        } catch {
          /* já encerrado */
        }
        ts = null;
      }
      engine = null;
      video.removeAttribute('src');
      video.load();
    };

    const giveUp = (why: FailReason) => {
      dead = true;
      clearTimers();
      teardown();
      const blockedMixed = location.protocol === 'https:' && item.url.startsWith('http:');
      const networkish = why === 'network' || why === 'timeout' || why === 'format';
      setReason(
        !navigator.onLine ? 'offline' : why === 'protocol' || why === 'http' ? why : blockedMixed ? 'mixed' : plan.blocked && networkish ? 'cors' : why,
      );
      setDetail(plan.detail ?? '');
      setPhase('error');
      if (navigator.onLine) live.current.markUnavailable(item.id, true);
      // Nunca registra o endereço completo: ele pode conter credenciais.
      console.warn('[TuiTV] reprodução falhou:', why, maskUrl(item.url));
    };

    const fail = (why: FailReason) => {
      if (disposed || dead) return;
      clearTimers();
      if (!everPlayed && index < candidates.length - 1) {
        index++;
        void start();
        return;
      }
      const recoverable = why === 'network' || why === 'timeout';
      const limit = everPlayed ? 6 : 2;
      if (live.current.settings.autoReconnect && recoverable && retries < limit) {
        retries++;
        setAttempt(retries);
        setPhase('reconnecting');
        retryTimer = setTimeout(() => void start(), Math.min(1000 * 2 ** (retries - 1), 15_000));
        return;
      }
      giveUp(why);
    };

    const start = async () => {
      teardown();
      if (disposed) return;
      const candidate = candidates[index];
      if (!candidate) {
        giveUp(plan.failure ?? 'protocol');
        return;
      }
      engine = candidate.engine;
      const { connectionTimeout, autoplay } = live.current.settings;
      mediaRecovered = false;
      timeoutTimer = setTimeout(() => fail('timeout'), connectionTimeout * 1000);
      if (candidate.engine === 'hls') {
        const { default: HlsCtor } = await import('hls.js');
        if (disposed) return;
        const instance = new HlsCtor({
          enableWorker: true,
          manifestLoadingTimeOut: connectionTimeout * 1000,
          xhrSetup: (xhr) => {
            xhr.withCredentials = false;
          },
        });
        hls = instance;
        hlsRef.current = instance;
        instance.subtitleDisplay = true;
        instance.on(HlsCtor.Events.MANIFEST_PARSED, () => {
          if (autoplay) video.play().catch(() => undefined);
        });
        instance.on(HlsCtor.Events.AUDIO_TRACKS_UPDATED, () => {
          const options = instance.audioTracks.map((track, id) => ({ id, label: track.name || track.lang || `${id + 1}` }));
          setAudio(options);
          const wanted = live.current.settings.audioLanguage.toLowerCase();
          const preferred = wanted ? instance.audioTracks.findIndex((track) => (track.lang ?? '').toLowerCase().startsWith(wanted)) : -1;
          if (preferred >= 0) instance.audioTrack = preferred;
          setAudioId(preferred >= 0 ? preferred : instance.audioTrack);
        });
        instance.on(HlsCtor.Events.AUDIO_TRACK_SWITCHED, () => setAudioId(instance.audioTrack));
        instance.on(HlsCtor.Events.SUBTITLE_TRACKS_UPDATED, () => {
          const options = instance.subtitleTracks.map((track, id) => ({ id, label: track.name || track.lang || `${id + 1}` }));
          setSubs(options);
          const { subtitlesEnabled, subtitleLanguage } = live.current.settings;
          let chosen = -1;
          if (subtitlesEnabled && options.length) {
            const wanted = subtitleLanguage.toLowerCase();
            chosen = wanted ? instance.subtitleTracks.findIndex((track) => (track.lang ?? '').toLowerCase().startsWith(wanted)) : 0;
            if (chosen < 0) chosen = 0;
          }
          instance.subtitleTrack = chosen;
          setSubId(chosen);
        });
        instance.on(HlsCtor.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) fail('network');
          else if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
            mediaRecovered = true;
            instance.recoverMediaError();
          } else fail('format');
        });
        instance.loadSource(candidate.url);
        instance.attachMedia(video);
      } else if (candidate.engine === 'mpegts') {
        const { default: mpegts } = await import('mpegts.js');
        if (disposed) return;
        mpegts.LoggingControl.enableAll = false;
        const instance = mpegts.createPlayer({ type: 'mpegts', isLive: item.kind === 'live', url: candidate.url }, { enableWorker: false, lazyLoad: false });
        ts = instance;
        instance.on(mpegts.Events.ERROR, (type: string) => fail(type === mpegts.ErrorTypes.NETWORK_ERROR ? 'network' : 'format'));
        instance.attachMediaElement(video);
        instance.load();
        if (autoplay) Promise.resolve(instance.play()).catch(() => undefined);
      } else {
        video.src = candidate.url;
        video.load();
        if (autoplay) video.play().catch(() => undefined);
      }
    };

    const report = (force: boolean) => {
      const now = Date.now();
      if (!everPlayed || (!force && now - lastReport < 5000)) return;
      lastReport = now;
      live.current.onProgress?.(item, video.currentTime, video.duration);
    };

    const readNativeSubtitles = () => {
      if (hls) return;
      const list: TrackOption[] = [];
      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i]!;
        if (track.kind === 'subtitles' || track.kind === 'captions') list.push({ id: i, label: track.label || track.language || `${i + 1}` });
      }
      setSubs(list);
    };

    const handlers: [keyof HTMLVideoElementEventMap, () => void][] = [
      [
        'playing',
        () => {
          everPlayed = true;
          retries = 0;
          clearTimeout(timeoutTimer);
          setAttempt(0);
          setPhase('playing');
          live.current.markUnavailable(item.id, false);
          report(true);
        },
      ],
      ['waiting', () => everPlayed && setPhase('buffering')],
      [
        'loadedmetadata',
        () => {
          setDuration(video.duration);
          const resume = live.current.startAt;
          if (!seeked && resume > 0 && Number.isFinite(video.duration) && resume < video.duration - 10) video.currentTime = resume;
          seeked = true;
          readNativeSubtitles();
        },
      ],
      [
        'loadeddata',
        () => {
          clearTimeout(timeoutTimer);
          setPhase((current) => (current === 'loading' || current === 'reconnecting' ? 'ready' : current));
        },
      ],
      ['durationchange', () => setDuration(video.duration)],
      [
        'timeupdate',
        () => {
          setTime(video.currentTime);
          report(false);
        },
      ],
      ['play', () => setPaused(false)],
      [
        'pause',
        () => {
          setPaused(true);
          report(true);
        },
      ],
      [
        'volumechange',
        () => {
          setVolume(video.volume);
          setMuted(video.muted);
        },
      ],
      [
        'ended',
        () => {
          report(true);
          if (item.kind === 'live') fail('network');
          else live.current.onEnded?.();
        },
      ],
      [
        'error',
        () => {
          if (engine !== 'native' || !video.error) return;
          fail(video.error.code === MediaError.MEDIA_ERR_NETWORK ? 'network' : 'format');
        },
      ],
    ];
    for (const [name, handler] of handlers) video.addEventListener(name, handler);

    void (async () => {
      const { default: HlsCtor } = await import('hls.js');
      if (disposed) return;
      const { default: mpegts } = await import('mpegts.js');
      if (disposed) return;
      const timeoutMs = live.current.settings.connectionTimeout * 1000;
      plan = await planPlayback(item.url, { hls: HlsCtor.isSupported(), mpegts: mpegts.getFeatureList().mseLivePlayback }, timeoutMs);
      if (disposed) return;
      candidates = plan.candidates;
      void start();
    })();

    return () => {
      report(true);
      disposed = true;
      clearTimers();
      for (const [name, handler] of handlers) video.removeEventListener(name, handler);
      teardown();
    };
  }, [item.id, item.url, item.kind, nonce]);

  /* ── Controles ───────────────────────────────────────────────────────── */
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => undefined);
    else video.pause();
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!container) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (container.requestFullscreen) void container.requestFullscreen().catch(() => undefined);
    else video?.webkitEnterFullscreen?.();
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const volumeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const changeVolume = useCallback(
    (value: number) => {
      const video = videoRef.current;
      if (!video) return;
      const next = Math.min(1, Math.max(0, value));
      video.volume = next;
      video.muted = next === 0;
      clearTimeout(volumeTimer.current);
      volumeTimer.current = setTimeout(() => updateSettings({ volume: next }), 600);
    },
    [updateSettings],
  );

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + delta));
  }, []);

  /* ── Modo TV: busca acumulada, retorno visual e foco entre barra e botões ── */
  const controlsRef = useRef<HTMLDivElement>(null);
  const [scrubTo, setScrubTo] = useState<number | null>(null);
  const scrubRef = useRef<number | null>(null);
  const scrubSteps = useRef(0);
  const scrubTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [flash, setFlash] = useState<Flash | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [barFocused, setBarFocused] = useState(true);

  const showFlash = useCallback((kind: Flash) => {
    setFlash(kind);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 650);
  }, []);

  const commitScrub = useCallback(() => {
    clearTimeout(scrubTimer.current);
    const target = scrubRef.current;
    if (target === null) return;
    if (videoRef.current) videoRef.current.currentTime = target;
    setTime(target);
    scrubRef.current = null;
    scrubSteps.current = 0;
    setScrubTo(null);
  }, []);

  const scrub = useCallback(
    (direction: 1 | -1) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
      // Quanto mais toques seguidos, maior o salto: 10 s, depois 30 s, depois 1 min.
      const n = scrubSteps.current++;
      const step = n < 3 ? 10 : n < 8 ? 30 : 60;
      const next = Math.min(video.duration, Math.max(0, (scrubRef.current ?? video.currentTime) + direction * step));
      scrubRef.current = next;
      setScrubTo(next);
      showFlash(direction > 0 ? 'forward' : 'back');
      clearTimeout(scrubTimer.current);
      scrubTimer.current = setTimeout(commitScrub, 700);
    },
    [commitScrub, showFlash],
  );

  useEffect(() => {
    clearTimeout(scrubTimer.current);
    scrubRef.current = null;
    scrubSteps.current = 0;
    setScrubTo(null);
  }, [item.id]);
  useEffect(() => () => {
    clearTimeout(scrubTimer.current);
    clearTimeout(flashTimer.current);
  }, []);

  const tvToggle = () => {
    const video = videoRef.current;
    if (!video) return;
    showFlash(video.paused ? 'play' : 'pause');
    togglePlay();
  };

  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 3500);
  }, []);
  useEffect(() => () => clearTimeout(idleTimer.current), []);

  const onTvKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    wake();
    if (target !== containerRef.current) {
      // Nos botões: ◀▶ e OK são deles (navegação espacial); ▲ volta à barra de progresso.
      if (event.key === 'ArrowUp' && menu === null && !target.closest('[role="menu"]')) {
        containerRef.current?.focus({ preventScroll: true });
        event.preventDefault();
      } else if (event.key === 'k') {
        tvToggle();
        event.preventDefault();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowLeft':
        scrub(-1);
        break;
      case 'ArrowRight':
        scrub(1);
        break;
      case 'Enter':
      case ' ':
      case 'k':
        if (scrubRef.current !== null) commitScrub();
        else if (!isLive || event.key === 'k') tvToggle();
        break;
      case 'ArrowDown':
        if (isLive && onNext) onNext();
        else controlsRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
        break;
      case 'ArrowUp':
        if (isLive && onPrev) onPrev();
        break;
      case 'PageUp':
      case 'ChannelUp':
        onPrev?.();
        break;
      case 'PageDown':
      case 'ChannelDown':
        onNext?.();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (tv) return onTvKeyDown(event);
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return;
    wake();
    switch (event.key) {
      case ' ':
      case 'k':
        if (target.tagName === 'BUTTON' && event.key === ' ') return;
        togglePlay();
        break;
      case 'f':
        toggleFullscreen();
        break;
      case 'm':
        if (videoRef.current) videoRef.current.muted = !videoRef.current.muted;
        break;
      case 'ArrowLeft':
        seekBy(-10);
        break;
      case 'ArrowRight':
        seekBy(10);
        break;
      case 'ArrowUp':
        if (onPrev) onPrev();
        else changeVolume(volume + 0.1);
        break;
      case 'ArrowDown':
        if (onNext) onNext();
        else changeVolume(volume - 0.1);
        break;
      case 'PageUp':
      case 'ChannelUp':
        onPrev?.();
        break;
      case 'PageDown':
      case 'ChannelDown':
        onNext?.();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const selectAudio = (id: number) => {
    if (hlsRef.current) hlsRef.current.audioTrack = id;
    setAudioId(id);
    setMenu(null);
  };

  const selectSubtitle = (id: number) => {
    const video = videoRef.current;
    if (hlsRef.current) hlsRef.current.subtitleTrack = id;
    else if (video) {
      for (let i = 0; i < video.textTracks.length; i++) video.textTracks[i]!.mode = i === id ? 'showing' : 'disabled';
    }
    setSubId(id);
    setMenu(null);
  };

  const cycleAspect = () => {
    const next = ASPECTS[(ASPECTS.indexOf(settings.aspect) + 1) % ASPECTS.length]!;
    updateSettings({ aspect: next });
  };
  const aspectLabel = { contain: t('Proporção: ajustar'), cover: t('Proporção: preencher'), fill: t('Proporção: esticar') }[settings.aspect];

  const pip = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      /* não suportado */
    }
  };
  const pipSupported = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;

  const busy = phase === 'loading' || phase === 'buffering' || phase === 'reconnecting';
  const showControls = !idle || paused || phase !== 'playing' || menu !== null || scrubTo !== null;
  // Controles escondidos não podem ficar com o foco (TV): ele volta à barra de progresso.
  useEffect(() => {
    if (!tv || showControls) return;
    if (controlsRef.current?.contains(document.activeElement)) containerRef.current?.focus({ preventScroll: true });
  }, [tv, showControls]);
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const tvButton = 'tv-ctl inline-flex h-12 w-12 shrink-0 items-center justify-center gap-2 rounded-full bg-white/15 text-white transition-transform duration-150';
  const controlButton = 'inline-flex size-10 items-center justify-center rounded-lg text-white/90 transition hover:bg-white/15 hover:text-white';

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={(event) => setBarFocused(event.target === event.currentTarget)}
      onPointerMove={wake}
      onPointerDown={wake}
      data-phase={phase}
      data-testid="player"
      className={cx('group relative overflow-hidden bg-black text-white outline-none select-none', !showControls && 'cursor-none', className)}
    >
      <video
        ref={videoRef}
        playsInline
        className={cx('absolute inset-0 size-full', ASPECT_CLASS[settings.aspect])}
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
      />

      {busy && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40" aria-live="polite">
          <Spinner className="size-10 text-accent" />
          <span className="text-sm text-white/90">
            {phase === 'reconnecting' ? t('Reconectando… (tentativa {n})', { n: attempt }) : t('Carregando…')}
          </span>
        </div>
      )}

      {phase === 'ready' && paused && !tv && (
        <button type="button" onClick={togglePlay} aria-label={t('Reproduzir')} className="absolute inset-0 flex items-center justify-center bg-black/30">
          <span className="flex size-16 items-center justify-center rounded-full bg-accent text-accent-ink">
            <Play className="size-8 translate-x-0.5" fill="currentColor" />
          </span>
        </button>
      )}

      {phase === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center" role="alert">
          <AlertTriangle className="size-9 text-warning" />
          <p className="max-w-md text-sm text-white/90">{t(REASON_TEXT[reason], { detail })}</p>
          {detail && reason !== 'http' && <p className="text-xs text-white/50">{detail}</p>}
          <Button variant="primary" onClick={() => setNonce((n) => n + 1)}>
            <RotateCw className="size-4" /> {t('Tentar novamente')}
          </Button>
        </div>
      )}

      {tv ? (
        <>
          <div
            className={cx(
              'pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent px-14 pt-10 pb-16 transition-opacity duration-300',
              showControls ? 'opacity-100' : 'opacity-0',
            )}
          >
            <p className="truncate text-3xl font-bold">{item.name}</p>
            {subtitle && <p className="mt-1 truncate text-lg text-white/75">{subtitle}</p>}
          </div>

          {flash && (
            <div className="tv-flash pointer-events-none absolute top-1/2 left-1/2 flex size-28 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55" aria-hidden>
              {flash === 'play' && <Play className="size-14 translate-x-1" fill="currentColor" />}
              {flash === 'pause' && <Pause className="size-14" fill="currentColor" />}
              {flash === 'back' && <RotateCcw className="size-14" />}
              {flash === 'forward' && <RotateCw className="size-14" />}
            </div>
          )}

          <div
            ref={controlsRef}
            className={cx(
              'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-14 pt-24 pb-10 transition-[opacity,visibility] duration-300',
              showControls ? 'visible opacity-100' : 'invisible opacity-0',
            )}
          >
            {seekable ? (
              <TvSeekBar position={scrubTo ?? time} duration={duration} scrubbing={scrubTo !== null} focused={barFocused} />
            ) : isLive ? (
              <span className="inline-flex items-center gap-2 rounded bg-danger px-2.5 py-1 text-sm font-bold tracking-wide">{t('AO VIVO')}</span>
            ) : null}
            <div className="mt-6 flex items-center gap-4">
              <button type="button" className={tvButton} onClick={tvToggle} aria-label={paused ? t('Reproduzir') : t('Pausar')}>
                {paused ? <Play className="size-6 translate-x-0.5" fill="currentColor" /> : <Pause className="size-6" fill="currentColor" />}
              </button>
              {seekable && (
                <>
                  <button type="button" className={tvButton} onClick={() => seekBy(-10)} aria-label={t('Voltar 10 segundos')}>
                    <RotateCcw className="size-6" />
                  </button>
                  <button type="button" className={tvButton} onClick={() => seekBy(10)} aria-label={t('Avançar 10 segundos')}>
                    <RotateCw className="size-6" />
                  </button>
                </>
              )}
              {audio.length > 1 && (
                <TrackMenu
                  open={menu === 'audio'}
                  onToggle={() => setMenu(menu === 'audio' ? null : 'audio')}
                  label={t('Áudio')}
                  icon={<AudioLines className="size-6" />}
                  options={audio}
                  selected={audioId}
                  onSelect={selectAudio}
                  buttonClass={tvButton}
                />
              )}
              {subs.length > 0 && (
                <TrackMenu
                  open={menu === 'subs'}
                  onToggle={() => setMenu(menu === 'subs' ? null : 'subs')}
                  label={t('Legendas')}
                  icon={<Captions className="size-6" />}
                  options={[{ id: -1, label: t('Desativadas') }, ...subs]}
                  selected={subId}
                  onSelect={selectSubtitle}
                  buttonClass={tvButton}
                />
              )}
              <button type="button" className={tvButton} onClick={cycleAspect} aria-label={aspectLabel} title={aspectLabel}>
                <RectangleHorizontal className="size-6" />
              </button>
              {onNext && !isLive && (
                <button type="button" className={cx(tvButton, 'w-auto px-6')} onClick={onNext}>
                  <SkipForward className="size-6" /> <span className="text-base font-semibold">{nextLabel ?? t('Próximo')}</span>
                </button>
              )}
              <span className="flex-1" />
              <span className="text-base text-white/60">
                {barFocused ? (isLive ? t('▲▼ trocar canal · Voltar sai') : t('◀▶ avançar/voltar · OK pausa · ▼ botões')) : t('▲ barra de progresso')}
              </span>
            </div>
          </div>
        </>
      ) : (
        <>
      <div
        className={cx(
          'pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/75 to-transparent px-4 pt-3 pb-8 transition-opacity',
          showControls ? 'opacity-100' : 'opacity-0',
        )}
      >
        <p className="truncate text-sm font-semibold">{item.name}</p>
        {subtitle && <p className="truncate text-xs text-white/75">{subtitle}</p>}
      </div>

      <div
        className={cx(
          'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pt-8 pb-1.5 transition-opacity sm:px-3',
          showControls ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        {seekable && (
          <input
            type="range"
            aria-label={t('Posição')}
            min={0}
            max={duration}
            step={1}
            value={Math.min(time, duration)}
            onChange={(event) => {
              if (videoRef.current) videoRef.current.currentTime = Number(event.target.value);
            }}
            className="tui-range mx-1 block w-[calc(100%-0.5rem)]"
            style={{ ['--fill' as string]: `${(time / duration) * 100}%` }}
          />
        )}
        <div className="flex items-center gap-0.5">
          <button type="button" className={controlButton} onClick={togglePlay} aria-label={paused ? t('Reproduzir') : t('Pausar')}>
            {paused ? <Play className="size-5" fill="currentColor" /> : <Pause className="size-5" fill="currentColor" />}
          </button>
          {onPrev && (
            <button type="button" className={controlButton} onClick={onPrev} aria-label={t('Anterior')} title={t('Anterior')}>
              <SkipBack className="size-5" />
            </button>
          )}
          {onNext && (
            <button type="button" className={controlButton} onClick={onNext} aria-label={t('Próximo')} title={t('Próximo')}>
              <SkipForward className="size-5" />
            </button>
          )}
          <button
            type="button"
            className={controlButton}
            onClick={() => {
              if (videoRef.current) videoRef.current.muted = !videoRef.current.muted;
            }}
            aria-label={muted ? t('Ativar som') : t('Silenciar')}
          >
            <VolumeIcon className="size-5" />
          </button>
          <input
            type="range"
            aria-label={t('Volume')}
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(event) => changeVolume(Number(event.target.value))}
            className="tui-range hidden w-20 sm:block"
            style={{ ['--fill' as string]: `${(muted ? 0 : volume) * 100}%` }}
          />
          <span className="ml-2 text-xs tabular-nums text-white/85">
            {isLive ? (
              <span className="inline-flex items-center gap-1.5 font-bold tracking-wide">
                <span className="size-2 rounded-full bg-red-500" /> {t('AO VIVO')}
              </span>
            ) : (
              `${formatClock(time)}${seekable ? ` / ${formatClock(duration)}` : ''}`
            )}
          </span>
          <span className="flex-1" />

          {audio.length > 1 && (
            <TrackMenu
              open={menu === 'audio'}
              onToggle={() => setMenu(menu === 'audio' ? null : 'audio')}
              label={t('Áudio')}
              icon={<AudioLines className="size-5" />}
              options={audio}
              selected={audioId}
              onSelect={selectAudio}
              buttonClass={controlButton}
            />
          )}
          {subs.length > 0 && (
            <TrackMenu
              open={menu === 'subs'}
              onToggle={() => setMenu(menu === 'subs' ? null : 'subs')}
              label={t('Legendas')}
              icon={<Captions className="size-5" />}
              options={[{ id: -1, label: t('Desativadas') }, ...subs]}
              selected={subId}
              onSelect={selectSubtitle}
              buttonClass={controlButton}
            />
          )}
          <button type="button" className={controlButton} onClick={cycleAspect} aria-label={aspectLabel} title={aspectLabel}>
            <RectangleHorizontal className="size-5" />
          </button>
          {pipSupported && (
            <button type="button" className={cx(controlButton, 'hidden sm:inline-flex')} onClick={pip} aria-label="Picture-in-picture" title="Picture-in-picture">
              <PictureInPicture2 className="size-5" />
            </button>
          )}
          <button
            type="button"
            className={controlButton}
            onClick={toggleFullscreen}
            aria-label={fullscreen ? t('Sair da tela cheia') : t('Tela cheia')}
            title={fullscreen ? t('Sair da tela cheia') : t('Tela cheia')}
          >
            {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
          </button>
        </div>
      </div>
        </>
      )}
    </div>
  );
}

/** Barra de progresso do player de TV: tempo alvo durante a busca e tempo restante, como na Netflix. */
function TvSeekBar({ position, duration, scrubbing, focused }: { position: number; duration: number; scrubbing: boolean; focused: boolean }) {
  const pct = Math.min(100, Math.max(0, (position / duration) * 100));
  return (
    <div>
      <div className="relative h-9">
        {scrubbing && (
          <span className="absolute bottom-1 -translate-x-1/2 text-2xl font-bold tabular-nums" style={{ left: `${Math.min(96, Math.max(4, pct))}%` }}>
            {formatClock(position)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-6">
        <div className="relative flex h-6 flex-1 items-center">
          <div className={cx('w-full rounded-full bg-white/30 transition-[height]', focused ? 'h-2' : 'h-1')} />
          <div className={cx('absolute left-0 rounded-full bg-danger transition-[height]', focused ? 'h-2' : 'h-1')} style={{ width: `${pct}%` }} />
          {focused && <div className="absolute size-6 -translate-x-1/2 rounded-full bg-danger shadow-lg shadow-black/50" style={{ left: `${pct}%` }} />}
        </div>
        <span className="text-xl tabular-nums">-{formatClock(Math.max(0, duration - position))}</span>
      </div>
    </div>
  );
}

function TrackMenu({
  open,
  onToggle,
  label,
  icon,
  options,
  selected,
  onSelect,
  buttonClass,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  icon: ReactNode;
  options: TrackOption[];
  selected: number;
  onSelect: (id: number) => void;
  buttonClass: string;
}) {
  return (
    <div className="relative">
      <button type="button" className={buttonClass} onClick={onToggle} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}>
        {icon}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 bottom-12 z-10 max-h-60 min-w-44 overflow-y-auto rounded-lg border border-white/15 bg-black/90 p-1 shadow-xl">
          <p className="px-3 py-1.5 text-xs font-semibold tracking-wide text-white/60 uppercase">{label}</p>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={option.id === selected}
              onClick={() => onSelect(option.id)}
              className={cx('block w-full rounded px-3 py-2 text-left text-sm hover:bg-white/15', option.id === selected && 'font-bold text-accent')}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

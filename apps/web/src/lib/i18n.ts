'use client';

import { useCallback } from 'react';
import type { Language } from '@tuitv/shared-models';
import { en } from './i18n-en';
import { ImportError, type ImportErrorCode } from './net';
import { useStore } from './store';

/**
 * Internacionalização simples: o texto em português é a própria chave.
 * Idiomas adicionais mapeiam a chave para a tradução (ver i18n-en.ts).
 */
const dictionaries: Record<Language, Record<string, string> | null> = { 'pt-BR': null, en };

export type Translate = (text: string, vars?: Record<string, string | number>) => string;

export function translate(language: Language, text: string, vars?: Record<string, string | number>): string {
  let out = dictionaries[language]?.[text] ?? text;
  if (vars) for (const [key, value] of Object.entries(vars)) out = out.replaceAll(`{${key}}`, String(value));
  return out;
}

export function useT(): Translate {
  const language = useStore((s) => s.settings.language);
  return useCallback((text, vars) => translate(language, text, vars), [language]);
}

const IMPORT_ERRORS: Record<ImportErrorCode, string> = {
  'url-empty': 'Informe o endereço.',
  'url-malformed': 'O endereço não é válido. Use um endereço completo, começando com http:// ou https://.',
  'url-scheme': 'Apenas endereços http:// e https:// são aceitos.',
  'login-missing': 'Informe o host, o usuário e a senha.',
  'url-private': 'Este endereço aponta para a rede local ou interna. Para usá-lo, ative “Permitir endereços da rede local” nas Configurações.',
  offline: 'Sem conexão com a internet. A biblioteca já importada continua disponível.',
  'mixed-content': 'O navegador bloqueou o endereço http:// porque o TuiTV está aberto em https://. Use um endereço https:// ou baixe o arquivo e importe-o pelo dispositivo.',
  'network-or-cors': 'Não foi possível baixar este endereço. O servidor pode estar fora do ar ou não permitir acesso direto pelo navegador (CORS). Baixe o arquivo e use “Importar arquivo”.',
  timeout: 'O servidor demorou demais para responder. Tente novamente ou aumente o tempo limite nas Configurações.',
  http: 'O servidor respondeu com erro ({detail}).',
  'too-large': 'O conteúdo excede o tamanho máximo de importação.',
  'not-m3u': 'O conteúdo não é uma lista M3U/M3U8 válida.',
  'hls-manifest': 'Este endereço é uma transmissão única (manifesto HLS), não uma lista de canais.',
  empty: 'Nenhum conteúdo válido foi encontrado.',
  'not-xmltv': 'O conteúdo não é um guia XMLTV válido.',
  storage: 'Não foi possível gravar os dados neste dispositivo. O armazenamento do navegador pode estar cheio.',
  cancelled: 'Importação cancelada.',
};

export function importErrorText(t: Translate, error: unknown): string {
  if (error instanceof ImportError) return t(IMPORT_ERRORS[error.code], { detail: error.detail ?? '' });
  return t('Ocorreu um erro inesperado.');
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function formatDuration(seconds: number, t: Translate): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('{n} min', { n: minutes });
  return t('{h} h {m} min', { h: Math.floor(minutes / 60), m: minutes % 60 });
}

export function formatDate(timestamp: number, language: Language): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(timestamp);
}

export function formatHour(timestamp: number, language: Language): string {
  return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(timestamp);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

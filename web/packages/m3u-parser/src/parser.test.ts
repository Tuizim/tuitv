import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { M3uParser, epgUrlFromHeader, looksLikeM3u, nameFromUrl, parseAttributes, parseM3u } from './index';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

describe('parseAttributes', () => {
  it('lê pares com e sem aspas e normaliza chaves', () => {
    const { attrs, end, ok } = parseAttributes('TVG-ID="a.b" group-title=News tvg-logo="http://x/y.png",Nome');
    expect(ok).toBe(true);
    expect(attrs).toEqual({ 'tvg-id': 'a.b', 'group-title': 'News', 'tvg-logo': 'http://x/y.png' });
    expect('TVG-ID="a.b" group-title=News tvg-logo="http://x/y.png",Nome'.slice(end)).toBe(',Nome');
  });

  it('aceita vírgulas dentro de valores entre aspas', () => {
    const { attrs } = parseAttributes('group-title="A, B",X');
    expect(attrs['group-title']).toBe('A, B');
  });
});

describe('parseM3u', () => {
  it('interpreta a lista básica', () => {
    const { header, entries, errors } = parseM3u(fixture('basic.m3u'));
    expect(header.found).toBe(true);
    expect(epgUrlFromHeader(header)).toBe('https://example.org/guia.xml');
    expect(errors).toEqual([]);
    expect(entries).toHaveLength(6);
    expect(entries[0]).toMatchObject({
      name: 'Canal Um HD',
      url: 'https://stream.example.org/um/index.m3u8',
      tvgId: 'canal.um',
      tvgName: 'Canal Um HD',
      tvgLogo: 'https://example.org/logos/um.png',
      groupTitle: 'Abertos',
      duration: -1,
    });
    expect(entries[3]!.name).toBe('Notícias 24h');
    expect(entries[3]!.groupTitle).toBe('Notícias');
  });

  it('trata BOM, CRLF, caracteres especiais e vírgulas', () => {
    const { header, entries, errors } = parseM3u(fixture('special.m3u'));
    expect(header.found).toBe(true);
    expect(errors).toEqual([]);
    expect(entries.map((e) => e.name)).toEqual([
      'Arte & Música: São João, ao vivo',
      'Crianças Ñandú 日本語',
      'Rádio Coração',
      'Só TVG Name',
      'Atributos Maiúsculos',
      'Nome após atributos quebrados',
    ]);
    expect(entries[0]!.groupTitle).toBe('Variedades, Cultura');
    expect(entries[0]!.tvgId).toBeUndefined();
    expect(entries[1]).toMatchObject({ tvgId: 'infantil.1', groupTitle: 'Infantil' });
    expect(entries[2]).toMatchObject({
      groupTitle: 'Rádios',
      duration: 0,
      options: { 'http-user-agent': 'TuiTV/1.0', 'http-referrer': 'https://example.org/' },
    });
    expect(entries[4]).toMatchObject({ tvgId: 'Maiusculas.br', groupTitle: 'Abertos', url: 'rtmp://stream.example.org/live/maiusculas' });
  });

  it('continua após registros incompletos e registra erros individuais', () => {
    const { header, entries, errors } = parseM3u(fixture('incomplete.m3u'));
    expect(header.found).toBe(false);
    expect(entries.map((e) => e.name)).toEqual([
      'Primeiro canal',
      'Canal depois do incompleto',
      'Canal Sem Extinf',
      'Endereço inválido seguido de válido',
      'extinf-vazio',
    ]);
    expect(errors.map((e) => [e.line, e.code])).toEqual([
      [3, 'missing-url'],
      [7, 'invalid-url'],
      [9, 'invalid-url'],
      [12, 'malformed-extinf'],
      [14, 'missing-url'],
    ]);
  });

  it('produz o mesmo resultado quando alimentado em pedaços arbitrários', () => {
    for (const name of ['basic.m3u', 'special.m3u', 'incomplete.m3u', 'vod.m3u']) {
      const text = fixture(name);
      const whole = parseM3u(text);
      for (const size of [1, 7, 64, 1000]) {
        const parser = new M3uParser();
        const entries = [];
        for (let i = 0; i < text.length; i += size) entries.push(...parser.push(text.slice(i, i + size)));
        entries.push(...parser.end());
        expect(entries, `${name} em pedaços de ${size}`).toEqual(whole.entries);
        expect(parser.errors).toEqual(whole.errors);
      }
    }
  });

  it('identifica manifestos HLS de mídia', () => {
    const result = parseM3u('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg0.ts\n');
    expect(result.isHlsManifest).toBe(true);
    expect(result.entries).toHaveLength(0);
  });

  it('processa listas extensas rapidamente', () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 100_000; i++) {
      lines.push(`#EXTINF:-1 tvg-id="c${i}" tvg-logo="https://example.org/${i}.png" group-title="Grupo ${i % 50}",Canal ${i}`);
      lines.push(`https://stream.example.org/${i}/index.m3u8`);
    }
    const started = performance.now();
    const { entries } = parseM3u(lines.join('\n'));
    expect(entries).toHaveLength(100_000);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

describe('utilitários', () => {
  it('looksLikeM3u valida o formato', () => {
    expect(looksLikeM3u('﻿#EXTM3U\n')).toBe(true);
    expect(looksLikeM3u('#EXTINF:-1,A\nhttp://a/b')).toBe(true);
    expect(looksLikeM3u('<!doctype html><html>')).toBe(false);
    expect(looksLikeM3u('{"erro": true}')).toBe(false);
  });

  it('nameFromUrl deriva um nome legível', () => {
    expect(nameFromUrl('https://a.b/c/Meu_Canal%20HD.m3u8?token=1')).toBe('Meu Canal HD');
  });
});

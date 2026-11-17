import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseM3u } from '@tuitv/m3u-parser';
import { DEFAULT_SETTINGS, type BackupData, type Programme } from '@tuitv/shared-models';
import { validateBackupEnvelope } from '@tuitv/validation';
import {
  BackupError,
  ItemBuilder,
  XmltvParser,
  backupHasCredentials,
  buildEpgIndex,
  classifyEntry,
  createBackup,
  createRestriction,
  extractYear,
  groupSeries,
  hashPin,
  isAdultLabel,
  listGroups,
  matchEpisode,
  nextEpisode,
  normalizeText,
  nowNext,
  openBackup,
  parseXmltv,
  parseXmltvDate,
  resolveEpgChannel,
  searchIn,
  stableHash,
  toSearchable,
  verifyPin,
} from './index';

const fixture = (name: string) => readFileSync(new URL(`../../m3u-parser/fixtures/${name}`, import.meta.url), 'utf8');
const build = (name: string, playlistId = 'p1') => new ItemBuilder(playlistId).add(parseM3u(fixture(name)).entries);

describe('texto', () => {
  it('normaliza acentos e caixa', () => {
    expect(normalizeText('  Notícias   São João ')).toBe('noticias sao joao');
  });
  it('hash estável', () => {
    expect(stableHash('abc')).toBe(stableHash('abc'));
    expect(stableHash('abc')).not.toBe(stableHash('abd'));
    expect(stableHash('')).toBe('811c9dc59747b28c');
  });
});

describe('classificação', () => {
  const kind = (name: string, url: string, group?: string, attrs: Record<string, string> = {}) =>
    classifyEntry({ name, url, attrs, groupTitle: group }).kind;

  it('segue a ordem das regras', () => {
    expect(kind('Canal', 'https://a.b/c.m3u8')).toBe('live');
    expect(kind('Filme', 'https://a.b/c.mp4')).toBe('movie');
    expect(kind('Série S01E02', 'https://a.b/c.mkv')).toBe('series');
    expect(kind('X', 'http://a.b/movie/u/p/1.mp4')).toBe('movie');
    expect(kind('X', 'http://a.b/series/u/p/1.mp4')).toBe('series');
    expect(kind('Canal de Filmes', 'http://a.b/live/u/p/1.ts', 'Filmes e Séries')).toBe('live');
    expect(kind('Doc', 'https://a.b/c.m3u8', 'Docs', { 'tvg-type': 'movie' })).toBe('movie');
    expect(kind('Novela Temporada 1 Episódio 3', 'https://a.b/c.m3u8', 'Novelas')).toBe('series');
    expect(kind('Jogo 3x2', 'https://a.b/c.m3u8', 'Esportes')).toBe('live');
  });

  it('reconhece marcações de episódio', () => {
    expect(matchEpisode('A Série S01E02')).toEqual({ title: 'A Série', season: 1, episode: 2 });
    expect(matchEpisode('A Série - S02 E10 - Final')).toEqual({ title: 'A Série', season: 2, episode: 10 });
    expect(matchEpisode('Risadas 1x05')).toEqual({ title: 'Risadas', season: 1, episode: 5 });
    expect(matchEpisode('Aventura.T03.E120.1080p')).toEqual({ title: 'Aventura', season: 3, episode: 120 });
    expect(matchEpisode('Coração Temporada 2 Episódio 13')).toEqual({ title: 'Coração', season: 2, episode: 13 });
    expect(matchEpisode('Canais HBO')).toBeNull();
    expect(matchEpisode('TNT Series')).toBeNull();
  });

  it('extrai o ano', () => {
    expect(extractYear('Filme (2019)')).toBe(2019);
    expect(extractYear('Planeta [2006]')).toBe(2006);
    expect(extractYear('Outro - 2021')).toBe(2021);
    expect(extractYear('Blade Runner 2049')).toBeUndefined();
  });
});

describe('biblioteca', () => {
  it('gera ids determinísticos e distingue duplicados', () => {
    const a = build('basic.m3u');
    const b = build('basic.m3u');
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
    expect(new Set(a.map((i) => i.id)).size).toBe(a.length);
    // "Canal Dois" aparece duas vezes com o mesmo tvg-id e nome.
    const dois = a.filter((i) => i.name === 'Canal Dois');
    expect(dois).toHaveLength(2);
    expect(dois[1]!.key).toBe(`${dois[0]!.key}-2`);
  });

  it('mantém o id quando apenas o endereço muda', () => {
    const before = new ItemBuilder('p').add(parseM3u('#EXTM3U\n#EXTINF:-1 tvg-id="x" group-title="G",Canal X\nhttp://a.b/1?token=AAA\n').entries);
    const after = new ItemBuilder('p').add(parseM3u('#EXTM3U\n#EXTINF:-1 tvg-id="x" group-title="Outro",Canal X\nhttp://c.d/9?token=BBB\n').entries);
    expect(after[0]!.id).toBe(before[0]!.id);
  });

  it('descarta logotipos com esquemas não permitidos', () => {
    const item = build('special.m3u').find((i) => i.name === 'Atributos Maiúsculos')!;
    expect(item.logo).toBeUndefined();
  });

  it('organiza séries, temporadas e episódios', () => {
    const items = build('vod.m3u');
    expect(items.filter((i) => i.kind === 'movie').map((i) => i.name)).toEqual(['O Grande Filme (2019)', 'Outro Filme - 2021', 'Planeta Azul [2006]']);
    expect(items.filter((i) => i.kind === 'live').map((i) => i.name)).toEqual(['Canal de Filmes 24h', 'Jogo 3x2 Melhores Momentos']);
    const movie = items.find((i) => i.name.startsWith('Outro Filme'))!;
    expect(movie).toMatchObject({ year: 2021, duration: 7260, description: 'Um drama sobre recomeços.' });

    const series = groupSeries(items);
    expect(series.map((s) => s.title).sort()).toEqual(['A Série', 'Aventura', 'Coração Valente', 'Minissérie Sem Marcação', 'Risadas']);
    const a = series.find((s) => s.title === 'A Série')!;
    expect(a.seasons.map((s) => [s.season, s.episodes.map((e) => e.series!.episode)])).toEqual([
      [1, [1, 2]],
      [2, [1]],
    ]);
    const risadas = series.find((s) => s.title === 'Risadas')!;
    expect(risadas.seasons[0]!.episodes.map((e) => e.series!.episode)).toEqual([4, 5]);
    const first = a.seasons[0]!.episodes[0]!;
    expect(nextEpisode(a, first.id)?.name).toBe('A Série S01E02');
    expect(nextEpisode(a, a.seasons[1]!.episodes[0]!.id)).toBeUndefined();
  });

  it('lista categorias com contagem', () => {
    expect(listGroups(build('basic.m3u'))).toEqual([
      { name: 'Abertos', count: 4 },
      { name: 'Esportes', count: 1 },
      { name: 'Notícias', count: 1 },
    ]);
  });

  it('busca sem acentos e ordena por relevância', () => {
    const index = toSearchable(build('basic.m3u'), (i) => i.name);
    expect(searchIn(index, 'noticias').map((i) => i.name)).toEqual(['Notícias 24h']);
    expect(searchIn(index, 'um canal').map((i) => i.name)).toEqual(['Canal Um HD', 'Canal Um SD']);
    expect(searchIn(index, '   ')).toEqual([]);
    expect(searchIn(index, 'canal', 2)).toHaveLength(2);
  });

  it('busca em 100 mil itens dentro da meta (RNF-003)', () => {
    const names = Array.from({ length: 100_000 }, (_, i) => `Canal Número ${i} HD`);
    const index = toSearchable(names, (n) => n);
    const started = performance.now();
    expect(searchIn(index, 'numero 99999')).toEqual(['Canal Número 99999 HD']);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('EPG XMLTV', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="teste">
  <channel id="canal.um"><display-name lang="pt">Canal Um</display-name><display-name>Canal Um HD</display-name><icon src="https://example.org/um.png"/></channel>
  <channel id="Canal.Dois"><display-name>Canal Dois</display-name></channel>
  <programme start="20240501120000 +0000" stop="20240501130000 +0000" channel="canal.um"><title lang="pt">Jornal &amp; Not&#237;cias</title><desc>Resumo do dia.</desc><category>Jornalismo</category></programme>
  <programme start="20240501100000 -0300" stop="20240501110000 -0300" channel="canal.um"><title><![CDATA[Filme <Especial>]]></title></programme>
  <programme start="20240501140000 +0000" channel="Canal.Dois"><title>Sem fim</title></programme>
  <programme start="invalida" channel="canal.um"><title>Ruim</title></programme>
</tv>`;

  it('interpreta datas com fuso', () => {
    expect(parseXmltvDate('20240501120000 +0000')).toBe(Date.UTC(2024, 4, 1, 12));
    expect(parseXmltvDate('20240501100000 -0300')).toBe(Date.UTC(2024, 4, 1, 13));
    expect(parseXmltvDate('20240501120000 +0530')).toBe(Date.UTC(2024, 4, 1, 6, 30));
    expect(parseXmltvDate('202405011200')).toBe(Date.UTC(2024, 4, 1, 12));
    expect(Number.isNaN(parseXmltvDate('ontem'))).toBe(true);
  });

  it('lê canais e programas', () => {
    const { channels, programmes } = parseXmltv(xml);
    expect(channels).toEqual([
      { id: 'canal.um', displayNames: ['Canal Um', 'Canal Um HD'], icon: 'https://example.org/um.png' },
      { id: 'Canal.Dois', displayNames: ['Canal Dois'] },
    ]);
    expect(programmes).toHaveLength(3);
    expect(programmes[0]).toEqual({
      channelId: 'canal.um',
      start: Date.UTC(2024, 4, 1, 12),
      stop: Date.UTC(2024, 4, 1, 13),
      title: 'Jornal & Notícias',
      description: 'Resumo do dia.',
      category: 'Jornalismo',
    });
    expect(programmes[1]!.title).toBe('Filme <Especial>');
    expect(programmes[2]!.stop - programmes[2]!.start).toBe(30 * 60_000);
  });

  it('é incremental e respeita a janela de tempo', () => {
    for (const size of [1, 13, 200]) {
      const parser = new XmltvParser();
      const channels = [];
      const programmes = [];
      for (let i = 0; i < xml.length; i += size) {
        const batch = parser.push(xml.slice(i, i + size));
        channels.push(...batch.channels);
        programmes.push(...batch.programmes);
      }
      const last = parser.end();
      channels.push(...last.channels);
      programmes.push(...last.programmes);
      expect(channels).toHaveLength(2);
      expect(programmes).toHaveLength(3);
      expect(parser.skipped).toBe(1);
    }
    const windowed = parseXmltv(xml, { from: Date.UTC(2024, 4, 1, 14, 15) });
    expect(windowed.programmes.map((p) => p.title)).toEqual(['Sem fim']);
  });

  it('associa canais por tvg-id e por nome', () => {
    const { channels } = parseXmltv(xml);
    const index = buildEpgIndex(channels.map((c) => ({ key: c.id, channelId: c.id, displayNames: c.displayNames })));
    expect(resolveEpgChannel({ tvgId: 'CANAL.UM', name: 'x' }, index)).toBe('canal.um');
    expect(resolveEpgChannel({ name: 'canal dois' }, index)).toBe('Canal.Dois');
    expect(resolveEpgChannel({ tvgName: 'Canal Um HD', name: 'x' }, index)).toBe('canal.um');
    expect(resolveEpgChannel({ name: 'Desconhecido' }, index)).toBeUndefined();
  });

  it('calcula programa atual e próximos', () => {
    const p = (start: number, stop: number, title: string): Programme => ({ sourceId: 's', channelId: 'c', start, stop, title });
    const list = [p(0, 10, 'A'), p(10, 20, 'B'), p(20, 30, 'C'), p(30, 40, 'D')];
    const result = nowNext(list, 12, 1);
    expect(result.current?.title).toBe('B');
    expect(result.next.map((x) => x.title)).toEqual(['C']);
    expect(nowNext(list, 100).current).toBeUndefined();
  });
});

describe('backup', () => {
  const items = new ItemBuilder('p1').add(parseM3u(fixture('basic.m3u')).entries);
  const data: BackupData = {
    playlists: [
      {
        playlist: { id: 'p1', name: 'Arquivo', source: 'file', fileName: 'basic.m3u', active: true, createdAt: 1, updatedAt: 2, itemCount: items.length, counts: { live: 6, movie: 0, series: 0 } },
        items,
      },
      {
        playlist: { id: 'p2', name: 'Remota', source: 'url', url: 'http://provedor.example.org/get.php?username=u&password=p', active: true, createdAt: 1, updatedAt: 2, itemCount: 0, counts: { live: 0, movie: 0, series: 0 } },
      },
    ],
    favorites: [{ id: items[0]!.id, kind: 'live', playlistId: 'p1', addedAt: 5 }],
    history: [{ itemId: items[1]!.id, playlistId: 'p1', kind: 'live', name: 'Canal Dois', playedAt: 9, position: 0, duration: 0, completed: false }],
    epgSources: [],
    settings: { ...DEFAULT_SETTINGS, autoplay: false, parental: { enabled: true, hideAdult: true, lockedGroups: ['x'], pinHash: 'h', pinSalt: 's' } },
  };

  it('exporta e restaura sem senha', async () => {
    const text = await createBackup(data, { platform: 'web', now: 123 });
    const check = validateBackupEnvelope(text);
    expect(check.ok).toBe(true);
    expect(check.envelope).toMatchObject({ app: 'tuitv', schemaVersion: 1, createdAt: 123, encrypted: false });
    const restored = await openBackup(check.envelope!);
    expect(restored.playlists).toEqual(data.playlists);
    expect(restored.favorites).toEqual(data.favorites);
    expect(restored.history).toEqual(data.history);
    expect(restored.settings.autoplay).toBe(false);
    // O PIN não acompanha o backup.
    expect(restored.settings.parental).toEqual({ enabled: false, hideAdult: true, lockedGroups: ['x'] });
  });

  it('protege por senha', async () => {
    const text = await createBackup(data, { platform: 'web', password: 'correta' });
    expect(text).not.toContain('provedor.example.org');
    expect(text).not.toContain('Canal Dois');
    const { envelope } = validateBackupEnvelope(text);
    await expect(openBackup(envelope!)).rejects.toMatchObject({ code: 'password-required' });
    await expect(openBackup(envelope!, 'errada')).rejects.toBeInstanceOf(BackupError);
    await expect(openBackup(envelope!, 'errada')).rejects.toMatchObject({ code: 'wrong-password' });
    const restored = await openBackup(envelope!, 'correta');
    expect(restored.playlists).toEqual(data.playlists);
  });

  it('sinaliza credenciais', () => {
    expect(backupHasCredentials(data)).toBe(true);
    expect(backupHasCredentials({ ...data, playlists: [data.playlists[0]!] })).toBe(false);
  });
});

describe('controle parental', () => {
  it('verifica o PIN sem armazená-lo', async () => {
    const hashed = await hashPin('1234');
    expect(hashed.pinHash).not.toContain('1234');
    const settings = { enabled: true, hideAdult: true, lockedGroups: [], ...hashed };
    expect(await verifyPin('1234', settings)).toBe(true);
    expect(await verifyPin('4321', settings)).toBe(false);
  });

  it('identifica e bloqueia categorias', () => {
    expect(isAdultLabel('Adultos +18')).toBe(true);
    expect(isAdultLabel('Canais XXX')).toBe(true);
    expect(isAdultLabel('Filmes | Ação')).toBe(false);
    expect(isAdultLabel('Esportes')).toBe(false);
    const settings = { enabled: true, hideAdult: true, lockedGroups: ['terror'] };
    const blocked = createRestriction(settings, false)!;
    expect(blocked({ name: 'a', group: 'Adultos' })).toBe(true);
    expect(blocked({ name: 'a', group: 'Terror' })).toBe(true);
    expect(blocked({ name: 'a', group: 'Infantil' })).toBe(false);
    expect(createRestriction(settings, true)).toBeNull();
    expect(createRestriction({ ...settings, enabled: false }, false)).toBeNull();
  });
});

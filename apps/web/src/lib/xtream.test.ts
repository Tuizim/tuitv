import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Playlist } from '@tuitv/shared-models';
import { xtreamPlaylistUrl } from '@tuitv/validation';
import { buildLibrary } from './library';
import { ImportError } from './net';
import { NoXtreamApi, connect, itemFromId, remoteSeriesId, seriesEpisodes, seriesList, streams } from './xtream';

const login = { host: 'http://srv.example:8080', username: 'joão', password: 's&nha' };
const PARENTAL = { enabled: false, hideAdult: true, lockedGroups: [] };

/** Responde cada action do player_api.php com o corpo indicado. */
function serve(routes: Record<string, unknown>, status = 200) {
  const calls: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);
      calls.push(url);
      const action = url.searchParams.get('action') ?? '';
      const body = action in routes ? routes[action] : '[]';
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('login Xtream consultado sob demanda', () => {
  it('conecta: valida a conta e lê só as categorias', async () => {
    const calls = serve({
      '': { user_info: { auth: 1, status: 'Active', exp_date: '1893499200', max_connections: '2' } },
      get_live_categories: [{ category_id: 1, category_name: 'Abertos' }, { category_id: '1', category_name: 'Repetida' }],
      get_vod_categories: {}, // alguns servidores respondem {} no lugar de []
      get_series_categories: null,
    });
    const { account, categories } = await connect(login, 10);
    expect(account).toEqual({ status: 'Active', expiresAt: 1893499200000, maxConnections: 2, categories: { live: 1, movie: 0, series: 0 } });
    expect(categories.live).toEqual([{ id: '1', name: 'Abertos' }]);
    expect(calls.map((c) => c.searchParams.get('action') ?? '')).toEqual(['', 'get_live_categories', 'get_vod_categories', 'get_series_categories']);
    // Credenciais vão codificadas na consulta.
    expect(calls[0]!.searchParams.get('username')).toBe('joão');
    expect(calls[0]!.searchParams.get('password')).toBe('s&nha');
  });

  it('recusa usuário ou senha e conta inativa; sem API, pede a lista M3U', async () => {
    serve({ '': { user_info: { auth: 0 } } });
    await expect(connect(login, 10)).rejects.toMatchObject({ code: 'login-invalid' });
    serve({ '': { user_info: { auth: 1, status: 'Expired' } } });
    await expect(connect(login, 10)).rejects.toMatchObject({ code: 'account-inactive', detail: 'Expired' });
    serve({ '': '<html>404</html>' });
    await expect(connect(login, 10)).rejects.toBeInstanceOf(NoXtreamApi);
    serve({}, 404);
    await expect(connect(login, 10)).rejects.toBeInstanceOf(NoXtreamApi);
    serve({}, 500);
    await expect(connect(login, 10)).rejects.toBeInstanceOf(ImportError);
  });

  it('canais e filmes de uma categoria viram itens com ids estáveis e endereços de reprodução', async () => {
    const calls = serve({
      get_live_streams: [
        { stream_id: 11, name: ' Canal Um ', stream_icon: 'https://img.example/um.png', epg_channel_id: 'canal.um', category_id: '1' },
        { stream_id: 'x', name: 'Inválido' },
        { name: 'Sem id' },
      ],
      get_vod_streams: [{ stream_id: '501', name: 'Corrida Final (2022)', container_extension: 'mkv', stream_icon: 'javascript:alert(1)', category_id: '10' }],
    });
    const live = await streams('pl1', login, 'live', new Map([['1', 'Abertos']]), '1', 10);
    expect(calls[0]!.searchParams.get('category_id')).toBe('1');
    expect(live).toEqual([
      {
        id: 'pl1:x:l:11',
        playlistId: 'pl1',
        key: 'x:l:11',
        kind: 'live',
        name: 'Canal Um',
        url: 'http://srv.example:8080/live/jo%C3%A3o/s%26nha/11.ts',
        logo: 'https://img.example/um.png',
        group: 'Abertos',
        tvgId: 'canal.um',
        order: 0,
      },
    ]);
    const [movie] = await streams('pl1', login, 'movie', new Map([['10', 'Ação']]), undefined, 10);
    expect(movie).toMatchObject({ id: 'pl1:x:m:501.mkv', url: 'http://srv.example:8080/movie/jo%C3%A3o/s%26nha/501.mkv', year: 2022, group: 'Ação' });
    expect(movie!.logo).toBeUndefined(); // endereço de imagem inseguro descartado
  });

  it('séries chegam sem episódios; os episódios vêm ao abrir a série', async () => {
    serve({
      get_series: [{ series_id: 77, name: 'Vale Escuro', cover: 'https://img.example/v.jpg', releaseDate: '2021-03-01', category_id: '20' }],
      get_series_info: {
        info: { name: 'Vale Escuro', plot: 'Segredos.' },
        // formato em lista de listas (alguns painéis)
        episodes: [
          [
            { id: '7002', episode_num: '2', title: 'Neblina', container_extension: 'mp4', season: '1', info: {} },
            { id: '7001', episode_num: 1, title: 'Chegada', container_extension: 'mp4', season: 1, info: { duration_secs: '2400' } },
          ],
          [{ id: '7101', episode_num: 1, title: '', container_extension: 'mkv', season: 2 }],
        ],
      },
    });
    const names = new Map([['20', 'Drama']]);
    const [stub] = await seriesList('pl1', login, names, '20', 10);
    expect(stub).toEqual({ id: 'pl1:s:x77', playlistId: 'pl1', title: 'Vale Escuro', logo: 'https://img.example/v.jpg', group: 'Drama', year: 2021, seasons: [], episodeCount: 0 });
    expect(remoteSeriesId('pl1', stub!.id)).toBe('77');
    expect(remoteSeriesId('pl1', 'pl1:s:abc')).toBeUndefined();

    const full = await seriesEpisodes('pl1', login, '77', stub, names, 10);
    expect(full.id).toBe('pl1:s:x77');
    expect(full.episodeCount).toBe(3);
    expect(full.seasons.map((s) => s.season)).toEqual([1, 2]);
    expect(full.seasons[0]!.episodes.map((e) => e.name)).toEqual(['Chegada', 'Neblina']);
    expect(full.seasons[0]!.episodes[0]).toMatchObject({
      id: 'pl1:x:e:77:7001.mp4',
      url: 'http://srv.example:8080/series/jo%C3%A3o/s%26nha/7001.mp4',
      duration: 2400,
      series: { title: 'Vale Escuro', seriesKey: 'x77', season: 1, episode: 1 },
    });
    expect(full.seasons[1]!.episodes[0]!.name).toBe('T2 E1');
  });

  it('reconstrói favoritos e histórico pelo id, sem consultar o servidor', () => {
    const playlist: Playlist = {
      id: 'pl1',
      name: 'Provedor',
      source: 'url',
      url: xtreamPlaylistUrl(login),
      provider: 'xtream',
      active: true,
      createdAt: 0,
      updatedAt: 0,
      itemCount: 0,
      counts: { live: 0, movie: 0, series: 0 },
    };
    expect(itemFromId(playlist, 'pl1:x:l:11', { name: 'Canal Um' })).toMatchObject({ kind: 'live', name: 'Canal Um', url: 'http://srv.example:8080/live/jo%C3%A3o/s%26nha/11.ts' });
    expect(itemFromId(playlist, 'pl1:x:m:501.mkv', { name: 'Filme' })?.url).toBe('http://srv.example:8080/movie/jo%C3%A3o/s%26nha/501.mkv');
    expect(itemFromId(playlist, 'pl1:x:e:77:7001.mp4', { name: 'Ep' })).toMatchObject({ kind: 'series', series: { seriesKey: 'x77' } });
    expect(itemFromId(playlist, 'pl1:x:m:501.<script>', { name: 'x' })).toBeUndefined();
    expect(itemFromId(playlist, 'outra:x:l:11', { name: 'x' })).toBeUndefined();
  });
});

describe('biblioteca com conteúdo de login', () => {
  const movie = (id: string, group: string) => ({ id, playlistId: 'pl1', key: id, kind: 'movie' as const, name: id, url: 'http://x/y.mp4', group, order: 0 });

  it('lista as categorias do servidor (inclusive as não carregadas) e aplica o controle parental', () => {
    const lib = buildLibrary(
      [movie('local', 'Locais')],
      { enabled: true, hideAdult: true, lockedGroups: [] },
      false,
      {
        items: [movie('remoto', 'Ação')],
        series: [{ id: 'pl1:s:x1', playlistId: 'pl1', title: 'Adulta', group: 'Adultos XXX', seasons: [], episodeCount: 0 }],
        groups: { live: [], movie: ['Ação', 'Drama', 'Adultos XXX'], series: ['Adultos XXX'] },
      },
    );
    expect(lib.movieGroups).toEqual([
      { name: 'Ação', count: 1 },
      { name: 'Drama', count: 0 },
      { name: 'Locais', count: 1 },
    ]);
    expect(lib.byId.has('remoto')).toBe(true);
    expect(lib.series).toEqual([]);
    expect(lib.seriesGroups).toEqual([]);
    expect(lib.allGroups).toContain('Adultos XXX');
  });

  it('sem login, a biblioteca é a mesma de antes', () => {
    const lib = buildLibrary([movie('a', 'G1'), movie('b', 'G1')], PARENTAL, false);
    expect(lib.movieGroups).toEqual([{ name: 'G1', count: 2 }]);
  });
});

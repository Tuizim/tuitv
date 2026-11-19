// Servidor de apoio aos testes: entrega os arquivos de referência como se fossem fontes remotas.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const fixtures = new URL('../../packages/m3u-parser/fixtures/', import.meta.url);
const pad = (n) => String(n).padStart(2, '0');
const stamp = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00 +0000`;
};

function epg() {
  const hour = 3_600_000;
  const base = Math.floor(Date.now() / hour) * hour;
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n<channel id="canal.um"><display-name>Canal Um HD</display-name></channel>\n<channel id="sem.id"><display-name>Notícias 24h</display-name></channel>\n';
  for (let i = -2; i < 12; i++) {
    xml += `<programme start="${stamp(base + i * hour)}" stop="${stamp(base + (i + 1) * hour)}" channel="canal.um"><title>Programa ${i + 3}</title><desc>Descrição do programa ${i + 3}.</desc></programme>\n`;
    xml += `<programme start="${stamp(base + i * hour)}" stop="${stamp(base + (i + 1) * hour)}" channel="sem.id"><title>Jornal ${i + 3}</title></programme>\n`;
  }
  return `${xml}</tv>\n`;
}

function big(count) {
  const lines = ['#EXTM3U'];
  for (let i = 0; i < count; i++) {
    lines.push(`#EXTINF:-1 tvg-id="c${i}" group-title="Grupo ${i % 40}",Canal Grande ${i}`, `https://stream.invalid/${i}/index.m3u8`);
  }
  return lines.join('\n');
}

/** Catálogo de filmes com várias categorias cheias (memória das telas ao voltar de um título). */
function catalog(perGroup) {
  const lines = ['#EXTM3U'];
  for (const group of ['Ação', 'Comédia', 'Drama', 'Terror']) {
    for (let i = 1; i <= perGroup; i++) {
      lines.push(`#EXTINF:-1 group-title="Filmes | ${group}",${group} ${i} (2020)`, `http://vod.invalid/movie/u/p/${group}-${i}.mp4`);
    }
  }
  return lines.join('\n');
}

/**
 * Provedor Xtream Codes simulado (usuário "joão", senha "s&nha"): mesmos canais de basic.m3u,
 * mais filmes e uma série, servidos pela API player_api.php por categoria.
 */
const XT = {
  live_categories: [
    { category_id: '1', category_name: 'Abertos', parent_id: 0 },
    { category_id: '2', category_name: 'Esportes', parent_id: 0 },
    { category_id: '3', category_name: 'Notícias', parent_id: 0 },
  ],
  live: [
    { num: 1, name: 'Canal Um HD', stream_type: 'live', stream_id: 11, stream_icon: 'https://example.org/logos/um.png', epg_channel_id: 'canal.um', category_id: '1' },
    { num: 2, name: 'Canal Dois', stream_type: 'live', stream_id: 12, stream_icon: 'https://example.org/logos/dois.png', epg_channel_id: 'canal.dois', category_id: '1' },
    { num: 3, name: 'Canal Um SD', stream_type: 'live', stream_id: 13, stream_icon: '', epg_channel_id: 'canal.um', category_id: '1' },
    { num: 4, name: 'Esporte 1', stream_type: 'live', stream_id: 21, stream_icon: '', epg_channel_id: 'esporte.1', category_id: '2' },
    { num: 5, name: 'Notícias 24h', stream_type: 'live', stream_id: 31, stream_icon: '', epg_channel_id: null, category_id: '3' },
  ],
  vod_categories: [
    { category_id: '10', category_name: 'Filmes | Ação', parent_id: 0 },
    { category_id: '11', category_name: 'Filmes | Drama', parent_id: 0 },
  ],
  vod: [
    { num: 1, name: 'Corrida Final (2022)', stream_type: 'movie', stream_id: 501, stream_icon: '', container_extension: 'mp4', category_id: '10' },
    { num: 2, name: 'Drama na Serra', stream_type: 'movie', stream_id: 502, stream_icon: '', container_extension: 'mkv', category_id: '11' },
  ],
  series_categories: [{ category_id: '20', category_name: 'Séries | Drama', parent_id: 0 }],
  series: [{ num: 1, name: 'Vale Escuro', series_id: 77, cover: '', plot: 'Uma cidade e seus segredos.', genre: 'Drama', releaseDate: '2021-03-01', category_id: '20' }],
  series_info: {
    info: { name: 'Vale Escuro', plot: 'Uma cidade e seus segredos.', genre: 'Drama', category_id: '20' },
    episodes: {
      1: [
        { id: '7001', episode_num: 1, title: 'Vale Escuro - S01E01 - Chegada', container_extension: 'mp4', season: 1, info: { duration_secs: 2400, plot: 'Uma família chega ao vale.', movie_image: 'http://127.0.0.1:4801/thumb-7001.png' } },
        { id: '7002', episode_num: 2, title: 'Vale Escuro - S01E02 - Neblina', container_extension: 'mp4', season: 1, info: {} },
      ],
      2: [{ id: '7101', episode_num: 1, title: 'Vale Escuro - S02E01 - Retorno', container_extension: 'mkv', season: 2, info: {} }],
    },
  },
};

function xtream(query) {
  if (query.get('username') !== 'joão' || query.get('password') !== 's&nha') return { user_info: { auth: 0 } };
  const action = query.get('action') ?? '';
  const cat = query.get('category_id');
  const byCat = (list) => (cat ? list.filter((s) => s.category_id === cat) : list);
  switch (action) {
    case '':
      return {
        user_info: { username: 'joão', auth: 1, status: 'Active', exp_date: '1893499200', max_connections: '2' },
        server_info: { url: '127.0.0.1', port: '4801', server_protocol: 'http' },
      };
    case 'get_live_categories':
      return XT.live_categories;
    case 'get_live_streams':
      return byCat(XT.live);
    case 'get_vod_categories':
      return XT.vod_categories;
    case 'get_vod_streams':
      return byCat(XT.vod);
    case 'get_series_categories':
      return XT.series_categories;
    case 'get_series':
      return byCat(XT.series);
    case 'get_series_info':
      return query.get('series_id') === '77' ? XT.series_info : { info: [], episodes: [] };
    case 'get_vod_info':
      return { info: query.get('vod_id') === '501' ? { plot: 'Perseguição pela cidade.', genre: 'Ação' } : [] };
    default:
      return [];
  }
}

createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const cors = { 'access-control-allow-origin': '*' };
  try {
    // Miniatura de episódio (PNG 16x9 de uma cor só).
    if (path === '/thumb-7001.png') {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVR4nGMwDl1FEmIY1RA6GEIJAAkFrCHNUOOhAAAAAElFTkSuQmCC',
        'base64',
      );
      return res.writeHead(200, { ...cors, 'content-type': 'image/png' }).end(png);
    }
    if (path === '/xt.m3u') {
      const host = 'http://127.0.0.1:4801';
      return res.writeHead(200, cors).end(
        `#EXTM3U\n#EXTINF:-1 group-title="Filmes | Drama",Filme do Servidor (2020)\n${host}/movie/u/p/101.mp4\n#EXTINF:-1 group-title="Filmes | Drama",Filme Sem Dados\n${host}/movie/u/p/102.mp4\n#EXTINF:-1 group-title="Séries | Drama",Minha Série S01E01\n${host}/series/u/p/201.mp4\n`,
      );
    }
    if (path === '/player_api.php') {
      const query = new URL(req.url, 'http://x').searchParams;
      const json = (body) => res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(body));
      if (query.get('username') === 'joão') return json(xtream(query));
      if (query.get('username') !== 'u' || query.get('password') !== 'p') return json({ user_info: { auth: 0 } });
      if (query.get('action') === 'get_vod_info' && query.get('vod_id') === '101') {
        return json({ info: { plot: 'Sinopse vinda do servidor da lista.', genre: 'Drama', cast: 'Ana Souza, Rui Lima', director: 'Lia Prado', rating: '7.8', releasedate: '2020-05-01' } });
      }
      if (query.get('action') === 'get_vod_info') return json({ info: [] });
      if (query.get('action') === 'get_series') return json([{ series_id: 9, name: 'Minha Série (2021)', plot: 'Sinopse da série.', genre: 'Drama', rating: '8' }]);
      return json({});
    }
    // Login Xtream Codes (host, usuário e senha): usuário "joão", senha "s&nha".
    // Em /semapi o servidor não oferece player_api.php: o TuiTV volta a importar a lista M3U (get.php).
    if (path === '/semapi/get.php') {
      const query = new URL(req.url, 'http://x').searchParams;
      if (query.get('username') !== 'joão' || query.get('password') !== 's&nha') return res.writeHead(401, cors).end();
      return res.writeHead(200, cors).end(readFileSync(new URL('basic.m3u', fixtures), 'utf8').replace(/^#EXTM3U[^\n]*/, '#EXTM3U'));
    }
    if (path === '/get.php' || path === '/xmltv.php') {
      const query = new URL(req.url, 'http://x').searchParams;
      if (query.get('username') !== 'joão' || query.get('password') !== 's&nha') return res.writeHead(401, cors).end();
      if (path === '/xmltv.php') return res.writeHead(200, { ...cors, 'content-type': 'text/xml' }).end(epg());
      if (query.get('type') !== 'm3u_plus') return res.writeHead(400, cors).end();
      // Sem url-tvg no cabeçalho: o guia vem do xmltv.php do mesmo login.
      return res.writeHead(200, cors).end(readFileSync(new URL('basic.m3u', fixtures), 'utf8').replace(/^#EXTM3U[^\n]*/, '#EXTM3U'));
    }
    if (path === '/epg.xml') return res.writeHead(200, { ...cors, 'content-type': 'text/xml' }).end(epg());
    if (path === '/big.m3u') return res.writeHead(200, cors).end(big(30000));
    if (path === '/catalog.m3u') return res.writeHead(200, cors).end(catalog(120));
    if (path === '/nocors.m3u') {
      const body = readFileSync(new URL('basic.m3u', fixtures));
      return res.writeHead(200).end(body);
    }
    if (path === '/html.m3u') return res.writeHead(200, cors).end('<!doctype html><html><body>Entrar</body></html>');
    if (/^\/[\w-]+\.m3u$/.test(path)) {
      const body = readFileSync(new URL(path.slice(1), fixtures));
      return res.writeHead(200, cors).end(body);
    }
  } catch {
    /* 404 abaixo */
  }
  res.writeHead(404, cors).end('não encontrado');
}).listen(4801, () => console.log('fixtures em http://127.0.0.1:4801'));

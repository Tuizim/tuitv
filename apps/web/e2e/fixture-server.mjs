// Servidor de apoio aos testes: entrega os arquivos de referência como se fossem fontes remotas.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const fixtures = new URL('../../../packages/m3u-parser/fixtures/', import.meta.url);
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

createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const cors = { 'access-control-allow-origin': '*' };
  try {
    if (path === '/xt.m3u') {
      const host = 'http://127.0.0.1:4801';
      return res.writeHead(200, cors).end(
        `#EXTM3U\n#EXTINF:-1 group-title="Filmes | Drama",Filme do Servidor (2020)\n${host}/movie/u/p/101.mp4\n#EXTINF:-1 group-title="Filmes | Drama",Filme Sem Dados\n${host}/movie/u/p/102.mp4\n#EXTINF:-1 group-title="Séries | Drama",Minha Série S01E01\n${host}/series/u/p/201.mp4\n`,
      );
    }
    if (path === '/player_api.php') {
      const query = new URL(req.url, 'http://x').searchParams;
      const json = (body) => res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(body));
      if (query.get('username') !== 'u' || query.get('password') !== 'p') return json({ user_info: { auth: 0 } });
      if (query.get('action') === 'get_vod_info' && query.get('vod_id') === '101') {
        return json({ info: { plot: 'Sinopse vinda do servidor da lista.', genre: 'Drama', cast: 'Ana Souza, Rui Lima', director: 'Lia Prado', rating: '7.8', releasedate: '2020-05-01' } });
      }
      if (query.get('action') === 'get_vod_info') return json({ info: [] });
      if (query.get('action') === 'get_series') return json([{ series_id: 9, name: 'Minha Série (2021)', plot: 'Sinopse da série.', genre: 'Drama', rating: '8' }]);
      return json({});
    }
    // Login Xtream Codes (host, usuário e senha): usuário "joão", senha "s&nha".
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

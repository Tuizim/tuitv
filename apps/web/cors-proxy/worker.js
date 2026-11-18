/**
 * Proxy de CORS do TuiTV Web (Cloudflare Worker).
 *
 * O navegador bloqueia listas, guias e a API Xtream de servidores que não enviam cabeçalhos de CORS
 * (e servidores http numa página https). O app tenta direto e, se falhar, pede por aqui:
 *   GET https://<proxy>/?url=<endereço codificado>
 *
 * Local:     npx wrangler dev cors-proxy/worker.js            (http://localhost:8787)
 * Publicar:  npx wrangler deploy cors-proxy/worker.js --name tuitv-cors
 * Restringir quem usa: variável ALLOWED_ORIGINS (ex.: "https://tuitv.app,http://localhost:3000").
 * Endereços nunca são registrados em logs (contêm usuário e senha Xtream).
 */
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$|\[?f[cd])/i;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(origin)) return new Response('Origem não permitida', { status: 403 });

    const cors = {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Type',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return new Response('Método não permitido', { status: 405, headers: cors });

    let target;
    try {
      target = new URL(new URL(request.url).searchParams.get('url') ?? '');
    } catch {
      return new Response('Parâmetro url inválido', { status: 400, headers: cors });
    }
    if (!/^https?:$/.test(target.protocol) || PRIVATE_HOST.test(target.hostname)) {
      return new Response('Endereço não permitido', { status: 400, headers: cors });
    }

    let upstream;
    try {
      upstream = await fetch(target, { headers: { 'User-Agent': 'TuiTV' }, redirect: 'follow' });
    } catch {
      return new Response('Servidor de origem inacessível', { status: 502, headers: cors });
    }
    const headers = new Headers(cors);
    const type = upstream.headers.get('Content-Type');
    if (type) headers.set('Content-Type', type);
    // O corpo chega já descompactado: o tamanho só vale se a origem não compactou.
    const length = upstream.headers.get('Content-Length');
    if (length && !upstream.headers.get('Content-Encoding')) headers.set('Content-Length', length);
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

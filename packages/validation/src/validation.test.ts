import { describe, expect, it } from 'vitest';
import {
  hasCredentials,
  isPrivateHost,
  maskUrl,
  normalizeXtreamHost,
  parseXtreamUrl,
  safeImageUrl,
  validateBackupEnvelope,
  validateRemoteUrl,
  xtreamEpgUrl,
  xtreamPlaylistUrl,
} from './index';

describe('validateRemoteUrl', () => {
  it('aceita http/https públicos', () => {
    expect(validateRemoteUrl(' https://example.org/lista.m3u ').ok).toBe(true);
    expect(validateRemoteUrl('http://example.org:8080/get.php?type=m3u').ok).toBe(true);
  });
  it('rejeita esquemas e formatos inválidos', () => {
    expect(validateRemoteUrl('').problem).toBe('empty');
    expect(validateRemoteUrl('lista.m3u').problem).toBe('malformed');
    expect(validateRemoteUrl('file:///etc/passwd').problem).toBe('scheme');
    expect(validateRemoteUrl('javascript:alert(1)').problem).toBe('scheme');
  });
  it('bloqueia endereços internos, salvo autorização', () => {
    for (const url of ['http://localhost/a', 'http://127.0.0.1/a', 'http://192.168.0.10/a', 'http://10.1.2.3/a', 'http://[::1]/a', 'http://169.254.169.254/latest', 'http://roteador/a', 'http://nas.local/a']) {
      expect(validateRemoteUrl(url).problem, url).toBe('private-host');
      expect(validateRemoteUrl(url, { allowPrivate: true }).ok, url).toBe(true);
    }
  });
});

describe('isPrivateHost', () => {
  it('distingue faixas públicas e privadas', () => {
    expect(isPrivateHost('172.16.0.1')).toBe(true);
    expect(isPrivateHost('172.32.0.1')).toBe(false);
    expect(isPrivateHost('8.8.8.8')).toBe(false);
    expect(isPrivateHost('fd00::1')).toBe(true);
    expect(isPrivateHost('2001:4860:4860::8888')).toBe(false);
    expect(isPrivateHost('::ffff:192.168.1.1')).toBe(true);
  });
});

describe('credenciais', () => {
  it('detecta e mascara credenciais', () => {
    const url = 'http://provedor.example.org:8080/get.php?username=joao&password=segredo&type=m3u_plus';
    expect(hasCredentials(url)).toBe(true);
    const masked = maskUrl(url);
    expect(masked).not.toContain('joao');
    expect(masked).not.toContain('segredo');
    expect(masked).toContain('type=m3u_plus');
    expect(hasCredentials('http://x.example.org/live/joao/segredo/12.ts')).toBe(true);
    expect(maskUrl('http://x.example.org/live/joao/segredo/12.ts')).toBe('http://x.example.org/live/•••/•••/12.ts');
    expect(maskUrl('https://user:pw@x.example.org/a')).toBe('https://•••@x.example.org/a');
    expect(maskUrl('http://x.example.org:8080/joao/segredo/12')).toBe('http://x.example.org:8080/•••/•••/12');
    expect(hasCredentials('http://x.example.org/joao/segredo/12.ts')).toBe(true);
    expect(hasCredentials('https://example.org/a/b/lista.m3u')).toBe(false);
    expect(hasCredentials('https://example.org/lista.m3u')).toBe(false);
  });
});

describe('safeImageUrl', () => {
  it('aceita apenas http(s) e data:image', () => {
    expect(safeImageUrl('https://a.b/c.png')).toBe('https://a.b/c.png');
    expect(safeImageUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeImageUrl('data:text/html;base64,AAAA')).toBeUndefined();
    expect(safeImageUrl('data:image/png;base64,AAAA')).toBeDefined();
  });
});

describe('validateBackupEnvelope', () => {
  const data = { playlists: [], favorites: [], history: [], epgSources: [], settings: {} };
  it('valida estrutura e versão', () => {
    expect(validateBackupEnvelope('não é json').problem).toBe('not-json');
    expect(validateBackupEnvelope('{"app":"outro"}').problem).toBe('not-tuitv');
    expect(validateBackupEnvelope(JSON.stringify({ app: 'tuitv', schemaVersion: 99, encrypted: false, data })).problem).toBe('newer-version');
    expect(validateBackupEnvelope(JSON.stringify({ app: 'tuitv', schemaVersion: 1, encrypted: false, data: { playlists: 'x' } })).problem).toBe('invalid-structure');
    expect(validateBackupEnvelope(JSON.stringify({ app: 'tuitv', schemaVersion: 1, encrypted: true })).problem).toBe('invalid-structure');
    expect(validateBackupEnvelope(JSON.stringify({ app: 'tuitv', schemaVersion: 1, encrypted: false, data })).ok).toBe(true);
  });
});

describe('login Xtream (host, usuário e senha)', () => {
  it('normaliza o host digitado', () => {
    expect(normalizeXtreamHost('servidor.example:8080')).toBe('http://servidor.example:8080');
    expect(normalizeXtreamHost(' https://servidor.example/ ')).toBe('https://servidor.example');
    expect(normalizeXtreamHost('http://servidor.example:8080/get.php?username=a&password=b')).toBe('http://servidor.example:8080');
    expect(normalizeXtreamHost('http://servidor.example/painel/player_api.php')).toBe('http://servidor.example/painel');
    expect(normalizeXtreamHost('HTTP://Servidor.Example:80')).toBe('http://servidor.example');
    expect(normalizeXtreamHost('')).toBeUndefined();
    expect(normalizeXtreamHost('ftp://servidor.example')).toBeUndefined();
    expect(normalizeXtreamHost('http://')).toBeUndefined();
  });
  it('monta os endereços da lista e do guia', () => {
    const login = { host: 'http://servidor.example:8080', username: ' joão ', password: 'a&b c/+' };
    expect(xtreamPlaylistUrl(login)).toBe(
      'http://servidor.example:8080/get.php?username=jo%C3%A3o&password=a%26b%20c%2F%2B&type=m3u_plus&output=ts',
    );
    expect(xtreamEpgUrl(login)).toBe('http://servidor.example:8080/xmltv.php?username=jo%C3%A3o&password=a%26b%20c%2F%2B');
    expect(hasCredentials(xtreamPlaylistUrl(login))).toBe(true);
    expect(maskUrl(xtreamPlaylistUrl(login))).not.toContain('jo%C3%A3o');
  });
  it('recupera o login de um endereço get.php', () => {
    const url = xtreamPlaylistUrl({ host: 'http://servidor.example:8080', username: 'joão', password: 'a&b' });
    expect(parseXtreamUrl(url)).toEqual({ host: 'http://servidor.example:8080', username: 'joão', password: 'a&b' });
    expect(parseXtreamUrl('http://servidor.example/lista.m3u')).toBeUndefined();
    expect(parseXtreamUrl('http://servidor.example/get.php?username=a')).toBeUndefined();
  });
});

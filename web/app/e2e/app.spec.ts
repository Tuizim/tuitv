import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const FIXTURES = 'http://127.0.0.1:4801';
const fixtureFile = (name: string) => resolve(__dirname, '../../packages/m3u-parser/fixtures', name);

/** Os testes usam um servidor local como "fonte remota"; por isso liberam endereços da rede local. */
async function allowLocalHosts(page: Page) {
  await page.goto('/settings/');
  await page.getByRole('switch', { name: 'Permitir endereços da rede local' }).click();
}

async function importByUrl(page: Page, file: string, name: string) {
  await page.goto('/playlists/');
  await page.getByRole('button', { name: 'Adicionar lista' }).click();
  await page.getByLabel('Nome').fill(name);
  await page.getByLabel('Endereço M3U/M3U8').fill(`${FIXTURES}/${file}`);
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
}

/**
 * Espera as gravações já iniciadas no armazenamento local: uma navegação completa (page.goto) logo depois
 * de um clique interromperia a gravação. Uma transação de leitura nos mesmos depósitos só começa depois delas.
 */
async function flushStorage(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('tuitv');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['favorites', 'kv', 'history'], 'readonly');
          tx.objectStore('favorites').count();
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

/** Seletor próprio do TuiTV (substitui o <select> nativo). */
async function choose(page: Page, label: string, option: RegExp) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option }).click();
}

async function search(page: Page, text: string) {
  await page.getByRole('search').getByRole('button', { name: 'Buscar' }).click();
  await page.getByRole('search').getByRole('searchbox').fill(text);
}

async function importByFile(page: Page, file: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Importar arquivo' }).click();
  await page.locator('input[type=file]').setInputFiles(fixtureFile(file));
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
}

test('primeiro acesso: boas-vindas sem cadastro nem login', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Boas-vindas ao TuiTV' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adicionar lista' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Importar arquivo' })).toBeVisible();
  await expect(page.locator('input[type=email], input[type=password]')).toHaveCount(0);
  // Menu principal na ordem do PRD.
  // Os nove destinos do PRD: cinco na barra superior e quatro no menu.
  await expect(page.getByRole('navigation', { name: 'Menu principal' }).first().getByRole('link')).toHaveText(['Início', 'TV ao vivo', 'Filmes', 'Séries', 'Favoritos']);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Histórico', 'Guia de programação', 'Minhas listas', 'Configurações']);
});

test('importa arquivo M3U, lista canais, favorita e persiste após recarregar', async ({ page }) => {
  await importByFile(page, 'basic.m3u');
  await expect(page.getByText('importada: 6 itens')).toBeVisible();
  await expect(page.getByTestId('hero')).toBeVisible();

  await page.goto('/live/');
  const list = page.getByTestId('channel-list');
  await expect(list.getByRole('button', { name: /Canal Um HD/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /Notícias 24h/ })).toBeVisible();

  // Categorias
  await choose(page, 'Categoria', /Esportes/);
  await expect(list.getByRole('button', { name: /Esporte 1/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /Canal Um HD/ })).toHaveCount(0);
  await choose(page, 'Categoria', /Todas as categorias/);

  // Filtro sem acentos
  await page.getByLabel('Filtrar canais').fill('noticias');
  await expect(list.getByRole('button', { name: /Notícias 24h/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /Canal Um HD/ })).toHaveCount(0);
  await page.getByLabel('Filtrar canais').fill('');

  // Seleciona um canal: o player aparece
  await list.getByRole('button', { name: /Canal Um HD/ }).click();
  await expect(page.getByTestId('player')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Canal Um HD' })).toBeVisible();

  // Favorita e recarrega: dados locais persistem (IndexedDB)
  await list.getByRole('button', { name: 'Adicionar aos favoritos' }).first().click();
  await page.reload();
  await page.goto('/favorites/');
  await expect(page.getByRole('link', { name: /Canal Um HD/ })).toBeVisible();
  // Último canal restaurado na TV ao vivo
  await page.goto('/live/');
  await expect(page.getByRole('heading', { name: 'Canal Um HD' })).toBeVisible();
});

test('importa por endereço, atualiza sem duplicar e preserva favoritos', async ({ page }) => {
  await allowLocalHosts(page);
  await importByUrl(page, 'basic.m3u', 'Remota');
  const card = page.getByTestId('playlist-card');
  await expect(card.getByRole('heading', { name: 'Remota' })).toBeVisible();
  await expect(card.getByText('Conteúdos').locator('..')).toContainText('6');

  await page.goto('/live/');
  await page.getByTestId('channel-list').getByRole('button', { name: 'Adicionar aos favoritos' }).nth(1).click();

  await page.goto('/playlists/');
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await expect(page.getByText('Lista “Remota” atualizada.')).toBeVisible();
  await expect(card.getByText('Conteúdos').locator('..')).toContainText('6');

  await page.goto('/favorites/');
  await expect(page.getByRole('link', { name: /Canal Dois/ })).toBeVisible();

  // Renomear, desativar e excluir
  await page.goto('/playlists/');
  await page.getByRole('button', { name: 'Renomear' }).click();
  await page.getByRole('textbox', { name: 'Nome' }).fill('Renomeada');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(card.getByRole('heading', { name: 'Renomeada' })).toBeVisible();
  await page.getByRole('switch', { name: 'Ativar ou desativar a lista' }).click();
  await page.goto('/live/');
  await expect(page.getByRole('heading', { name: 'Nenhum canal disponível' })).toBeVisible();
  await page.goto('/playlists/');
  await page.getByRole('button', { name: 'Excluir' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Excluir' }).click();
  await expect(page.getByRole('heading', { name: 'Nenhuma lista cadastrada' })).toBeVisible();
});

test('recusa endereços internos, conteúdo inválido e fontes sem CORS com mensagens claras', async ({ page }) => {
  await importByUrl(page, 'basic.m3u', 'Bloqueada');
  await expect(page.getByText('aponta para a rede local ou interna')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();

  await allowLocalHosts(page);
  await importByUrl(page, 'html.m3u', 'HTML');
  await expect(page.getByText('não é uma lista M3U/M3U8 válida')).toBeVisible();
  await page.getByLabel('Endereço M3U/M3U8').fill(`${FIXTURES}/nocors.m3u`);
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
  await expect(page.getByText('(CORS)')).toBeVisible();
  await page.getByLabel('Endereço M3U/M3U8').fill(`${FIXTURES}/nao-existe.m3u`);
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
  await expect(page.getByText('respondeu com erro (404)')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('heading', { name: 'Nenhuma lista cadastrada' })).toBeVisible();
});

/** Ações pedidas ao player_api.php do provedor simulado (ex.: "get_vod_streams:10"). */
function xtreamCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/player_api.php')) {
      const action = url.searchParams.get('action') ?? 'login';
      const category = url.searchParams.get('category_id');
      calls.push(category ? `${action}:${category}` : action);
    }
    if (url.pathname.endsWith('/get.php')) calls.push('get.php');
  });
  return calls;
}

async function addLogin(page: Page, password: string, host = '127.0.0.1:4801/') {
  await page.getByLabel('Host (servidor)').fill(host);
  await page.getByLabel('Usuário').fill('joão');
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
}

test('login (host, usuário e senha): conecta sem baixar a lista e oferece o guia do mesmo login', async ({ page }) => {
  await allowLocalHosts(page);
  const calls = xtreamCalls(page);
  await page.goto('/playlists/');
  await page.getByRole('button', { name: 'Adicionar lista' }).click();
  await page.getByRole('tab', { name: 'Login' }).click();
  await addLogin(page, 'errada');
  await expect(page.getByText('O servidor recusou o usuário ou a senha.')).toBeVisible();

  await page.getByLabel('Senha').fill('');
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
  await expect(page.getByText('Informe o host, o usuário e a senha.')).toBeVisible();

  await addLogin(page, 's&nha');
  await expect(page.getByText(/Conectado a “127.0.0.1”: 6 categorias/)).toBeVisible();
  const card = page.getByTestId('playlist-card');
  await expect(card.getByRole('heading', { name: '127.0.0.1' })).toBeVisible();
  await expect(card.getByText('Login: joão em http://127.0.0.1:4801')).toBeVisible();
  await expect(card.getByText('Categorias de canais').locator('..')).toContainText('3');
  await expect(card.getByText('Vencimento').locator('..')).toContainText('2030');
  await expect(card.getByText('nada do catálogo fica guardado neste dispositivo')).toBeVisible();
  // Só a conta e as categorias foram pedidas: nenhum canal, filme ou a lista M3U inteira.
  expect(calls.filter((c) => c !== 'login' && !c.endsWith('_categories'))).toEqual([]);

  await page.goto('/guide/');
  await expect(page.getByText('Uma das suas listas indica um guia de programação')).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  // O diálogo abre com o endereço xmltv.php do mesmo login já preenchido.
  await page.getByRole('dialog').getByRole('button', { name: 'Importar', exact: true }).click();
  await expect(page.getByText('Guia de programação importado.')).toBeVisible();
  // A grade abre na primeira categoria (pedida ao servidor); "Todas" pede a lista completa de canais.
  await expect(page.getByText('2 canais com programação')).toBeVisible();
  await choose(page, 'Categoria', /Todas as categorias/);
  await expect(page.getByText('3 canais com programação')).toBeVisible();
  expect(calls.filter((c) => c === 'get.php')).toEqual([]);
});

test('login: categorias, séries e favoritos vêm do servidor sob demanda', async ({ page }) => {
  await allowLocalHosts(page);
  const calls = xtreamCalls(page);
  await page.goto('/playlists/');
  await page.getByRole('button', { name: 'Adicionar lista' }).click();
  await page.getByRole('tab', { name: 'Login' }).click();
  await addLogin(page, 's&nha');
  await expect(page.getByText(/Conectado a/)).toBeVisible();

  // Ao vivo: todos os canais numa consulta só; trocar de categoria não consulta de novo.
  await page.goto('/live/');
  const list = page.getByTestId('channel-list');
  await expect(list.getByRole('button', { name: /Canal Um HD/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /Esporte 1/ })).toHaveCount(0);
  await choose(page, 'Categoria', /Esportes/);
  await expect(list.getByRole('button', { name: /Esporte 1/ })).toBeVisible();
  expect(calls.filter((c) => c.startsWith('get_live_streams'))).toEqual(['get_live_streams']);

  // Filmes: uma fileira por categoria, todas da mesma consulta (uma por tipo, não uma por fileira).
  await page.goto('/movies/');
  await expect(page.getByRole('link', { name: /Corrida Final \(2022\)/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Drama na Serra/ })).toBeVisible();
  expect(calls.filter((c) => c.startsWith('get_vod_streams'))).toEqual(['get_vod_streams']);
  await page.getByRole('link', { name: /Corrida Final/ }).click();
  await expect(page.getByText('Perseguição pela cidade.')).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar aos favoritos' }).click();
  await flushStorage(page);

  // Série: episódios pedidos ao abrir a série.
  await page.goto('/series/');
  await page.getByRole('link', { name: /Vale Escuro/ }).click();
  await expect(page.getByRole('heading', { name: 'Vale Escuro' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Temporada 2' })).toBeVisible();
  // Cartões de episódio como na Netflix: título próprio (sem o nome da série), duração, sinopse e miniatura.
  await expect(page.getByRole('link', { name: '2. Neblina' })).toBeVisible();
  const first = page.getByRole('link', { name: '1. Chegada' });
  await expect(first).toContainText('40 min');
  await expect(first).toContainText('Uma família chega ao vale.');
  await expect(first.locator('img')).toHaveAttribute('src', /thumb-7001\.png/);
  await expect(page.getByTestId('series-page').getByTestId('ambient-backdrop')).toBeAttached();
  await expect(page.getByTestId('episodes')).toHaveAttribute('data-layout', 'cards');
  await page.screenshot({ path: 'test-results/serie-cartoes.png', fullPage: true });
  expect(calls).toContain('get_series_info');
  await page.getByRole('button', { name: 'Adicionar aos favoritos' }).click();
  await flushStorage(page);

  // Depois de recarregar, os favoritos aparecem sem pedir as categorias de novo (nome e capa guardados).
  calls.length = 0;
  await page.goto('/favorites/');
  await expect(page.getByRole('link', { name: /Corrida Final/ })).toBeVisible();
  await page.getByRole('tab', { name: /Séries/ }).click();
  await expect(page.getByRole('link', { name: /Vale Escuro/ })).toBeVisible();
  expect(calls.filter((c) => !c.endsWith('_categories') && c !== 'login')).toEqual([]);

  // Busca: o catálogo de cada tipo é pedido uma vez e filtrado no aparelho.
  await search(page, 'serra');
  await expect(page.getByRole('link', { name: /Drama na Serra/ })).toBeVisible();
  expect(calls).toEqual(expect.arrayContaining(['get_live_streams', 'get_vod_streams', 'get_series']));
  expect(calls.filter((c) => c === 'get.php')).toEqual([]);
});

test('login sem a API do servidor (player_api.php): importa a lista M3U do mesmo login', async ({ page }) => {
  await allowLocalHosts(page);
  await page.goto('/playlists/');
  await page.getByRole('button', { name: 'Adicionar lista' }).click();
  await page.getByRole('tab', { name: 'Login' }).click();
  await addLogin(page, 's&nha', '127.0.0.1:4801/semapi');
  await expect(page.getByText('importada: 6 itens')).toBeVisible();
  await expect(page.getByTestId('playlist-card').getByText('Conteúdos').locator('..')).toContainText('6');
});

test('registros incompletos não interrompem a importação', async ({ page }) => {
  await importByFile(page, 'incomplete.m3u');
  await expect(page.getByText('importada: 5 itens')).toBeVisible();
  await page.goto('/playlists/');
  await expect(page.getByText('5 registros inválidos ignorados')).toBeVisible();
});

test('filmes, séries, temporadas, episódios assistidos e busca global', async ({ page }) => {
  await importByFile(page, 'vod.m3u');
  await expect(page.getByText('importada: 13 itens')).toBeVisible();

  await page.goto('/movies/');
  await expect(page.getByRole('link', { name: /O Grande Filme \(2019\)/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Planeta Azul/ })).toBeVisible();

  await page.goto('/series/');
  await page.getByRole('link', { name: /A Série/ }).click();
  await expect(page.getByRole('heading', { name: 'A Série' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Temporada 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Temporada 2' })).toBeVisible();
  await expect(page.getByRole('link', { name: '2. Episódio 2' })).toBeVisible();

  // Marca o primeiro episódio como assistido: o próximo a assistir passa a ser o E2.
  await page.getByRole('button', { name: 'Marcar como assistido' }).first().click();
  await expect(page.getByRole('link', { name: 'Assistir T1 E2' })).toBeVisible();
  // Lista sem miniatura nem sinopse por episódio: grade compacta, com o próximo episódio em destaque.
  await expect(page.getByTestId('episodes')).toHaveAttribute('data-layout', 'grid');
  await expect(page.getByRole('link', { name: '2. Episódio 2' })).toContainText('Próximo');
  await expect(page.getByRole('link', { name: '1. Episódio 1' })).toContainText('Assistido');
  await page.screenshot({ path: 'test-results/serie-grade.png', fullPage: true });
  await page.reload();
  await expect(page.getByRole('link', { name: 'Assistir T1 E2' })).toBeVisible();

  // Página de reprodução
  await page.getByRole('link', { name: '2. Episódio 2' }).click();
  await expect(page.getByTestId('player')).toBeVisible();
  await expect(page.getByText('Temporada 1 · Episódio 2').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Próximo episódio' })).toBeVisible();

  // Histórico: a série aparece uma única vez (não um item por episódio) e abrir continua
  // do episódio mais adiante já assistido — o E1 foi concluído, então segue para o E2.
  await page.goto('/history/');
  await page.getByRole('button', { name: 'Séries' }).click();
  await expect(page.getByRole('link', { name: /A Série/ })).toHaveCount(1);
  await expect(page.getByRole('link', { name: /S01E0/ })).toHaveCount(0);
  await page.getByRole('link', { name: /A Série/ }).click();
  await expect(page).toHaveURL(/\/watch\/?\?id=/);
  await expect(page.getByText('Temporada 1 · Episódio 2').first()).toBeVisible();

  // Início: "Continuar assistindo" também mostra a série uma única vez e continua do episódio mais adiante.
  await page.goto('/');
  const row = page.locator('section', { has: page.getByRole('heading', { name: 'Continuar assistindo' }) });
  await expect(row.getByRole('link', { name: /A Série/ })).toHaveCount(1);
  await expect(row.getByRole('link', { name: /S01E0/ })).toHaveCount(0);
  // Abrir o cartão leva à página da série (como os filmes levam à ficha), já com o botão no episódio certo.
  await row.getByRole('link', { name: /A Série/ }).click();
  await expect(page).toHaveURL(/\/series\/view\/?\?id=/);
  await expect(page.getByRole('link', { name: 'Assistir T1 E2' })).toBeVisible();

  // Busca global, sem acentos
  await search(page, 'serie');
  await expect(page.getByRole('heading', { name: 'Resultados para “serie”' })).toBeVisible();
  await expect(page.getByRole('link', { name: /A Série/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Categorias/ })).toBeVisible();
  await search(page, 'filme');
  await expect(page.getByRole('link', { name: /O Grande Filme/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Canal de Filmes 24h/ })).toBeVisible();
});

test('voltar de um filme reabre a categoria na mesma posição da rolagem', async ({ page }) => {
  await allowLocalHosts(page);
  await importByUrl(page, 'catalog.m3u', 'Catálogo');
  await expect(page.getByText('importada: 480 itens')).toBeVisible({ timeout: 20_000 });
  await page.goto('/movies/');
  await choose(page, 'Categoria', /^Filmes \| Terror/);
  await expect(page).toHaveURL(/\/movies\/\?g=Filmes\+%7C\+Terror$/);
  await expect(page.locator('main a[title="Terror 1 (2020)"]')).toBeVisible();

  // Desce bastante na grade (virtualizada) e abre um filme lá embaixo.
  await page.mouse.wheel(0, 3000);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(2000);
  // O cartão no meio da tela.
  const middle = () =>
    page.evaluate(() => {
      const links = [...document.querySelectorAll<HTMLAnchorElement>('main a[title^="Terror"]')];
      return links.find((a) => {
        const r = a.getBoundingClientRect();
        return r.top > window.innerHeight * 0.2 && r.bottom < window.innerHeight;
      })?.title;
    });
  await expect.poll(middle).toBeTruthy();
  const name = (await middle())!;
  const y = await page.evaluate(() => window.scrollY);
  await page.locator(`main a[title="${name}"]`).click();
  await expect(page.getByTestId('player')).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/movies\/\?g=Filmes\+%7C\+Terror$/);
  await expect(page.getByRole('button', { name: 'Categoria', exact: true })).toContainText('Terror');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y - 5);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(y + 5);
  await expect(page.locator(`main a[title="${name}"]`)).toBeInViewport();

  // Abrir a mesma tela pelo menu começa do topo.
  await page.getByRole('navigation', { name: 'Menu principal' }).first().getByRole('link', { name: 'Filmes' }).click();
  await expect(page).toHaveURL(/\/movies\/$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test('sinopse de filmes e séries vem do servidor da própria lista', async ({ page }) => {
  await allowLocalHosts(page);
  await importByUrl(page, 'xt.m3u', 'Servidor');
  await expect(page.getByTestId('playlist-card')).toBeVisible();

  await page.goto('/movies/');
  await page.getByRole('link', { name: /Filme do Servidor/ }).click();
  const synopsis = page.getByTestId('synopsis');
  await expect(synopsis).toContainText('Sinopse vinda do servidor da lista.');
  await expect(synopsis).toContainText('7.8');
  await expect(synopsis).toContainText('Ana Souza, Rui Lima');

  await page.goto('/movies/');
  await page.getByRole('link', { name: /Filme Sem Dados/ }).click();
  await expect(page.getByTestId('synopsis')).toContainText('Esta lista não informa a sinopse');

  await page.goto('/series/');
  await page.getByRole('link', { name: /Minha Série/ }).click();
  await expect(page.getByTestId('synopsis')).toContainText('Sinopse da série.');
});

test('guia XMLTV: importa por endereço e mostra o programa atual', async ({ page }) => {
  await allowLocalHosts(page);
  await importByUrl(page, 'basic.m3u', 'Com guia');
  await expect(page.getByTestId('playlist-card')).toBeVisible();

  await page.goto('/guide/');
  await page.getByRole('button', { name: 'Adicionar guia' }).click();
  await page.getByLabel('Endereço XMLTV').fill(`${FIXTURES}/epg.xml`);
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
  await expect(page.getByText('Guia de programação importado.')).toBeVisible();
  // Canal Um HD e SD (mesmo tvg-id) e Notícias 24h (associado pelo nome).
  await expect(page.getByText('3 canais com programação')).toBeVisible();
  const grid = page.getByTestId('epg-grid');
  await expect(grid.getByRole('button', { name: 'Programa 3' }).first()).toBeVisible();
  await grid.getByRole('button', { name: 'Programa 3' }).first().click();
  await expect(page.getByRole('dialog').getByText('Descrição do programa 3.')).toBeVisible();
  await page.getByRole('dialog').getByRole('link', { name: /Assistir Canal Um/ }).click();
  await expect(page.getByText('Agora')).toBeVisible();
  await expect(page.getByTestId('channel-list').getByText('Jornal 3')).toBeVisible();
});

test('backup protegido por senha: exporta, apaga tudo e restaura', async ({ page }) => {
  await importByFile(page, 'basic.m3u');
  await expect(page.getByText('importada: 6 itens')).toBeVisible();
  await page.goto('/live/');
  await page.getByTestId('channel-list').getByRole('button', { name: 'Adicionar aos favoritos' }).first().click();

  await page.goto('/settings/');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await page.getByLabel('Senha (recomendada)').fill('segredo-123');
  const downloading = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Exportar' }).click();
  const file = await (await downloading).path();

  await page.getByRole('button', { name: 'Excluir tudo' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Excluir tudo' }).click();
  await expect(page.getByText('Todos os dados locais foram excluídos.')).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Boas-vindas ao TuiTV' })).toBeVisible();

  await page.goto('/settings/');
  await page.getByTestId('backup-file').setInputFiles(file);
  await page.getByLabel('Senha do backup').fill('errada');
  await page.getByRole('dialog').getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.getByText('Senha incorreta.')).toBeVisible();
  await page.getByLabel('Senha do backup').fill('segredo-123');
  await page.getByRole('dialog').getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.getByText('Backup restaurado: 1 listas.')).toBeVisible();

  await page.goto('/favorites/');
  await expect(page.getByRole('link', { name: /Canal Um HD/ })).toBeVisible();
});

test('controle parental oculta categorias até o PIN ser informado', async ({ page }) => {
  await importByFile(page, 'basic.m3u');
  await expect(page.getByText('importada: 6 itens')).toBeVisible();
  await page.goto('/settings/');
  await page.getByRole('button', { name: 'Definir PIN' }).click();
  await page.getByLabel('Novo PIN').fill('1234');
  await page.getByLabel('Repita o PIN').fill('1234');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.getByLabel('Esportes').check();
  await flushStorage(page);

  // Nova sessão: o conteúdo volta bloqueado.
  await page.goto('/live/');
  await expect(page.getByTestId('channel-list').getByRole('button', { name: /Canal Um HD/ })).toBeVisible();
  await expect(page.getByTestId('channel-list').getByRole('button', { name: /Esporte 1/ })).toHaveCount(0);
  await search(page, 'esporte');
  await expect(page.getByRole('heading', { name: /Nenhum resultado/ })).toBeVisible();

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Desbloquear conteúdo restrito' }).click();
  await page.getByLabel('Digite o PIN').fill('0000');
  await page.getByRole('button', { name: 'Desbloquear', exact: true }).click();
  await expect(page.getByText('PIN incorreto.')).toBeVisible();
  await page.getByLabel('Digite o PIN').fill('1234');
  await page.getByRole('button', { name: 'Desbloquear', exact: true }).click();
  await expect(page.getByRole('link', { name: /Esporte 1/ })).toBeVisible();
});

test('lista extensa: importa 30 mil canais com progresso e busca dentro da meta', async ({ page }) => {
  await allowLocalHosts(page);
  await importByUrl(page, 'big.m3u', 'Grande');
  await expect(page.getByText('importada: 30000 itens')).toBeVisible({ timeout: 45_000 });
  await page.goto('/live/');
  await expect(page.getByTestId('channel-list').getByRole('button', { name: /Canal Grande 0 Grupo 0/ })).toBeVisible();
  // Apenas as linhas visíveis existem no DOM.
  expect(await page.getByTestId('channel-list').getByRole('button', { name: /Canal Grande/ }).count()).toBeLessThan(80);
  const started = Date.now();
  await search(page, 'grande 29999');
  await expect(page.getByRole('link', { name: /Canal Grande 29999/ })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(2500); // inclui 250 ms de espera de digitação e a navegação
});

test('PWA e privacidade: manifesto, service worker, uso offline e nenhuma requisição externa', async ({ page, context }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== 'http://localhost:4800' && url.protocol !== 'data:' && url.protocol !== 'blob:') external.push(request.url());
  });
  await importByFile(page, 'basic.m3u');
  await expect(page.getByText('importada: 6 itens')).toBeVisible();
  for (const path of ['/movies/', '/series/', '/favorites/', '/history/', '/playlists/', '/settings/']) await page.goto(path);
  // Logotipos das listas são as únicas origens externas tocadas; nenhum serviço de terceiros ou do TuiTV.
  expect(external.filter((u) => !u.startsWith('https://example.org/logos/'))).toEqual([]);

  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'TuiTV', display: 'standalone', theme_color: '#101827' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).some((k) => k.startsWith('tuitv-app-')))).toBe(true);
  await expect.poll(() => page.evaluate(async () => {
    const keys = await caches.keys();
    return (await (await caches.open(keys[0]!)).keys()).length;
  })).toBeGreaterThan(50);

  // Sem internet: abre, navega nas listas importadas, consulta configurações.
  await context.setOffline(true);
  await page.goto('/');
  await expect(page.getByTestId('hero')).toBeVisible();
  await page.goto('/live/');
  await expect(page.getByTestId('channel-list').getByRole('button', { name: /Canal Um HD/ })).toBeVisible();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Configurações' }).click();
  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
  await expect(page.getByText('Você está sem internet')).toBeVisible();
});

test('layout móvel: menu compacto inferior @mobile', async ({ page }) => {
  await importByFile(page, 'basic.m3u');
  await expect(page.getByText('importada: 6 itens')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Menu principal' }).last();
  await expect(nav.getByRole('link', { name: 'TV ao vivo' })).toBeVisible();
  await nav.getByRole('link', { name: 'TV ao vivo' }).click();
  await page.getByTestId('channel-list').getByRole('button', { name: /Canal Dois/ }).first().click();
  await expect(page.getByTestId('player')).toBeInViewport();
  await nav.getByRole('button', { name: 'Mais' }).click();
  await page.locator('[data-menu-sheet]').getByRole('menuitem', { name: 'Minhas listas' }).click();
  await expect(page.getByTestId('playlist-card')).toBeVisible();
  // Sem rolagem horizontal.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

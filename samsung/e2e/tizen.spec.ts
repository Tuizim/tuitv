import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const APP = new URL('../dist/index.html', import.meta.url).href;
const FIXTURES = 'http://127.0.0.1:4801';
const BACK = 10009;

/** API "tizen" mínima, como na TV: registra teclas pedidas e o encerramento do aplicativo. */
async function open(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__keys = [] as string[];
    w.__exited = false;
    w.tizen = {
      tvinputdevice: { registerKeyBatch: (keys: string[]) => (w.__keys as string[]).push(...keys), registerKey: () => undefined },
      application: { getCurrentApplication: () => ({ exit: () => (w.__exited = true) }) },
    };
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP);
  return errors;
}

/** Tecla do controle Samsung (código numérico, como o Tizen envia). */
async function remote(page: Page, keyCode: number) {
  await page.evaluate((code) => {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { keyCode: code, bubbles: true, cancelable: true } as KeyboardEventInit));
  }, keyCode);
}

const focused = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText?.trim() ?? document.activeElement?.getAttribute('aria-label') ?? '');

/** Move o foco com as setas até um elemento cujo texto contenha `text`. */
async function focusByArrows(page: Page, key: 'ArrowDown' | 'ArrowUp' | 'ArrowLeft' | 'ArrowRight', text: string, max = 15) {
  for (let i = 0; i < max; i++) {
    if ((await focused(page)).includes(text)) return;
    await page.keyboard.press(key);
  }
  throw new Error(`"${text}" não recebeu foco com ${key} (foco em: "${await focused(page)}")`);
}

test('abre a partir de file://, registra as teclas do controle e foca a interface', async ({ page }) => {
  const errors = await open(page);
  expect(page.url()).toMatch(/^file:\/\//);
  await expect(page.getByRole('heading', { name: 'Boas-vindas ao TuiTV' })).toBeVisible();
  await expect.poll(() => focused(page)).toContain('Adicionar lista');
  const keys = await page.evaluate(() => (window as unknown as { __keys: string[] }).__keys);
  expect(keys).toEqual(expect.arrayContaining(['MediaPlayPause', 'ChannelUp', 'ChannelDown', '0', '9']));
  expect(errors).toEqual([]);
});

test('marca: logotipo e gato carregam como na TV (política de segurança do Tizen bloqueia imagens "data:")', async ({ page }) => {
  // Cópia do index.html com a regra de imagens que o Tizen aplica sem política no config.xml (default-src *).
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  const html = readFileSync(`${dist}index.html`, 'utf8').replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="img-src *">');
  writeFileSync(`${dist}index-csp-tizen.html`, html);
  const blocked: string[] = [];
  page.on('console', (m) => m.text().includes('Content Security Policy') && blocked.push(m.text()));
  await page.goto(new URL('../dist/index-csp-tizen.html', import.meta.url).href);
  await expect(page.getByRole('heading', { name: 'Boas-vindas ao TuiTV' })).toBeVisible();
  await expect(page.locator('header img[data-brand="logo"]')).toBeVisible();
  const images = await page.locator('img[data-brand]').evaluateAll((imgs) =>
    (imgs as HTMLImageElement[]).map((img) => ({ brand: img.dataset.brand, loaded: img.complete && img.naturalWidth > 0, alt: img.alt, src: img.getAttribute('src'), ratio: img.getBoundingClientRect().width / img.getBoundingClientRect().height })),
  );
  expect(images.filter((i) => i.brand === 'logo').length).toBeGreaterThanOrEqual(2);
  for (const img of images) {
    // Arquivo do pacote (relativo ao index.html), carregado e sem texto alternativo no lugar da imagem.
    expect(img).toMatchObject({ loaded: true, alt: '' });
    expect(img.src).toMatch(/^\.\/brand\//);
    if (img.brand === 'logo') expect(img.ratio).toBeGreaterThan(3);
  }
  // Cabeçalho: logotipo em altura legível e nenhum "TuiTV" escrito no lugar dele.
  expect((await page.locator('header img[data-brand="logo"]').boundingBox())!.height).toBeGreaterThan(30);
  expect(await page.locator('header').getByRole('link', { name: 'TuiTV' }).innerText()).toBe('');
  expect(blocked).toEqual([]);
});

test('só com o controle: lista por login, canais, player, troca de canal e Voltar', async ({ page }) => {
  const errors = await open(page);

  // Liberar a rede local (o servidor de apoio roda em 127.0.0.1) pela tela de configurações.
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.getByRole('switch', { name: 'Permitir endereços da rede local' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('switch', { name: 'Permitir endereços da rede local' })).toHaveAttribute('aria-checked', 'true');

  // Voltar do controle: com a tela rolada, primeiro volta ao topo (como na Netflix); depois, à tela inicial.
  const welcome = page.getByRole('heading', { name: 'Boas-vindas ao TuiTV' });
  for (let i = 0; i < 2 && !(await welcome.isVisible()); i++) {
    await remote(page, BACK);
    await page.waitForTimeout(400);
  }
  await expect(page.getByRole('heading', { name: 'Boas-vindas ao TuiTV' })).toBeVisible();
  expect(new URL(page.url()).hash).toMatch(/^(#\/?)?$/);

  // OK em "Adicionar lista" → aba Login → host, usuário e senha → Importar.
  await page.getByRole('button', { name: 'Adicionar lista' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await focusByArrows(page, 'ArrowUp', 'Link M3U');
  await focusByArrows(page, 'ArrowRight', 'Login');
  await page.keyboard.press('Enter');
  // Abaixo das abas vem "Nome" (opcional) e depois o host.
  await page.keyboard.press('ArrowDown');
  await expect(dialog.getByLabel('Nome')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(dialog.getByLabel('Host (servidor)')).toBeFocused();
  await page.keyboard.type('127.0.0.1:4801');
  await page.keyboard.press('ArrowDown');
  await expect(dialog.getByLabel('Usuário')).toBeFocused();
  await page.keyboard.type('joão');
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByLabel('Senha')).toBeFocused();
  await page.keyboard.type('s&nha');
  await page.keyboard.press('Enter');
  // Login: conecta sem baixar a lista; os canais vêm do servidor por categoria.
  await expect(page.getByText(/Conectado a “127.0.0.1”: 6 categorias/)).toBeVisible();

  // TV ao vivo: o canal escolhido toca no player; Canal +/− do controle troca de canal.
  await page.evaluate(() => (location.hash = '#/live'));
  const list = page.getByTestId('channel-list');
  await list.getByRole('button', { name: /Canal Um HD/ }).focus();
  await page.keyboard.press('Enter');
  // Na TV, OK no canal abre o player em tela cheia.
  const player = page.getByTestId('tv-watch').getByTestId('player');
  await expect(player).toBeVisible();
  await player.focus();
  const heading = page.getByTestId('tv-watch').locator('p.text-3xl');
  const before = await heading.innerText();
  // ▼ no player ao vivo troca de canal (as teclas Canal +/− do controle são traduzidas para o mesmo).
  await page.keyboard.press('ArrowDown');
  await expect(heading).not.toHaveText(before);
  await remote(page, BACK);
  await expect(page.getByTestId('tv-watch')).toHaveCount(0);

  // Voltar do controle em telas internas volta à anterior; na tela inicial fecha o aplicativo.
  await page.evaluate(() => (location.hash = '#/favorites'));
  await expect(page.getByRole('heading', { name: 'Nenhum favorito ainda' })).toBeVisible();
  await remote(page, BACK);
  await expect(page).toHaveURL(/#\/live/);
  await page.evaluate(() => (location.hash = '#/'));
  await remote(page, BACK);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __exited: boolean }).__exited)).toBe(true);

  expect(errors).toEqual([]);
});

test('diálogos fecham com o Voltar do controle', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Adicionar lista' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await remote(page, BACK);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Continua no aplicativo (não fechou).
  expect(await page.evaluate(() => (window as unknown as { __exited: boolean }).__exited)).toBe(false);
});


test('capturas de tela para conferência visual (build/screenshots)', async ({ page }) => {
  const shot = (name: string) => page.screenshot({ path: new URL(`../build/screenshots/${name}.png`, import.meta.url).pathname });
  await open(page);
  await expect.poll(() => focused(page)).toContain('Adicionar lista');
  await shot('01-boas-vindas');
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.getByRole('switch', { name: 'Permitir endereços da rede local' }).click();
  await page.evaluate(() => (location.hash = '#/'));
  await page.getByRole('button', { name: 'Adicionar lista' }).click();
  await page.getByRole('tab', { name: 'Login' }).click();
  await page.getByLabel('Host (servidor)').fill('127.0.0.1:4801');
  await page.getByLabel('Usuário').fill('joão');
  await page.getByLabel('Senha').fill('s&nha');
  await page.getByLabel('Senha').focus();
  await shot('02-adicionar-por-login');
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
  // Login: conecta sem baixar a lista; os canais vêm do servidor por categoria.
  await expect(page.getByText(/Conectado a “127.0.0.1”: 6 categorias/)).toBeVisible();
  await page.evaluate(() => (location.hash = '#/'));
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(400);
  await shot('03-inicio');
  await page.evaluate(() => (location.hash = '#/live'));
  await page.getByTestId('channel-list').getByRole('button', { name: /Canal Dois/ }).first().focus();
  await page.waitForTimeout(400);
  await shot('04-ao-vivo');
});

test('sem gap em flex (Tizen 5.5/6.0): o espaçamento vira margem e o diálogo mantém o layout', async ({ page }) => {
  const shot = (name: string) => page.screenshot({ path: new URL(`../build/screenshots/${name}.png`, import.meta.url).pathname });
  await page.addInitScript(() => localStorage.setItem('tuitv-no-flex-gap', '1'));
  await open(page);
  await expect(page.locator('html.no-flex-gap')).toHaveCount(1);
  await page.getByRole('button', { name: 'Adicionar lista' }).click();
  await page.getByRole('tab', { name: 'Login' }).click();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  // Simula o Chromium < 84: gap ignorado em flex (em grid continua valendo).
  await page.addStyleTag({ content: '[class*=flex]:not([class*=grid]){gap:0!important}' });
  // Ícone e texto da aba não ficam colados; botões Cancelar/Importar separados.
  const tab = page.getByRole('tab', { name: 'Login' });
  const [icon, text] = await tab.evaluate((el) => {
    const svg = el.querySelector('svg')!.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el.lastChild!);
    return [svg.right, range.getBoundingClientRect().left];
  });
  expect(text - icon).toBeGreaterThanOrEqual(6);
  const cancel = await page.getByRole('button', { name: 'Cancelar' }).boundingBox();
  const submit = await page.getByRole('button', { name: 'Importar', exact: true }).boundingBox();
  expect(submit!.x - (cancel!.x + cancel!.width)).toBeGreaterThanOrEqual(6);
  await page.getByLabel('Host (servidor)').focus();
  await shot('05-adicionar-sem-flex-gap');
});

/** Lista por login no servidor de apoio (atalho pelo mouse; o controle é testado acima). */
async function login(page: Page) {
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.getByRole('switch', { name: 'Permitir endereços da rede local' }).click();
  await page.evaluate(() => (location.hash = '#/'));
  await page.getByRole('button', { name: 'Adicionar lista' }).click();
  await page.getByRole('tab', { name: 'Login' }).click();
  await page.getByLabel('Host (servidor)').fill('127.0.0.1:4801');
  await page.getByLabel('Usuário').fill('joão');
  await page.getByLabel('Senha').fill('s&nha');
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
  await expect(page.getByText(/Conectado a “127.0.0.1”/)).toBeVisible();
}

test('filme: cartão → ficha (capa, sinopse, Assistir, Favoritar) → player em tela cheia', async ({ page }) => {
  const shot = (name: string) => page.screenshot({ path: new URL(`../build/screenshots/${name}.png`, import.meta.url).pathname });
  const errors = await open(page);
  await login(page);
  await page.evaluate(() => (location.hash = '#/movies'));
  const card = page.locator('main a.group[href*="title"]').first();
  await expect(card).toBeVisible();
  // Na TV o cartão é um único alvo: a estrela de favoritar não aparece nele.
  await expect(card.locator('button')).toBeHidden();
  await card.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('title-page')).toBeVisible();
  await expect.poll(() => focused(page)).toContain('Assistir');
  await page.waitForTimeout(300);
  await shot('05-ficha-do-filme');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => focused(page)).toContain('Favoritar');
  await page.keyboard.press('Enter');
  await expect.poll(() => focused(page)).toContain('Nos favoritos');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => focused(page)).toContain('Assistir');
  await page.keyboard.press('Enter');

  // Player próprio: tela cheia; ▼ leva aos botões e ▲ volta à barra de progresso.
  await expect(page.getByTestId('tv-watch')).toBeVisible();
  const player = page.getByTestId('player');
  await expect(player).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON');
  await page.keyboard.press('ArrowUp');
  await expect(player).toBeFocused();
  await shot('06-player-tv');

  // Voltar do controle: sai do player e volta à ficha.
  await remote(page, BACK);
  await expect(page.getByTestId('title-page')).toBeVisible();
  expect(errors).toEqual([]);
});

test('fileiras: ▲▼ voltam ao cartão em que o usuário estava', async ({ page }) => {
  await open(page);
  await expect.poll(() => focused(page)).toContain('Adicionar lista');
  // Duas fileiras de cartões (mesma estrutura das telas), operadas pela navegação espacial real.
  await page.evaluate(() => {
    const main = document.querySelector('main')!;
    main.innerHTML = '';
    for (const row of ['A', 'B']) {
      // Mesma estrutura das fileiras na TV: janela fixa + trilha que desliza com transform.
      const div = document.createElement('div');
      div.className = 'no-scrollbar';
      div.dataset.navRow = '';
      div.dataset.tvCarousel = '';
      div.style.cssText = 'overflow:hidden;padding:8px;margin-top:24px';
      const track = document.createElement('div');
      track.className = 'tv-track';
      track.style.cssText = 'display:flex;gap:16px';
      for (let i = 1; i <= 6; i++) {
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = `${row}${i}`;
        a.style.cssText = 'display:block;flex:0 0 300px;height:90px';
        track.appendChild(a);
      }
      div.appendChild(track);
      main.appendChild(div);
    }
    (main.querySelector('a') as HTMLElement).focus();
  });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await focused(page)).toBe('A3');
  await page.waitForTimeout(500);
  // A fileira desliza: o cartão em foco fica no início dela.
  const { offset, transform, scrolled } = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const row = el.closest('[data-tv-carousel]') as HTMLElement;
    return {
      offset: el.getBoundingClientRect().left - row.getBoundingClientRect().left,
      transform: (row.firstElementChild as HTMLElement).style.transform,
      scrolled: row.scrollLeft,
    };
  });
  // Desliza por transform (GPU), sem rolar a caixa.
  expect(transform).toContain('translate3d(-');
  expect(scrolled).toBe(0);
  expect(offset).toBeLessThan(20);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  const below = await focused(page);
  expect(below.startsWith('B')).toBe(true);
  await page.keyboard.press('ArrowUp');
  expect(await focused(page)).toBe('A3');
  await page.keyboard.press('ArrowDown');
  expect(await focused(page)).toBe(below);
  // Carrossel: no fim da fileira, ▶ não pula para a fileira de baixo.
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
  expect(await focused(page)).toBe('B6');
});

test('Voltar como na Netflix: fecha o seletor sem sair da tela; seletor sem caixa de busca na TV', async ({ page }) => {
  const errors = await open(page);
  await login(page);
  await page.evaluate(() => (location.hash = '#/movies'));
  const dropdown = page.getByRole('button', { name: 'Categoria' });
  await dropdown.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(page.locator('[role="listbox"]').locator('xpath=..').locator('input')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('option');
  await remote(page, BACK);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/movies/);
  await expect(dropdown).toBeFocused();
  expect(errors).toEqual([]);
});

test('TV ao vivo: OK no canal abre a tela cheia; ▲▼ trocam de canal; Voltar volta à lista', async ({ page }) => {
  const shot = (name: string) => page.screenshot({ path: new URL(`../build/screenshots/${name}.png`, import.meta.url).pathname });
  const errors = await open(page);
  await login(page);
  await page.evaluate(() => (location.hash = '#/live'));
  const list = page.getByTestId('channel-list');
  await list.getByRole('button', { name: /Canal Um HD/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tv-watch')).toBeVisible();
  const player = page.getByTestId('tv-watch').getByTestId('player');
  await expect(player).toBeFocused();
  const title = page.getByTestId('tv-watch').locator('p.text-3xl');
  const before = await title.innerText();
  await page.keyboard.press('ArrowDown');
  await expect(title).not.toHaveText(before);
  await shot('07-ao-vivo-tela-cheia');
  // Ao vivo não há pausa nem ajuste de tela na barra do player.
  const watch = page.getByTestId('tv-watch');
  await expect(watch.getByRole('button', { name: /^(Pausar|Reproduzir)$/ })).toHaveCount(0);
  await expect(watch.getByRole('button', { name: /Proporção/ })).toHaveCount(0);
  await remote(page, BACK);
  await expect(page.getByTestId('tv-watch')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/live/);
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="channel-list"]'))).toBe(true);
  // O logotipo do topo não é alvo do controle.
  expect(await page.getByRole('link', { name: 'TuiTV' }).getAttribute('tabindex')).toBe('-1');
  expect(errors).toEqual([]);
});

test('TV ao vivo na TV: abre com o foco nos canais; do menu, ▼ volta aos canais; categorias à esquerda', async ({ page }) => {
  const shot = (name: string) => page.screenshot({ path: new URL(`../build/screenshots/${name}.png`, import.meta.url).pathname });
  const errors = await open(page);
  await login(page);
  await page.evaluate(() => (location.hash = '#/live'));
  await expect(page.getByTestId('tv-live')).toBeVisible();
  const inChannels = () => page.evaluate(() => !!document.activeElement?.closest('[data-testid="channel-list"]'));
  await expect.poll(inChannels).toBe(true);
  // Sem prévia de vídeo na página (a TV reproduz um vídeo por vez).
  await expect(page.getByTestId('player')).toHaveCount(0);
  await page.waitForTimeout(300);
  await shot('08-ao-vivo-tv');
  // Do menu do topo, ▼ cai nos canais (não em outro elemento da tela).
  await page.getByRole('link', { name: 'TV ao vivo' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(inChannels).toBe(true);
  // ▶ no canal leva ao botão de favoritar do painel; OK favorita; ◀ volta ao mesmo canal.
  const channel = await focused(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => focused(page)).toContain('Favoritar');
  await page.keyboard.press('Enter');
  await expect.poll(() => focused(page)).toContain('Favorito');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => focused(page)).toBe(channel);
  // ◀ leva às categorias; passar por uma categoria não troca a lista — só o OK.
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="tv-categories"]'))).toBe(true);
  const listBefore = await page.getByTestId('channel-list').innerText();
  await focusByArrows(page, 'ArrowDown', 'Esportes');
  const category = await focused(page);
  await page.waitForTimeout(800);
  expect(await focused(page)).toBe(category);
  expect(await page.getByTestId('channel-list').innerText()).toBe(listBefore);
  await page.keyboard.press('Enter');
  await expect.poll(inChannels).toBe(true);
  expect(await page.getByTestId('channel-list').innerText()).not.toBe(listBefore);
  expect(errors).toEqual([]);
});

test('início: títulos das fileiras sem clique ("Ver tudo" leva à lista)', async ({ page }) => {
  await open(page);
  await login(page);
  await page.evaluate(() => (location.hash = '#/'));
  const section = page.locator('main section.group\\/row').first();
  await expect(section).toBeVisible();
  await expect(section.locator('h2 a')).toHaveCount(0);
  await expect(section.getByRole('link', { name: 'Ver tudo' })).toBeVisible();
});

test('ficha do filme: fundo ambiente com a capa desfocada (captura para conferência)', async ({ page }) => {
  // Capa de teste colorida no lugar da capa vazia do servidor de apoio.
  const poster = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f97316"/><stop offset="0.5" stop-color="#be123c"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient></defs><rect width="300" height="450" fill="url(#g)"/><circle cx="210" cy="140" r="70" fill="#fde68a"/><text x="30" y="400" font-size="44" font-family="sans-serif" fill="#fff">CORRIDA</text></svg>`;
  await page.route('**/poster.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: poster }));
  await page.route('**/player_api.php*', async (route) => {
    const response = await route.fetch();
    if (!route.request().url().includes('get_vod_streams')) return route.fulfill({ response });
    const list = (await response.json()) as { stream_icon?: string }[];
    return route.fulfill({ response, json: list.map((m) => ({ ...m, stream_icon: 'http://127.0.0.1:4801/poster.svg' })) });
  });
  const errors = await open(page);
  await login(page);
  await page.evaluate(() => (location.hash = '#/movies'));
  const card = page.locator('main a.group[href*="title"]').first();
  await expect(card).toBeVisible();
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('ambient-backdrop')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (document.querySelector('[data-testid="ambient-backdrop"] canvas') as HTMLCanvasElement).style.opacity)).toBe('0.9');
  await page.waitForTimeout(700);
  await page.screenshot({ path: new URL('../build/screenshots/09-ficha-fundo-ambiente.png', import.meta.url).pathname });
  expect(errors).toEqual([]);
});

test('cartão em foco ampliado (captura para conferência)', async ({ page }) => {
  await open(page);
  await login(page);
  await page.evaluate(() => (location.hash = '#/movies'));
  const card = page.locator('main a.group').first();
  await expect(card).toBeVisible();
  await card.focus();
  await page.waitForTimeout(300);
  const scale = await card.evaluate((el) => getComputedStyle(el.firstElementChild as Element).transform);
  expect(scale).toContain('1.18');
  await page.screenshot({ path: new URL('../build/screenshots/10-cartao-em-foco.png', import.meta.url).pathname });
});

test('filmes/séries na TV: fileiras sem rolagem virtual e categorias pedidas com antecedência', async ({ page }) => {
  await open(page);
  await login(page);
  // Séries sem a contagem de episódios sob a capa.
  await page.evaluate(() => (location.hash = '#/series'));
  await expect(page.locator('main a.group').first()).toBeVisible();
  await expect(page.locator('main a.group').filter({ hasText: /episódios/ })).toHaveCount(0);
  // Filmes: várias categorias → fileiras.
  await page.evaluate(() => (location.hash = '#/movies'));
  const rows = page.locator('main [data-row-index]');
  await expect(rows.first()).toBeVisible();
  // Todas as categorias montadas em fluxo normal (sem posicionamento absoluto da lista virtual).
  expect(await page.locator('main [data-row-index] section.group\\/row').count()).toBeGreaterThan(0);
  await expect(page.getByText('Carregando do servidor…')).toHaveCount(0);
  await page.locator('main a.group').first().focus();
  await page.waitForTimeout(300);
  await page.screenshot({ path: new URL('../build/screenshots/11-series-foco.png', import.meta.url).pathname });
});

test('cartão em foco: cresce sem encostar nos vizinhos e as capas carregam só perto da tela', async ({ page }) => {
  const colors = ['#f97316', '#22c55e', '#3b82f6', '#a855f7', '#ef4444', '#14b8a6', '#eab308', '#ec4899'];
  await page.route('**/poster-*.svg', (route) => {
    const n = Number(/poster-(\d+)/.exec(route.request().url())![1]);
    const c = colors[n % colors.length];
    route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="${c}"/><text x="20" y="280" font-size="40" fill="#fff">${n}</text></svg>` });
  });
  await page.route('**/player_api.php*', async (route) => {
    const response = await route.fetch();
    if (!route.request().url().includes('get_vod_streams')) return route.fulfill({ response });
    const list = (await response.json()) as Record<string, unknown>[];
    const first = list[0]!;
    // Fileira cheia: 12 filmes na mesma categoria, cada um com uma capa.
    const many = Array.from({ length: 12 }, (_, i) => ({ ...first, stream_id: 9000 + i, name: `Filme ${i + 1}`, stream_icon: `http://127.0.0.1:4801/poster-${i}.svg` }));
    return route.fulfill({ response, json: [...many, ...list.slice(1)] });
  });
  await open(page);
  await login(page);
  await page.evaluate(() => (location.hash = '#/movies'));
  const row = page.locator('main [data-tv-carousel]').first();
  const cards = row.locator('a.group');
  await expect(cards.nth(5)).toBeVisible();
  // Capas fora da janela da fileira ainda não foram pedidas.
  expect(await cards.nth(11).locator('img').getAttribute('src')).toBeNull();
  await cards.nth(0).focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(450);
  const [focusedBox, nextBox] = await Promise.all([1, 2].map((i) => cards.nth(i).locator('div').first().boundingBox()));
  // O cartão em foco fica alinhado ao início da fileira (como o título da seção).
  const rowBox = await row.boundingBox();
  const pad = await row.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  const firstBox = await cards.nth(1).boundingBox();
  expect(Math.abs(firstBox!.x - (rowBox!.x + pad))).toBeLessThan(4);
  // Respiro à direita da capa ampliada igual ao da esquerda (o espaço entre cartões).
  const prevBox = await cards.nth(0).locator('div').first().boundingBox();
  const left = focusedBox!.x - (prevBox!.x + prevBox!.width);
  const right = nextBox!.x - (focusedBox!.x + focusedBox!.width);
  expect(Math.abs(right - left)).toBeLessThan(3);
  // Ao andar na fileira, as próximas capas já são pedidas.
  expect(await cards.nth(8).locator('img').getAttribute('src')).not.toBeNull();
  await page.screenshot({ path: new URL('../build/screenshots/12-fileira-foco.png', import.meta.url).pathname });
});

test('"Ver tudo": capa em foco cresce do centro, com respiro igual dos dois lados', async ({ page }) => {
  await page.route('**/player_api.php*', async (route) => {
    const response = await route.fetch();
    if (!route.request().url().includes('get_vod_streams')) return route.fulfill({ response });
    const list = (await response.json()) as Record<string, unknown>[];
    const many = Array.from({ length: 14 }, (_, i) => ({ ...list[0]!, stream_id: 9100 + i, name: `Filme ${i + 1}` }));
    return route.fulfill({ response, json: [...many, ...list.slice(1)] });
  });
  await open(page);
  await login(page);
  await page.evaluate(() => (location.hash = '#/movies'));
  await page.locator('main section').first().getByRole('button', { name: 'Ver tudo' }).click();
  const cards = page.locator('main .tv-grid-row a.group');
  await expect(cards.nth(3)).toBeVisible();
  await cards.nth(1).focus();
  await page.waitForTimeout(300);
  const [a, b, c] = await Promise.all([0, 1, 2].map((i) => cards.nth(i).locator('div').first().boundingBox()));
  const left = b!.x - (a!.x + a!.width);
  const right = c!.x - (b!.x + b!.width);
  expect(Math.abs(left - right)).toBeLessThan(3);
  expect(left).toBeGreaterThan(14);
  await page.screenshot({ path: new URL('../build/screenshots/13-ver-tudo-foco.png', import.meta.url).pathname });
});

test('menu do topo com o controle: OK abre com o foco no 1º item, ▲▼ andam nos itens, Voltar fecha', async ({ page }) => {
  const errors = await open(page);
  await login(page);
  await page.evaluate(() => (location.hash = '#/'));
  await expect(page.locator('main a.group').first()).toBeVisible();
  const button = page.getByRole('button', { name: 'Menu', exact: true });
  await button.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect.poll(() => focused(page)).toBe('Histórico');
  // ▼ desce pelos itens (não pula para os cartões da tela); ◀▶ não saem do menu.
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => focused(page)).toBe('Guia de programação');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  expect(await focused(page)).toBe('Guia de programação');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => focused(page)).toBe('Configurações');
  await page.keyboard.press('ArrowDown');
  expect(await focused(page)).toBe('Configurações');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => focused(page)).toBe('Minhas listas');
  // Voltar fecha o menu, devolve o foco ao botão e continua na tela.
  await remote(page, BACK);
  await expect(menu).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Menu');
  await expect(page).toHaveURL(/#\/$/);
  // OK num item abre a tela e fecha o menu.
  await page.keyboard.press('Enter');
  await expect.poll(() => focused(page)).toBe('Histórico');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/guide/);
  await expect(menu).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('série com o controle: episódio em foco bem visível (cartões e grade) e um único alvo por episódio', async ({ page }) => {
  const shot = (name: string) => page.screenshot({ path: new URL(`../build/screenshots/${name}.png`, import.meta.url).pathname });
  const errors = await open(page);
  await login(page);
  await page.evaluate(() => (location.hash = '#/series'));
  await page.locator('main a.group', { hasText: 'Vale Escuro' }).first().click();
  await expect(page.getByRole('heading', { name: 'Vale Escuro' })).toBeVisible();
  const focusedEpisode = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el?.dataset.episode) return null;
      const style = getComputedStyle(el);
      return { label: el.getAttribute('aria-label'), background: style.backgroundColor, transform: style.transform };
    });
  // Temporada 1 (com sinopse e miniatura): cartões. ▼ a partir das ações chega ao primeiro episódio.
  await expect(page.getByTestId('episodes')).toHaveAttribute('data-layout', 'cards');
  // Na TV não há botão de "assistido" por episódio: cada episódio é uma única parada do controle.
  await expect(page.getByTestId('episodes').locator('button')).toHaveCount(0);
  await page.locator('main a, main button').first().focus();
  for (let i = 0; i < 8 && !(await focusedEpisode()); i++) await page.keyboard.press('ArrowDown');
  expect(await focusedEpisode()).toMatchObject({ label: '1. Chegada', background: 'rgb(255, 255, 255)' });
  await page.keyboard.press('ArrowDown');
  expect(await focusedEpisode()).toMatchObject({ label: '2. Neblina', background: 'rgb(255, 255, 255)' });
  await shot('14-serie-cartoes-foco');
  // Temporada 2 (sem dados por episódio): grade, com o mesmo destaque no foco.
  await page.getByRole('button', { name: 'Temporada 2' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('episodes')).toHaveAttribute('data-layout', 'grid');
  await expect(page.getByTestId('episodes').locator('button')).toHaveCount(0);
  await page.keyboard.press('ArrowDown');
  await expect.poll(focusedEpisode).toMatchObject({ label: '1. Retorno', background: 'rgb(255, 255, 255)' });
  expect((await focusedEpisode())!.transform).not.toBe('none');
  await shot('15-serie-grade-foco');
  expect(errors).toEqual([]);
});

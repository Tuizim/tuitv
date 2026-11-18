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

test('só com o controle: lista por login, canais, player, troca de canal e Voltar', async ({ page }) => {
  const errors = await open(page);

  // Liberar a rede local (o servidor de apoio roda em 127.0.0.1) pela tela de configurações.
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.getByRole('switch', { name: 'Permitir endereços da rede local' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('switch', { name: 'Permitir endereços da rede local' })).toHaveAttribute('aria-checked', 'true');

  // Voltar do controle: volta para a tela inicial.
  await remote(page, BACK);
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
  const player = page.getByTestId('player');
  await expect(player).toBeVisible();
  await player.focus();
  const heading = page.locator('main h1').first();
  const before = await heading.innerText();
  await remote(page, 428); // Canal −
  await expect(heading).not.toHaveText(before);

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
      const div = document.createElement('div');
      div.className = 'no-scrollbar';
      div.style.cssText = 'display:flex;gap:16px;overflow-x:auto;padding:8px;margin-top:24px';
      for (let i = 1; i <= 6; i++) {
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = `${row}${i}`;
        a.style.cssText = 'display:block;flex:0 0 300px;height:90px';
        div.appendChild(a);
      }
      main.appendChild(div);
    }
    (main.querySelector('a') as HTMLElement).focus();
  });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await focused(page)).toBe('A3');
  await page.waitForTimeout(500);
  // A fileira desliza: o cartão em foco fica no início dela.
  const offset = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    return el.getBoundingClientRect().left - el.parentElement!.getBoundingClientRect().left;
  });
  expect(offset).toBeLessThan(20);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  const below = await focused(page);
  expect(below.startsWith('B')).toBe(true);
  await page.keyboard.press('ArrowUp');
  expect(await focused(page)).toBe('A3');
  await page.keyboard.press('ArrowDown');
  expect(await focused(page)).toBe(below);
});

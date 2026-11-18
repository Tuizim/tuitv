import { describe, expect, it } from 'vitest';
import { auditCss, compatCss } from './css-compat';

const norm = (css: string) => css.replace(/\s+/g, '');

describe('compatibilidade do CSS com Tizen 5.5 (Chromium 69)', () => {
  it('desfaz @layer mantendo a ordem', async () => {
    const out = await compatCss('@layer theme, base; @layer base { a { color: red } } @layer utilities { .x { color: blue } }');
    expect(out).not.toContain('@layer');
    expect(out.indexOf('a{')).toBeLessThan(out.indexOf('.x{'));
  });

  it('expande :where() e :is() em seletores simples', async () => {
    const out = norm(await compatCss('input:where([type=button],[type=reset]){cursor:pointer} [hidden]:where(:not([hidden=until-found])){display:none!important}'));
    expect(out).toContain('input[type=button],input[type=reset]{cursor:pointer}');
    expect(out).toContain('[hidden]:not([hidden=until-found]){display:none!important}');
    expect(out).not.toMatch(/:where|:is\(/);
  });

  it('expande :is() aninhado a :where() (variantes group-hover)', async () => {
    const out = norm(await compatCss(':is(:where(.group):hover .group-hover\\:x){opacity:1}'));
    expect(out).toContain('.group:hover.group-hover\\:x{opacity:1}'.replace('.group:hover.', '.group:hover .').replace(/\s/g, ''));
  });

  it('descarta seletores que só servem a outro navegador', async () => {
    const out = await compatCss(':-moz-focusring:where(:not(iframe)){outline:auto} a{color:red}');
    expect(out).not.toContain('moz');
    expect(out).toContain('a{color:red}');
  });

  it('declara os valores iniciais de @property e compõe transformações', async () => {
    const out = norm(
      await compatCss(
        '@property --tw-translate-y{syntax:"*";inherits:false;initial-value:0} .-translate-y-1\\/2{--tw-translate-y:-50%;translate:var(--tw-translate-x) var(--tw-translate-y)} .scale-125{--tw-scale-x:125%;scale:var(--tw-scale-x) var(--tw-scale-y)} .rotate-180{rotate:180deg}',
      ),
    );
    expect(out).toMatch(/\*,:(after|before),:(after|before)(,::backdrop)?\{--tw-translate-y:0\}/);
    expect(out).not.toMatch(/[{;](translate|scale|rotate):/);
    expect(out).toContain('--tw-scale-x:1.25');
    expect(out).toContain('--tui-rotate:180deg');
    expect(out).toContain('transform:translate(var(--tw-translate-x,0),var(--tw-translate-y,0))');
  });

  it('dvh e aspect-ratio ganham alternativas', async () => {
    const out = norm(await compatCss(':root{--aspect-video:16/9} .h{height:55dvh} .aspect-video{aspect-ratio:var(--aspect-video)}'));
    expect(out).toContain('height:55vh;height:55dvh');
    expect(out).toContain('@supportsnot(aspect-ratio:1/1)');
    expect(out).toContain('.aspect-video:before{content:"";float:left;padding-top:56.25');
  });

  it(':focus-visible vira :focus', async () => {
    expect(await compatCss('a:focus-visible{outline:2px solid red}')).toContain('a:focus{');
  });

  it('a auditoria aponta o que o Chromium 69 descartaria', () => {
    expect(auditCss('@layer x{a{color:red}}')).toHaveLength(1);
    expect(auditCss('a:where(.b){color:red}')).toHaveLength(1);
    expect(auditCss('.x{translate:1px 2px}')).toHaveLength(1);
    expect(auditCss('.x{color:oklch(50% .1 200)}')).toHaveLength(1);
    expect(auditCss('.x{color:#123;color:oklch(50% .1 200)}')).toHaveLength(0);
    expect(auditCss('@supports (color:lab(0% 0 0)){.x{color:lab(50% 1 1)}}')).toHaveLength(0);
    expect(auditCss('.px-3{padding-inline:12px}')).toHaveLength(1);
    expect(
      auditCss('.bg-a\\/15{background-color:var(--tui-accent)}@supports (color:color-mix(in lab, red, red)){.bg-a\\/15{background-color:color-mix(in oklab, var(--tui-accent) 15%, transparent)}}'),
    ).toHaveLength(1);
  });

  it('propriedades lógicas viram físicas (px-*, py-*, mx-*, space-y-*)', async () => {
    const out = norm(
      await compatCss(
        '.px-3{padding-inline:calc(var(--spacing) * 3)} .py{padding-block:1px 2px} .mx-auto{margin-inline:auto} .s>:not(:last-child){margin-block-end:4px}',
      ),
    );
    expect(out).not.toMatch(/-(inline|block)/);
    expect(out).toContain('padding-left:calc(var(--spacing)*3);padding-right:calc(var(--spacing)*3)');
    expect(out).toContain('padding-top:1px;padding-bottom:2px');
    expect(out).toContain('margin-left:auto;margin-right:auto');
    expect(out).toContain('margin-bottom:4px');
  });

  it('cores do tema com transparência mantêm a transparência sem color-mix()', async () => {
    const out = norm(
      await compatCss(
        ':root{--tui-accent:#38bdf8} [data-theme=light]{--tui-accent:#0284c7} .bg-accent\\/15{background-color:var(--tui-accent);@supports (color:color-mix(in lab, red, red)){background-color:color-mix(in oklab, var(--tui-accent) 15%, transparent)}}',
      ),
    );
    expect(out).toContain('--tui-accent-rgb:56,189,248');
    expect(out).toContain('--tui-accent-rgb:2,132,199');
    expect(out).toContain('.bg-accent\\/15{background-color:rgba(var(--tui-accent-rgb),.15)}');
    // Mesmo CSS já sem aninhamento (como o Vite entrega no build).
    const flat = norm(
      await compatCss(
        ':root{--tui-line:#1c2a42} .b\\/60{border-color:var(--tui-line)} @supports (color:color-mix(in lab, red, red)){.b\\/60{border-color:color-mix(in oklab, var(--tui-line) 60%, transparent)}}',
      ),
    );
    expect(flat).toContain('.b\\/60{border-color:rgba(var(--tui-line-rgb),.6)}');
    // Regra combinada com a cor sólida.
    const merged = norm(
      await compatCss(
        ':root{--tui-line:#1c2a42} .b,.b\\/60{border-color:var(--tui-line)} @supports (color:color-mix(in lab, red, red)){.b\\/60{border-color:color-mix(in oklab, var(--tui-line) 60%, transparent)}}',
      ),
    );
    expect(merged).toContain('.b{border-color:var(--tui-line)}');
    expect(merged).toContain('.b\\/60{border-color:rgba(var(--tui-line-rgb),.6)}');
    expect(auditCss(await compatCss(':root{--tui-accent:#38bdf8} .b\\/15{color:var(--tui-accent);@supports (color:color-mix(in lab, red, red)){color:color-mix(in oklab, var(--tui-accent) 15%, transparent)}}'))).toHaveLength(0);
  });

  it('gap em flex ganha margens quando o navegador não o aplica (html.no-flex-gap)', async () => {
    const raw = await compatCss('.gap-2{gap:8px} .gap-y-1{row-gap:4px} @media (min-width:40rem){.sm\\:gap-4{gap:16px}}');
    expect(raw).toContain('.no-flex-gap .gap-2'); // descendente de <html class="no-flex-gap">
    const out = norm(raw);
    expect(out).toContain('.gap-2{gap:8px}');
    expect(out).toContain('.gap-2:not([class*=grid]):not(.flex-col):not(.flex-wrap)>*+:not(.ml-auto){margin-left:8px}');
    expect(out).toContain('.gap-2:not([class*=grid]).flex-col>*+:not(.mt-auto){margin-top:8px}');
    expect(out).toContain('.gap-2:not([class*=grid]).flex-wrap>*{margin-bottom:8px;margin-right:8px}');
    expect(out).toContain('.gap-y-1:not([class*=grid]).flex-col>*+:not(.mt-auto){margin-top:4px}');
    expect(out).not.toContain('.gap-y-1:not([class*=grid]):not(.flex-col)');
    expect(out).toMatch(/@media\(min-width:40rem\)\{[^}]*\}\.no-flex-gap\.sm\\:gap-4/);
  });
});

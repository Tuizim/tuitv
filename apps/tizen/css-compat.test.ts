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
  });
});

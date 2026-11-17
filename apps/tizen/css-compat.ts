/**
 * Compatibilidade do CSS do Tailwind v4 com o navegador das TVs Samsung (Tizen 5.5+, Chromium 69+).
 *
 * O Tailwind v4 gera CSS para navegadores recentes (Chromium 111+). Recursos que um navegador antigo
 * não entende fazem a regra inteira ser descartada — por exemplo, todo bloco @layer, ou toda regra com
 * :where(). Este módulo reescreve o CSS para formas equivalentes e audita o resultado.
 */
import browserslist from 'browserslist';
import { browserslistToTargets, transform } from 'lightningcss';
import postcss, { type AtRule, type ChildNode, type Declaration, type Root, type Rule } from 'postcss';
import selectorParser from 'postcss-selector-parser';

export const BROWSERS = ['chrome >= 69'];

const inSupports = (node: ChildNode): boolean => {
  for (let p = node.parent; p; p = p.parent as typeof p) {
    if (p.type === 'atrule' && (p as AtRule).name === 'supports') return true;
    if (p.type === 'root') break;
  }
  return false;
};

/** 1. @layer (Chromium 99+): desfaz as camadas mantendo a ordem do Tailwind (theme, base, components, utilities). */
function flattenLayers(root: Root) {
  root.walkAtRules('layer', (rule) => {
    if (rule.nodes && rule.nodes.length) rule.replaceWith(rule.nodes);
    else rule.remove();
  });
}

/**
 * 2. @property (Chromium 85+): sem registro, variáveis como --tw-translate-y ficam indefinidas e invalidam
 * a declaração inteira. Os valores iniciais passam a ser declarados em todos os elementos, antes das utilidades.
 */
function propertyInitialValues(root: Root) {
  const decls: string[] = [];
  root.walkAtRules('property', (rule) => {
    const name = rule.params.trim();
    let initial: string | undefined;
    rule.walkDecls('initial-value', (d) => {
      initial = d.value;
    });
    if (initial !== undefined && name.startsWith('--')) decls.push(`${name}:${initial}`);
  });
  if (!decls.length) return;
  const fallback = postcss.parse(`*,::before,::after,::backdrop{${decls.join(';')}}`);
  // Logo após as regras do tema (:root), antes de base e utilidades.
  root.prepend(fallback.nodes);
}

const unwrapPseudos = new Set([':where', ':is', ':matches', ':-webkit-any']);

/**
 * 3. :where() e :is() (Chromium 88+): expande para seletores simples. Ex.: "input:where([type=button],[type=reset])"
 * → "input[type=button], input[type=reset]". A especificidade aumenta um pouco (aceitável nas utilidades do Tailwind).
 * :-webkit-any() é mantido quando já vem como alternativa (é suportado pelo Chromium antigo).
 */
function expandSelector(selector: string): string {
  const transformer = selectorParser((selectors) => {
    let changed = true;
    while (changed) {
      changed = false;
      selectors.each((sel) => {
        let target: selectorParser.Pseudo | undefined;
        sel.walkPseudos((pseudo) => {
          if (!target && (pseudo.value === ':where' || pseudo.value === ':is' || pseudo.value === ':matches')) target = pseudo;
        });
        if (!target) return;
        changed = true;
        const options = target.nodes.map((n) => n.toString().trim());
        const clones = options.map((option) => {
          const clone = sel.clone() as selectorParser.Selector;
          let replaced = false;
          clone.walkPseudos((pseudo) => {
            if (replaced || !unwrapPseudos.has(pseudo.value) || pseudo.toString() !== target!.toString()) return;
            const inner = selectorParser().astSync(option).first;
            pseudo.replaceWith(...inner.nodes.map((n) => n.clone()));
            replaced = true;
          });
          return clone;
        });
        for (const clone of clones) selectors.insertBefore(sel, clone);
        sel.remove();
      });
    }
  });
  return transformer.processSync(selector);
}

function expandSelectors(root: Root) {
  root.walkRules((rule) => {
    if (!/:where\(|:is\(|:matches\(/.test(rule.selector)) return;
    // Seletores que já são alternativas para outro navegador (prefixos -moz-) não interessam à TV.
    rule.selector = expandSelector(rule.selector);
    const kept = [...new Set(rule.selectors.filter((s) => s.trim() && !s.includes(':-moz-')))];
    if (kept.length) rule.selectors = kept;
    else rule.remove();
  });
}

/**
 * 4. translate/scale/rotate como propriedades independentes (Chromium 104+) → transform.
 * Todas as regras usam a mesma composição baseada nas variáveis do Tailwind, então classes diferentes
 * (ex.: -translate-y-1/2 e hover:scale-105) continuam se combinando.
 */
const COMPOSED =
  'translate(var(--tw-translate-x,0),var(--tw-translate-y,0)) rotate(var(--tui-rotate,0deg)) scale(var(--tw-scale-x,1),var(--tw-scale-y,1))';

function individualTransforms(root: Root) {
  root.walkDecls(/^--tw-scale-[xyz]$/, (d) => {
    const m = /^(-?\d*\.?\d+)%$/.exec(d.value.trim());
    if (m) d.value = String(Number(m[1]) / 100); // scale() não aceita porcentagem no Chromium antigo
  });
  root.walkRules((rule) => {
    const props = rule.nodes.filter((n): n is Declaration => n.type === 'decl' && ['translate', 'scale', 'rotate'].includes(n.prop));
    if (!props.length) return;
    for (const d of props) {
      if (d.prop === 'rotate') d.cloneBefore({ prop: '--tui-rotate', value: d.value });
      d.remove();
    }
    rule.append({ prop: 'transform', value: COMPOSED });
  });
}

/** 5. dvh (Chromium 108+): declara antes o mesmo valor em vh. */
function viewportUnits(root: Root) {
  root.walkDecls((d) => {
    if (!/\d(dvh|svh|lvh)\b/.test(d.value) || inSupports(d)) return;
    d.cloneBefore({ value: d.value.replace(/(\d)(dvh|svh|lvh)\b/g, '$1vh') });
  });
}

/** 6. aspect-ratio (Chromium 88+): alternativa com padding-top em ::before quando não houver suporte. */
function aspectRatio(root: Root) {
  const vars = new Map<string, string>();
  root.walkDecls(/^--/, (d) => {
    if (!vars.has(d.prop)) vars.set(d.prop, d.value);
  });
  const fallbacks: string[] = [];
  root.walkDecls('aspect-ratio', (d) => {
    if (inSupports(d)) return;
    let value = d.value.trim();
    const v = /^var\((--[\w-]+)\)$/.exec(value);
    if (v) value = vars.get(v[1]!) ?? value;
    const m = /^(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/.exec(value);
    if (!m) return;
    const percent = ((Number(m[2]) / Number(m[1])) * 100).toFixed(4);
    const rule = d.parent as Rule;
    for (const sel of rule.selectors) {
      fallbacks.push(`${sel}::before{content:"";float:left;padding-top:${percent}%}${sel}::after{content:"";display:block;clear:both}`);
    }
  });
  if (fallbacks.length) root.append(postcss.parse(`@supports not (aspect-ratio:1/1){${fallbacks.join('')}}`));
}

/** 7. :focus-visible (Chromium 86+) → :focus. Na TV o foco sempre vem do controle remoto. */
function focusVisible(root: Root) {
  root.walkRules((rule) => {
    if (rule.selector.includes(':focus-visible')) rule.selector = rule.selector.replace(/:focus-visible/g, ':focus');
  });
}

export async function compatCss(source: string, filename = 'style.css'): Promise<string> {
  const result = await postcss([]).process(source, { from: undefined });
  const root = result.root;
  flattenLayers(root);
  propertyInitialValues(root);
  expandSelectors(root);
  individualTransforms(root);
  viewportUnits(root);
  aspectRatio(root);
  focusVisible(root);
  // 8. Lightning CSS: aninhamento, cores modernas com alternativas, media queries por intervalo etc.
  const lowered = transform({
    filename,
    code: Buffer.from(root.toString()),
    minify: true,
    targets: browserslistToTargets(browserslist(BROWSERS)),
  });
  return lowered.code.toString();
}

/**
 * Auditoria: recursos que o Chromium 69 descarta e que ficaram fora de @supports.
 * Usada no build (falha se algo aparecer) e nos testes.
 */
export function auditCss(css: string): string[] {
  const root = postcss.parse(css);
  const problems: string[] = [];
  root.walkAtRules((a) => {
    if (a.name === 'layer' || a.name === 'container') problems.push(`@${a.name} ${a.params}`);
  });
  root.walkRules((rule) => {
    if (inSupports(rule)) return;
    if (/:where\(|:is\(|:has\(|:focus-visible/.test(rule.selector)) problems.push(`seletor: ${rule.selector}`);
    if (rule.selector.includes('&')) problems.push(`aninhamento: ${rule.selector}`);
  });
  root.walkDecls((d) => {
    if (inSupports(d)) return;
    const where = `${(d.parent as Rule).selector ?? ''} { ${d.prop}: ${d.value} }`;
    if (['translate', 'scale', 'rotate', 'inset'].includes(d.prop)) problems.push(`propriedade: ${where}`);
    if (d.prop === 'aspect-ratio') {
      const sel = (d.parent as Rule).selector;
      const first = sel.split(',')[0]!.trim();
      if (!css.includes(`${first}::before`) && !css.includes(`${first}:before`)) problems.push(`sem alternativa: ${where}`);
    }
    if (/\b(oklch|oklab|lab|lch|color-mix)\(|rgb\(from/.test(d.value) || /\d(dvh|svh|lvh)\b/.test(d.value)) {
      const prev = d.prev();
      const hasFallback = prev?.type === 'decl' && prev.prop === d.prop;
      if (!hasFallback && !d.prop.startsWith('--')) problems.push(`sem alternativa: ${where}`);
    }
  });
  return problems;
}

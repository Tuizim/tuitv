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

/**
 * 8. Propriedades lógicas (padding-inline, padding-block, margin-inline: Chromium 87+) → físicas.
 * O Tailwind v4 usa padding-inline em todo px-*: sem isso, campos e botões ficam sem preenchimento.
 * A interface é sempre da esquerda para a direita (pt-BR / en).
 */
const LOGICAL_SIDES: Record<string, [string, string]> = { inline: ['left', 'right'], block: ['top', 'bottom'] };
const LOGICAL_EDGE: Record<string, string> = {
  'inline-start': 'left',
  'inline-end': 'right',
  'block-start': 'top',
  'block-end': 'bottom',
};

/** Divide um valor CSS em partes separadas por espaço no nível superior (fora de parênteses). */
function splitTop(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value.trim()) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (current) parts.push(current);
      current = '';
    } else current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

function logicalProperties(root: Root) {
  root.walkDecls(/^(padding|margin|inset)-(inline|block)(-(start|end))?$/, (d) => {
    const m = /^(padding|margin|inset)-(inline|block)(?:-(start|end))?$/.exec(d.prop)!;
    const [, box, axis, edge] = m;
    const physical = (side: string) => (box === 'inset' ? side : `${box}-${side}`);
    if (edge) {
      d.cloneBefore({ prop: physical(LOGICAL_EDGE[`${axis}-${edge}`]!) });
    } else {
      const parts = splitTop(d.value);
      const [a, b] = LOGICAL_SIDES[axis!]!;
      d.cloneBefore({ prop: physical(a), value: parts[0] });
      d.cloneBefore({ prop: physical(b), value: parts[1] ?? parts[0] });
    }
    d.remove();
  });
}

/**
 * 9. Cores do tema com transparência (bg-accent/15). O Tailwind usa a cor SÓLIDA como alternativa para
 * navegadores sem color-mix() — fundos sutis viram blocos de cor. Cada --tui-* em hexadecimal ganha uma
 * versão --tui-*-rgb ("r,g,b") e a alternativa passa a ser rgba(var(--tui-*-rgb), alfa), em todos os temas.
 */
function hexToRgb(hex: string): string | undefined {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');
}

const MIX = /^color-mix\(in oklab,\s*var\((--tui-[\w-]+)\)\s+(\d*\.?\d+)%,\s*transparent\)$/;

function themeAlphaFallbacks(root: Root) {
  const used = new Set<string>();
  root.walkAtRules('supports', (supports) => {
    if (!supports.params.includes('color-mix')) return;
    const prev = supports.prev();
    supports.walkDecls((inner) => {
      const m = MIX.exec(inner.value.trim());
      if (!m) return;
      // A alternativa é a declaração da mesma propriedade antes do @supports: dentro da mesma regra
      // (CSS aninhado do Tailwind) ou na regra de mesmo seletor logo antes (CSS já sem aninhamento).
      let fallback: Declaration | undefined;
      if (prev?.type === 'decl' && prev.prop === inner.prop) fallback = prev;
      else if (prev?.type === 'rule' && inner.parent?.type === 'rule') {
        const before = prev as Rule;
        const target = (inner.parent as Rule).selectors;
        if (!target.every((s) => before.selectors.includes(s))) return;
        const solid = before.nodes.find((n): n is Declaration => n.type === 'decl' && n.prop === inner.prop);
        if (!solid) return;
        if (before.selectors.length === target.length) fallback = solid;
        else {
          // Regra combinada com a cor sólida (ex.: ".border-accent,.border-accent\/30"): separa o seletor transparente.
          before.selectors = before.selectors.filter((s) => !target.includes(s));
          const own = postcss.rule({ selectors: target });
          fallback = solid.clone();
          own.append(fallback);
          before.after(own);
        }
      }
      if (!fallback) return;
      fallback.value = `rgba(var(${m[1]}-rgb),${Number(m[2]) / 100})`;
      used.add(m[1]!);
    });
  });
  if (!used.size) return;
  root.walkDecls(/^--tui-/, (d) => {
    if (!used.has(d.prop)) return;
    const rgb = hexToRgb(d.value);
    if (rgb) d.cloneAfter({ prop: `${d.prop}-rgb`, value: rgb });
  });
}

/**
 * 10. gap em flex (Chromium 84+; em grid funciona desde o 66). O aplicativo marca <html class="no-flex-gap">
 * quando o navegador não aplica gap em flex (src/flex-gap.ts) e o espaçamento vira margem nos filhos:
 *  - linha: margem à esquerda a partir do segundo filho;
 *  - coluna (flex-col): margem acima a partir do segundo filho;
 *  - com quebra (flex-wrap): margem à direita e abaixo de cada filho.
 * Filhos com margem automática (ml-auto, mt-auto) mantêm a própria margem.
 */
function flexGapFallback(root: Root) {
  root.walkRules((rule) => {
    if (!/^\.(?:[\w-]+\\:)*gap-/.test(rule.selector) || rule.selector.includes(',')) return;
    let column: string | undefined; // espaço entre colunas (direção de linha)
    let row: string | undefined;
    rule.walkDecls((d) => {
      if (d.parent !== rule) return;
      if (d.prop === 'gap') {
        const parts = splitTop(d.value);
        row = parts[0];
        column = parts[1] ?? parts[0];
      } else if (d.prop === 'column-gap') column = d.value;
      else if (d.prop === 'row-gap') row = d.value;
    });
    if (column === undefined && row === undefined) return;
    const s = `.no-flex-gap ${rule.selector}:not([class*=grid])`;
    const css: string[] = [];
    if (column !== undefined) css.push(`${s}:not(.flex-col):not(.flex-wrap)>*+*:not(.ml-auto){margin-left:${column}}`);
    if (row !== undefined) css.push(`${s}.flex-col>*+*:not(.mt-auto){margin-top:${row}}`);
    const wrap = [column !== undefined && `margin-right:${column}`, row !== undefined && `margin-bottom:${row}`].filter(Boolean);
    css.push(`${s}.flex-wrap>*{${wrap.join(';')}}`);
    rule.after(postcss.parse(css.join('')).nodes);
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
  logicalProperties(root);
  themeAlphaFallbacks(root);
  flexGapFallback(root);
  // 11. Lightning CSS: aninhamento, cores modernas com alternativas, media queries por intervalo etc.
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
  // Cor do tema transparente cuja alternativa (regra anterior, mesmo seletor) é a cor sólida.
  root.walkAtRules('supports', (supports) => {
    if (!supports.params.includes('color-mix')) return;
    const prev = supports.prev();
    if (prev?.type !== 'rule') return;
    supports.walkDecls((inner) => {
      if (!/color-mix\(in oklab,\s*var\(--tui-/.test(inner.value)) return;
      const rule = inner.parent as Rule;
      const solid = (prev as Rule).nodes.find((n) => n.type === 'decl' && n.prop === inner.prop && /^var\(--tui-[\w-]+\)$/.test(n.value));
      if (solid && (prev as Rule).selectors.some((s) => rule.selectors.includes(s))) problems.push(`transparência perdida: ${rule.selector} { ${inner.prop} }`);
    });
  });
  root.walkDecls((d) => {
    if (inSupports(d)) return;
    const where = `${(d.parent as Rule).selector ?? ''} { ${d.prop}: ${d.value} }`;
    if (['translate', 'scale', 'rotate', 'inset'].includes(d.prop)) problems.push(`propriedade: ${where}`);
    if (/^(padding|margin|inset|border)-(inline|block)\b/.test(d.prop)) problems.push(`propriedade lógica: ${where}`);
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

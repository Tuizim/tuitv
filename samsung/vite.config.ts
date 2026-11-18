import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { auditCss, compatCss } from './css-compat.ts';

/**
 * Navegador mínimo: Tizen 5.5 (TVs Samsung de 2020) usa Chromium 69.
 * Tizen 6.0 (2021) = Chromium 76; 6.5 (2022) = 85; 7.0 (2023) = 94; 8.0 (2024) = 108.
 */
const CHROME_TARGET = 'chrome69';

const webSrc = fileURLToPath(new URL('../web/app/src', import.meta.url));
const shim = (name: string) => fileURLToPath(new URL(`./src/shims/${name}`, import.meta.url));

/**
 * Compatibilidade com o navegador das TVs:
 *  - CSS do Tailwind v4 reescrito para o Chromium 69 (ver css-compat.ts) e auditado: o build falha
 *    se sobrar algum recurso que a TV descartaria;
 *  - script clássico em vez de módulo (módulos ES não carregam a partir de file://).
 */
function tizenCompat(): Plugin {
  return {
    name: 'tuitv-tizen-compat',
    apply: 'build',
    enforce: 'post',
    async generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.css')) continue;
        const source = typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source);
        const css = await compatCss(source, file.fileName);
        const problems = auditCss(css);
        if (problems.length) this.error(`CSS incompatível com Tizen 5.5 (Chromium 69):\n  ${problems.slice(0, 20).join('\n  ')}`);
        file.source = css;
      }
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html
          .replace(/<script type="module" crossorigin src=/g, '<script defer src=')
          .replace(/<script type="module" src=/g, '<script defer src=')
          .replace(/<link rel="modulepreload"[^>]*>/g, '')
          .replace(/ crossorigin/g, '');
      },
    },
  };
}

export default defineConfig(({ command }) => ({
  // Caminhos relativos: o pacote .wgt é aberto como arquivo local na TV.
  base: './',
  plugins: [react(), tizenCompat()],
  resolve: {
    alias: [
      { find: 'next/link', replacement: shim('next-link.tsx') },
      { find: 'next/navigation', replacement: shim('next-navigation.ts') },
      { find: '@', replacement: webSrc },
    ],
    dedupe: ['react', 'react-dom'],
  },
  define: {
    'process.env.NEXT_PUBLIC_BASE_PATH': JSON.stringify(''),
    // A TV não tem CORS (config.xml libera as origens): o proxy da versão Web não é usado.
    'process.env.NEXT_PUBLIC_CORS_PROXY': JSON.stringify(''),
    // Logins consultados por categoria: catálogos inteiros pesam demais na memória das TVs.
    'process.env.NEXT_PUBLIC_REMOTE_BY_CATEGORY': JSON.stringify('1'),
    // Tudo fica num único script: o auxiliar de pré-carregamento do Vite não precisa de import.meta.
    ...(command === 'build' ? { 'import.meta.url': JSON.stringify(''), 'import.meta.resolve': 'undefined' } : {}),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: CHROME_TARGET,
    cssTarget: CHROME_TARGET,
    cssMinify: false,
    // Um único arquivo de CSS (o formato IIFE injetaria o CSS no JavaScript, fora do pós-processamento).
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: 0,
    sourcemap: false,
    // Um único arquivo é o esperado (React, players HLS/MPEG-TS e polyfills ficam juntos no pacote local).
    chunkSizeWarningLimit: 4096,
    rolldownOptions: {
      output: {
        format: 'iife',
        codeSplitting: false,
        entryFileNames: 'assets/tuitv.js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
}));

import type { NextConfig } from 'next';

/**
 * O TuiTV Web é exportado como site estático (PRD §13): a hospedagem serve apenas
 * HTML, CSS, JavaScript e imagens. Não existe API, banco central ou servidor de autenticação.
 */
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  reactStrictMode: true,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  images: { unoptimized: true },
  transpilePackages: [
    '@tuitv/business-rules',
    '@tuitv/design-system',
    '@tuitv/m3u-parser',
    '@tuitv/shared-models',
    '@tuitv/validation',
  ],
};

export default config;

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import './globals.css';

const base = process.env.NEXT_PUBLIC_BASE_PATH || '';

export const metadata: Metadata = {
  title: { default: 'TuiTV', template: '%s · TuiTV' },
  description: 'Seu entretenimento em um só lugar. Player IPTV 100% local, sem conta e sem login.',
  applicationName: 'TuiTV',
  manifest: `${base}/manifest.webmanifest`,
  icons: {
    // Aba do navegador: só o gato em SVG (com o PNG na lista, o navegador escolhia o quadrado escuro).
    icon: [{ url: `${base}/icons/icon.svg`, type: 'image/svg+xml', sizes: 'any' }],
    apple: `${base}/icons/apple-touch-icon.png`,
  },
  appleWebApp: { capable: true, title: 'TuiTV', statusBarStyle: 'black-translucent' },
  referrer: 'no-referrer',
  robots: { index: false },
};

export const viewport: Viewport = {
  themeColor: '#101827',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/**
 * Política de segurança de conteúdo (PRD §10): scripts e estilos apenas da própria aplicação;
 * imagens, mídia e conexões podem vir das fontes que o usuário importar.
 * Aplicada apenas em produção (o modo de desenvolvimento do Next.js depende de eval).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  'img-src * data: blob:',
  'media-src * data: blob:',
  'connect-src *',
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const themeBoot = `try{if(localStorage.getItem('tuitv-theme')==='light')document.documentElement.dataset.theme='light'}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="dark" suppressHydrationWarning>
      <head>
        {process.env.NODE_ENV === 'production' && <meta httpEquiv="Content-Security-Policy" content={CSP} />}
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

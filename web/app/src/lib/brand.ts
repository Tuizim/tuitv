/**
 * Arquivos da marca (web/app/public/brand, gerados por `pnpm brand` a partir de img/).
 * Web: a partir da base do site. TV (Samsung): relativos ao index.html do pacote — a política de segurança
 * padrão do Tizen bloqueia imagens embutidas ("data:"), então a marca precisa ser arquivo.
 */
const base = process.env.NEXT_PUBLIC_ASSET_BASE ?? (process.env.NEXT_PUBLIC_BASE_PATH || '');

export const brandLogo = `${base}/brand/tuitv-logo.png`;
export const brandIcon = `${base}/brand/tuitv-icone.svg`;

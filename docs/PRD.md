# PRD — TuiTV v2.0 (resumo)

O documento oficial é o [PRD.pdf](../PRD.pdf). Este resumo relaciona cada requisito à implementação.

## Regra fundamental

Plataforma independente, local-first e sem contas. Nenhuma função essencial depende de backend, autenticação, banco remoto ou sincronização. A hospedagem Web serve apenas os arquivos da aplicação.

## Requisitos funcionais × implementação (Web)

| Requisito | Onde |
| --- | --- |
| RF-001 Inicialização (logotipo, preferências, último estado) | `components/AppShell.tsx` (Splash), `lib/store.ts` (`init`), último canal em `app/live` |
| RF-002 Primeiro acesso | `app/page.tsx` (`Welcome`) |
| RF-003 Importação por URL/arquivo e gerenciamento | `components/dialogs.tsx`, `lib/importer.ts`, `app/playlists` |
| RF-004 Parser M3U/M3U8 | `packages/m3u-parser` (+ `packages/kotlin-core`) |
| RF-005 TV ao vivo | `app/live`, `components/Player.tsx` |
| RF-006 Filmes · RF-007 Séries | `app/movies`, `app/series`, `app/watch`, `business-rules/classify.ts` e `library.ts` |
| RF-008 Favoritos | `app/favorites`, `components/cards.tsx` |
| RF-009 EPG XMLTV | `business-rules/epg.ts`, `app/guide` |
| RF-010 Pesquisa global (local) | `app/search`, `business-rules/library.ts` (`searchIn`) |
| RF-011 Histórico | `app/history`, `lib/store.ts` (`recordPlayback`) |
| RF-012 Múltiplas listas | `app/playlists` |
| RF-013 Configurações · RF-015 Privacidade | `app/settings` |
| RF-014 Player (HTML5 + HLS.js) | `components/Player.tsx` |
| §8 Armazenamento local (IndexedDB) e §8.3 Backup | `lib/db.ts`, `business-rules/backup.ts` |
| §10 Segurança | `packages/validation`, CSP em `app/layout.tsx`, cifragem em `lib/db.ts` |
| §12.4 PWA | `public/manifest.webmanifest`, `scripts/sw.template.js` |

## Escopo

- **P0** (identidade, splash, início, importação por URL/arquivo, parser, TV ao vivo, player, categorias, busca, favoritos, armazenamento local, sem conta): implementado na Web.
- **P1** (filmes, séries, múltiplas listas, histórico, EPG, backup, controle parental, PWA): implementado na Web.
- **Android e Android TV**: pendentes; o núcleo Kotlin com parser e regras já existe.
- **P2** (Samsung/LG, iOS): fora desta entrega.

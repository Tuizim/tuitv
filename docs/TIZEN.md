# TuiTV para Smart TVs Samsung (Tizen)

O aplicativo Tizen (`apps/tizen`) é a **mesma interface da aplicação Web**, empacotada como aplicativo de TV (`.wgt`).
Não há uma segunda interface para manter: as telas vêm de `apps/web/src`.

## Como funciona

| Web (navegador) | Tizen (TV) |
| --- | --- |
| Next.js, rotas por caminho (`/live/`) | Vite; as mesmas rotas no hash (`index.html#/live`), porque na TV o app abre de um arquivo local |
| `next/link`, `next/navigation` | Substituídos por `src/shims/` sobre `src/router.ts` |
| Mouse, toque, Tab | Controle remoto (`src/remote.ts`): setas com navegação espacial, OK, Voltar, mídia e canal |
| PWA (service worker) | Não se aplica; o pacote já está instalado |
| Restrições de CORS e conteúdo misto | Aplicativo empacotado com `<access origin="*">`: requisições às origens liberadas não dependem de CORS (comportamento do runtime Tizen; **conferir na TV**) |

### Compatibilidade com versões da Tizen

| Tizen | TVs | Chromium | Situação |
| --- | --- | --- | --- |
| 8.0+ | 2024+ | 108+ | Suportada |
| 7.0 | 2023 | 94 | Suportada |
| 6.5 | 2022 | 85 | Suportada |
| 6.0 | 2021 | 76 | Suportada; espaçamento menor entre alguns elementos (sem `gap` em flex, Chromium 84+) |
| 5.5 | 2020 | 69 | Mínimo suportado; mesma observação |
| ≤ 5.0 | ≤ 2019 | ≤ 63 | Não suportada |

O build garante isso automaticamente:

- **JavaScript** compilado para Chromium 69 e verificado como ES2019 (`scripts/check-syntax.mjs`); APIs ausentes vêm do core-js.
- **CSS** do Tailwind v4 reescrito para Chromium 69 (`css-compat.ts`): sem `@layer`, `:where()`/`:is()` expandidos,
  valores iniciais de `@property`, `translate`/`scale`/`rotate` → `transform`, alternativas para `dvh` e `aspect-ratio`,
  `:focus-visible` → `:focus`, e Lightning CSS para aninhamento e cores. Uma auditoria faz o build **falhar** se sobrar
  algum recurso que a TV descartaria.
- **Script clássico** (não módulo ES) e caminhos relativos, para carregar de `file://`.

## Gerar o pacote

```bash
pnpm install
pnpm build:tizen
```

- Sem certificado: `apps/tizen/build/TuiTV-sem-assinatura.wgt` (a TV **não** instala pacotes sem assinatura).
- Com o Tizen Studio e um perfil de certificado: `apps/tizen/build/TuiTV.wgt` assinado:

```bash
TIZEN_PROFILE=TuiTV pnpm build:tizen      # nome do perfil criado no Certificate Manager
# CLI fora do padrão (~/tizen-studio/tools/ide/bin/tizen)? Informe: TIZEN_CLI=/caminho/tizen
```

## Instalar na TV (modo desenvolvedor)

1. **Tizen Studio** com CLI. No *Package Manager*, instale *Samsung TV Extensions* e *Samsung Certificate Extension*.
2. **Modo desenvolvedor na TV:** abra *Apps*, digite `1 2 3 4 5` no controle, ative *Developer mode*, informe o IP do
   computador e reinicie a TV.
3. **Conectar:** `sdb connect IP_DA_TV` (o `sdb` fica em `~/tizen-studio/tools/`). `sdb devices` mostra o nome do aparelho.
4. **Certificado Samsung:** no *Certificate Manager*, crie um perfil **Samsung → TV** (entra com a conta Samsung) e
   inclua o **DUID** da TV (o assistente lê da TV conectada). Use o nome do perfil em `TIZEN_PROFILE`.
5. **Gerar e instalar:**

```bash
TIZEN_PROFILE=TuiTV pnpm build:tizen
tizen install -n apps/tizen/build/TuiTV.wgt -t NOME_DO_APARELHO
tizen run -p TuiTVtizen.TuiTV -t NOME_DO_APARELHO
```

O certificado de desenvolvedor só vale para as TVs cujo DUID foi incluído. Para distribuir a qualquer TV, o aplicativo
precisa passar pela *Samsung Seller Office* (loja Samsung Apps), que exige o certificado de distribuição e a revisão da Samsung.

## Controle remoto

| Onde | Tecla | Ação |
| --- | --- | --- |
| Qualquer tela | ◀ ▶ ▲ ▼ | move o foco para o elemento mais próximo naquela direção |
| | OK | ativa o elemento em foco |
| | Voltar | fecha o diálogo → sai da tela cheia → tela anterior → na tela inicial, fecha o app |
| Campos de texto | ◀ ▶ | movem o cursor; na borda do texto, o foco sai do campo |
| Player | ◀ ▶ (e ⏪ ⏩) | voltar / avançar 10 s |
| | ▲ ▼ / Canal + − | canal anterior / próximo |
| | ⏯ Play/Pause | pausar / continuar |
| | ■ Stop | sair do player |

## Testes

```bash
pnpm --filter @tuitv/tizen test     # compatibilidade do CSS (Vitest)
pnpm build:tizen && pnpm test:tizen  # ponta a ponta (Playwright) sobre o pacote aberto via file://
```

Os testes de ponta a ponta simulam a TV: pacote aberto de arquivo local, viewport 1280×720, API `tizen` falsa
(registro de teclas e encerramento) e uso só de teclas — inclusive adicionar lista por login, abrir canal,
trocar de canal com Canal −, Voltar e fechar o app. Capturas ficam em `apps/tizen/build/screenshots/`.

## Limitações conhecidas

- **Ainda não testado em TV real nem no emulador Tizen.** Os testes rodam em Chromium atual; a compatibilidade com
  versões antigas vem das transformações e auditorias do build, não de execução no aparelho.
- **Player:** o vídeo usa o elemento `<video>` com HLS.js / mpegts.js (como na Web), não a API nativa AVPlay da Samsung.
  Codecs e desempenho dependem da TV.
- **Menus do player** (áudio, legendas, proporção) foram feitos para mouse/toque: no controle, as setas controlam
  a reprodução e não chegam a esses botões.
- **Tizen 5.5/6.0:** espaçamento reduzido onde a interface usa `gap` em flex.
- Interface com escala fixa: largura lógica de 1280 px (1,5× em TVs Full HD).

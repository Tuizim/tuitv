# TuiTV

**Seu entretenimento em um só lugar.** Player IPTV multiplataforma, 100% local: sem conta, sem cadastro, sem login e sem backend.

O usuário importa as próprias listas M3U/M3U8, organiza canais, filmes e séries, consulta o guia de programação (XMLTV) e reproduz conteúdos de fontes autorizadas. Todos os dados ficam no dispositivo.

Especificação: [PRD.pdf](PRD.pdf) (resumo em [docs/PRD.md](docs/PRD.md)).

## Baixar

Sempre a versão mais recente:

| Aparelho | Arquivo |
| --- | --- |
| Android TV, Google TV, Fire TV | [TuiTV-AndroidTV.apk](https://github.com/Tuizim/tuitv/releases/latest/download/TuiTV-AndroidTV.apk) |
| Smart TV Samsung (Tizen) | [TuiTV-Tizen-sem-assinatura.wgt](https://github.com/Tuizim/tuitv/releases/latest/download/TuiTV-Tizen-sem-assinatura.wgt) (precisa ser assinado com o seu certificado Samsung; ver [docs/TIZEN.md](docs/TIZEN.md)) |

Todas as versões: [Releases](https://github.com/Tuizim/tuitv/releases). Como publicar uma versão: [docs/RELEASES.md](docs/RELEASES.md).

## Estado atual

| Parte | Estado |
| --- | --- |
| Pacotes compartilhados (modelos, parser M3U, regras, validação, design system) | Prontos e testados |
| **TuiTV Web** (React + Next.js, PWA) | Pronto: P0 e P1 do PRD, testado de ponta a ponta |
| Núcleo Kotlin (`android/core`) — parser, regras, EPG, busca e controle parental equivalentes ao TypeScript | Pronto e testado com os mesmos arquivos de referência |
| **TuiTV Android TV / Fire TV** (`android/app`: Compose for TV, Room, Media3) | Pronto para instalar por APK: P0 e P1 do PRD; testado em JVM (Robolectric), ainda **não testado em aparelho real** — ver [docs/ANDROID-TV.md](docs/ANDROID-TV.md) |
| **TuiTV Tizen** (`samsung`: Smart TVs Samsung, mesma interface da Web empacotada em `.wgt`) | Pacote gerado e testado (Chromium, via `file://`, só com teclas); assinatura e teste em TV real pendentes — ver [docs/TIZEN.md](docs/TIZEN.md) |
| TuiTV Android para celular/tablet | No mesmo APK de `android/app` (telas adaptadas a toque) |

## Estrutura

Três projetos, um por plataforma, que evoluem juntos (mesmas telas, mesmas regras):

```
web/                   TuiTV Web (pnpm + Turborepo)
  app/                 Aplicação Web (Next.js, exportação estática, PWA)
  packages/            Pacotes TypeScript compartilhados com a Samsung
    shared-models/     Tipos de dados (listas, itens, favoritos, histórico, EPG, backup)
    m3u-parser/        Interpretador M3U/M3U8 incremental + fixtures/ (arquivos de referência, usados também pelo Android)
    business-rules/    Classificação, séries, busca, EPG XMLTV, backup, controle parental
    validation/        Validação de endereços, limites, máscaras de credenciais, backup
    design-system/     Cores, logotipo e tema (Tailwind v4)
android/               TuiTV Android (projeto Gradle próprio: gradlew, gradle/libs.versions.toml)
  app/                 Aplicativo Android TV / Google TV / Fire TV / celular / tablet (Compose, Room, Media3)
  core/                Porte Kotlin/JVM do parser e das regras do TypeScript
samsung/               TuiTV para Smart TVs Samsung (Tizen): as telas de web/app empacotadas em .wgt
img/                   Identidade visual: tuitv-icone.svg (gato) e tuitv-logo.png (gato + nome)
docs/                  PRD, arquitetura e testes
```

Ícones e logotipos das três plataformas saem de `img/`: depois de trocar uma imagem, rode `pnpm brand`
(gera PWA/favicon da Web, ícone da Samsung, ícones/banner do Android e o logotipo usado nas telas).

## Como usar

Requisitos: Node 22+, pnpm 12 (`corepack enable pnpm`); para Kotlin/Android, JDK 17 (com `javac`) e Android SDK (`ANDROID_HOME`) com `platforms;android-37.0` e `build-tools;37.0.0`.

```bash
pnpm install
pnpm dev              # Web em http://localhost:3000
pnpm build            # gera web/app/out (site estático + service worker)
pnpm test             # testes unitários (TypeScript)
pnpm typecheck
pnpm test:e2e         # Playwright sobre o build estático (rode `pnpm build` antes)
pnpm build:samsung    # pacote .wgt para TVs Samsung em samsung/build/
pnpm test:samsung     # ponta a ponta do pacote Samsung (rode build:samsung antes)

cd android
./gradlew :core:test                 # testes do núcleo Kotlin
./gradlew :app:testDebugUnitTest     # testes do app (Robolectric) + capturas em android/app/build/screenshots
./gradlew :app:assembleRelease       # APK em android/app/build/outputs/apk/release/app-release.apk
```

Na primeira execução dos testes de ponta a ponta: `pnpm --filter @tuitv/web exec playwright install chromium`.

## Publicação da Web

`web/app/out` contém apenas arquivos estáticos; qualquer hospedagem estática serve. Não há API nem banco.
Use **HTTPS**: a PWA, a cifragem local de credenciais, o backup com senha e o controle parental dependem de contexto seguro.
Para publicar em subcaminho, defina `NEXT_PUBLIC_BASE_PATH=/caminho` no build.

## Limitações conhecidas da Web

São restrições dos navegadores, tratadas com mensagens claras no aplicativo:

- **CORS**: listas, guias e transmissões só funcionam se o servidor de origem permitir acesso pelo navegador. Para listas e guias, a alternativa é baixar o arquivo e importá-lo.
  Com um proxy de CORS ([web/app/cors-proxy/worker.js](web/app/cors-proxy/worker.js)) definido em `NEXT_PUBLIC_CORS_PROXY` no build, listas, guias e a API Xtream bloqueadas pelo navegador são buscadas por ele (o app tenta direto primeiro). O vídeo continua indo direto ao servidor.
  - Local: `npx wrangler dev cors-proxy/worker.js` em `web/app` e `NEXT_PUBLIC_CORS_PROXY=http://localhost:8787` em `web/app/.env.local`.
  - Publicado: `npx wrangler deploy cors-proxy/worker.js --name tuitv-cors`, com `ALLOWED_ORIGINS` limitado ao endereço do site.
- **Conteúdo misto**: com o TuiTV em `https://`, endereços `http://` são bloqueados.
- **Formatos**: tocam HLS (`.m3u8`, via HLS.js), MPEG-TS (via mpegts.js) e os formatos nativos do navegador (MP4, WebM…). Quando o endereço não revela o formato, o player o detecta pelos primeiros bytes. RTMP, RTSP e UDP não tocam em navegadores.

## Android TV e Fire TV

Como gerar o APK, instalar na TV ou na Fire TV (ADB ou app Downloader), usar o controle remoto e as limitações: [docs/ANDROID-TV.md](docs/ANDROID-TV.md).

## Smart TVs Samsung (Tizen)

Como gerar, assinar e instalar o pacote `.wgt`, versões da Tizen suportadas e uso do controle: [docs/TIZEN.md](docs/TIZEN.md).

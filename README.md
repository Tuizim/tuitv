# TuiTV

**Seu entretenimento em um só lugar.** Player IPTV multiplataforma, 100% local: sem conta, sem cadastro, sem login e sem backend.

O usuário importa as próprias listas M3U/M3U8, organiza canais, filmes e séries, consulta o guia de programação (XMLTV) e reproduz conteúdos de fontes autorizadas. Todos os dados ficam no dispositivo.

Especificação: [PRD.pdf](PRD.pdf) (resumo em [docs/PRD.md](docs/PRD.md)).

## Estado atual

| Parte | Estado |
| --- | --- |
| Pacotes compartilhados (modelos, parser M3U, regras, validação, design system) | Prontos e testados |
| **TuiTV Web** (React + Next.js, PWA) | Pronto: P0 e P1 do PRD, testado de ponta a ponta |
| Núcleo Kotlin (`packages/kotlin-core`) — parser, regras, EPG, busca e controle parental equivalentes ao TypeScript | Pronto e testado com os mesmos arquivos de referência |
| **TuiTV Android TV / Fire TV** (`apps/android-tv`: Compose for TV, Room, Media3) | Pronto para instalar por APK: P0 e P1 do PRD; testado em JVM (Robolectric), ainda **não testado em aparelho real** — ver [docs/ANDROID-TV.md](docs/ANDROID-TV.md) |
| **TuiTV Tizen** (`apps/tizen`: Smart TVs Samsung, mesma interface da Web empacotada em `.wgt`) | Pacote gerado e testado (Chromium, via `file://`, só com teclas); assinatura e teste em TV real pendentes — ver [docs/TIZEN.md](docs/TIZEN.md) |
| TuiTV Android para celular/tablet | Não iniciado (reaproveitará `kotlin-core` e a camada de dados do app de TV) |

## Estrutura

```
apps/
  web/                 Aplicação Web (Next.js, exportação estática, PWA)
  android-tv/          Aplicativo Android TV / Google TV / Fire TV (Kotlin, Compose for TV, Media3)
  tizen/               Aplicativo para Smart TVs Samsung (Tizen): a interface Web empacotada em .wgt
packages/
  shared-models/       Tipos de dados (listas, itens, favoritos, histórico, EPG, backup)
  m3u-parser/          Interpretador M3U/M3U8 incremental + fixtures/ (arquivos de referência)
  business-rules/      Classificação, séries, busca, EPG XMLTV, backup, controle parental
  validation/          Validação de endereços, limites, máscaras de credenciais, backup
  design-system/       Cores, logotipo e tema (Tailwind v4)
  kotlin-core/         Porte Kotlin/JVM do parser e das regras (base dos apps Android)
gradle/libs.versions.toml  Versões das dependências Kotlin/Android
docs/                  PRD, arquitetura e testes
```

## Como usar

Requisitos: Node 22+, pnpm 12 (`corepack enable pnpm`); para Kotlin/Android, JDK 17 (com `javac`) e Android SDK (`ANDROID_HOME`) com `platforms;android-37.0` e `build-tools;37.0.0`.

```bash
pnpm install
pnpm dev              # Web em http://localhost:3000
pnpm build            # gera apps/web/out (site estático + service worker)
pnpm test             # testes unitários (TypeScript)
pnpm typecheck
pnpm test:e2e         # Playwright sobre o build estático (rode `pnpm build` antes)
./gradlew :kotlin-core:test                 # testes do núcleo Kotlin
./gradlew :android-tv:testDebugUnitTest     # testes do app de TV (Robolectric) + capturas em apps/android-tv/build/screenshots
./gradlew :android-tv:assembleRelease       # APK para TV/Fire TV em apps/android-tv/build/outputs/apk/release/
pnpm build:tizen                            # pacote .wgt para TVs Samsung em apps/tizen/build/
pnpm test:tizen                             # ponta a ponta do pacote Tizen (rode build:tizen antes)
```

Na primeira execução dos testes de ponta a ponta: `pnpm --filter @tuitv/web exec playwright install chromium`.

## Publicação da Web

`apps/web/out` contém apenas arquivos estáticos; qualquer hospedagem estática serve. Não há API nem banco.
Use **HTTPS**: a PWA, a cifragem local de credenciais, o backup com senha e o controle parental dependem de contexto seguro.
Para publicar em subcaminho, defina `NEXT_PUBLIC_BASE_PATH=/caminho` no build.

## Limitações conhecidas da Web

São restrições dos navegadores, tratadas com mensagens claras no aplicativo:

- **CORS**: listas, guias e transmissões só funcionam se o servidor de origem permitir acesso pelo navegador. Para listas e guias, a alternativa é baixar o arquivo e importá-lo.
- **Conteúdo misto**: com o TuiTV em `https://`, endereços `http://` são bloqueados.
- **Formatos**: tocam HLS (`.m3u8`, via HLS.js), MPEG-TS (via mpegts.js) e os formatos nativos do navegador (MP4, WebM…). Quando o endereço não revela o formato, o player o detecta pelos primeiros bytes. RTMP, RTSP e UDP não tocam em navegadores.

## Android TV e Fire TV

Como gerar o APK, instalar na TV ou na Fire TV (ADB ou app Downloader), usar o controle remoto e as limitações: [docs/ANDROID-TV.md](docs/ANDROID-TV.md).

## Smart TVs Samsung (Tizen)

Como gerar, assinar e instalar o pacote `.wgt`, versões da Tizen suportadas e uso do controle: [docs/TIZEN.md](docs/TIZEN.md).

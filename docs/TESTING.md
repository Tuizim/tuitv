# Testes

| Camada | Ferramenta | Comando | O que cobre |
| --- | --- | --- | --- |
| Pacotes TypeScript | Vitest | `pnpm test` | Parser, classificação, ids estáveis, séries, busca, XMLTV, backup, PIN, validação de endereços |
| Núcleo Kotlin | JUnit | `cd android && ./gradlew :core:test` | Mesmos arquivos de referência do TypeScript; backup cifrado gerado pela Web; EPG, busca, parental e PBKDF2 portados |
| App Android TV | Robolectric + Compose UI Test | `cd android && ./gradlew :app:testDebugUnitTest` | Importação real em Room (arquivo, endereço via MockWebServer, gzip, Windows-1252), atualização sem duplicar, erros explicados, guia `url-tvg` automático e programa atual, backup Web ⇄ TV, parental, histórico; telas em 1920x1080 com capturas em `android/app/build/screenshots`; abrir o player e trocar de canal pelo D-pad |
| Tizen | Vitest + Playwright | `pnpm --filter @tuitv/samsung test`, `pnpm build:samsung && pnpm test:samsung` | Compatibilidade do CSS com Chromium 69 e sintaxe ES2019; pacote aberto via `file://` em 1280×720, operado só por teclas (login, canal, Canal −, Voltar, fechar o app) |
| Web, ponta a ponta | Playwright | `pnpm build && pnpm test:e2e` | Fluxos reais sobre o build estático, em desktop e celular |

## Cenários de ponta a ponta (`web/app/e2e/app.spec.ts`)

- Primeiro acesso sem cadastro; menu na ordem do PRD.
- Importação por arquivo, por endereço e por login (host, usuário e senha, com guia do mesmo login); categorias, filtro, favoritos; persistência após recarregar.
- Atualização sem duplicar e preservando favoritos; renomear, desativar e excluir listas.
- Recusa de endereço interno, conteúdo que não é M3U, fonte sem CORS e erro HTTP.
- Registros incompletos não interrompem a importação.
- Filmes, séries, temporadas, episódio assistido, página de reprodução e busca global.
- Guia XMLTV por endereço, grade e programa atual.
- Backup com senha: exportar, excluir tudo, senha errada, restaurar.
- Controle parental: categoria oculta nas telas e na busca até informar o PIN.
- Lista de 30 mil canais: importação, virtualização e tempo de busca.
- PWA: manifesto, service worker, uso sem internet e ausência de requisições a terceiros.
- Layout móvel sem rolagem horizontal.

Um servidor local (`e2e/fixture-server.mjs`) faz o papel de fonte remota.

## Verificação manual de reprodução

O Chromium do Playwright não inclui H.264/AAC, então a reprodução real foi conferida no Google Chrome com transmissões públicas de teste: HLS ao vivo, seleção de legendas, MP4, WebM, avanço automático de episódio, retomada de posição, canal fora do ar e endereço RTMP.

## Ainda não coberto

- Firefox, Safari e Edge (apenas Chrome/Chromium foram exercitados).
- Metas de tempo do PRD em dispositivos de referência: só há medições em máquina de desenvolvimento.
- App de TV em aparelho real ou emulador: o emulador exige KVM (`/dev/kvm`), indisponível sem permissão nesta máquina. Reprodução de vídeo real (decodificação, HLS ao vivo, legendas) ainda não foi conferida no Android.
- Aplicativo Tizen em TV real ou no emulador Tizen (exige Tizen Studio e certificado Samsung); versões antigas da Tizen só cobertas pelas transformações e auditorias do build.
- Aplicativo Android para celular/tablet, que ainda não existe.

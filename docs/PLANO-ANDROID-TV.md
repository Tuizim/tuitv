# Plano — TuiTV para Android TV e Fire TV

Status: **F0–F4 implementadas; F5 parcial** (APK instalável gerado; publicação em loja pendente).
Instalação e uso: [ANDROID-TV.md](ANDROID-TV.md). Itens **[decidir]** abaixo receberam um valor padrão (ver seção 11) e podem ser revistos.

## 1. Escopo

Um único aplicativo Android TV, distribuído para:

- **Android TV / Google TV** (Play Store ou APK);
- **Fire TV** (Fire OS é baseado em Android e aceita apps Android TV; a Amazon Appstore ou APK sideload). *Confirmar na documentação da Amazon as exigências de publicação e a versão mínima de Fire OS dos aparelhos disponíveis.*

Fora deste escopo agora: aplicativo de celular/tablet Android (será uma etapa própria, reaproveitando as mesmas camadas), Samsung/LG e iOS (P2 do PRD).

## 2. Decisões técnicas (propostas)

| Tema | Proposta | Motivo |
| --- | --- | --- |
| Linguagem / UI | Kotlin + Jetpack Compose for TV (`androidx.tv`) | Foco por D-pad e temas próprios para TV; mesma linguagem do `android/core` |
| Reprodução | Media3 / ExoPlayer (módulos HLS e TS) | Equivalente ao HLS.js + mpegts.js da Web, com decodificação por hardware |
| Persistência | Room, com o mesmo modelo de `web/packages/shared-models` | Substitui o IndexedDB; permite migrar backups da Web |
| Cifragem de endereços | AES-GCM com chave no Android Keystore | Mesmo critério da Web (`lib/db.ts`) |
| Regras | `android/core` como dependência Gradle local | Já testado contra os mesmos arquivos de referência do TypeScript |
| Injeção de dependência | Manual (sem Hilt no início) | Menos peças para um app pequeno; revisitar se crescer |
| Tarefas em segundo plano | WorkManager | Atualização automática de listas e guias (padrão de 1 dia, como na Web) |
| `minSdk` | **[decidir]** proposta: 24 | Cobre a maioria dos Fire TV e TVs Android atuais. Fire OS 5 (API 22) ficaria de fora; confirmar se algum aparelho do usuário precisa de suporte |
| `applicationId` | **[decidir]** ex.: `tv.tui.tuitv` | Identificador definitivo antes da primeira publicação; não muda depois |

## 3. Estrutura do projeto

```
apps/
  android-tv/            Aplicativo Android TV (Compose for TV, Media3, Room)
web/packages/
  kotlin-core/           (já existe) regras e parser em Kotlin/JVM puro
```

Se o app de celular entrar depois, cria-se `apps/android-mobile/` e um módulo `android-common` (Room, repositórios, player) compartilhado. Não criar agora.

O `settings.gradle.kts` da raiz já inclui `android/core`; o módulo `:android-tv` é adicionado ali.

## 4. Lacunas conhecidas entre Web e Kotlin

Revisar antes de cada etapa, porque o `android/core` não cobre tudo o que a Web faz:

- **EPG XMLTV** (`web/packages/business-rules/src/epg.ts`): não há equivalente em Kotlin. Precisa de porte e de testes com arquivos de referência.
- **Pesquisa e normalização** (`searchIn` em `business-rules`): conferir o que já está em `Library.kt`.
- **Controle parental** (PIN, classificação): conferir se há equivalente em Kotlin.
- **Player**: não há porte; a Web usa HLS.js/mpegts.js, o app usa Media3. Os formatos e as falhas precisam de nova tabela de comportamento.
- **Backup**: `Backup.kt` já lê backups da Web (testado); falta gravar, se for necessário.

## 5. Interação com controle remoto (requisito principal de TV)

- Navegação 100% por D-pad, com foco visível em todos os elementos.
- Tecla Voltar: volta uma tela, e fecha o player antes de sair do app.
- Canal + / − (`KEYCODE_CHANNEL_UP/DOWN`) para trocar de canal ao vivo.
- Play/pausa, avançar e voltar (`KEYCODE_MEDIA_*`) nos filmes e séries.
- Grades e fileiras virtualizadas (`TvLazyRow` / `TvLazyColumn`), sem carregar a biblioteca inteira na memória.
- Textos grandes e contraste para leitura a 3 metros.
- Entrada de texto (busca, endereço de lista) por teclado virtual; avaliar suporte a teclado físico/Bluetooth.

## 6. Limitações a comunicar ao usuário

- Formatos sem suporte em Media3 (por exemplo RTMP e RTSP) continuam fora, como na Web. A explicação de erro deve ser igual à da Web.
- CORS é restrição do navegador e não se aplica ao app nativo. Listas e guias por endereço devem funcionar em servidores que hoje bloqueiam a Web. Isso precisa ser confirmado com testes reais, não assumido.
- Endereços `http://` passam a ser aceitos no app nativo, a menos que se decida bloquear. **[decidir]** manter o bloqueio por segurança ou liberar com aviso.

## 7. Fases

| Fase | Entrega | Critério de saída |
| --- | --- | --- |
| **F0 — Preparação** | SDK instalado (platform, build-tools, emulador Android TV), decisões da seção 2, lista de aparelhos de teste | `./gradlew :core:test` passando e app vazio abrindo no emulador |
| **F1 — Spike de reprodução** | Tela única com um canal HLS e um TS, D-pad e canal +/− | Reproduz HLS e TS em emulador e em um aparelho real (Fire TV ou Android TV) |
| **F2 — Dados e importação** | Room, importação por URL e arquivo com `android/core`, cifragem, favoritos e histórico | Importar a mesma lista duas vezes não duplica itens; favoritos sobrevivem |
| **F3 — Interface TV** | Início, TV ao vivo, filmes, séries, busca, favoritos, histórico, configurações | Toda a navegação funciona só com o controle remoto |
| **F4 — Recursos P1** | EPG (porte), múltiplas listas, controle parental, backup, atualização automática | Backup gerado pela Web restaura no app; guia exibe programação |
| **F5 — Publicação** | Build assinado, ícone e banner de TV, política de privacidade, ficha para Play e Amazon | Instalação limpa por APK e pela loja em pelo menos um Fire TV e uma Android TV |

Cada fase termina com testes automatizados e um teste manual no aparelho real.

## 8. Testes

- **Unitários:** `android/core` (já existe, com fixtures compartilhadas).
- **Instrumentados:** Room e importação, em emulador Android TV (imagem de sistema x86_64).
- **Manuais:** matriz em aparelho real — pelo menos um Fire TV Stick, uma Android TV (ou Google TV) e, se possível, um Fire TV com Fire OS recente. Anotar versão de Fire OS / Android, resolução e o resultado de cada formato de lista.
- **Desempenho:** listas grandes (dezenas de milhares de itens) com tempo de importação e uso de memória medidos.

## 9. Preparação do ambiente

Hoje `ANDROID_HOME=/home/tuizim/Android/Sdk` contém só `cmdline-tools`. Para a F0:

```bash
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" \
  "emulator" "system-images;android-35;android-tv;x86_64"
```

(Versões de exemplo: confirmar a mais recente estável antes de instalar. Aceitar as licenças com `sdkmanager --licenses`.)

## 10. Perguntas que bloqueiam a F0

1. Quais aparelhos vai testar (modelo do Fire TV e da Android TV / Google TV)? Isso define o `minSdk`.
2. Destino de publicação: Play Store, Amazon Appstore, ou ambas com APK também?
3. `applicationId` definitivo (ex.: `tv.tui.tuitv`)?
4. `http://` no app nativo: bloquear como na Web ou liberar com aviso?

## 11. Decisões tomadas na implementação (revisáveis)

| Pergunta | Decisão | Motivo |
| --- | --- | --- |
| `minSdk` | **23** (Android 6 / Fire OS 6+) | Mínimo das bibliotecas atuais; cobre Fire TV Stick 4K e posteriores. Fire OS 5 (API 22) fica de fora |
| `applicationId` | **`tv.tui.tuitv`** (`tv.tui.tuitv.debug` no build de depuração) | Mesmo prefixo do `android/core`; não muda após a primeira publicação |
| Publicação | **APK** (ADB ou Downloader) nesta etapa | Play e Amazon exigem chave definitiva, ficha e política de privacidade publicadas |
| `http://` | **Permitido** | Listas e transmissões IPTV usam http; no app nativo não há conteúdo misto. A validação de rede local continua (configurável) |
| Assinatura | Chave definitiva via `scripts/create-keystore.sh`; sem ela, chave de depuração local | Permite instalar já; a chave definitiva precisa ser guardada para atualizações |
| Celular/tablet | Fora desta etapa | Mesma base (`android/core` e camada de dados) |

## 12. Estado das fases

| Fase | Estado |
| --- | --- |
| F0 — Preparação | Feita: SDK (platform 37, build-tools 37, imagem Android TV 36), AGP 9.5, Gradle 9.9, catálogo de versões |
| F1 — Reprodução | Feita no código: Media3 com estratégias (auto → HLS → variante), reconexão, D-pad, canal ±, números, menu de faixas. **Não conferida em aparelho real** |
| F2 — Dados e importação | Feita e testada (Robolectric): Room, arquivo e endereço, gzip, Windows-1252, gerações, cifragem, favoritos, histórico |
| F3 — Interface TV | Feita: início, ao vivo, filmes, séries, guia, busca, favoritos, histórico, listas, configurações; capturas 1080p nos testes |
| F4 — Recursos P1 | Feita: EPG portado (XMLTV) com guia automático via `url-tvg`, múltiplas listas, parental com PIN, backup compatível com a Web, atualização automática |
| F5 — Publicação | Parcial: APK de release (R8, v1+v2) e guia de instalação. Falta: teste em Fire TV e Android TV reais, chave definitiva, fichas das lojas |

### Próximos passos

1. Instalar o APK em uma Fire TV e em uma Android TV e percorrer a matriz da seção 8 (formatos, listas grandes, memória).
2. Liberar o emulador nesta máquina (`sudo usermod -aG kvm $USER` e reiniciar o WSL) para testes instrumentados.
3. Opcional: cabeçalhos `#EXTVLCOPT` (User-Agent/Referer por canal), idioma inglês, app de celular/tablet.

# TuiTV para Android TV e Fire TV

Um único APK atende Android TV, Google TV e Fire TV (Fire OS 6 ou mais recente, ou seja, Android 6+ / API 23+).

## 1. Gerar o APK

Requisitos: JDK 17 (com `javac`) e Android SDK com `platforms;android-37.0` e `build-tools;37.0.0`
(`ANDROID_HOME` apontando para o SDK). O Gradle escolhe o JDK 17 sozinho (`gradle/gradle-daemon-jvm.properties`).

```bash
./gradlew :android-tv:assembleRelease
# APK: apps/android-tv/build/outputs/apk/release/android-tv-release.apk  (~2,7 MB)
```

A chave definitiva já foi criada em `~/.tuitv/` e é a usada nas releases do GitHub (ver [RELEASES.md](RELEASES.md)).

Sem `apps/android-tv/keystore.properties`, o APK de release é assinado com a **chave de depuração desta máquina**.
Isso basta para instalar por APK; atualizações futuras precisam ser assinadas pela mesma chave
(a de depuração fica em `~/.android/debug.keystore`).

Para uma chave definitiva (obrigatória para lojas):

```bash
apps/android-tv/scripts/create-keystore.sh      # cria ~/.tuitv/tuitv-release.jks e keystore.properties
./gradlew :android-tv:assembleRelease
```

Guarde o `.jks` e a senha fora do repositório. Perder a chave impede atualizar quem já instalou.

## 2. Instalar no aparelho

### Fire TV (Fire TV Stick, Fire TV Cube, TVs com Fire OS)

Os nomes dos menus variam um pouco conforme o modelo e a versão do Fire OS.

1. **Ativar as opções de desenvolvedor:** Configurações → *Minha Fire TV* → *Sobre* → selecione o nome do aparelho
   (ex.: "Fire TV Stick") 7 vezes. Em modelos antigos, as opções já aparecem em *Minha Fire TV*.
2. Em *Minha Fire TV* → *Opções do desenvolvedor*: ative **Depuração ADB**.
3. Anote o IP: *Minha Fire TV* → *Sobre* → *Rede*.

**Opção A — pelo computador (ADB, mesma rede Wi-Fi):**

```bash
adb connect 192.168.0.50:5555        # IP da Fire TV; aceite o pedido que aparece na TV
adb install -r apps/android-tv/build/outputs/apk/release/android-tv-release.apk
```

`adb` está em `$ANDROID_HOME/platform-tools`. No WSL, se a conexão falhar, use o `adb` do Windows
(Android SDK Platform-Tools para Windows) com o mesmo comando.

**Opção B — sem computador (app Downloader):**

1. Instale o app **Downloader** pela Amazon Appstore.
2. Em *Opções do desenvolvedor* → *Instalar apps desconhecidos*, permita o Downloader.
3. Publique o APK num endereço acessível pela TV (servidor na sua rede, link direto de nuvem) e abra esse endereço no Downloader.

### Android TV / Google TV (TVs Sony, TCL, Philips, Chromecast com Google TV, TV boxes)

1. **Opções de desenvolvedor:** Configurações → *Sistema* → *Sobre* → selecione *Build do Android TV OS* 7 vezes.
2. Em *Opções do desenvolvedor*: ative **Depuração USB** (em alguns modelos, *Depuração pela rede* / ADB por rede).
3. IP da TV: *Configurações* → *Rede e Internet* → sua rede.
4. Pelo computador: `adb connect IP:5555` e `adb install -r android-tv-release.apk` (aceite o pedido na TV).

Sem computador: instale um gerenciador de arquivos ou o Downloader pela Play Store, permita
"fontes desconhecidas" para ele (*Configurações* → *Apps* → *Segurança e restrições*) e abra o APK.

O TuiTV aparece na fileira de apps da tela inicial (banner próprio no Android TV; ícone na Fire TV).

## 3. Primeiro uso

1. **Adicionar lista**, de um dos dois jeitos:
   - **Login (host, usuário e senha):** os três dados que o provedor envia (formato Xtream Codes). É o mais fácil de digitar
     com o controle. O host aceita `servidor.com:8080` (sem `http://`, assumido) ou o endereço completo. O app monta o endereço
     da lista (`get.php`, canais + filmes + séries) e adiciona o guia de programação do mesmo login (`xmltv.php`).
   - **Link M3U:** o endereço completo da lista.

   Dica: para textos longos, use o teclado do app do controle no celular (Google TV / Fire TV) ou um teclado Bluetooth.
   Senha nova do provedor? Em *Listas*, use **Editar login** — favoritos e histórico são mantidos.
2. Ou **Restaurar backup**: exporte um backup no TuiTV Web (Configurações → Backup), publique o arquivo num endereço
   e restaure pelo endereço — listas, favoritos, histórico e guias vêm juntos.
3. Listas que anunciam um guia (`url-tvg`) adicionam o guia de programação automaticamente.

A Fire TV não tem seletor de arquivos do sistema; por isso, toda importação também funciona por endereço.

## 4. Controle remoto

| Onde | Tecla | Ação |
| --- | --- | --- |
| Listas e grades | ◀ ▶ ▲ ▼ / OK | navegar / abrir |
| | OK pressionado | favoritar / remover favorito |
| | Voltar | tela anterior |
| Player ao vivo | ▲ ▼ ou Canal + / − | próximo / anterior canal da categoria |
| | Números (controles com teclado numérico) | ir ao canal pelo número |
| | OK | informações (programa atual e próximo) |
| Player de filmes e séries | OK ou ⏯ | pausar / continuar |
| | ◀ ▶ | voltar / avançar 10 s |
| | ⏪ ⏩ | voltar / avançar 30 s |
| Qualquer player | ☰ (Menu) | áudio, legendas, proporção, favorito |

## 5. Limitações conhecidas

- Formatos: HLS, MPEG-TS, MP4, MKV, WebM e demais formatos do Media3. RTMP, RTSP e UDP não são reproduzidos (como na Web).
- Conteúdo com DRM não é suportado.
- Codecs dependem do aparelho (ex.: HEVC/H.265 em aparelhos antigos); o app informa quando o aparelho não decodifica o conteúdo.
- Interface somente em português (pt-BR) nesta versão.
- O PIN parental não é recuperável: esquecido o PIN, limpe os dados do app e restaure um backup.

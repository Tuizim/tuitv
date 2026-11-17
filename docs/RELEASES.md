# Versões e downloads

Cada versão do TuiTV é uma **tag Git** `vMAIOR.MENOR.CORREÇÃO`. Ao enviar a tag, o GitHub Actions
([.github/workflows/release.yml](../.github/workflows/release.yml)) roda os testes, gera os pacotes e cria a release.

## Links fixos (sempre a última versão)

Os arquivos têm o mesmo nome em todas as versões, então estes links nunca mudam:

| Aparelho | Link |
| --- | --- |
| Android TV / Google TV / Fire TV | `https://github.com/Tuizim/tuitv/releases/latest/download/TuiTV-AndroidTV.apk` |
| Samsung (Tizen) | `https://github.com/Tuizim/tuitv/releases/latest/download/TuiTV-Tizen-sem-assinatura.wgt` |
| Somas SHA-256 | `https://github.com/Tuizim/tuitv/releases/latest/download/SHA256SUMS.txt` |

Para baixar direto na TV, os links só funcionam com o **repositório público** (em repositório privado o GitHub exige login).

**Fire TV / Android TV:** instale o app *Downloader* (AFTVnews), permita "Instalar apps desconhecidos" para ele e
digite o link do APK. Para uma nova versão, o mesmo link instala por cima, mantendo listas e favoritos.

**Samsung:** a TV só aceita pacotes assinados com o certificado do desenvolvedor que inclui o DUID dela,
por isso a release traz o pacote sem assinatura. Para assinar o `.wgt` baixado:
`tizen package -t wgt -s <perfil> -- TuiTV-Tizen-sem-assinatura.wgt` (ou gere localmente com `TIZEN_PROFILE`; ver [TIZEN.md](TIZEN.md)).

## Publicar uma versão

```bash
git tag v0.2.0
git push origin v0.2.0
```

- A versão da tag vai para o APK (`versionName` 0.2.0, `versionCode` 200) e para o `config.xml` da Tizen.
  Cada versão precisa ser **maior** que a anterior, ou o Android recusa a atualização.
- Tags com sufixo (`v0.3.0-beta.1`) viram **pré-release** e não mudam o link "latest".
- As notas da release são geradas a partir dos commits desde a tag anterior.
- Se algum teste falhar, nada é publicado. Para tentar de novo com a mesma versão:
  `git push --delete origin v0.2.0 && git tag -f v0.2.0 && git push origin v0.2.0`.

Builds locais sem tag usam a versão 0.1.0. Para outra: `./gradlew -Ptuitv.version=1.2.3 :android-tv:assembleRelease`
e `TUITV_VERSION=1.2.3 pnpm build:tizen`.

## Chave de assinatura do Android

Todas as versões do APK precisam ser assinadas com **a mesma chave**; com outra, o aparelho recusa a atualização
e só instala depois de desinstalar (perdendo os dados). A chave definitiva fica fora do repositório:

- `~/.tuitv/tuitv-release.jks` (alias `tuitv`) e a senha em `~/.tuitv/tuitv-release.password`;
- `apps/android-tv/keystore.properties` aponta para ela nos builds locais.

**Faça uma cópia de segurança desses dois arquivos** (gerenciador de senhas, cofre). Perder a chave significa
que nenhuma instalação existente poderá ser atualizada.

No GitHub (*Settings → Secrets and variables → Actions*), cadastre:

| Secret | Valor |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | saída de `base64 -w0 ~/.tuitv/tuitv-release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | conteúdo de `~/.tuitv/tuitv-release.password` |
| `ANDROID_KEY_ALIAS` | opcional; padrão `tuitv` |

Sem esses secrets o workflow falha de propósito, em vez de publicar um APK assinado com uma chave descartável.

Com o GitHub CLI autenticado, o cadastro pode ser feito assim:

```bash
base64 -w0 ~/.tuitv/tuitv-release.jks | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD --body "$(cat ~/.tuitv/tuitv-release.password)"
```

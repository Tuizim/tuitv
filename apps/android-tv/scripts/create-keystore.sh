#!/usr/bin/env bash
# Cria a chave de assinatura definitiva do TuiTV e o arquivo apps/android-tv/keystore.properties.
# A MESMA chave precisa assinar todas as versões futuras: sem ela, aparelhos com o app instalado
# não aceitam atualizações. Guarde o arquivo .jks e as senhas fora do repositório (ambos são ignorados pelo Git).
set -euo pipefail
cd "$(dirname "$0")/.."
STORE=${1:-$HOME/.tuitv/tuitv-release.jks}
ALIAS=tuitv

if [[ -e keystore.properties ]]; then
  echo "keystore.properties já existe; nada foi alterado." >&2
  exit 1
fi
mkdir -p "$(dirname "$STORE")"
read -rsp "Senha da chave (mín. 6 caracteres): " PASS; echo
read -rsp "Repita a senha: " PASS2; echo
[[ "$PASS" == "$PASS2" ]] || { echo "As senhas não conferem." >&2; exit 1; }

keytool -genkeypair -v -keystore "$STORE" -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=TuiTV"

cat > keystore.properties <<EOF
storeFile=$STORE
storePassword=$PASS
keyAlias=$ALIAS
keyPassword=$PASS
EOF
chmod 600 keystore.properties
echo "Pronto. O próximo './gradlew :android-tv:assembleRelease' usa esta chave."
echo "Faça uma cópia de segurança de $STORE e da senha."

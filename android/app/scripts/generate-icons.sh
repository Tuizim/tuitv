#!/usr/bin/env bash
# Gera o banner de TV e os ícones PNG do aplicativo a partir da identidade visual
# (web/packages/design-system/src/logo.ts). Requer ImageMagick (`convert`).
# Os arquivos gerados são versionados; rode novamente apenas se o logotipo mudar.
set -euo pipefail
cd "$(dirname "$0")/.."
RES=src/main/res
WEB_ICON=../../web/app/public/icons/icon-512.png
NAVY='#101827'
CYAN='#38BDF8'
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Banner 16:9 do launcher do Android TV (320x180 em xhdpi).
cat >"$TMP/banner.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="$NAVY"/>
  <g transform="translate(70 100) scale(0.3125)">
    <circle cx="256" cy="256" r="256" fill="$CYAN"/>
    <path d="M212 168c0-12 13-19 23-13l132 88c9 6 9 20 0 26l-132 88c-10 6-23-1-23-13z" fill="$NAVY"/>
  </g>
  <text x="250" y="216" font-family="DejaVu Sans" font-size="96" font-weight="bold" fill="#FFFFFF">Tui</text>
  <text x="402" y="216" font-family="DejaVu Sans" font-size="96" font-weight="bold" fill="$CYAN">TV</text>
</svg>
SVG
mkdir -p "$RES/drawable-xhdpi"
convert -background none -density 96 "$TMP/banner.svg" -resize 320x180 "$RES/drawable-xhdpi/banner.png"

# Ícone quadrado (aparelhos com API < 26 e Fire TV).
for pair in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  dir=${pair%%:*}
  size=${pair##*:}
  mkdir -p "$RES/mipmap-$dir"
  convert "$WEB_ICON" -resize "${size}x${size}" "$RES/mipmap-$dir/ic_launcher.png"
done
echo "Ícones gerados em $RES"

#!/usr/bin/env bash
# Rasterise the app icon, Android adaptive foreground, splash and favicon from
# assets/icon.svg. Needs rsvg-convert and ImageMagick (`brew install librsvg imagemagick`).
#
# The variants reuse the mark from icon.svg and only change the ground and
# the mark's placement on a 1024 canvas:
#   icon.png           slate ground, mark 640px (no alpha: App Store rejects it)
#   adaptive-icon.png  transparent, mark 420px (diagonal fits Android's 66% safe-zone circle;
#                      background colour comes from app.json)
#   splash-icon.png    transparent, mark 560px (splash backgroundColor in app.json)
#   favicon.png        48px rounded slate tile, mark 32px
#   icon-mac.png       macOS app icon (desktop/): transparent, 824px rounded slate tile
#                      on Apple's 1024 grid with a soft shadow, mark 515px. macOS does
#                      not mask icons the way iOS does, so the shape is baked in.
set -euo pipefail
cd "$(dirname "$0")/../assets"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

mark=$(sed -n '/<g transform=/,/<\/g>/p' icon.svg | sed '1d;$d')

variant() { # out.svg size ground-svg translate scale
  cat > "$tmp/$1" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" width="$2" height="$2" viewBox="0 0 $2 $2">
  $3
  <g transform="translate($4 $4) scale($5)">
$mark
  </g>
</svg>
EOF
}

rsvg-convert -w 1024 -h 1024 icon.svg | magick - -background '#121316' -alpha remove -alpha off PNG24:icon.png

variant adaptive.svg 1024 '' 302 10.5
rsvg-convert -w 1024 -h 1024 "$tmp/adaptive.svg" -o adaptive-icon.png

variant splash.svg 1024 '' 232 14
rsvg-convert -w 1024 -h 1024 "$tmp/splash.svg" -o splash-icon.png

variant favicon.svg 48 '<rect width="48" height="48" rx="12" fill="#121316"/>' 8 0.8
rsvg-convert -w 48 -h 48 "$tmp/favicon.svg" -o favicon.png

# The shadow is a blurred copy under the tile rather than feDropShadow on it:
# librsvg's feDropShadow shifts the tile's own colour.
mac_ground='<defs>
    <filter id="blur" x="-10%" y="-10%" width="120%" height="125%">
      <feGaussianBlur stdDeviation="12"/>
    </filter>
  </defs>
  <rect x="100" y="110" width="824" height="824" rx="185" fill="#000" fill-opacity="0.35" filter="url(#blur)"/>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="#121316"/>
  <rect x="100.5" y="100.5" width="823" height="823" rx="184.5" fill="none" stroke="#fff" stroke-opacity="0.1"/>'
variant mac.svg 1024 "$mac_ground" 254.5 12.875
rsvg-convert -w 1024 -h 1024 "$tmp/mac.svg" -o icon-mac.png

magick identify -format '%f %wx%h %[channels]\n' icon.png adaptive-icon.png splash-icon.png favicon.png icon-mac.png

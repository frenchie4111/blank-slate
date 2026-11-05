#!/usr/bin/env bash
#
# Fails unless every .app and .dmg in release/ is Developer ID-signed,
# notarized and stapled, the way v1.1.0 shipped.
#
# electron-builder reports "skipped macOS application code signing" or
# "skipped macOS notarization" and still exits 0 when it can't find the
# identity or the Apple credentials. A green build therefore proves nothing.
# This script decides whether the build passed. The release and smoke
# workflows both run it, and it works locally after `npm run dist`:
#
#   scripts/verify-mac.sh

set -euo pipefail

cd "$(dirname "$0")/../release"

shopt -s nullglob
apps=(mac*/*.app)
dmgs=(*.dmg)

if [ ${#apps[@]} -eq 0 ] && [ ${#dmgs[@]} -eq 0 ]; then
    echo "::error::Nothing to verify in release/. Did the build run?"
    exit 1
fi

# Gatekeeper's verdict, which is what users actually see. `spctl` prints it on
# stderr, and an unnotarized build reports "Unnotarized Developer ID" even
# though codesign has no complaint.
assess() {
    local verdict
    verdict=$(spctl --assess -vv "$@" 2>&1 || true)
    echo "$verdict"
    if ! grep -q "source=Notarized Developer ID" <<<"$verdict"; then
        echo "::error::${*: -1} was not accepted as Notarized Developer ID."
        exit 1
    fi
}

for app in "${apps[@]}"; do
    echo "== $app"
    codesign --verify --deep --strict --verbose=2 "$app"
    codesign -dv --verbose=4 "$app" 2>&1 | grep -E "^Authority=Developer ID Application|^TeamIdentifier" \
        || { echo "::error::$app is not signed with a Developer ID Application certificate."; exit 1; }
    assess --type execute "$app"
    xcrun stapler validate "$app"
done

for dmg in "${dmgs[@]}"; do
    echo "== $dmg"
    codesign --verify --verbose=2 "$dmg"
    codesign -dv --verbose=4 "$dmg" 2>&1 | grep -E "^Authority=Developer ID Application" \
        || { echo "::error::$dmg is not signed with a Developer ID Application certificate."; exit 1; }
    # A disk image is assessed as something to open, using its own signature,
    # not the signature of the app inside it.
    assess --type open --context context:primary-signature "$dmg"
    xcrun stapler validate "$dmg"
done

echo "Verified ${#apps[@]} app(s) and ${#dmgs[@]} DMG(s)."

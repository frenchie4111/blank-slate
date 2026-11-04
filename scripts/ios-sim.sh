#!/usr/bin/env bash
# Build the dev client, install it on an iOS simulator and run it against Metro.
#
#   scripts/ios-sim.sh [udid]
#
# With no UDID it uses the booted iPhone simulator, and stops if there are
# none or several. A UDID that isn't booted is booted first.
#
# This replaces `npx expo run:ios`, which fails on Xcode 27 (Simulator is now
# DeviceHub), and passes IPHONEOS_DEPLOYMENT_TARGET=15.1, which three pods
# need to build there.
set -euo pipefail
cd "$(dirname "$0")/.."

BUNDLE_ID=org.mikelyons.blank-slate
METRO_PORT=8081

udid=${1:-}
if [[ -z $udid ]]; then
  booted=$(xcrun simctl list devices booted | grep -E '^\s+iPhone' || true)
  count=$(printf '%s' "$booted" | grep -c . || true)
  if [[ $count -eq 0 ]]; then
    echo "No booted iPhone simulator. Boot one in Simulator, or pass a UDID:" >&2
    xcrun simctl list devices available | grep -E '^\s+iPhone' >&2 || true
    exit 1
  elif [[ $count -gt 1 ]]; then
    echo "Several iPhone simulators are booted; pass the UDID of one:" >&2
    echo "$booted" >&2
    exit 1
  fi
  udid=$(echo "$booted" | grep -oE '[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}')
fi

state=$(xcrun simctl list devices | grep -F "$udid" || true)
if [[ -z $state ]]; then
  echo "No simulator with UDID $udid" >&2
  exit 1
fi
if [[ $state != *"(Booted)"* ]]; then
  echo "Booting $udid"
  xcrun simctl boot "$udid"
fi
echo "Simulator: $(echo "$state" | sed -E 's/^[[:space:]]+//; s/ \(Booted\)| \(Shutdown\)//')"

if [[ ! -d ios ]]; then
  npx expo prebuild -p ios --no-install
fi
if [[ ! -d ios/Pods ]] || [[ ios/Podfile -nt ios/Pods/Manifest.lock ]]; then
  (cd ios && pod install)
fi

xcodebuild \
  -workspace ios/BlankSlate.xcworkspace \
  -scheme BlankSlate \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination "id=$udid" \
  -derivedDataPath ios/build \
  IPHONEOS_DEPLOYMENT_TARGET=15.1 \
  build

xcrun simctl install "$udid" ios/build/Build/Products/Debug-iphonesimulator/BlankSlate.app

metro_up() { curl -sf "http://localhost:$METRO_PORT/status" 2>/dev/null | grep -q running; }

launch() {
  xcrun simctl launch "$udid" "$BUNDLE_ID" --initialUrl "http://localhost:$METRO_PORT"
}

if metro_up; then
  echo "Using the Metro already running on :$METRO_PORT (stop it first if it serves another checkout)"
  launch
  exit 0
fi

npx expo start --dev-client --port "$METRO_PORT" &
metro=$!
trap 'kill $metro 2>/dev/null || true' EXIT INT TERM
until metro_up; do
  if ! kill -0 "$metro" 2>/dev/null; then
    echo "Metro exited" >&2
    exit 1
  fi
  sleep 1
done
launch
wait "$metro"

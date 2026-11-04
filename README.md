# Blank Slate

Blank Slate is an app that builds apps on your phone. Describe what you want in
chat; an LLM agent (via [OpenRouter](https://openrouter.ai), with your own key)
writes React Native TSX, and Blank Slate compiles and runs it on the device
straight away. No build step, no app store. It is an Expo SDK 54 app for iOS
(dev client, JSC), and it also runs on the web and as an Electron desktop app.

<p>
  <img src="docs/images/your-apps.png" alt="The Your apps grid with two generated apps" width="260">
  <img src="docs/images/chat.png" alt="A chat mid-build, with a group of tool calls in progress" width="260">
  <img src="docs/images/app.png" alt="A generated habit tracker running, with the dock below it" width="260">
</p>

## Features

- **Many apps.** A home grid ("Your apps") with a generated icon and name for
  each, and a dock for switching between them without going back home.
- **Agent tools.** Read, write and edit files; generate images; web search and
  fetch; set the app's icon and name.
- **Debugging.** A History tab records what the app did at runtime (logs,
  errors, network, taps). The agent can read that history, take screenshots,
  and inspect the UI tree, so it can check its own work.
- **Design guidance.** Each app has a vibe (Cozy, Bold, Minimal, Playful,
  Retro, or your own words) that the agent turns into a theme. The default is
  an "iOS native" direction: system colours, SF Symbols, and native stack and
  tab navigation.
- **Per-app storage.** AsyncStorage, SQLite and `localStorage` are namespaced
  per app, so apps don't see each other's data.
- **Sharing.** Export an app as a `.blankslate` file and open it on another
  device.
- **Desktop.** The Electron build puts the dock in a left rail with chat in a
  sidebar beside the running app (Cmd+\ hides it). Wide browser windows get
  the same layout.
- **Slate & Chalk.** Blank Slate's own design; see [`design/`](design/README.md).

## Getting started

### Prerequisites

- Node 20
- Xcode and CocoaPods (for iOS)
- An [OpenRouter API key](https://openrouter.ai/keys). You enter it in the app
  on first launch. It is stored on the device only (Keychain on iOS and
  desktop, `localStorage` in a browser) and sent only to OpenRouter.

### Web

```sh
npm ci
npx expo start --web
```

### iOS simulator

```sh
npm ci
scripts/ios-sim.sh            # uses the booted iPhone simulator
scripts/ios-sim.sh <udid>     # or a specific one (booted if needed)
```

The script prebuilds `ios/` and installs pods if needed, builds the dev
client with `xcodebuild`, installs it, starts Metro and opens the app against
it (or reuses a Metro already on port 8081). It stops rather than guessing
if several iPhone simulators are booted.

It exists because `npx expo run:ios` does not work with Xcode 27 (Simulator is
now DeviceHub) and three pods need `IPHONEOS_DEPLOYMENT_TARGET=15.1`. The
manual equivalent:

```sh
npx expo prebuild -p ios
xcodebuild -workspace ios/BlankSlate.xcworkspace -scheme BlankSlate \
  -configuration Debug -sdk iphonesimulator -destination id=<udid> \
  -derivedDataPath ios/build IPHONEOS_DEPLOYMENT_TARGET=15.1 build
xcrun simctl install <udid> ios/build/Build/Products/Debug-iphonesimulator/BlankSlate.app
npx expo start --dev-client
xcrun simctl launch <udid> org.mikelyons.blank-slate --initialUrl http://localhost:8081
```

### Desktop

See [`desktop/README.md`](desktop/README.md).

### EAS builds

`eas.json` has `development`, `preview` and `production` profiles. `app.json`
points at the maintainer's Expo account and Apple team, so in a fork change
`owner`, `extra.eas.projectId`, `updates.url`, `ios.bundleIdentifier` and
`ios.appleTeamId` to your own before running `eas build`.

## Architecture

- [`src/agent/`](src/agent) — the agent loop, OpenRouter streaming, tool
  definitions and the system prompt.
- [`src/dynamic/`](src/dynamic) — compiles generated code and resolves its
  imports.
- [`src/vfs/`](src/vfs) — each app's source files and image assets, persisted per app.
- [`src/project/`](src/project) — apps, chats, icons and appearance.
- [`src/sandbox/`](src/sandbox) — per-app storage and globals.
- [`src/debug/`](src/debug) — runtime history, screenshots, UI tree.
- [`src/share/`](src/share) — `.blankslate` export and import.
- [`src/screens/`](src/screens), [`src/theme/`](src/theme) — Blank Slate's
  own UI.
- [`desktop/`](desktop) — the Electron wrapper.

**How generated code runs.** Each file is compiled with Babel standalone
([`transpile.ts`](src/dynamic/transpile.ts)) to CommonJS and evaluated with
`new Function` ([`resolver.ts`](src/dynamic/resolver.ts)). Its `require` goes
through a shim ([`requireShim.ts`](src/dynamic/requireShim.ts)) that only
offers a fixed set of modules (React Native, a list of Expo modules,
navigation, SVG and so on), with storage modules swapped for per-app
versions ([`src/sandbox/`](src/sandbox)). That keeps apps out of each other's
data by accident, but it is not a security boundary: generated code runs in
the same JS realm as Blank Slate, so code written to escape can reach the
real globals, other apps' storage and possibly the OpenRouter key
([`globals.ts`](src/sandbox/globals.ts) spells out what it does and doesn't
cover). Only import `.blankslate` files from people you trust.

## Releasing

CI does the release. Locally:

1. Bump `expo.version` in `app.json` and commit.
2. Tag the commit `vX.Y.Z`, matching that version, and push the tag:
   `git tag vX.Y.Z && git push origin vX.Y.Z`. For hand-written release
   notes, use an annotated tag (`git tag -a vX.Y.Z -F notes.md`). Otherwise
   GitHub generates the notes.

The tag starts two workflows:

- [`desktop.yml`](.github/workflows/desktop.yml) builds the macOS (arm64 and
  x64, signed and notarized, DMG and zip) and Windows (x64 NSIS, unsigned)
  installers. It uploads them to a **draft** GitHub Release for the tag. Once
  both platforms are in, it adds `SHA256SUMS.txt` and publishes the release.
  Installed desktop apps update from the published release
  ([`desktop/README.md`](desktop/README.md#auto-update)).
- [`app.yml`](.github/workflows/app.yml) typechecks, then publishes an EAS
  update to the `production` branch. `runtimeVersion` follows the app version,
  so an update for a new `expo.version` only reaches native builds of that
  version. A version bump needs `eas build --profile production` as well.

Both workflows fail early if the tag doesn't match `expo.version`. Every push
to `main` publishes an EAS update to `preview`. Every push that touches the
app runs the typecheck and a web export.

**Retrying a partial release.** Nothing is public until every platform has
uploaded, so a failed run leaves a draft behind. Fix the cause, then either
re-run the failed jobs on the original run, or dispatch the workflow against
the tag: Actions → Test & Release desktop → Run workflow → *Use workflow
from* `vX.Y.Z`, or `gh workflow run desktop.yml --ref vX.Y.Z`. The retry
uploads into the same draft and replaces any assets already there. The same
works for `app.yml` if the production update failed. Dispatched against a
branch, the desktop workflow only checks the web export.

**Smoke-testing signing.** `desktop-mac-smoke.yml` runs the macOS half of a
release, including notarization, with `--publish never`. It then checks the
app and DMG with `codesign`, `spctl` and `stapler`, and uploads the arm64 DMG
as an artifact. Run it from Actions → *Smoke test the macOS signing chain* on
any branch, picking a runner image, before cutting a release that changes
signing, the certificate or electron-builder.

**Repository secrets** (`GITHUB_TOKEN` is provided automatically):

| Secret | What |
| --- | --- |
| `APPLE_ID` | Apple ID used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID (appleid.apple.com) |
| `APPLE_TEAM_ID` | `M7Y6TPCQ63` |
| `MAC_CSC_LINK` | Base64 `.p12` of the "Developer ID Application: Michael Lyons (M7Y6TPCQ63)" certificate |
| `MAC_CSC_KEY_PASSWORD` | Password for that `.p12` |
| `EXPO_TOKEN` | Expo access token for the `mikepersonal` account |

## Status

A personal, experimental project. Expect rough edges and breaking changes.

## License

MIT. See [LICENSE](LICENSE).

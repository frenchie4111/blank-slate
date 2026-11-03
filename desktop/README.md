# Blank Slate desktop

The Expo web build of Blank Slate in an Electron window, modelled on Grow's
`desktop/`. Every script exports the web build of the repo root into
`renderer/` (gitignored) first, so there is nothing else to build.

```sh
cd desktop
npm install
npm start        # export the web build, then open it in Electron
npm run pack     # unsigned .app in release/mac-arm64/ — no credentials needed
npm run dist     # signed + notarized DMG and zip for arm64 and x64
```

## How it fits together

- `src/serve.js` serves `renderer/` over a privileged `blank-slate://` scheme
  with `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: credentialless`. That makes the page
  cross-origin isolated, which `expo-sqlite` needs on web (SharedArrayBuffer +
  OPFS). `credentialless` rather than `require-corp` so generated apps can still
  show remote images from hosts that send no CORP header.
- `src/session.js` grants generated apps geolocation, notifications,
  camera/mic and clipboard, and **lifts CORS** for requests from the app's own
  origin, so `fetch` behaves as it does on iOS (which the agent's system prompt
  assumes). Nothing else is affected.
- `src/secureStore.js` + `src/preload.js` expose a key store that encrypts the
  OpenRouter key with `safeStorage` (Keychain-backed). The preload hands it out
  once, via `window.blankSlateDesktop.claimSecureStore()`, and
  `src/platform/desktop.ts` claims it while Blank Slate starts, so generated
  apps in the same renderer get null. `src/storage/keyStore.ts` uses it and
  moves any key a previous web run left in localStorage. Code that escapes the
  module sandbox (`src/sandbox/globals.ts`) could still find Blank Slate's own
  reference, so this is not a hard boundary.
- No CSP is set: generated code is compiled with Babel and run with
  `new Function` at runtime, so `unsafe-eval` has to stay available.
  `contextIsolation`, `sandbox` are on and `nodeIntegration` is off.
- `src/main.js` opens a 430×900 window (min 360×560), remembers its bounds,
  links out to the default browser, and uses `hiddenInset` on macOS. The preload
  draws a dark 28px drag strip under the traffic lights.

## Signing

`npm run dist` signs with "Michael Lyons (M7Y6TPCQ63)" from the keychain and
notarizes when `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`
are set — copy `.env.example` to `.env`. Without them notarization is skipped
silently and Gatekeeper will reject the build on other Macs.

`--no-sign` (what `pack` uses) signs ad-hoc and skips notarization; the app runs
on this Mac only. For an unsigned DMG: `npm run renderer && node scripts/build.mjs --no-sign`.

## Auto-update: not set up

There is no S3 bucket yet, so there is no `update.js`, no `publish` config and
no `release` script. To add it, copy Grow's `desktop/src/update.js` (and its
`electron-updater` dependency, `build.publish` block and `release` script),
call `startUpdates()` after `createWindow()` in `main.js`, and point
`build.publish` at the bucket. Updates only install over a Developer ID-signed
build.

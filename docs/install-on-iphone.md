# Installing Blank Slate on an iPhone

This is a runbook for a coding agent (Claude Code, Codex, …) to follow with a
user who has cloned this repo and wants Blank Slate on their own iPhone. A
person can follow it too; skip the "Agent:" notes.

Steps marked **HUMAN STEP** need the user: a browser sign-in, an interactive
prompt, or something on the phone. Stop, tell the user exactly what to do,
and wait for them to confirm before carrying on. Don't try to automate around
these steps.

Rules for the agent:

- Never build with the maintainer's identifiers: bundle id
  `org.mikelyons.blank-slate`, Apple team `M7Y6TPCQ63`, Expo owner
  `mikepersonal`, project id `9190e865-…`. Step 2 replaces them all.
- Run each check and compare it with the expected result before moving on.
  If a check fails, fix it or report it; don't skip ahead.
- Don't commit the `app.json` changes to a branch you plan to send upstream.
  They belong to the user's fork.

## 0. Ask the user first

Ask these before running anything, in one message:

1. **Apple account:** a paid Apple Developer Program membership ($99/yr), or
   just a free Apple ID? → paid: **Path A** (EAS). Free: **Path B** (Xcode).
2. **Expo account** (Path A only): do they have one? It's free:
   <https://expo.dev/signup>.
3. **iPhone model and iOS version.** iOS 16 or later needs Developer Mode
   (step 4). The app's minimum is iOS 15.1.
4. **Connection** (Path B): is the phone plugged into this Mac by USB, or on
   the same Wi-Fi and already paired with this Mac?
5. **Dev client or standalone?**
   - *Dev client:* loads JavaScript from Metro on this Mac and live-reloads.
     Good for hacking on Blank Slate itself. Needs the Mac running and on the
     same network.
   - *Standalone* (recommended for just using it): the JS is bundled in, so it
     works anywhere. On Path A it can also take over-the-air updates.

## 1. Clone and install (both paths)

```sh
git clone https://github.com/frenchie4111/blank-slate.git
cd blank-slate
npm ci
```

Check: `npm ci` ends with `added N packages` and no `ERR!`. You need Node 20
or later (`node -v`). Run `npm ci` again after every `git pull`, because a
stale `node_modules` gives confusing native build errors.

For Path B, also check Xcode and CocoaPods:

```sh
xcodebuild -version   # Xcode 16 or later
pod --version         # any recent version; install with `brew install cocoapods`
```

## 2. Point `app.json` at the user's accounts (both paths)

`app.json` is set up for the maintainer's accounts. Edit `expo` in `app.json`:

| Field | Change |
|---|---|
| `owner` | delete (Path A: `eas init` sets the logged-in account) |
| `extra.eas.projectId` | delete (`eas init` writes a new one); leave `"extra": { "eas": {} }` |
| `updates` (the whole `{ "url": … }` block) | delete (Path A: `eas update:configure` writes a new one) |
| `ios.bundleIdentifier` | something unique to the user, e.g. `com.<theirname>.blankslate` |
| `ios.appleTeamId` | Path A: delete it, or set the user's 10-character team ID. Path B: set it to the Personal Team ID from step B2. |

Leave everything else alone, including `CFBundleDocumentTypes` /
`UTExportedTypeDeclarations` (`org.mikelyons.blank-slate.app`). That's the
file type for `.blankslate` files, not a signing identifier, and changing it
stops shared apps opening between installs.

The same edit as a script (replace the bundle id):

```sh
node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("app.json", "utf8"));
const e = j.expo;
delete e.owner;
delete e.extra.eas.projectId;
delete e.updates;
delete e.ios.appleTeamId;
e.ios.bundleIdentifier = "com.YOURNAME.blankslate";
fs.writeFileSync("app.json", JSON.stringify(j, null, 2) + "\n");
'
```

Check:

```sh
grep -nE 'mikelyons\.blank-slate"|M7Y6TPCQ63|mikepersonal|9190e865' app.json
```

The only matches should be the two `org.mikelyons.blank-slate.app` file-type
lines. If you see `"bundleIdentifier": "org.mikelyons.blank-slate"`, the team
id, the owner or the project id, the edit didn't take.

If `scripts/ios-sim.sh` is used later, it reads the bundle id from `app.json`,
so it follows this change.

---

## Path A: EAS build (paid Apple Developer account)

EAS builds the app in the cloud, signs it with an ad hoc profile for the
user's registered devices, and gives an install link. Use `npx
eas-cli@latest` throughout; there's no need to install it globally.

### A1. Log in to Expo

**HUMAN STEP:** the user runs this in their own terminal and completes the
browser sign-in:

```sh
npx eas-cli@latest login
```

(Agent alternative: `npx eas-cli@latest login --device --non-interactive`
prints a request ID and a URL. The user opens the URL, signs in and tells you
the number shown. Then you run `npx eas-cli@latest login --device
--non-interactive --resume <REQUEST_ID> --match <NUMBER>`.)

Check: `npx eas-cli@latest whoami` prints the user's Expo username, not
`mikepersonal`.

### A2. Create the user's EAS project and configure updates

```sh
npx eas-cli@latest init --non-interactive --force
npx eas-cli@latest update:configure -p ios --non-interactive
```

Check: `app.json` now has a new `extra.eas.projectId` and a matching
`updates.url` of `https://u.expo.dev/<that id>`. If it has an `owner`, it
must be the `whoami` username (or an Expo org of theirs). `eas.json` already has channels
`development` / `preview` / `production`, so leave it as it is.

### A3. Register the iPhone

```sh
npx eas-cli@latest device:create
```

This is interactive. It asks the user to sign in to Apple and pick a team,
then shows a QR code and URL.

**HUMAN STEP:** the user signs in to Apple when prompted, then on the iPhone
opens the URL (or scans the QR with the Camera), downloads the profile, and
installs it under Settings → General → VPN & Device Management (or the
"Profile Downloaded" item at the top of Settings).

Check: `npx eas-cli@latest device:list` lists the phone. Register the device
**before** building, because the ad hoc profile only includes devices that
exist when it's made. To add a phone later, rebuild with
`--refresh-ad-hoc-provisioning-profile`.

### A4. Build

Standalone (recommended):

```sh
npx eas-cli@latest build -p ios --profile preview
```

Dev client (live reload):

```sh
npx eas-cli@latest build -p ios --profile development
```

**HUMAN STEP:** the first build is interactive. The user signs in to Apple
again if asked and accepts the defaults (let EAS manage the distribution
certificate and provisioning profile, and set up a push key if it offers).
Run it in a terminal the user can type into. A cloud build takes about 10–20
minutes (and longer in the free-tier queue).

Check: the command ends with `Build finished` (or `✔ Build finished`), an
install URL, and a QR code. The EAS dashboard shows the same.

### A5. Install

**HUMAN STEP:** on the iPhone, open the install URL (or scan the QR with the
Camera) and tap Install. Then do step 4 (Developer Mode) below.

### A6. After installing

- **preview build:** push JS changes over the air with
  `npx eas-cli@latest update --branch preview --message "what changed"`
  The app fetches it on
  launch and applies it on the next launch. Updates only reach builds with
  the same `version` in `app.json` (runtime policy `appVersion`), so bumping
  the version needs a new build.
- **development build:** run `npx expo start` on the Mac (the phone must be on
  the same Wi-Fi). Open Blank Slate on the phone; the dev launcher lists the
  Metro server, or you can scan the QR printed by `expo start`. JS edits
  reload live.

Then go to **step 4**.

---

## Path B: Xcode with a free Apple ID (Personal Team)

This builds locally and installs straight onto a connected phone. It's free,
with these limits:

- **The app expires after 7 days.** It stops launching, and you rebuild and
  reinstall (steps B4–B5) to renew it. Your data stays if you don't delete
  the app.
- **No push notifications.** Personal Teams can't sign the `aps-environment`
  entitlement. See B3. Local (scheduled) notifications still work.
- At most 3 sideloaded apps per device, and 10 new bundle ids per 7 days, per
  free account.
- No over-the-air updates. Rebuild to get changes.

### B1. Sign in to Xcode and connect the phone

**HUMAN STEP:** the user opens Xcode → Settings → Accounts, clicks +, and
signs in with their Apple ID. This creates "<Name> (Personal Team)".

**HUMAN STEP:** the user connects the iPhone by USB, unlocks it, and taps
**Trust** on "Trust This Computer?". For Wi-Fi, it has to be paired over USB
once first.

Check:

```sh
xcrun devicectl list devices
```

The phone appears with `Reality` = `physical` and a `State` of `available
(paired)` or `connected`. Note its UDID (the `Identifier` column, e.g.
`00008140-…`). Use that, not a simulator id.

### B2. Find the Personal Team ID

```sh
security find-identity -v -p codesigning
```

You should see an `Apple Development: <email or name> (XXXXXXXXXX)` line. If
there are no valid identities, open Xcode → Settings → Accounts → the team →
Manage Certificates → + → Apple Development.

The team ID is the certificate's organizational unit (`OU`), which is not
always the value in brackets above:

```sh
security find-certificate -a -c "Apple Development" -p \
  | openssl x509 -noout -subject
```

Look for `OU=XXXXXXXXXX` (10 characters). If several certificates exist,
pick the one for the user's Apple ID (Xcode → Settings → Accounts also shows
the team). Set it as `ios.appleTeamId` in `app.json` (step 2) so prebuild
writes it into the Xcode project.

### B3. Generate the iOS project and remove the push entitlement

```sh
npx expo prebuild -p ios --clean
/usr/libexec/PlistBuddy -c "Delete :aps-environment" ios/BlankSlate/BlankSlate.entitlements
```

Why: `expo-notifications` is installed, so prebuild always applies its config
plugin. It does this automatically, even if `"expo-notifications"` is removed
from `plugins` in `app.json`, and the plugin adds `aps-environment` (push).
A Personal Team can't sign that, and Xcode fails with "Personal development
teams … do not support the Push Notifications capability". Nothing else
needs an entitlement: there are no App Groups, iCloud or keychain groups,
and the `.blankslate` document types live in `Info.plist`, which is fine.

Check:

```sh
cat ios/BlankSlate/BlankSlate.entitlements
```

It should be an empty `<dict/>`. Before the PlistBuddy line it contains
`aps-environment` / `development`. Also check that
`ios/BlankSlate/Supporting/Expo.plist` has `EXUpdatesEnabled` = `false`.
That's expected once `updates.url` is removed, and it means the app runs its
bundled JS rather than asking the maintainer's update server.

Re-run the PlistBuddy line after every `expo prebuild`, which regenerates
the file.

### B4. Build and install

`npx expo run:ios --device` may work, but it fails with Xcode 27 (the
Simulator is now DeviceHub, and three pods need
`IPHONEOS_DEPLOYMENT_TARGET=15.1`), so use `xcodebuild` directly.
`ios/` is generated and gitignored; delete it and re-run B3 if it gets into a
bad state.

```sh
(cd ios && pod install)

UDID=<the phone's UDID from B1>
CONFIG=Release   # standalone. Use Debug for a dev client that loads JS from Metro.

xcodebuild \
  -workspace ios/BlankSlate.xcworkspace -scheme BlankSlate \
  -configuration "$CONFIG" -destination "id=$UDID" \
  -derivedDataPath ios/build \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  IPHONEOS_DEPLOYMENT_TARGET=15.1 \
  build

xcrun devicectl device install app --device "$UDID" \
  "ios/build/Build/Products/$CONFIG-iphoneos/BlankSlate.app"
```

Checks:

- `pod install` ends with `Pod installation complete!`.
- `xcodebuild` ends with `** BUILD SUCCEEDED **`. If signing fails, the
  usual causes are a bundle id someone else already owns (pick another in
  `app.json`, then redo B3), the team ID not being set (check B2), or the
  push entitlement still being in the file (B3).
- `devicectl … install app` reports the app as installed, with the user's
  bundle id. `xcrun devicectl device info apps --device "$UDID" | grep -i
  blank` confirms it.

Doing it in the Xcode UI instead: `open ios/BlankSlate.xcworkspace`, select
the BlankSlate target → Signing & Capabilities, tick "Automatically manage
signing", choose the Personal Team, and make sure the bundle id is the unique
one. If a "Push Notifications" capability is listed, remove it with its ×.
Pick the iPhone as the run destination and press Run. If pods fail to
compile with Xcode 27, use the command-line recipe above, which passes
`IPHONEOS_DEPLOYMENT_TARGET=15.1`.

### B5. Trust the developer certificate

**HUMAN STEP:** the first launch shows "Untrusted Developer". On the iPhone,
go to Settings → General → VPN & Device Management → "Apple Development: <the
Apple ID>" → Trust. Then do step 4 (Developer Mode).

### B6. Debug builds only: start Metro

```sh
npx expo start --dev-client
```

The phone has to be on the same Wi-Fi as the Mac. In the dev launcher on the
phone, pick the server listed (or enter `http://<mac-ip>:8081`). Release
builds don't need this.

---

## 3. (Optional) TestFlight

If the maintainer invites the user as a tester, they can install from
TestFlight with none of the above. The App Store and public TestFlight aren't
guaranteed, because Apple's guideline 2.5.2 restricts apps that download or
run new code.

Android is untested.

## 4. Developer Mode (iOS 16+, both paths)

Ad hoc (EAS internal) and development-signed apps won't open until
Developer Mode is on.

**HUMAN STEP:** on the iPhone, go to Settings → Privacy & Security → Developer
Mode → on → Restart. After the restart, unlock the phone and tap **Turn On**.
The toggle only appears once a developer-signed app is installed or the
phone has been connected to Xcode, so install first (A5 / B4).

## 5. First launch and done criteria

**HUMAN STEP:** the user opens Blank Slate and pastes an OpenRouter API key
from <https://openrouter.ai/keys>. The key is stored on the device only (in
the iOS Keychain) and sent only to OpenRouter. Don't ask the user to paste
the key to you.

Done when all of these are true:

1. Blank Slate launches on the phone. No "Untrusted Developer" message, no
   immediate crash, and on a Debug/dev client it has connected to Metro.
2. The onboarding / API key screen appears, and after entering the key you
   reach "Your apps".
3. A test prompt builds a working app. For example: *"A counter with a big
   plus button and a reset button."* The agent's tool calls finish, and the
   counter runs and responds to taps.

Ask the user to confirm each one.

## Gotchas

| Symptom | Fix |
|---|---|
| `npx expo run:ios` fails with Xcode 27 (Simulator is now DeviceHub) | Use the `xcodebuild` recipe in B4 (or `scripts/ios-sim.sh` for the simulator). |
| Pods fail to compile on Xcode 27 | Pass `IPHONEOS_DEPLOYMENT_TARGET=15.1` to `xcodebuild`. |
| "Personal development teams … do not support the Push Notifications capability" | Remove `aps-environment` (B3); re-run after each prebuild. |
| "Untrusted Developer" | Settings → General → VPN & Device Management → Trust (B5). |
| App won't open on iOS 16+ | Turn on Developer Mode (step 4). |
| Free-team app stopped launching after a week | 7-day expiry. Rebuild and reinstall (B4). |
| EAS build installs but says it can't be installed on this device | The phone wasn't registered when the profile was made. Run `device:create`, then rebuild with `--refresh-ad-hoc-provisioning-profile`. |
| Weird native/JS errors after `git pull` | `npm ci`, then (Path B) delete `ios/` and redo B3–B4. |
| `eas update` doesn't reach the phone | Wrong channel (preview builds listen to branch `preview`) or a different `version`. Rebuild after a version bump. |

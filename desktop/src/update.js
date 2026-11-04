const { app, dialog, Menu, MenuItem } = require("electron");

const { autoUpdater } = require("electron-updater");

/**
 * Keeping the app up to date from GitHub Releases, modelled on Grow's
 * `desktop/src/update.js`.
 *
 * `expo-updates` does nothing here. On web it is a stub that never contacts a
 * server, so the EAS channel in `app.json` cannot reach the desktop app. The
 * desktop app updates the usual way for a desktop app: `electron-updater`
 * reads `latest-mac.yml` / `latest.yml` from the newest published release,
 * downloads the zip (macOS) or installer (Windows) in the background, and
 * swaps it in on restart. Draft releases are invisible to it, which is why the
 * release workflow publishes only after every platform has uploaded.
 *
 * All the UI is native: a dialog when an update is ready, and a "Check for
 * Updates…" menu item. Grow pushes update state to its renderer over the
 * preload bridge. This app can't do that, because generated apps run in the
 * same renderer and the bridge is deliberately limited to
 * `claimSecureStore()`. Native UI needs no bridge at all.
 */

/**
 * How often to check after the launch check. Six hours finds a release within
 * a working day without polling GitHub from an app that stays open all day.
 */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** @type {"idle" | "checking" | "downloading" | "ready"} */
let stage = "idle";

/** Whether the check in flight came from the menu and so deserves an answer. */
let manual = false;

/**
 * Whether the user was told an update is downloading. If that download then
 * fails, they're waiting on a restart prompt that will never come, so the
 * failure is reported even though the check is no longer `manual`.
 */
let promisedDownload = false;

/** The version that has downloaded, once `stage` is "ready". */
let readyVersion = null;

function log(message) {
    console.log(`[update] ${message}`);
}

/**
 * Offer the downloaded update. Deferred to the next tick: calling
 * `quitAndInstall` straight out of the dialog's callback can race the dialog's
 * own teardown.
 */
async function offer(version) {
    const { response } = await dialog.showMessageBox({
        type: "info",
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
        cancelId: 1,
        message: `Blank Slate ${version} is ready to install.`,
        detail: "It installs when Blank Slate restarts. If you choose Later, it installs the next time you quit.",
    });

    if (response === 0) setImmediate(() => autoUpdater.quitAndInstall());
    else log("install deferred");
}

/**
 * Check for an update, unless one is already being checked or downloaded. A
 * check from the menu while an update is waiting offers that update again
 * instead.
 */
function check({ fromMenu = false } = {}) {
    if (stage === "ready") {
        if (fromMenu) offer(readyVersion);
        return;
    }

    if (stage !== "idle") {
        if (fromMenu) {
            dialog.showMessageBox({
                type: "info",
                message: stage === "downloading" ? "An update is downloading." : "Already checking for updates.",
            });
        }
        return;
    }

    stage = "checking";
    manual = fromMenu;

    autoUpdater.checkForUpdates().catch((error) => fail(error));
}

/**
 * Fail quietly unless the user asked. No network, or no release yet, is the
 * ordinary case at launch and not worth a dialog.
 */
function fail(error) {
    // The "error" event and the rejected `checkForUpdates()` both land here
    // for one failure. The first one handles it.
    if (stage === "idle") return;

    const shouldTell = manual || (stage === "downloading" && promisedDownload);
    const message = stage === "downloading" ? "The update couldn't be downloaded." : "Couldn't check for updates.";
    stage = "idle";
    manual = false;
    promisedDownload = false;

    if (shouldTell) {
        dialog.showMessageBox({
            type: "warning",
            message,
            detail: error.message,
        });
    }
}

/**
 * "Check for Updates…" in the menu Electron builds by default: in the app menu
 * after About on macOS, and in Help elsewhere. The default menu is kept, not
 * replaced, so Edit (copy/paste) and View keep working.
 */
function addMenuItem() {
    const menu = Menu.getApplicationMenu();
    if (!menu) return;

    const item = new MenuItem({ label: "Check for Updates…", click: () => check({ fromMenu: true }) });

    const submenu =
        process.platform === "darwin"
            ? menu.items[0]?.submenu
            : menu.items.find((entry) => entry.role === "help" || entry.label === "Help")?.submenu;

    if (!submenu) return;

    submenu.insert(process.platform === "darwin" ? 1 : submenu.items.length, item);
    Menu.setApplicationMenu(menu);
}

/**
 * Start checking, if this build can update itself.
 *
 * Unpackaged runs are skipped. `electron-builder` writes the feed into
 * `app-update.yml` at package time, so a checkout has no feed to read and the
 * updater would fail rather than do nothing.
 *
 * On macOS, Squirrel.Mac installs an update only if it carries the same
 * signature as the running app. An ad-hoc build (`--no-sign`) will download an
 * update and then refuse to install it. That failure is logged and otherwise
 * ignored.
 */
function startUpdates() {
    if (!app.isPackaged) {
        log("not packaged — skipping");
        return;
    }

    autoUpdater.logger = {
        info: (message) => log(message),
        warn: (message) => log(`[warn] ${message}`),
        error: (message) => log(`[error] ${message}`),
        debug: () => {},
    };

    autoUpdater.on("update-available", (info) => {
        log(`found ${info.version}`);
        // `autoDownload` is on, so the download has already started.
        stage = "downloading";
        promisedDownload = manual;

        if (manual) {
            dialog.showMessageBox({
                type: "info",
                message: `Blank Slate ${info.version} is available.`,
                detail: "It's downloading in the background. You'll be asked to restart when it's ready.",
            });
        }
        manual = false;
    });

    autoUpdater.on("update-not-available", () => {
        log("up to date");
        stage = "idle";

        if (manual) {
            dialog.showMessageBox({
                type: "info",
                message: "You're up to date.",
                detail: `Blank Slate ${app.getVersion()} is the latest version.`,
            });
        }
        manual = false;
    });

    autoUpdater.on("error", (error) => fail(error));

    autoUpdater.on("update-downloaded", (info) => {
        log(`downloaded ${info.version}`);
        stage = "ready";
        readyVersion = info.version;
        promisedDownload = false;
        offer(info.version);
    });

    addMenuItem();

    check();
    // Unref'd so a pending check never keeps the app alive.
    setInterval(check, CHECK_INTERVAL_MS).unref();
}

module.exports = { startUpdates };

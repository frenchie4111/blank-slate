const path = require("node:path");

const { app, BrowserWindow, shell } = require("electron");

const { SCHEME, START_URL, registerScheme, serve } = require("./serve");
const { registerSecureStore } = require("./secureStore");
const { configureSession } = require("./session");
const { loadBounds, trackBounds } = require("./windowState");

// Auto-update is not wired up yet: there is no S3 bucket to publish to. See
// "Auto-update" in README.md, and Grow's `desktop/src/update.js` for the shape
// it should take.

// `electron .` runs as "Blank Slate Dev", with its own data folder and so its
// own "… Safe Storage" Keychain item. Sharing one with the packaged app would
// mean two differently signed binaries taking turns at the same item, and a
// Keychain prompt every time they swap.
if (!app.isPackaged) {
    app.setName("Blank Slate Dev");
    app.setPath("userData", path.join(app.getPath("appData"), "Blank Slate Dev"));
}

registerScheme();

/** The app's own background, so first paint and resizing never flash white. */
const BACKGROUND = "#121316";

/**
 * Anything that is not the app itself goes to the real browser: chat links,
 * `Linking.openURL` from a generated app (which on web is `window.open`), and
 * any in-place navigation away. Only http(s) and mailto are passed on, since
 * `openExternal` would launch whatever handler a scheme claims.
 */
function openExternally(url) {
    if (/^(https?:|mailto:)/.test(url)) {
        shell.openExternal(url);
    }
}

function createWindow() {
    const window = new BrowserWindow({
        // Desktop proportions: wide enough for the chat sidebar plus the app
        // (the app switches layout at `WIDE_MIN_WIDTH` in src/theme/layout.ts).
        // Narrower than that, it falls back to the phone layout.
        ...loadBounds({ width: 1280, height: 820 }),
        minWidth: 420,
        minHeight: 560,
        title: "Blank Slate",
        backgroundColor: BACKGROUND,
        // Shown once there is something to show, so there is no blank frame.
        show: false,
        // The traffic lights sit over a dark strip `preload.js` draws in.
        ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" } : {}),
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            preload: path.join(__dirname, "preload.js"),
        },
    });

    trackBounds(window);

    window.once("ready-to-show", () => window.show());

    window.webContents.setWindowOpenHandler(({ url }) => {
        openExternally(url);
        return { action: "deny" };
    });

    window.webContents.on("will-navigate", (event, url) => {
        if (new URL(url).protocol === `${SCHEME}:`) return;
        event.preventDefault();
        openExternally(url);
    });

    window.loadURL(START_URL);

    return window;
}

app.whenReady().then(() => {
    // A packaged app gets its icon from the bundle; `electron .` would show
    // Electron's own in the Dock.
    if (!app.isPackaged && process.platform === "darwin") {
        app.dock.setIcon(path.join(__dirname, "..", "..", "assets", "icon-mac.png"));
    }

    serve();
    registerSecureStore();
    configureSession();
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

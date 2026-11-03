const path = require("node:path");

const { app, BrowserWindow, shell } = require("electron");

const { SCHEME, START_URL, registerScheme, serve } = require("./serve");
const { registerSecureStore } = require("./secureStore");
const { configureSession } = require("./session");
const { loadBounds, trackBounds } = require("./windowState");

// Auto-update is not wired up yet: there is no S3 bucket to publish to. See
// "Auto-update" in README.md, and Grow's `desktop/src/update.js` for the shape
// it should take.

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
        // Roughly phone proportions: generated apps are designed for a phone.
        ...loadBounds({ width: 430, height: 900 }),
        minWidth: 360,
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

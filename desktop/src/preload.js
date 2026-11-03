const { contextBridge, ipcRenderer } = require("electron");

/**
 * What the window may ask the main process, and nothing else.
 *
 * The renderer is the Expo web build. It also has to work in an ordinary
 * browser, so this bridge is optional: `window.blankSlateDesktop` is absent
 * everywhere else, and `src/platform/desktop.ts` checks for it.
 *
 * Keep it narrow. Generated apps are compiled and run inside this same
 * renderer, so anything exposed here is exposed to them too. Expose named
 * calls; never expose `ipcRenderer` itself.
 */
let secureStore = {
    get: (key) => ipcRenderer.invoke("secure-store:get", key),
    set: (key, value) => ipcRenderer.invoke("secure-store:set", key, value),
    delete: (key) => ipcRenderer.invoke("secure-store:delete", key),
};

/**
 * The key store is a one-shot capability. `src/platform/desktop.ts` claims it
 * while Blank Slate starts up and keeps the only reference; every later call,
 * including any from a generated app, gets null. A reload re-runs this
 * preload, and Blank Slate claims it again first thing.
 */
contextBridge.exposeInMainWorld("blankSlateDesktop", {
    claimSecureStore: () => {
        const claimed = secureStore;
        secureStore = null;
        return claimed;
    },
});

/**
 * Room for the traffic lights on macOS, where `titleBarStyle: "hiddenInset"`
 * draws them over the page. A strip in the app's own background colour sits
 * at the top, pushes `#root` down, and doubles as the drag handle that the
 * missing title bar would otherwise have been. Done here, not in the app, so
 * the web build stays unaware of any of this.
 */
if (process.platform === "darwin") {
    const INSET = 28;

    window.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = `
            #blank-slate-titlebar {
                position: fixed; top: 0; left: 0; right: 0; height: ${INSET}px;
                background: #121316; -webkit-app-region: drag; z-index: 2147483647;
            }
            #root { margin-top: ${INSET}px; height: calc(100% - ${INSET}px) !important; }
        `;
        document.head.appendChild(style);

        const bar = document.createElement("div");
        bar.id = "blank-slate-titlebar";
        document.body.appendChild(bar);
    });
}

const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { net, protocol } = require("electron");

/**
 * The Expo web export, served to the window over a scheme of its own.
 *
 * The obvious way to put a web build in Electron is `loadFile`, and it does not
 * work here. `file://` is not a cross-origin isolated context, so the renderer
 * gets no `SharedArrayBuffer` and no synchronous OPFS handles, and `expo-sqlite`
 * fails to open the database — so any generated app that uses it would break. Isolation is granted on the strength of two response headers,
 * and `file://` has no response to put them on, so the export is served instead.
 */
const SCHEME = "blank-slate";

const ROOT = path.join(__dirname, "..", "renderer");

const START_URL = `${SCHEME}://app/`;

/**
 * The headers that buy cross-origin isolation. Both are required: COEP alone
 * does nothing without COOP to go with it.
 *
 * `credentialless` rather than `require-corp`: generated apps load remote
 * images from wherever their APIs point, and almost no image host sends
 * `Cross-Origin-Resource-Policy`. Under `require-corp` every one of those
 * `<img>` loads is blocked; `credentialless` lets them through without cookies.
 */
const ISOLATION = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "credentialless",
};

/**
 * Content types by extension, spelled out rather than left to the file
 * protocol's own guess. `application/wasm` is the one that has to be right:
 * `WebAssembly.instantiateStreaming` rejects any other type outright, and the
 * thing it would refuse to start is the SQLite build behind `expo-sqlite`.
 */
const TYPES = {
    ".css": "text/css",
    ".html": "text/html",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript",
    ".json": "application/json",
    ".map": "application/json",
    ".mjs": "text/javascript",
    ".otf": "font/otf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".wasm": "application/wasm",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
};

/**
 * Has to run before `app.whenReady`, and only once — Electron fixes the
 * privileges of every scheme at startup. `standard` gives the scheme real
 * origins (so `/_expo/...` in the export's markup resolves), and `secure` is
 * what makes it a trustworthy context, without which the isolation headers
 * would be ignored however faithfully they are sent.
 */
function registerScheme() {
    protocol.registerSchemesAsPrivileged([
        {
            scheme: SCHEME,
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
                corsEnabled: true,
                stream: true,
            },
        },
    ]);
}

async function isFile(candidate) {
    try {
        return (await fs.stat(candidate)).isFile();
    } catch {
        return false;
    }
}

/**
 * The file a request names, or null if there is nothing to serve.
 *
 * A URL is not a path the app chose, so the resolved location is checked back
 * against the export directory before anything is read: `path.join` collapses
 * the `..` segments, and a request that climbed out would land somewhere the
 * prefix test rejects.
 */
async function resolve(pathname) {
    const requested = path.join(ROOT, decodeURIComponent(pathname));

    if (requested !== ROOT && !requested.startsWith(ROOT + path.sep)) {
        return null;
    }

    if (await isFile(requested)) {
        return requested;
    }

    // A single-page export: only `index.html` is on disk, so any extensionless
    // path is handed it. A missing `.js` is a broken build, and returning
    // markup under a script's name would hide that behind a syntax error.
    return path.extname(requested) === ""
        ? path.join(ROOT, "index.html")
        : null;
}

function serve() {
    protocol.handle(SCHEME, async (request) => {
        const file = await resolve(new URL(request.url).pathname);

        if (file === null) {
            return new Response("Not found", {
                status: 404,
                headers: { "Content-Type": "text/plain", ...ISOLATION },
            });
        }

        const response = await net.fetch(pathToFileURL(file).toString());

        return new Response(response.body, {
            status: 200,
            headers: {
                "Content-Type":
                    TYPES[path.extname(file)] ?? "application/octet-stream",
                // The markup names the hashed bundle, so a cached copy would
                // keep loading the old one after a re-export or an update.
                // The hashed files themselves are fine to cache.
                ...(path.extname(file) === ".html" ? { "Cache-Control": "no-cache" } : {}),
                ...ISOLATION,
            },
        });
    });
}

module.exports = { SCHEME, START_URL, registerScheme, serve };

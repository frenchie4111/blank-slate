const { session } = require("electron");

const { SCHEME } = require("./serve");

const ORIGIN = `${SCHEME}://app`;

/**
 * Permissions a generated app may ask for. Electron grants nothing by default
 * once a handler is set, and it asks no one: the OS prompts (camera, mic,
 * location) still appear on top of this, driven by the usage strings in
 * `package.json` under `build.mac.extendInfo`.
 */
const ALLOWED = new Set([
    "geolocation",
    "notifications",
    "media",
    "clipboard-read",
    "clipboard-sanitized-write",
    "fullscreen",
]);

function fromApp(origin) {
    return typeof origin === "string" && origin.startsWith(ORIGIN);
}

function configurePermissions(ses) {
    ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
        const origin = details.requestingUrl ?? webContents.getURL();
        callback(ALLOWED.has(permission) && fromApp(origin));
    });

    ses.setPermissionCheckHandler((_webContents, permission, origin) =>
        ALLOWED.has(permission) && fromApp(origin),
    );
}

/**
 * Lift CORS for requests the app makes, as on a phone.
 *
 * On iOS a generated app's `fetch` goes straight out with no CORS at all, and
 * the system prompt tells the agent so. In this window every API without CORS
 * headers would fail instead — most of the public APIs a user asks for. So
 * responses to requests from the app's own origin get the CORS headers they
 * would need, and preflights are answered OK.
 *
 * The app's origin is echoed rather than `*` so credentialed requests pass too.
 * This only touches responses headed for this renderer; it widens nothing for
 * other sites.
 */
function relaxCors(ses) {
    // Request id → the CORS ask, for requests from the app's origin.
    const preflights = new Map();

    ses.webRequest.onBeforeSendHeaders({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
        const headers = details.requestHeaders;
        const origin = headers.Origin ?? headers.origin;
        if (fromApp(origin)) {
            preflights.set(details.id, {
                headers: headers["Access-Control-Request-Headers"] ?? headers["access-control-request-headers"],
                method: headers["Access-Control-Request-Method"] ?? headers["access-control-request-method"],
            });
        }
        callback({ requestHeaders: headers });
    });

    ses.webRequest.onHeadersReceived({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
        const request = preflights.get(details.id);
        if (!request) {
            callback({});
            return;
        }

        const headers = {};
        for (const [name, value] of Object.entries(details.responseHeaders ?? {})) {
            if (!name.toLowerCase().startsWith("access-control-")) headers[name] = value;
        }
        headers["Access-Control-Allow-Origin"] = [ORIGIN];
        headers["Access-Control-Allow-Credentials"] = ["true"];
        // Named, because `*` means a literal `*` on a credentialed response.
        headers["Access-Control-Expose-Headers"] = [Object.keys(headers).join(", ")];
        if (request.headers) headers["Access-Control-Allow-Headers"] = [request.headers];
        if (request.method) headers["Access-Control-Allow-Methods"] = [request.method];

        // A server that never expected a browser often answers OPTIONS with a
        // 404 or 405, and a preflight that is not 2xx fails the real request.
        const preflight = details.method === "OPTIONS" && request.method;
        callback(
            preflight
                ? { responseHeaders: headers, statusLine: "HTTP/1.1 204 No Content" }
                : { responseHeaders: headers },
        );
    });

    // Not cleared in `onHeadersReceived`: a redirect keeps the request id, and
    // the response it lands on needs the headers too.
    ses.webRequest.onCompleted(({ id }) => preflights.delete(id));
    ses.webRequest.onErrorOccurred(({ id }) => preflights.delete(id));
}

function configureSession() {
    const ses = session.defaultSession;
    configurePermissions(ses);
    relaxCors(ses);
}

module.exports = { configureSession, ORIGIN };

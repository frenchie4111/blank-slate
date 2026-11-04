const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const { app, ipcMain } = require("electron");

/**
 * A local MCP server, so a coding agent on this Mac (Claude Code, Codex…) can
 * build apps straight into Blank Slate: list and open apps, read and write
 * their files, and screenshot the result in the window.
 *
 * This file only speaks the protocol: MCP's Streamable HTTP transport, JSON
 * responses only (no SSE), on 127.0.0.1. The tools themselves live in the
 * renderer (`src/mcp/host.ts`), because that is where the apps' files are
 * (AsyncStorage, i.e. the page's localStorage) and where the app renders.
 * `tools/list` and `tools/call` are forwarded there over IPC.
 *
 * Every request needs the bearer token from `mcp.json` in the data folder, so
 * other local processes and web pages (which can reach 127.0.0.1 too) can't
 * drive it. Requests carrying a browser Origin are refused outright.
 */

const DEFAULT_PORT = 47821;
const PORT_ATTEMPTS = 10;
const CALL_TIMEOUT_MS = 120_000;
const MAX_BODY = 8 * 1024 * 1024;
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const FILE = () => path.join(app.getPath("userData"), "mcp.json");

const INSTRUCTIONS = `Blank Slate is a desktop app whose apps are React Native + TypeScript code in a virtual filesystem, rendered live in its window. These tools write into that filesystem; there are no files on disk.

Call get_app_guide first: it has the rules for what generated code can import and how it should look. Then list_apps / create_app / open_app to pick the app (the window shows whichever is open), edit files, and check the result with take_screenshot and get_app_history.`;

let state = null; // { port, token }
let server = null;
let target = null; // the BrowserWindow whose renderer hosts the tools
let rendererReady = false;
let nextCallId = 1;
const pending = new Map();

async function loadState() {
    try {
        const parsed = JSON.parse(await fs.readFile(FILE(), "utf8"));
        if (typeof parsed.token === "string" && Number.isInteger(parsed.port)) return parsed;
    } catch {}
    return { port: DEFAULT_PORT, token: crypto.randomBytes(24).toString("base64url") };
}

async function saveState() {
    const tmp = `${FILE()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
    await fs.rename(tmp, FILE());
}

/** What Settings shows: the URL and the command that registers it. */
function connectionInfo() {
    if (!state || !server) return null;
    const url = `http://127.0.0.1:${state.port}/mcp`;
    return {
        url,
        token: state.token,
        claudeCommand: `claude mcp add --transport http --scope user blank-slate ${url} --header "Authorization: Bearer ${state.token}"`,
    };
}

function tokenMatches(header) {
    const expected = Buffer.from(`Bearer ${state.token}`);
    const given = Buffer.from(typeof header === "string" ? header : "");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Forwards a request to the renderer and waits for its answer. */
function askRenderer(method, params) {
    if (!target || target.isDestroyed() || !rendererReady) {
        return Promise.reject(
            new Error("Blank Slate isn't ready: open its window (and finish setup if it's asking for an API key)."),
        );
    }
    const id = nextCallId++;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`${method} timed out after ${CALL_TIMEOUT_MS / 1000}s`));
        }, CALL_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        target.webContents.send("mcp:request", { id, method, params });
    });
}

async function handleRpc(msg) {
    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;
    const result = (value) => ({ jsonrpc: "2.0", id, result: value });
    const error = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

    if (isNotification) return null;

    switch (method) {
        case "initialize": {
            const asked = params?.protocolVersion;
            return result({
                protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: "blank-slate", title: "Blank Slate", version: app.getVersion() },
                instructions: INSTRUCTIONS,
            });
        }
        case "ping":
            return result({});
        case "tools/list":
            try {
                return result(await askRenderer("tools/list", {}));
            } catch (e) {
                return error(-32603, e.message);
            }
        case "tools/call":
            try {
                return result(await askRenderer("tools/call", params ?? {}));
            } catch (e) {
                // A tool that couldn't run is a tool error, so the model sees why.
                return result({ content: [{ type: "text", text: e.message }], isError: true });
            }
        default:
            return error(-32601, `Method not found: ${method}`);
    }
}

function send(res, status, body, headers = {}) {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(body === undefined ? undefined : JSON.stringify(body));
}

async function onRequest(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/mcp") return send(res, 404, { error: "not found" });
    // A web page can reach 127.0.0.1; a CLI client sends no Origin.
    if (req.headers.origin) return send(res, 403, { error: "browser origins are not allowed" });
    if (!tokenMatches(req.headers.authorization)) return send(res, 401, { error: "bad or missing token" });
    // No server-initiated stream and no sessions to end.
    if (req.method !== "POST") return send(res, 405, { error: "method not allowed" }, { Allow: "POST" });

    let raw = "";
    for await (const chunk of req) {
        raw += chunk;
        if (raw.length > MAX_BODY) return send(res, 413, { error: "request too large" });
    }
    let msg;
    try {
        msg = JSON.parse(raw);
    } catch {
        return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }

    const batch = Array.isArray(msg);
    const replies = (await Promise.all((batch ? msg : [msg]).map(handleRpc))).filter(Boolean);
    if (replies.length === 0) {
        res.writeHead(202);
        return res.end();
    }
    send(res, 200, batch ? replies : replies[0]);
}

function listen(port) {
    return new Promise((resolve, reject) => {
        const s = http.createServer((req, res) => {
            onRequest(req, res).catch((e) => {
                if (!res.headersSent) send(res, 500, { error: e.message });
            });
        });
        s.once("error", reject);
        s.listen(port, "127.0.0.1", () => resolve(s));
    });
}

/** Starts the server, on the port it used last time if that's still free. */
async function startMcp() {
    // Registered first, so the renderer never finds them missing while the
    // server is still starting (mcp:info just returns null until then).
    registerIpc();
    state = await loadState();
    for (let i = 0; i < PORT_ATTEMPTS; i++) {
        try {
            server = await listen(state.port + i);
            if (i > 0) state.port += i;
            break;
        } catch (e) {
            if (e.code !== "EADDRINUSE") throw e;
        }
    }
    if (!server) {
        console.warn(`[mcp] no free port from ${state.port}; MCP server not started`);
        return;
    }
    await saveState();
}

function registerIpc() {
    ipcMain.handle("mcp:ready", (event, ready) => {
        if (!target || event.sender !== target.webContents) return;
        rendererReady = ready === true;
    });
    ipcMain.handle("mcp:response", (event, id, payload) => {
        if (!target || event.sender !== target.webContents) return;
        const call = pending.get(id);
        if (!call) return;
        pending.delete(id);
        clearTimeout(call.timer);
        if (payload && typeof payload.error === "string") call.reject(new Error(payload.error));
        else call.resolve(payload?.result);
    });
    ipcMain.handle("mcp:info", (event) => {
        if (!target || event.sender !== target.webContents) return null;
        return connectionInfo();
    });
}

/** Points the server at a window. A reload drops readiness until the renderer re-registers. */
function attachMcpWindow(window) {
    target = window;
    rendererReady = false;
    const fail = () => {
        rendererReady = false;
        for (const [id, call] of pending) {
            clearTimeout(call.timer);
            call.reject(new Error("Blank Slate's window reloaded or closed mid-call; try again."));
            pending.delete(id);
        }
    };
    // Main-frame navigations only: a generated app's iframes don't count.
    window.webContents.on("did-navigate", fail);
    window.webContents.on("render-process-gone", fail);
    window.on("closed", () => {
        fail();
        if (target === window) target = null;
    });
}

module.exports = { startMcp, attachMcpWindow };

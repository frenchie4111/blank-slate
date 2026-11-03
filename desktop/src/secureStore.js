const fs = require("node:fs/promises");
const path = require("node:path");

const { app, ipcMain, safeStorage } = require("electron");

/**
 * Secrets the renderer asks to keep, encrypted with `safeStorage`.
 *
 * On the web the OpenRouter key would sit in localStorage as plain text, in a
 * LevelDB file anyone with the disk can read. Here it is encrypted with a key
 * the OS holds — the Keychain on macOS — and only the ciphertext reaches disk.
 * `src/storage/keyStore.ts` is the other half.
 *
 * Keys are limited to the app's own `blank-slate.` namespace so the bridge
 * cannot be used as a general file writer. Generated apps run in the same
 * renderer as Blank Slate itself; `preload.js` hands the bridge out once, to
 * Blank Slate at startup, so they can't simply ask for it. Code that breaks
 * out of the module sandbox (see src/sandbox/globals.ts) could still find
 * Blank Slate's own reference, so this is not a hard boundary.
 */

const FILE = () => path.join(app.getPath("userData"), "secure-store.json");

const KEY_PATTERN = /^blank-slate\.[a-z0-9.-]+$/;

function checkKey(key) {
    if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
        throw new Error(`secureStore: refusing key ${JSON.stringify(key)}`);
    }
}

function checkAvailable() {
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("secureStore: OS encryption is not available");
    }
}

async function load() {
    try {
        return JSON.parse(await fs.readFile(FILE(), "utf8"));
    } catch {
        return {};
    }
}

// Writes are serialized so two quick `set`s cannot interleave a read-modify-
// write and lose one of them.
let queue = Promise.resolve();

function update(change) {
    const next = queue.then(async () => {
        const entries = await load();
        change(entries);
        const tmp = `${FILE()}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(entries), { mode: 0o600 });
        await fs.rename(tmp, FILE());
    });
    queue = next.catch(() => {});
    return next;
}

function registerSecureStore() {
    ipcMain.handle("secure-store:get", async (_event, key) => {
        checkKey(key);
        const stored = (await load())[key];
        if (typeof stored !== "string") return null;
        checkAvailable();
        return safeStorage.decryptString(Buffer.from(stored, "base64"));
    });

    ipcMain.handle("secure-store:set", async (_event, key, value) => {
        checkKey(key);
        if (typeof value !== "string") throw new Error("secureStore: value must be a string");
        checkAvailable();
        const encrypted = safeStorage.encryptString(value).toString("base64");
        await update((entries) => {
            entries[key] = encrypted;
        });
    });

    ipcMain.handle("secure-store:delete", async (_event, key) => {
        checkKey(key);
        await update((entries) => {
            delete entries[key];
        });
    });
}

module.exports = { registerSecureStore };

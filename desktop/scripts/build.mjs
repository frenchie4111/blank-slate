#!/usr/bin/env node

/**
 * `electron-builder`, versioned from the app rather than this package.
 *
 * The desktop build takes `expo.version` from the root `app.json`, like the
 * phone builds do. `version` in `desktop/package.json` stays `0.0.0-dev`, which
 * is what an unpackaged `electron .` reports. The version is injected through
 * `extraMetadata` rather than written to disk, so a build never dirties the
 * tree.
 *
 * `--no-notarize` signs with the Developer ID but skips notarization: quick,
 * and the stable signature means a Keychain "Always Allow" survives rebuilds.
 *
 * `--no-sign` builds without credentials: signing is ad-hoc (enough to run on
 * this Mac, not to distribute) and notarization is skipped. Each ad-hoc build
 * is a new identity to the Keychain, so expect an access prompt after every
 * rebuild. Every other argument is passed straight through, so `--dir` and
 * `--mac` work as they do on `electron-builder` itself.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const unsigned = args.includes("--no-sign");
const unnotarized = unsigned || args.includes("--no-notarize");
const passthrough = args.filter((arg) => arg !== "--no-sign" && arg !== "--no-notarize");

/**
 * `.env`, loaded before anything reads the environment. electron-builder reads
 * `APPLE_ID` and the rest off `process.env` and silently skips notarization
 * when they are missing, so a forgotten loader would ship a build Gatekeeper
 * rejects. Variables that are already set win, which is the CI path.
 */
const envFile = join(here, "..", ".env");

if (!unsigned && existsSync(envFile)) process.loadEnvFile(envFile);

const env = { ...process.env };

/**
 * Catch a malformed app-specific password before spending minutes on signing.
 * Apple issues them as four groups of four lowercase letters. A value pasted
 * with its `.env` quotes still attached (Node strips them, `gh secret set`
 * doesn't) otherwise only fails as a 401 from notarytool, after the build.
 */
const password = env.APPLE_APP_SPECIFIC_PASSWORD;

if (!unnotarized && password && !/^[a-z]{4}(-[a-z]{4}){3}$/.test(password)) {
    console.error(
        `APPLE_APP_SPECIFIC_PASSWORD doesn't look like an app-specific password (xxxx-xxxx-xxxx-xxxx; ` +
            `got ${password.length} characters${/^["']|["']$/.test(password) ? ", wrapped in quotes" : ""}). ` +
            "Check for stray quotes or whitespace.",
    );
    process.exit(1);
}

if (unsigned) {
    env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
    for (const name of ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) {
        delete env[name];
    }
}

const appConfig = JSON.parse(readFileSync(join(here, "..", "..", "app.json"), "utf8"));

const version = appConfig.expo?.version;

if (typeof version !== "string" || version.length === 0) {
    console.error("No expo.version in app.json — nothing to version the build with.");
    process.exit(1);
}

// Spelled out rather than left to `PATH`, so running this file directly works
// as well as `npm run`.
const builder = join(
    here,
    "..",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron-builder.cmd" : "electron-builder",
);

const child = spawn(
    builder,
    [
        `--config.extraMetadata.version=${version}`,
        // "-" is ad-hoc: the identity in package.json is not looked for.
        ...(unsigned ? ["--config.mac.identity=-"] : []),
        ...(unnotarized ? ["--config.mac.notarize=false"] : []),
        ...passthrough,
    ],
    { cwd: join(here, ".."), env, stdio: "inherit", shell: process.platform === "win32" },
);

child.on("exit", (code, signal) => {
    if (signal !== null) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
});

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
 * `--no-sign` builds without credentials: signing is ad-hoc (enough to run on
 * this Mac, not to distribute) and notarization is skipped. Every other
 * argument is passed straight through, so `--dir` and `--mac` work as they do
 * on `electron-builder` itself.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const unsigned = args.includes("--no-sign");
const passthrough = args.filter((arg) => arg !== "--no-sign");

/**
 * `.env`, loaded before anything reads the environment. electron-builder reads
 * `APPLE_ID` and the rest off `process.env` and silently skips notarization
 * when they are missing, so a forgotten loader would ship a build Gatekeeper
 * rejects. Variables that are already set win, which is the CI path.
 */
const envFile = join(here, "..", ".env");

if (!unsigned && existsSync(envFile)) process.loadEnvFile(envFile);

const env = { ...process.env };

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
        ...(unsigned ? ["--config.mac.identity=-", "--config.mac.notarize=false"] : []),
        ...passthrough,
    ],
    { cwd: join(here, ".."), env, stdio: "inherit", shell: process.platform === "win32" },
);

child.on("exit", (code, signal) => {
    if (signal !== null) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
});

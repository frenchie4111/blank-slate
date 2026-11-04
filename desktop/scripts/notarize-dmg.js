/**
 * Notarizes and staples each DMG, as electron-builder's `artifactBuildCompleted` hook.
 *
 * electron-builder notarizes the `.app` and nothing else. `dmg.sign` gives the
 * DMG a Developer ID signature, but no ticket. v1.1.0's DMGs were notarized and
 * stapled by hand afterwards, so `spctl` reports "Notarized Developer ID" for
 * the disk image as well as the app inside it. This hook does the same work as
 * part of the build.
 *
 * Why this hook: electron-builder awaits it before emitting `artifactCreated`,
 * and `artifactCreated` is what the GitHub publisher uploads on. So the file
 * that `--publish always` uploads is the stapled one. Any later step would run
 * after the unstapled DMG was already on the release.
 *
 * The DMG's blockmap and sha512 are computed before this hook runs, and
 * stapling changes the file's bytes. That is why `dmg.writeUpdateInfo` is
 * false in package.json. The updater installs from the zip on macOS and has no
 * use for the DMG entry, so leaving it out of `latest-mac.yml` is simpler than
 * keeping a stale hash in it.
 *
 * Skipped, the same way electron-builder skips notarizing the app, when:
 * notarization is off (`--no-notarize` / `--no-sign`), the build is ad-hoc
 * signed, or the three Apple variables are missing (with a warning). CI does
 * not depend on that warning: the release and smoke workflows run `spctl`
 * against both the app and the DMG afterwards.
 */

const { execFileSync } = require("node:child_process");
const path = require("node:path");

/** stdout is returned to the caller; stderr goes straight to the build log. */
function run(command, args) {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

module.exports = async function notarizeDmg(context) {
    const { file, packager } = context;

    if (!file || !file.endsWith(".dmg")) return;

    const options = packager.platformSpecificBuildOptions;
    const name = path.basename(file);

    if (options.notarize === false || options.identity === "-") {
        console.log(`  • skipped DMG notarization  file=${name} reason=notarization is off for this build`);
        return;
    }

    const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;

    if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
        console.warn(
            `  • skipped DMG notarization  file=${name} reason=APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID are not all set`,
        );
        return;
    }

    console.log(`  • notarizing DMG  file=${name}`);

    // The submission's status is checked, not just the exit code: "Accepted" is
    // the only outcome that can be stapled.
    const result = JSON.parse(
        run("xcrun", [
            "notarytool",
            "submit",
            file,
            "--apple-id",
            APPLE_ID,
            "--password",
            APPLE_APP_SPECIFIC_PASSWORD,
            "--team-id",
            APPLE_TEAM_ID,
            "--wait",
            "--output-format",
            "json",
        ]),
    );

    if (result.status !== "Accepted") {
        throw new Error(
            `Notarization of ${name} finished as "${result.status}" (submission ${result.id}). ` +
                `See \`xcrun notarytool log ${result.id}\` for why.`,
        );
    }

    run("xcrun", ["stapler", "staple", file]);
    run("xcrun", ["stapler", "validate", file]);

    console.log(`  • notarized and stapled DMG  file=${name} submission=${result.id}`);
};

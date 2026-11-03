const fs = require("node:fs");
const path = require("node:path");

const { app, screen } = require("electron");

/**
 * The window's last size and position, restored on the next launch.
 *
 * Saved bounds are dropped if no display still overlaps them (a monitor that
 * was unplugged), so the window cannot reopen somewhere off-screen.
 */

const FILE = () => path.join(app.getPath("userData"), "window-state.json");

// Bumped when the default size changes enough that old saved bounds should
// not win (v2: phone-shaped 430x900 became desktop-shaped 1280x820).
const VERSION = 2;

function loadBounds(defaults) {
    try {
        const saved = JSON.parse(fs.readFileSync(FILE(), "utf8"));
        const { version, x, y, width, height } = saved;
        if (version !== VERSION) return defaults;
        if (![x, y, width, height].every(Number.isFinite)) return defaults;

        const visible = screen.getAllDisplays().some(({ workArea: area }) =>
            x < area.x + area.width &&
            x + width > area.x &&
            y < area.y + area.height &&
            y + height > area.y,
        );

        return visible ? { x, y, width, height } : defaults;
    } catch {
        return defaults;
    }
}

function trackBounds(window) {
    let timer = null;

    const save = () => {
        clearTimeout(timer);
        if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
        try {
            fs.writeFileSync(FILE(), JSON.stringify({ version: VERSION, ...window.getNormalBounds() }));
        } catch {}
    };

    // Debounced: `resize` and `move` fire continuously while dragging.
    const later = () => {
        clearTimeout(timer);
        timer = setTimeout(save, 400);
    };

    window.on("resize", later);
    window.on("move", later);
    window.on("close", save);
}

module.exports = { loadBounds, trackBounds };

# Blank Slate design — "Slate & Chalk"

Source of truth for the app's visual direction. The `boards/` folder holds the
mockups as HTML (`.dc.html`, from a Claude Design canvas). They need the canvas
runtime to render, so read them as source: every color, size and radius is
written inline. Translate to React Native `StyleSheet` — don't paste HTML.

Idea: a quiet dark slate that gets out of the way of the app being built.
Chalk-white type, one chalk-yellow accent for the next action, mono for
anything the agent touches.

## Color

| Token | Hex | Use |
| --- | --- | --- |
| `slate` | `#121316` | Screen background |
| `board` | `#1C1D21` | Surfaces: inputs, cards, segmented control, sheets |
| `raised` | `#26272C` | Selected/raised cards, inline code, menus |
| `line` | `#2E2F35` | Borders, dividers |
| `lineStrong` | `#3A3B42` | Input / secondary-button borders |
| `chalk` | `#EDEBE6` | Primary text; user chat bubble fill |
| `chalkSoft` | `#D6D4CE` | Secondary labels on surfaces |
| `chalkMuted` | `#B9B8B1` | Body copy on dark, tool-call text |
| `dust` | `#A3A39C` | Muted text, captions, icons |
| `accent` | `#E8C547` | The one action: send, save, fix, resume. Text on it is `slate` |
| `danger` | `#F08A6B` | Destructive text/icons; danger bg `#2A1C18`, border `#5A3328` |
| `success` | `#8FD1A0` | Done checks, diff `+` counts |
| `info` | `#8DB8F0` | Web search / fetch icons |
| `scrim` | `#0A0A0C` | Behind sheets |

Yellow is never decoration — if it's yellow, it's tappable and it's the next step.

## Type

- **Display / titles:** Space Grotesk 600–700. Display 32–40, screen title 28–30, header 19–22. Letter-spacing −0.01 to −0.02em.
- **Body / UI:** Inter 400–600. Body 15 (line-height 1.5), labels 13–14, captions 12.
- **Mono:** JetBrains Mono 400–500, 11–13. Only for file paths, tool calls, model IDs, versions, and uppercase section labels (11px, +0.12em tracking, `dust`).
- Sentence case everywhere ("Back to app", "Send"), replacing the current lowercase labels.

Load via `@expo-google-fonts/space-grotesk`, `@expo-google-fonts/inter`, `@expo-google-fonts/jetbrains-mono`.

## Shape & spacing

- Radii: 10 chips/tool rows · 12–14 buttons & inputs · 16–20 cards & icon tiles · 22 composer · 28 sheets.
- 4px grid. Screen gutter 20 (16 in chat). Touch targets ≥ 44.
- Buttons: height 48 (54 for the full-width CTA). Primary = `accent` bg / `slate` text. Secondary = `board` bg + `lineStrong` border. Destructive = danger bg/border + `danger` text.
- Icons: Ionicons outline, stroke look, `dust` by default. No emoji (replace `⚠︎`, `▾`).

## Screens (`boards/`)

- **Main.dc.html — Foundations:** palette, type scale, components, logo mark (rounded square outline with a small yellow bar bottom-right).
- **Onboarding.dc.html:** logo tile, "Build any app, right here." display headline, labelled key input (mono, secure), helper text with a "Get a key" link, full-width primary CTA pinned to the bottom.
- **Chat.dc.html:** header = logo button (back to app) · project name + chevron (opens Your apps) · settings icon. Chat/Files segmented control. Crash banner in danger colors with a yellow "Fix it" button. User bubble = chalk fill, slate text, radius 18/18/6/18. Assistant text sits on the background, no bubble. Composer = pill (`board`, radius 22) with a 44px yellow send button that becomes a stop square while running.
  - **Tool grouping** (like Claude Code): consecutive tool calls in a turn collapse into one card — status icon, summary ("Read 1 file, created 1, edited 1"), total diff "+18 −6", chevron. Tap expands to child rows on a 1px left rail, each `Verb path` in mono with a right-hand detail (line count, `+12`, `+6 −6`, "5 results"). A running group stays expanded with a spinner, a title of what it's doing ("Looking up the haptics API"), step count and elapsed time; the active step's rail is yellow.
- **Projects.dc.html — Your apps:** home-screen grid replacing the project sheet. 4 columns, 72px icon tiles (radius 20) with a tinted bg + colored glyph, 12px label below. Current app has a 2px yellow ring and dot. Last tile = dashed "New app" with a yellow plus. Edit button toggles edit mode (tiles tilt −2°, delete badges top-left, rename on tap). Bottom card: current app + yellow "Resume".
  - Tile tints (bg / glyph): yellow `#2B2A20/#E8C547`, green `#1F2A24/#8FD1A0`, blue `#1E2633/#8DB8F0`, coral `#2E2120/#F08A6B`, violet `#2A2233/#C3A6F0`, neutral `#24282B/#D6D4CE`.
- **Settings.dc.html:** back chevron + "Settings" title. Grouped cards (radius 20) under mono section labels: Model (radio rows + custom ID input with "Use"), App (version/channel/update rows in mono, status dot + "Check now"), API key (masked key + danger "Reset API key").

The dock (when chat is closed): along the bottom on a phone, plain `slate` (no hairline), above the home indicator. Logo button (`board` tile, `lineStrong` border, logo mark) · thin vertical divider · horizontally scrolling 44px app icons in Your apps order, the current one in a 2px yellow ring · dashed "+" for a new app. Tap switches apps, hold (or right-click) opens the tile menu. It slides away while the keyboard is up. The app is full bleed and raised over it: no gap, no borders, bottom corners rounded (radius 24) with a soft shadow onto the dock. On desktop and wide web the dock becomes a left rail (logo, horizontal divider, vertical icon column); the app fills the rest, rounded on its left corners where it meets the rail, with the chat sidebar on the right.

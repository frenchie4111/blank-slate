import * as history from './history';

// Automatic checks for visual slips a model can't see in a small screenshot
// description: styles it defined but never applied (a row whose
// flexDirection never reaches the view), styles it reads but never defined,
// and frames that overlap or run off screen. Findings go to the debug
// history and into take_screenshot / get_ui_tree results.

// ---- styles ----------------------------------------------------------------------------

// layout: the keys worth reporting when unused (see layoutKeys).
type Sheet = { where: string; keys: string[]; layout: string[]; used: Set<string> };

// One entry per StyleSheet.create call site and key set, for the code
// compiled most recently (the resolver resets it before each compile).
let sheets = new Map<string, Sheet>();
let missing = new Map<string, string>();

export function resetStyleLint(): void {
  sheets = new Map();
  missing = new Map();
}

// Generated modules carry a `//# sourceURL=vfs:///<path>`, so the first vfs
// frame is the app code that called StyleSheet.create.
function callSite(): string {
  const m = new Error().stack?.match(/vfs:\/\/\/([^\s:)]+):(\d+)/);
  return m ? `${m[1]}:${m[2]}` : 'the app';
}

// An unapplied layout style is the slip worth reporting: the row that never
// became a row. Colour-only styles and state variants ("chipActive") are
// often legitimately unread until that state happens, so they're left out.
const LAYOUT_PROPS = /^(flexDirection|alignItems|alignSelf|justifyContent|gap|rowGap|columnGap|flex|flexGrow|flexWrap|position|padding\w*|margin\w*|width|height|minHeight|minWidth)$/;
const STATE_NAME = /(active|selected|pressed|disabled|focused|checked|done|completed|on|off|open|closed|error|hover|current|today|highlight)$/i;

function layoutKeys(sheet: Record<string, unknown>): string[] {
  return Object.keys(sheet).filter((k) => {
    const v = sheet[k];
    return !STATE_NAME.test(k) && !!v && typeof v === 'object' && Object.keys(v).some((p) => LAYOUT_PROPS.test(p));
  });
}

// Property reads that aren't style lookups (React, Proxies, JSON, devtools).
const NOT_STYLES = new Set(['toJSON', 'then', 'constructor', 'prototype', 'length', 'displayName', 'name']);

/** StyleSheet.create that tracks which styles are actually read. */
export function lintedCreate<T extends Record<string, unknown>>(create: (s: T) => T): (s: T) => T {
  return (styles: T) => {
    const sheet = create(styles);
    if (!sheet || typeof sheet !== 'object') return sheet;
    const where = callSite();
    const keys = Object.keys(sheet);
    const id = `${where}|${keys.join(',')}`;
    let rec = sheets.get(id);
    if (!rec) sheets.set(id, (rec = { where, keys, layout: layoutKeys(sheet), used: new Set() }));
    const record = rec;
    return new Proxy(sheet, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && !NOT_STYLES.has(prop) && /^[A-Za-z_$][\w$]*$/.test(prop)) {
          if (prop in target) record.used.add(prop);
          else noteMissing(record.where, prop);
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  };
}

function noteMissing(where: string, key: string): void {
  const id = `${where}|${key}`;
  if (missing.has(id)) return;
  const text = `Style "${key}" is used but not defined in the StyleSheet.create at ${where}, so it does nothing.`;
  missing.set(id, text);
  history.record({ type: 'log', level: 'warn', text });
}

/** An icon name the set doesn't have: @expo/vector-icons draws a "?" for it. */
export function noteMissingIcon(set: string, iconName: string, glyphs: Record<string, unknown>): void {
  const id = `icon|${set}|${iconName}`;
  if (missing.has(id)) return;
  const stem = iconName.split('-')[0];
  const near = Object.keys(glyphs)
    .filter((k) => k.startsWith(stem))
    .slice(0, 4);
  const text = `${set} has no icon named "${iconName}", so it shows a "?"${near.length ? `. Close names: ${near.join(', ')}` : ''}.`;
  missing.set(id, text);
  history.record({ type: 'log', level: 'warn', text });
}

/**
 * Styles read but never defined, and styles defined but not used by anything
 * rendered so far. Sheets nothing has read yet (a screen not opened) are
 * skipped, which keeps the second list to likely mistakes.
 */
export function styleProblems(max = 8): string[] {
  const out = [...missing.values()];
  for (const s of sheets.values()) {
    if (!s.used.size) continue;
    const unused = s.layout.filter((k) => !s.used.has(k));
    if (unused.length) {
      out.push(
        `${s.where} defines layout style${unused.length === 1 ? '' : 's'} ${unused.map((k) => `"${k}"`).join(', ')} that nothing on screen applies: check the style props that should use ${
          unused.length === 1 ? 'it' : 'them'
        } (or delete ${unused.length === 1 ? 'it' : 'them'} if unused).`,
      );
    }
  }
  return out.slice(0, max);
}

// ---- layout ----------------------------------------------------------------------------

export type LintFrame = { x: number; y: number; w: number; h: number };
export type LintNode = {
  kind: string;
  label: string;
  frame: LintFrame;
  hitSlop?: boolean;
  // <Svg> only: its props, to find the rings it draws.
  svg?: Record<string, unknown>;
};

type Ring = { cx: number; cy: number; inner: number; outer: number };

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

// Stroked <Circle>s inside an <Svg>, in app-view points: the bands a dial
// or progress ring occupies. Anything else in the drawing is ignored.
function ringsOf(svg: Record<string, unknown>, frame: LintFrame): Ring[] {
  const vb = typeof svg.viewBox === 'string' ? svg.viewBox.split(/[\s,]+/).map(Number) : null;
  const w = vb?.[2] || num(svg.width) || frame.w;
  const h = vb?.[3] || num(svg.height) || frame.h;
  const sx = frame.w / w;
  const sy = frame.h / h;
  const ox = vb?.[0] ?? 0;
  const oy = vb?.[1] ?? 0;
  const out: Ring[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > 6 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1));
    const el = node as { type?: { displayName?: string; name?: string }; props?: Record<string, unknown> };
    const p = el.props ?? {};
    const type = el.type?.displayName || el.type?.name;
    if (type === 'Circle' && p.stroke && p.stroke !== 'none') {
      const cx = num(p.cx) ?? 0;
      const cy = num(p.cy) ?? 0;
      const rr = num(p.r);
      const sw = num(p.strokeWidth) ?? 1;
      if (rr) {
        const k = Math.min(sx, sy);
        out.push({
          cx: frame.x + (cx - ox) * sx,
          cy: frame.y + (cy - oy) * sy,
          inner: (rr - sw / 2) * k,
          outer: (rr + sw / 2) * k,
        });
      }
    }
    visit(p.children, depth + 1);
  };
  visit(svg.children, 0);
  return out;
}

function crossesRing(f: LintFrame, ring: Ring): boolean {
  const nx = Math.max(f.x, Math.min(ring.cx, f.x + f.w));
  const ny = Math.max(f.y, Math.min(ring.cy, f.y + f.h));
  const near = Math.hypot(nx - ring.cx, ny - ring.cy);
  const far = Math.max(
    ...[
      [f.x, f.y],
      [f.x + f.w, f.y],
      [f.x, f.y + f.h],
      [f.x + f.w, f.y + f.h],
    ].map(([x, y]) => Math.hypot(x - ring.cx, y - ring.cy)),
  );
  return near < ring.outer - 1 && far > ring.inner + 1;
}

const area = (f: LintFrame) => Math.max(0, f.w) * Math.max(0, f.h);

function intersection(a: LintFrame, b: LintFrame): LintFrame {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, w: Math.min(a.x + a.w, b.x + b.w) - x, h: Math.min(a.y + a.h, b.y + b.h) - y };
}

function contains(outer: LintFrame, inner: LintFrame, slack = 1): boolean {
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.w <= outer.x + outer.w + slack &&
    inner.y + inner.h <= outer.y + outer.h + slack
  );
}

const name = (n: LintNode) => `${n.kind === 'text' ? 'text' : n.kind} "${n.label || '(unlabelled)'}"`;
const r = Math.round;

/** Overlapping, clipped and too-small elements, from measured frames. */
export function layoutProblems(nodes: LintNode[], root: LintFrame | null, max = 8): string[] {
  const out: string[] = [];
  const texts = nodes.filter((n) => n.kind === 'text');
  const seen = new Set<string>();
  // Text that partly covers another element. Fully inside is fine (a label
  // in its button, a value in the middle of a dial); partly over usually
  // means an overlay that isn't positioned on what it labels.
  for (const t of texts) {
    for (const o of nodes) {
      if (o === t || o.kind === 'svg') continue;
      const i = intersection(t.frame, o.frame);
      if (i.w <= 1 || i.h <= 1) continue;
      if (contains(o.frame, t.frame) || contains(t.frame, o.frame)) continue;
      if (area(i) < 0.15 * Math.min(area(t.frame), area(o.frame))) continue;
      const key = [t.label, o.label].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`${name(t)} partly overlaps ${name(o)} (${r(t.frame.x)},${r(t.frame.y)} vs ${r(o.frame.x)},${r(o.frame.y)}).`);
    }
  }
  // Graphics: text and buttons must sit clear of them or inside. For a ring
  // or dial (a stroked Circle) only the hole is free: anything reaching the
  // band is drawn across the stroke.
  for (const g of nodes.filter((n) => n.kind === 'svg')) {
    const f = g.frame;
    const rings = g.svg ? ringsOf(g.svg, f) : [];
    const ring = rings.length > 0;
    const hits = nodes.filter((n) => {
      if (n === g || (n.kind !== 'text' && n.kind !== 'button')) return false;
      const i = intersection(n.frame, f);
      if (i.w <= 1 || i.h <= 1) return false;
      if (!ring) return !contains(f, n.frame);
      // A text frame includes its line box; the glyphs sit in the middle.
      const box = n.kind === 'text' ? { ...n.frame, y: n.frame.y + n.frame.h * 0.2, h: n.frame.h * 0.6 } : n.frame;
      return rings.some((rg) => crossesRing(box, rg));
    });
    // A button's own label isn't worth a second mention.
    const crossing = hits.filter(
      (n) => n.kind === 'button' || !hits.some((b) => b.kind === 'button' && contains(b.frame, n.frame)),
    );
    if (crossing.length) {
      out.push(
        `${crossing
          .slice(0, 4)
          .map(name)
          .join(', ')} ${crossing.length === 1 ? 'is' : 'are'} drawn across ${ring ? 'the ring stroke in' : 'the edge of'} the graphic at ${r(f.x)},${r(f.y)} ${r(f.w)}×${r(f.h)}: move ${crossing.length === 1 ? 'it' : 'them'} ${ring ? 'inside the ring or below it' : 'clear of it'}.`,
      );
    }
  }
  const emoji = texts.filter((t) => /\p{Extended_Pictographic}/u.test(t.label)).slice(0, 3);
  if (emoji.length) {
    out.push(`Emoji in the UI: ${emoji.map((t) => `"${t.label.slice(0, 30)}"`).join(', ')}. Use an icon instead unless the user asked for emoji.`);
  }
  if (root) {
    for (const n of nodes) {
      if (n.frame.x < -1 || n.frame.x + n.frame.w > root.w + 1) {
        out.push(`${name(n)} runs past the ${n.frame.x < -1 ? 'left' : 'right'} edge of the screen and is cut off.`);
      }
    }
  }
  const small = nodes.filter(
    (n) => n.kind === 'button' && !n.hitSlop && (n.frame.w < 40 || n.frame.h < 40),
  );
  if (small.length) {
    out.push(
      `Tap targets under 44pt: ${small
        .slice(0, 5)
        .map((n) => `"${n.label || '(unlabelled)'}" ${r(n.frame.w)}×${r(n.frame.h)}`)
        .join(', ')}. Give them 44pt or hitSlop.`,
    );
  }
  return out.slice(0, max);
}

import { Ionicons } from '@expo/vector-icons';
import { STORE_MODEL } from '../agent/models';
import { completeJson } from '../agent/openrouter';
import { loadFontsUsedIn } from '../appkit/fonts';
import { defaultGlyph, isGlyph, TINT_KEYS, TINTS, type Glyph, type Tint } from '../project/appearance';
import { cleanName, cleanVibe } from '../project/store';

// The App Store sells apps that don't exist yet. A search asks a cheap model
// to invent a page of listings (name, blurb, reviews, mock screenshots), and
// "Get" hands the listing to the agent as the brief for a brand-new project.

export type Palette = { bg: string; surface: string; text: string; accent: string };

// Mock screenshots are drawn from these blocks (see Screenshot.tsx), not
// generated as images: instant, free, and they use the app's own palette.
export type Block =
  | { t: 'hero'; text: string; sub?: string }
  | { t: 'row'; text: string; sub?: string; icon?: string }
  | { t: 'card'; text: string; sub?: string }
  | { t: 'chips'; items: string[] }
  | { t: 'bars'; values: number[] }
  | { t: 'progress'; value: number; text?: string }
  | { t: 'grid'; icons: string[] }
  | { t: 'button'; text: string }
  | { t: 'ring'; value: number; text: string; sub?: string }
  | { t: 'calendar'; month: string; marked: number[] }
  | { t: 'chat'; messages: { me: boolean; text: string }[] }
  | { t: 'photos'; icons: string[] }
  | { t: 'map'; pins: number; label?: string }
  | { t: 'toggles'; items: { text: string; on: boolean }[] }
  | { t: 'stats'; items: { value: string; label: string }[] }
  | { t: 'art'; icon: string; text?: string }
  | { t: 'board'; cols: number; cells: string }
  | { t: 'keypad'; keys: string[] }
  | { t: 'quote'; text: string; by?: string }
  | { t: 'segment'; items: string[]; selected: number };

export type BlockType = Block['t'];

// How a screenshot is composed around the phone.
export const LAYOUTS = ['classic', 'bottom', 'bleed', 'tilt', 'zoom'] as const;
export type Layout = (typeof LAYOUTS)[number];
// What sits behind the caption.
export const BACKDROPS = ['solid', 'gradient', 'dots', 'stripes', 'blob', 'dark'] as const;
export type Backdrop = (typeof BACKDROPS)[number];
export const HEADERS = ['large', 'center', 'none'] as const;
export type Header = (typeof HEADERS)[number];

export type Screen = {
  caption: string;
  title: string;
  layout: Layout;
  backdrop: Backdrop;
  header: Header;
  // Bottom tab bar icons; empty for none.
  tabs: string[];
  blocks: Block[];
};

// Display + body faces per type style. The display face also sets the
// listing's name on its icon when the icon is a lettermark.
export const FONTS = {
  grotesk: { display: 'SpaceGrotesk_700Bold', body: 'Inter_400Regular' },
  serif: { display: 'Fraunces_600SemiBold', body: 'Lora_400Regular' },
  editorial: { display: 'InstrumentSerif_400Regular', body: 'DMSans_400Regular' },
  rounded: { display: 'Nunito_800ExtraBold', body: 'Nunito_600SemiBold' },
  playful: { display: 'Fredoka_600SemiBold', body: 'Fredoka_400Regular' },
  mono: { display: 'SpaceMono_700Bold', body: 'SpaceMono_400Regular' },
  pixel: { display: 'PressStart2P_400Regular', body: 'SpaceMono_400Regular' },
  hand: { display: 'Caveat_700Bold', body: 'Nunito_600SemiBold' },
  condensed: { display: 'BebasNeue_400Regular', body: 'DMSans_500Medium' },
  chunky: { display: 'BricolageGrotesque_800ExtraBold', body: 'BricolageGrotesque_400Regular' },
} as const;
export type FontStyle = keyof typeof FONTS;
const FONT_KEYS = Object.keys(FONTS) as FontStyle[];

export const CORNERS = ['sharp', 'soft', 'round'] as const;
export type Corners = (typeof CORNERS)[number];
export const ICON_STYLES = ['gradient', 'flat', 'outline', 'letter', 'sticker'] as const;
export type IconStyle = (typeof ICON_STYLES)[number];

export type Look = { font: FontStyle; corners: Corners; iconStyle: IconStyle };

export type Review = { author: string; stars: number; title: string; body: string };

export type Listing = {
  id: string;
  name: string;
  developer: string;
  tagline: string;
  category: string;
  rating: number;
  ratings: number;
  ageRating: string;
  icon: string;
  palette: Palette;
  look: Look;
  vibe: string;
  description: string;
  whatsNew: string;
  features: string[];
  screens: Screen[];
  reviews: Review[];
  // What the agent is asked to build on "Get".
  brief: string;
};

const SYSTEM = () => `You are the catalogue of the Vibe App Store, a store whose apps are all
built on demand on the user's phone. Given a search, invent apps that match it.
Mix sincere, genuinely useful apps with a few delightfully odd or funny ones,
but every app must be small enough to build as a single React Native app with
local storage (no accounts, servers or payments).

Reply with one JSON object: {"apps": [ ... ]} with 6 apps. Each app:
{
  "name": "2-3 words, a real-sounding product name",
  "developer": "a plausible indie studio or person",
  "tagline": "under 40 chars",
  "category": "App Store category, e.g. Productivity",
  "rating": 3.2-5.0 with one decimal,
  "ratings": integer review count,
  "ageRating": "4+" | "9+" | "12+" | "17+",
  "icon": an Ionicons name WITHOUT "-outline", e.g. "leaf", "timer", "paw", "pizza", "sparkles",
  "palette": {"bg": "#hex", "surface": "#hex", "text": "#hex", "accent": "#hex"} (bg and text must contrast),
  "font": one of ${FONT_KEYS.join(' | ')},
  "corners": "sharp" | "soft" | "round",
  "iconStyle": "gradient" | "flat" | "outline" | "letter" | "sticker",
  "vibe": "3-6 words on how it should feel",
  "description": "2 short paragraphs of App Store copy, separated by \\n\\n",
  "whatsNew": "one or two playful release-note lines",
  "features": ["4-6 concrete features"],
  "screens": 3 screenshots, each {
    "caption": "marketing headline, 2-6 words",
    "title": "screen title",
    "layout": "classic" | "bottom" | "bleed" | "tilt" | "zoom",
    "backdrop": "solid" | "gradient" | "dots" | "stripes" | "blob" | "dark",
    "header": "large" | "center" | "none",
    "tabs": [] or 3-5 ionicons names for a bottom tab bar,
    "blocks": [2-5 blocks]
  },
  "reviews": 3 reviews, each {"author": "username", "stars": 1-5, "title": "...", "body": "1-2 sentences"},
  "brief": "a build brief for a developer: the screens, the data it stores, and the key interactions, 4-8 sentences"
}

DESIGN EACH APP FROM WHAT IT IS, NOT FROM A TEMPLATE. Before writing an app,
picture the best real app of its kind and design its screens the way that app
would look: a dice game looks like a game (a "board", big pieces, playful
font, loud colours), a ledger looks like a ledger (tight "stats", "bars",
mono or condensed type, sober palette), a journal looks like paper (light bg,
serif or hand font, "quote", "calendar"), a messenger is mostly "chat", a
camera app is mostly "photos", a calculator is mostly "keypad", a meditation
app is mostly "art" or "ring" with lots of space. The palette, font, corners,
icon and blocks should all come from that, so two apps for similar searches
still look like different products from different studios.

The six apps must look nothing alike:
- different "font" and "iconStyle" for every app; mix "corners".
- palettes: at least two light (pale bg, dark text), at least two dark, one loud/saturated. Never two apps with the same accent hue.
- within an app, each of its 3 screenshots uses a different "layout" and "backdrop".
- each screenshot is built around ONE block that suits that app (a game gets a "board", a messenger "chat", a habit app "calendar" or "ring", a finance app "stats" + "bars", a travel app "map", a camera app "photos", a calculator "keypad"), plus a few supporting blocks.
- use "row" and "card" sparingly; never build a screen only from rows.

Blocks draw a mock screenshot, top to bottom. Types:
{"t":"hero","text":"big text or number","sub":"small line"}
{"t":"row","text":"list item","sub":"detail","icon":"ionicons name"}
{"t":"card","text":"heading","sub":"body"}
{"t":"chips","items":["2-5 short labels"]}
{"t":"segment","items":["2-3 labels"],"selected":0}
{"t":"bars","values":[5-7 numbers 0-10]}
{"t":"progress","value":0-1,"text":"label"}
{"t":"ring","value":0-1,"text":"big label inside","sub":"small label"}
{"t":"stats","items":[{"value":"12","label":"days"}, 2-3 items]}
{"t":"calendar","month":"March","marked":[day numbers 1-31]}
{"t":"chat","messages":[{"me":false,"text":"..."},{"me":true,"text":"..."}, 2-4 messages]}
{"t":"photos","icons":["4-6 ionicons names, one per photo tile"]}
{"t":"map","pins":1-5,"label":"place name"}
{"t":"toggles","items":[{"text":"setting","on":true}, 2-4 items]}
{"t":"art","icon":"ionicons name","text":"short line under a big illustration"}
{"t":"board","cols":3-8,"cells":"a string of cols*rows chars: '.' empty, 'x' accent piece, 'o' text-colour piece, '#' wall"}
{"t":"keypad","keys":["9-16 short keys, e.g. digits and operators"]}
{"t":"quote","text":"a line of text to feature","by":"attribution"}
{"t":"grid","icons":["4-8 ionicons names"]}
{"t":"button","text":"call to action"}
Make the screenshot text specific to the app (real-looking data), never lorem ipsum.`;

export async function search(
  apiKey: string,
  query: string,
  signal?: AbortSignal,
): Promise<Listing[]> {
  const { text } = await completeJson(apiKey, STORE_MODEL, SYSTEM(), `Search: ${query.trim()}`, signal);
  const raw = parseLoose(text) as { apps?: unknown } | unknown[] | null;
  const apps = Array.isArray(raw) ? raw : Array.isArray(raw?.apps) ? raw.apps : [];
  const seen = new Set<string>();
  const listings: Listing[] = [];
  apps.forEach((a, i) => {
    const l = toListing(a, `${Date.now().toString(36)}-${i}`);
    if (!l || seen.has(l.name.toLowerCase())) return;
    seen.add(l.name.toLowerCase());
    listings.push(l);
  });
  if (!listings.length) throw new Error('The store came back empty. Try another search.');
  // Catalogue fonts load on demand; get them before the results draw.
  await loadFontsUsedIn([listings.map((l) => `${FONTS[l.look.font].display} ${FONTS[l.look.font].body}`).join(' ')]);
  return listings;
}

/**
 * The first message the agent gets for an installed listing. `shots` are the
 * project paths of its App Store screenshots, saved there for view_image.
 */
export function buildPrompt(l: Listing, shots: string[] = []): string {
  const features = l.features.map((f) => `- ${f}`).join('\n');
  const screens = l.screens
    .map((s, i) => `- ${s.title}: ${s.caption}${shots[i] ? ` (${shots[i]})` : ''}`)
    .join('\n');
  const reference = shots.filter(Boolean).length
    ? [
        '',
        `Its App Store screenshots are saved in this project: ${shots.filter(Boolean).join(', ')}. ` +
          'Look at each one with view_image before writing any code, then recreate those screens as closely as you can: ' +
          'the same layout, colours, typography, icons and sample content. They are the design spec. ' +
          "Don't display these files in the app; build the real UI.",
      ]
    : [];
  return [
    `Build "${l.name}" (${l.category}) — ${l.tagline}.`,
    '',
    l.brief,
    '',
    `Features:\n${features}`,
    '',
    `Its App Store listing shows these screens:\n${screens}`,
    ...reference,
    '',
    `Colours from its listing: background ${l.palette.bg}, surfaces ${l.palette.surface}, text ${l.palette.text}, accent ${l.palette.accent}.`,
    `Give it an app icon that matches.`,
  ].join('\n');
}

/** Home-screen tile for an installed listing, until the agent draws a real icon. */
export function tileFor(l: Listing): { tint: Tint; glyph: Glyph } {
  const glyph = isGlyph(l.icon) ? l.icon : defaultGlyph(`${l.name} ${l.category}`);
  const target = rgb(l.palette.accent);
  let best: Tint = 'neutral';
  let bestDist = Infinity;
  for (const k of TINT_KEYS) {
    const c = rgb(TINTS[k].fg);
    const d = (c[0] - target[0]) ** 2 + (c[1] - target[1]) ** 2 + (c[2] - target[2]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = k;
    }
  }
  return { tint: best, glyph };
}

/** An Ionicons outline name, or a stand-in when the model made one up. */
export type IconName = keyof typeof Ionicons.glyphMap;

export function iconName(name: string | undefined, fallback = 'sparkles', filled = false): IconName {
  const map = Ionicons.glyphMap as Record<string, number>;
  const base = (name ?? '').replace(/-(outline|sharp)$/, '');
  const pick = (b: string) => (filled ? b : `${b}-outline`);
  if (base && map[pick(base)] !== undefined) return pick(base) as IconName;
  if (base && map[base] !== undefined) return base as IconName;
  return pick(fallback) as IconName;
}

// ---- validation -----------------------------------------------------------
// The model's JSON is close but not guaranteed; keep what's usable.

function parseLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {}
  // Fenced or chatty replies: take the outermost object.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function str(v: unknown, max: number, fallback = ''): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : fallback;
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function strs(v: unknown, maxItems: number, maxLen: number): string[] {
  return Array.isArray(v)
    ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems)
    : [];
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function hex(v: unknown, fallback: string): string {
  return typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : fallback;
}

function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Stable stand-in from a list when the model leaves a style out, so even a
// lazy reply varies between apps and screenshots.
function spread<T>(options: readonly T[], seed: string, i = 0): T {
  return options[(hash(seed) + i) % options.length];
}

function rgb(h: string): [number, number, number] {
  let s = h.replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toBlock(v: unknown): Block | null {
  const b = v as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return null;
  switch (b.t) {
    case 'hero':
    case 'card':
    case 'row': {
      const text = str(b.text, 60);
      if (!text) return null;
      const sub = str(b.sub, 90) || undefined;
      return b.t === 'row' ? { t: 'row', text, sub, icon: str(b.icon, 40) || undefined } : { t: b.t, text, sub };
    }
    case 'chips': {
      const items = strs(b.items, 5, 20);
      return items.length ? { t: 'chips', items } : null;
    }
    case 'bars': {
      const values = Array.isArray(b.values) ? b.values.map((x) => num(x, 0, 10, 0)).slice(0, 8) : [];
      return values.length >= 2 ? { t: 'bars', values } : null;
    }
    case 'progress':
      return { t: 'progress', value: num(b.value, 0, 1, 0.5), text: str(b.text, 40) || undefined };
    case 'grid': {
      const icons = strs(b.icons, 8, 40);
      return icons.length ? { t: 'grid', icons } : null;
    }
    case 'button': {
      const text = str(b.text, 30);
      return text ? { t: 'button', text } : null;
    }
    case 'ring': {
      const text = str(b.text, 12);
      return text ? { t: 'ring', value: num(b.value, 0, 1, 0.7), text, sub: str(b.sub, 30) || undefined } : null;
    }
    case 'calendar': {
      const marked = Array.isArray(b.marked)
        ? b.marked.map((x) => Math.round(num(x, 1, 31, 0))).filter((d) => d >= 1).slice(0, 31)
        : [];
      return { t: 'calendar', month: str(b.month, 16, 'This month'), marked };
    }
    case 'chat': {
      const messages = (Array.isArray(b.messages) ? b.messages : [])
        .map((m) => {
          const mm = m as Record<string, unknown> | null;
          const text = str(mm?.text, 80);
          return text ? { me: !!mm?.me, text } : null;
        })
        .filter((m): m is { me: boolean; text: string } => !!m)
        .slice(0, 5);
      return messages.length ? { t: 'chat', messages } : null;
    }
    case 'photos': {
      const icons = strs(b.icons, 6, 40);
      return { t: 'photos', icons: icons.length ? icons : ['image', 'image', 'image', 'image'] };
    }
    case 'map':
      return { t: 'map', pins: Math.round(num(b.pins, 1, 6, 3)), label: str(b.label, 30) || undefined };
    case 'toggles': {
      const items = (Array.isArray(b.items) ? b.items : [])
        .map((x) => {
          const it = x as Record<string, unknown> | null;
          const text = str(it?.text, 30);
          return text ? { text, on: it?.on !== false } : null;
        })
        .filter((x): x is { text: string; on: boolean } => !!x)
        .slice(0, 5);
      return items.length ? { t: 'toggles', items } : null;
    }
    case 'stats': {
      const items = (Array.isArray(b.items) ? b.items : [])
        .map((x) => {
          const it = x as Record<string, unknown> | null;
          const value = str(typeof it?.value === 'number' ? String(it.value) : it?.value, 8);
          return value ? { value, label: str(it?.label, 16) } : null;
        })
        .filter((x): x is { value: string; label: string } => !!x)
        .slice(0, 3);
      return items.length ? { t: 'stats', items } : null;
    }
    case 'art':
      return { t: 'art', icon: str(b.icon, 40, 'sparkles'), text: str(b.text, 60) || undefined };
    case 'board': {
      const cols = Math.round(num(b.cols, 3, 8, 3));
      const raw = str(b.cells, 64).replace(/[^.xo#]/gi, '.').toLowerCase();
      const rows = Math.max(1, Math.min(8, Math.ceil(raw.length / cols) || cols));
      return { t: 'board', cols, cells: raw.padEnd(cols * rows, '.').slice(0, cols * rows) };
    }
    case 'keypad': {
      const keys = strs(b.keys, 16, 4);
      return keys.length >= 3 ? { t: 'keypad', keys } : null;
    }
    case 'quote': {
      const text = str(b.text, 120);
      return text ? { t: 'quote', text, by: str(b.by, 30) || undefined } : null;
    }
    case 'segment': {
      const items = strs(b.items, 3, 14);
      return items.length >= 2
        ? { t: 'segment', items, selected: Math.round(num(b.selected, 0, items.length - 1, 0)) }
        : null;
    }
    default:
      return null;
  }
}

function toListing(v: unknown, id: string): Listing | null {
  const a = v as Record<string, unknown> | null;
  if (!a || typeof a !== 'object') return null;
  const name = cleanName(str(a.name, 60));
  if (!name) return null;
  const p = (a.palette ?? {}) as Record<string, unknown>;
  const palette: Palette = {
    bg: hex(p.bg, '#101114'),
    surface: hex(p.surface, '#1C1D21'),
    text: hex(p.text, '#EDEBE6'),
    accent: hex(p.accent, '#E8C547'),
  };
  const screens = (Array.isArray(a.screens) ? a.screens : [])
    .map((s, i): Screen | null => {
      const sc = s as Record<string, unknown> | null;
      if (!sc || typeof sc !== 'object') return null;
      const blocks = (Array.isArray(sc.blocks) ? sc.blocks : [])
        .map(toBlock)
        .filter((b): b is Block => !!b)
        .slice(0, 7);
      if (!blocks.length) return null;
      return {
        caption: str(sc.caption, 60, name),
        title: str(sc.title, 30, name),
        layout: oneOf(sc.layout, LAYOUTS, spread(LAYOUTS, name, i)),
        backdrop: oneOf(sc.backdrop, BACKDROPS, spread(BACKDROPS, name, i * 2)),
        header: oneOf(sc.header, HEADERS, spread(HEADERS, name, i)),
        tabs: strs(sc.tabs, 5, 40),
        blocks,
      };
    })
    .filter((s): s is Screen => !!s)
    .slice(0, 4);
  const reviews = (Array.isArray(a.reviews) ? a.reviews : [])
    .map((r): Review | null => {
      const rv = r as Record<string, unknown> | null;
      if (!rv || typeof rv !== 'object') return null;
      const body = str(rv.body, 300);
      if (!body) return null;
      return {
        author: str(rv.author, 30, 'anonymous'),
        stars: Math.round(num(rv.stars, 1, 5, 5)),
        title: str(rv.title, 60),
        body,
      };
    })
    .filter((r): r is Review => !!r)
    .slice(0, 4);
  const description = str(a.description, 1200);
  const tagline = str(a.tagline, 60);
  const features = strs(a.features, 6, 120);
  return {
    id,
    name,
    developer: str(a.developer, 40, 'Indie Dev'),
    tagline,
    category: str(a.category, 30, 'Utilities'),
    rating: Math.round(num(a.rating, 1, 5, 4.5) * 10) / 10,
    ratings: Math.round(num(a.ratings, 0, 9_999_999, 120)),
    ageRating: str(a.ageRating, 4, '4+'),
    icon: str(a.icon, 40, 'sparkles'),
    palette,
    look: {
      font: oneOf(a.font, FONT_KEYS, spread(FONT_KEYS, name)),
      corners: oneOf(a.corners, CORNERS, spread(CORNERS, name)),
      iconStyle: oneOf(a.iconStyle, ICON_STYLES, spread(ICON_STYLES, name)),
    },
    vibe: cleanVibe(str(a.vibe, 120)),
    description,
    whatsNew: str(a.whatsNew, 300),
    features,
    screens,
    reviews,
    brief: str(a.brief, 2000) || `${tagline}. ${description}`,
  };
}

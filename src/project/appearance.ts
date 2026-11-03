// Home-screen tile appearance for projects: a tint (bg/glyph colour pair from
// design/README.md) and an Ionicons outline glyph. Stored on the Project as
// optional fields; projects saved before this existed get a stable default
// derived from their id and name, so nothing needs migrating.

export const TINTS = {
  yellow: { bg: '#2B2A20', fg: '#E8C547' },
  green: { bg: '#1F2A24', fg: '#8FD1A0' },
  blue: { bg: '#1E2633', fg: '#8DB8F0' },
  coral: { bg: '#2E2120', fg: '#F08A6B' },
  violet: { bg: '#2A2233', fg: '#C3A6F0' },
  neutral: { bg: '#24282B', fg: '#D6D4CE' },
} as const;

export type Tint = keyof typeof TINTS;
export const TINT_KEYS = Object.keys(TINTS) as Tint[];

// Ionicons names, without the "-outline" suffix.
export const GLYPHS = [
  'cube',
  'checkmark-done',
  'leaf',
  'calculator',
  'barbell',
  'cart',
  'happy',
  'timer',
  'albums',
  'book',
  'cash',
  'musical-notes',
  'cloud',
  'game-controller',
  'chatbubble',
  'camera',
  'map',
  'restaurant',
  'heart',
  'calendar',
  'flash',
  'planet',
  'rocket',
  'list',
] as const;

export type Glyph = (typeof GLYPHS)[number];

const KEYWORDS: [RegExp, Glyph][] = [
  [/habit|todo|task|check/i, 'checkmark-done'],
  [/plant|garden|water/i, 'leaf'],
  [/tip|calc|math|split/i, 'calculator'],
  [/workout|gym|lift|fitness|exercise/i, 'barbell'],
  [/grocer|shop|cart|store/i, 'cart'],
  [/mood|journal|feel/i, 'happy'],
  [/timer|focus|pomodoro|clock|count/i, 'timer'],
  [/flash ?card|card|deck|study/i, 'albums'],
  [/book|read|note/i, 'book'],
  [/budget|money|expense|finance|cash/i, 'cash'],
  [/music|song|beat|sound/i, 'musical-notes'],
  [/weather|forecast/i, 'cloud'],
  [/game|play|puzzle/i, 'game-controller'],
  [/chat|message/i, 'chatbubble'],
  [/photo|camera|picture/i, 'camera'],
  [/map|trip|travel|route/i, 'map'],
  [/recipe|food|meal|cook/i, 'restaurant'],
  [/calendar|event|schedule|plan/i, 'calendar'],
  [/list/i, 'list'],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function defaultTint(id: string): Tint {
  return TINT_KEYS[hash(id) % TINT_KEYS.length];
}

export function defaultGlyph(name: string): Glyph {
  for (const [re, glyph] of KEYWORDS) if (re.test(name)) return glyph;
  return 'cube';
}

export function isTint(v: unknown): v is Tint {
  return typeof v === 'string' && v in TINTS;
}

export function isGlyph(v: unknown): v is Glyph {
  return typeof v === 'string' && (GLYPHS as readonly string[]).includes(v);
}

export function appearanceOf(p: { id: string; name: string; tint?: string; glyph?: string }): {
  tint: Tint;
  glyph: Glyph;
} {
  return {
    tint: isTint(p.tint) ? p.tint : defaultTint(p.id),
    glyph: isGlyph(p.glyph) ? p.glyph : defaultGlyph(p.name),
  };
}

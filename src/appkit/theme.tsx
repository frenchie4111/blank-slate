import * as React from 'react';
import { useColorScheme as useRNColorScheme, type ColorValue } from 'react-native';

// The app's own design tokens, written by the agent to theme.ts. Nothing
// here has a look of its own: it only picks the light or dark palette.

export type Scheme = 'light' | 'dark';
type Palette = Record<string, ColorValue>;

export type ThemeSpec = {
  mood?: string;
  vibe?: string;
  // Either { light, dark? } or one flat palette for both schemes.
  colors: { light: Palette; dark?: Palette } | Palette;
  [token: string]: unknown;
};

type PaletteOf<T extends ThemeSpec> = T['colors'] extends { light: infer L } ? L : T['colors'];

export type ResolvedTheme<T extends ThemeSpec = ThemeSpec> = Omit<T, 'colors'> & {
  colors: PaletteOf<T>;
  scheme: Scheme;
  dark: boolean;
};

/** Identity, for type inference in theme.ts. */
export function defineTheme<T extends ThemeSpec>(theme: T): T {
  if (!theme || typeof theme !== 'object' || !theme.colors || typeof theme.colors !== 'object') {
    throw new Error('defineTheme() needs an object with a `colors` palette.');
  }
  return theme;
}

/** 'light' or 'dark', never null. */
export function useColorScheme(): Scheme {
  return useRNColorScheme() === 'dark' ? 'dark' : 'light';
}

const ThemeContext = React.createContext<ThemeSpec | null>(null);

export function AppThemeProvider({ theme, children }: { theme: ThemeSpec; children?: React.ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

const resolved = new WeakMap<ThemeSpec, Partial<Record<Scheme, ResolvedTheme>>>();

function isSchemeMap(colors: ThemeSpec['colors']): colors is { light: Palette; dark?: Palette } {
  const light = (colors as { light?: unknown }).light;
  return !!light && typeof light === 'object' && !Array.isArray(light);
}

function resolve(spec: ThemeSpec, scheme: Scheme): ResolvedTheme {
  let entry = resolved.get(spec);
  if (!entry) resolved.set(spec, (entry = {}));
  const hit = entry[scheme];
  if (hit) return hit;
  const c = spec.colors;
  const colors = isSchemeMap(c) ? (scheme === 'dark' ? (c.dark ?? c.light) : c.light) : c;
  const out = { ...spec, colors, scheme, dark: scheme === 'dark' } as ResolvedTheme;
  entry[scheme] = out;
  return out;
}

/** theme.ts with `colors` resolved for the current colour scheme. */
export function useAppTheme<T extends ThemeSpec = ThemeSpec>(): ResolvedTheme<T> {
  const spec = React.useContext(ThemeContext);
  const scheme = useColorScheme();
  if (!spec) {
    throw new Error(
      'useAppTheme() found no theme. Wrap the app in <AppThemeProvider theme={theme}> in App.tsx (import theme from "./theme").',
    );
  }
  if (typeof spec !== 'object' || !spec.colors || typeof spec.colors !== 'object') {
    throw new Error(
      `<AppThemeProvider theme> must be the object theme.ts exports with defineTheme(), got ${
        typeof spec === 'object' ? 'an object without `colors`' : `${typeof spec} ${String(spec).slice(0, 40)}`
      }.`,
    );
  }
  return resolve(spec, scheme) as unknown as ResolvedTheme<T>;
}

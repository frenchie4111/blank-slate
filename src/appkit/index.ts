// `blank-slate/app`: the helpers generated apps can import. Plumbing only
// (layout, keyboard, theme lookup), never a look. Shared app bundles depend
// on this API, so keep it small and only ever add to it; bump the version
// when something is added so a bundle can say what it was built against.

export const APP_KIT_VERSION = 1;

export { Screen, KeyboardAwareScrollView } from './Screen';
export type { ScreenProps, KeyboardAwareScrollViewProps } from './Screen';
export { AppThemeProvider, defineTheme, useAppTheme, useColorScheme } from './theme';
export type { ResolvedTheme, Scheme, ThemeSpec } from './theme';
export { iosTextStyles, systemColors } from './system';
export type { SystemColorName, SystemPalette } from './system';

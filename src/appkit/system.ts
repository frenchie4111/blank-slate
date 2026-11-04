import { Platform, PlatformColor, type ColorValue, type TextStyle } from 'react-native';

// iOS semantic colours. On iOS each one is a PlatformColor, so it follows
// dark mode, Increase Contrast and the rest by itself and `light`/`dark`
// hold the same values. Elsewhere they're Apple's published hex values.

const HEX = {
  systemBackground: ['#FFFFFF', '#000000'],
  secondarySystemBackground: ['#F2F2F7', '#1C1C1E'],
  tertiarySystemBackground: ['#FFFFFF', '#2C2C2E'],
  systemGroupedBackground: ['#F2F2F7', '#000000'],
  secondarySystemGroupedBackground: ['#FFFFFF', '#1C1C1E'],
  tertiarySystemGroupedBackground: ['#F2F2F7', '#2C2C2E'],
  label: ['#000000', '#FFFFFF'],
  secondaryLabel: ['rgba(60,60,67,0.6)', 'rgba(235,235,245,0.6)'],
  tertiaryLabel: ['rgba(60,60,67,0.3)', 'rgba(235,235,245,0.3)'],
  quaternaryLabel: ['rgba(60,60,67,0.18)', 'rgba(235,235,245,0.16)'],
  placeholderText: ['rgba(60,60,67,0.3)', 'rgba(235,235,245,0.3)'],
  separator: ['rgba(60,60,67,0.29)', 'rgba(84,84,88,0.6)'],
  opaqueSeparator: ['#C6C6C8', '#38383A'],
  link: ['#007AFF', '#0984FF'],
  systemFill: ['rgba(120,120,128,0.2)', 'rgba(120,120,128,0.36)'],
  secondarySystemFill: ['rgba(120,120,128,0.16)', 'rgba(120,120,128,0.32)'],
  tertiarySystemFill: ['rgba(118,118,128,0.12)', 'rgba(118,118,128,0.24)'],
  quaternarySystemFill: ['rgba(116,116,128,0.08)', 'rgba(118,118,128,0.18)'],
  systemBlue: ['#007AFF', '#0A84FF'],
  systemGreen: ['#34C759', '#30D158'],
  systemIndigo: ['#5856D6', '#5E5CE6'],
  systemOrange: ['#FF9500', '#FF9F0A'],
  systemPink: ['#FF2D55', '#FF375F'],
  systemPurple: ['#AF52DE', '#BF5AF2'],
  systemRed: ['#FF3B30', '#FF453A'],
  systemTeal: ['#30B0C7', '#40C8E0'],
  systemYellow: ['#FFCC00', '#FFD60A'],
  systemMint: ['#00C7BE', '#63E6E2'],
  systemCyan: ['#32ADE6', '#64D2FF'],
  systemBrown: ['#A2845E', '#AC8E68'],
  systemGray: ['#8E8E93', '#8E8E93'],
  systemGray2: ['#AEAEB2', '#636366'],
  systemGray3: ['#C7C7CC', '#48484A'],
  systemGray4: ['#D1D1D6', '#3A3A3C'],
  systemGray5: ['#E5E5EA', '#2C2C2E'],
  systemGray6: ['#F2F2F7', '#1C1C1E'],
} as const;

export type SystemColorName = keyof typeof HEX;
export type SystemPalette = Record<SystemColorName, ColorValue>;

function palette(index: 0 | 1): SystemPalette {
  const out = {} as SystemPalette;
  for (const name of Object.keys(HEX) as SystemColorName[]) {
    out[name] = Platform.OS === 'ios' ? PlatformColor(name) : HEX[name][index];
  }
  return Object.freeze(out);
}

/** Apple's hex values for one scheme, for places PlatformColor doesn't adapt. */
export function systemHex(scheme: 'light' | 'dark'): Record<SystemColorName, string> {
  const out = {} as Record<SystemColorName, string>;
  for (const name of Object.keys(HEX) as SystemColorName[]) out[name] = HEX[name][scheme === 'dark' ? 1 : 0];
  return out;
}

export const systemColors: { light: SystemPalette; dark: SystemPalette } = Object.freeze({
  light: palette(0),
  dark: palette(1),
});

// Apple's text styles at the default (Large) Dynamic Type size, in the
// system font. RN scales them with the user's text size setting.
export const iosTextStyles = Object.freeze({
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '400' },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '400' },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '400' },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: '400' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400' },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: '400' },
  subheadline: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption1: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  caption2: { fontSize: 11, lineHeight: 13, fontWeight: '400' },
} satisfies Record<string, TextStyle>);

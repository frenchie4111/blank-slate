// "Slate & Chalk" tokens — see design/README.md. Yellow `accent` only ever
// marks the next action; everything else stays on the slate/chalk ramp.

export const colors = {
  slate: '#121316',
  board: '#1C1D21',
  raised: '#26272C',
  line: '#2E2F35',
  lineStrong: '#3A3B42',
  // Unselected radio rings and dashed outlines in the boards.
  lineFaint: '#4A4B53',
  chalk: '#EDEBE6',
  chalkSoft: '#D6D4CE',
  chalkMuted: '#B9B8B1',
  dust: '#A3A39C',
  accent: '#E8C547',
  danger: '#F08A6B',
  dangerBg: '#2A1C18',
  dangerBorder: '#5A3328',
  dangerSoft: '#D9A595',
  success: '#8FD1A0',
  info: '#8DB8F0',
  scrim: '#0A0A0C',
} as const;

export const fonts = {
  display: 'SpaceGrotesk_700Bold',
  displaySemi: 'SpaceGrotesk_600SemiBold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
} as const;

// JetBrains Mono's contextual alternates draw `=>` as an arrow and `===` as
// a triple bar; code should show the characters that are actually there.
export const noLigatures = { fontVariant: ['no-contextual' as const] };

export const radii = {
  chip: 10,
  input: 12,
  button: 14,
  card: 20,
  tile: 20,
  composer: 22,
  sheet: 28,
} as const;

export const space = {
  gutter: 20,
  chatGutter: 16,
} as const;

// Custom fonts carry their weight in the family name, so these styles never
// set fontWeight (iOS would otherwise synthesize a fallback face).
export const type = {
  display: { fontFamily: fonts.display, fontSize: 40, lineHeight: 42, letterSpacing: -0.8 },
  screenTitle: { fontFamily: fonts.display, fontSize: 28, letterSpacing: -0.28 },
  header: { fontFamily: fonts.displaySemi, fontSize: 19, letterSpacing: -0.2 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 14 },
  labelStrong: { fontFamily: fonts.bodySemi, fontSize: 14 },
  caption: { fontFamily: fonts.body, fontSize: 12 },
  mono: { fontFamily: fonts.mono, fontSize: 12 },
  sectionLabel: {
    fontFamily: fonts.monoMedium,
    fontSize: 11,
    letterSpacing: 1.3,
    textTransform: 'uppercase' as const,
    color: colors.dust,
  },
} as const;

export const theme = { colors, fonts, radii, space, type };

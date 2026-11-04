import * as Font from 'expo-font';

// Google fonts generated apps can use by name (`fontFamily: 'Fraunces_600SemiBold'`).
// Nothing loads at startup: the resolver passes each app's source here
// before mounting it, and only the faces it names are loaded (once).
// Inter 400–600, Space Grotesk 600/700 and JetBrains Mono 400/500 are
// Blank Slate's own and already loaded.

/* eslint-disable @typescript-eslint/no-require-imports */
const CATALOG: Record<string, () => number> = {
  Inter_700Bold: () => require('@expo-google-fonts/inter/700Bold').Inter_700Bold,
  SpaceGrotesk_500Medium: () => require('@expo-google-fonts/space-grotesk/500Medium').SpaceGrotesk_500Medium,
  DMSans_400Regular: () => require('@expo-google-fonts/dm-sans/400Regular').DMSans_400Regular,
  DMSans_500Medium: () => require('@expo-google-fonts/dm-sans/500Medium').DMSans_500Medium,
  DMSans_700Bold: () => require('@expo-google-fonts/dm-sans/700Bold').DMSans_700Bold,
  BricolageGrotesque_400Regular: () =>
    require('@expo-google-fonts/bricolage-grotesque/400Regular').BricolageGrotesque_400Regular,
  BricolageGrotesque_600SemiBold: () =>
    require('@expo-google-fonts/bricolage-grotesque/600SemiBold').BricolageGrotesque_600SemiBold,
  BricolageGrotesque_800ExtraBold: () =>
    require('@expo-google-fonts/bricolage-grotesque/800ExtraBold').BricolageGrotesque_800ExtraBold,
  Nunito_400Regular: () => require('@expo-google-fonts/nunito/400Regular').Nunito_400Regular,
  Nunito_600SemiBold: () => require('@expo-google-fonts/nunito/600SemiBold').Nunito_600SemiBold,
  Nunito_800ExtraBold: () => require('@expo-google-fonts/nunito/800ExtraBold').Nunito_800ExtraBold,
  Fredoka_400Regular: () => require('@expo-google-fonts/fredoka/400Regular').Fredoka_400Regular,
  Fredoka_600SemiBold: () => require('@expo-google-fonts/fredoka/600SemiBold').Fredoka_600SemiBold,
  Fraunces_400Regular: () => require('@expo-google-fonts/fraunces/400Regular').Fraunces_400Regular,
  Fraunces_400Regular_Italic: () =>
    require('@expo-google-fonts/fraunces/400Regular_Italic').Fraunces_400Regular_Italic,
  Fraunces_600SemiBold: () => require('@expo-google-fonts/fraunces/600SemiBold').Fraunces_600SemiBold,
  PlayfairDisplay_400Regular: () =>
    require('@expo-google-fonts/playfair-display/400Regular').PlayfairDisplay_400Regular,
  PlayfairDisplay_400Regular_Italic: () =>
    require('@expo-google-fonts/playfair-display/400Regular_Italic').PlayfairDisplay_400Regular_Italic,
  PlayfairDisplay_700Bold: () => require('@expo-google-fonts/playfair-display/700Bold').PlayfairDisplay_700Bold,
  Lora_400Regular: () => require('@expo-google-fonts/lora/400Regular').Lora_400Regular,
  Lora_400Regular_Italic: () => require('@expo-google-fonts/lora/400Regular_Italic').Lora_400Regular_Italic,
  Lora_600SemiBold: () => require('@expo-google-fonts/lora/600SemiBold').Lora_600SemiBold,
  InstrumentSerif_400Regular: () =>
    require('@expo-google-fonts/instrument-serif/400Regular').InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic: () =>
    require('@expo-google-fonts/instrument-serif/400Regular_Italic').InstrumentSerif_400Regular_Italic,
  JetBrainsMono_700Bold: () => require('@expo-google-fonts/jetbrains-mono/700Bold').JetBrainsMono_700Bold,
  SpaceMono_400Regular: () => require('@expo-google-fonts/space-mono/400Regular').SpaceMono_400Regular,
  SpaceMono_700Bold: () => require('@expo-google-fonts/space-mono/700Bold').SpaceMono_700Bold,
  BebasNeue_400Regular: () => require('@expo-google-fonts/bebas-neue/400Regular').BebasNeue_400Regular,
  PressStart2P_400Regular: () => require('@expo-google-fonts/press-start-2p/400Regular').PressStart2P_400Regular,
  Caveat_400Regular: () => require('@expo-google-fonts/caveat/400Regular').Caveat_400Regular,
  Caveat_700Bold: () => require('@expo-google-fonts/caveat/700Bold').Caveat_700Bold,
};
/* eslint-enable @typescript-eslint/no-require-imports */

const NAME = /\b[A-Z][A-Za-z0-9]+_[1-9]00[A-Za-z]+(?:_Italic)?\b/g;

const loaded = new Set<string>();

// Blank Slate's own faces, already loaded at startup.
const BUILT_IN = new Set([
  'Inter_400Regular',
  'Inter_500Medium',
  'Inter_600SemiBold',
  'JetBrainsMono_400Regular',
  'JetBrainsMono_500Medium',
  'SpaceGrotesk_600SemiBold',
  'SpaceGrotesk_700Bold',
]);

const family = (name: string) => name.slice(0, name.indexOf('_'));

/**
 * Loads the catalogue fonts these sources mention. Never throws; returns a
 * problem per font that failed to load or isn't in the catalogue (e.g. a
 * weight that doesn't exist), which would silently render in a fallback.
 */
export async function loadFontsUsedIn(sources: string[]): Promise<string[]> {
  const wanted = new Set<string>();
  const problems: string[] = [];
  for (const src of sources) {
    for (const m of src.match(NAME) ?? []) {
      if (CATALOG[m]) {
        if (!loaded.has(m)) wanted.add(m);
      } else if (!BUILT_IN.has(m)) {
        const fam = family(m);
        const have = [...Object.keys(CATALOG), ...BUILT_IN].filter((k) => family(k) === fam);
        if (have.length && !problems.some((p) => p.startsWith(m))) {
          problems.push(`${m} doesn't exist (available: ${have.join(', ')})`);
        }
      }
    }
  }
  if (!wanted.size) return problems;
  const failed: string[] = problems;
  await Promise.all(
    [...wanted].map(async (name) => {
      try {
        await Font.loadAsync({ [name]: CATALOG[name]() });
        loaded.add(name);
      } catch {
        failed.push(`${name} failed to load`);
      }
    }),
  );
  return failed;
}

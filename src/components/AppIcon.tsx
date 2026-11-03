import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, View, type StyleProp, type ViewStyle } from 'react-native';
import { appearanceOf, TINTS, type Glyph, type Tint } from '../project/appearance';
import { useProjectIcon } from '../project/icon';

type Props = {
  project?: { id: string; name: string; tint?: string; glyph?: string };
  // Overrides for previews (e.g. the edit sheet before saving). Passing either
  // one shows the tint + glyph even if the project has a generated icon.
  tint?: Tint;
  glyph?: Glyph;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

// The one place a project's icon is drawn: Your apps tiles, the Resume card
// and the chat header. Shows the agent-generated icon (set_app_icon) when the
// project has one, otherwise its tint + glyph.
export function AppIcon({ project, tint, glyph, size = 72, style }: Props) {
  const previewing = tint !== undefined || glyph !== undefined;
  const uri = useProjectIcon(previewing ? null : project?.id);
  // 72 → 20 (tile), 44 → 13 (Resume card), per the boards.
  const box = { width: size, height: size, borderRadius: Math.round(size * 0.28) };

  if (uri) {
    return (
      <View style={[box, { overflow: 'hidden' }, style]}>
        <Image source={{ uri }} style={box} resizeMode="cover" accessibilityIgnoresInvertColors />
      </View>
    );
  }

  const fallback = project ? appearanceOf(project) : { tint: 'neutral' as Tint, glyph: 'cube' as Glyph };
  const t = TINTS[tint ?? fallback.tint];
  const g = glyph ?? fallback.glyph;
  return (
    <View
      style={[
        box,
        { backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' },
        style,
      ]}
    >
      <Ionicons name={`${g}-outline`} size={Math.round(size * 0.44)} color={t.fg} />
    </View>
  );
}

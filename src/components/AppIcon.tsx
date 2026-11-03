import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { appearanceOf, TINTS, type Glyph, type Tint } from '../project/appearance';

type Props = {
  project?: { id: string; name: string; tint?: string; glyph?: string };
  // Overrides for previews (e.g. the edit sheet before saving).
  tint?: Tint;
  glyph?: Glyph;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

// The one place a project's icon is drawn: Your apps tiles, the Resume card
// and the chat header. Generated project icons (feat/agent-app-icons) should
// slot in here, falling back to this tint + glyph.
export function AppIcon({ project, tint, glyph, size = 72, style }: Props) {
  const fallback = project ? appearanceOf(project) : { tint: 'neutral' as Tint, glyph: 'cube' as Glyph };
  const t = TINTS[tint ?? fallback.tint];
  const g = glyph ?? fallback.glyph;
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          // 72 → 20 (tile), 44 → 13 (Resume card), per the boards.
          borderRadius: Math.round(size * 0.28),
          backgroundColor: t.bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Ionicons name={`${g}-outline`} size={Math.round(size * 0.44)} color={t.fg} />
    </View>
  );
}

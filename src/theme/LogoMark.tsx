import React from 'react';
import { View } from 'react-native';
import { colors } from './index';

// Rounded-square outline with a small yellow bar bottom-right, per
// design/boards/Main.dc.html: radius ¼ of the size, bar inset ⅛ inside the
// stroke, bar ⅓ of the size wide (24px → 8×3 bar, 2px stroke). assets/icon.svg
// draws the app icon with the same proportions — keep the two in step.
export function LogoMark({ size = 20 }: { size?: number }) {
  const border = size >= 28 ? 2.5 : 2;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 4,
        borderWidth: border,
        borderColor: colors.chalk,
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
        padding: size / 8,
      }}
    >
      <View
        style={{
          width: size / 3,
          height: Math.max(3, Math.round(size / 10)),
          borderRadius: 2,
          backgroundColor: colors.accent,
        }}
      />
    </View>
  );
}

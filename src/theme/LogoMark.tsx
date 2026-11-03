import React from 'react';
import { View } from 'react-native';
import { colors } from './index';

// Rounded-square outline with a small yellow bar bottom-right. Proportions
// follow the boards: 64px tile → 30px mark, 44px button → 20px mark.
export function LogoMark({ size = 20 }: { size?: number }) {
  const border = size >= 28 ? 2.5 : 2;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.26,
        borderWidth: border,
        borderColor: colors.chalk,
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
        padding: size * 0.12,
      }}
    >
      <View
        style={{ width: size * 0.34, height: 3, borderRadius: 2, backgroundColor: colors.accent }}
      />
    </View>
  );
}

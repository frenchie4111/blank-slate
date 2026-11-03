import React from 'react';
import { Platform, StyleSheet, Switch, View, type SwitchProps } from 'react-native';

// A Switch that centres in its row on iOS. Under the new architecture the iOS
// UISwitch doesn't report its intrinsic 51x31 size to Yoga, so in an
// alignItems: 'center' row it lands at the top. A fixed box of that size gives
// Yoga something to centre. Other platforms size their Switch correctly.
export function SettingSwitch(props: SwitchProps) {
  if (Platform.OS !== 'ios') return <Switch {...props} />;
  return (
    <View style={styles.box}>
      <Switch {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: 51, height: 31, alignItems: 'center', justifyContent: 'center' },
});

import React from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text, type TextStyle, type StyleProp } from 'react-native';
import { colors, fonts } from '../theme';

/** A readable message for a caught value, whatever was thrown. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  return 'Please try again.';
}

/**
 * Speaks `message` to VoiceOver/TalkBack when it first appears or changes.
 * Android and web pick up live regions on their own; iOS ignores
 * accessibilityLiveRegion, so it gets an explicit announcement.
 */
export function useAnnounce(message: string | null | undefined) {
  React.useEffect(() => {
    if (!message || Platform.OS !== 'ios') return;
    AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
}

/** Whether VoiceOver/TalkBack (or a web screen reader, where detectable) is on. */
export function useScreenReader(): boolean {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((v) => live && setOn(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setOn);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return on;
}

/** Props that make a status row a polite live region on Android and web. */
export const liveStatus = {
  accessibilityLiveRegion: 'polite',
  role: 'status',
} as const;

/** Props for an error that should interrupt: assertive on Android, an alert on web. */
export const liveAlert = {
  accessibilityLiveRegion: 'assertive',
  role: 'alert',
} as const;

/** Danger-coloured error text that screen readers announce when it appears. */
export function InlineError({
  message,
  style,
}: {
  message: string | null | undefined;
  style?: StyleProp<TextStyle>;
}) {
  useAnnounce(message);
  if (!message) return null;
  return (
    <Text style={[styles.error, style]} {...liveAlert}>
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  error: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.danger,
    marginTop: 12,
  },
});

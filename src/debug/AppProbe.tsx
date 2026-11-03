import React from 'react';
import {
  AppState,
  Dimensions,
  Platform,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { colors } from '../theme';
import * as history from './history';
import { appFrame, hitTest, installGlobalHandlers, lastTap, setAppContainer } from './instrument';
import { setCaptureTarget } from './screenshot';

// Root of the generated app's view: the screenshot target, the frame that
// tap coordinates are relative to, and a passive touch listener. A tap that
// no instrumented handler picked up is logged as "nothing responded", the
// signal for "I tapped it and nothing happened".

const TAP_SLOP = 10;
const TAP_MAX_MS = 800;
// onPress fires on release, a moment after the raw touch end.
const SETTLE_MS = 350;

type Start = { x: number; y: number; t: number };

export function AppProbe({ children }: { children: React.ReactNode }) {
  const start = React.useRef<Start | null>(null);

  React.useEffect(() => {
    installGlobalHandlers();
    let appState = AppState.currentState;
    const appSub = AppState.addEventListener('change', (next) => {
      if (next === appState) return;
      appState = next;
      history.record({ type: 'lifecycle', text: `AppState → ${next}` });
    });
    const dimSub = Dimensions.addEventListener('change', ({ window }) => {
      history.record({
        type: 'lifecycle',
        text: `Window resized to ${Math.round(window.width)}×${Math.round(window.height)}`,
      });
    });
    return () => {
      appSub.remove();
      dimSub.remove();
    };
  }, []);

  const setRef = React.useCallback((node: View | null) => {
    setAppContainer(node);
    setCaptureTarget(node);
  }, []);

  const onStart = (e: GestureResponderEvent) => {
    const t = e.nativeEvent.touches?.length ?? 1;
    if (t > 1) {
      start.current = null;
      return;
    }
    start.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, t: Date.now() };
  };

  const onEnd = (e: GestureResponderEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const { pageX, pageY } = e.nativeEvent;
    if (Math.hypot(pageX - s.x, pageY - s.y) > TAP_SLOP || Date.now() - s.t > TAP_MAX_MS) return;
    setTimeout(async () => {
      const frame = await appFrame();
      const x = pageX - (frame?.x ?? 0);
      const y = pageY - (frame?.y ?? 0);
      const tap = lastTap();
      if (tap.id !== null && tap.at >= s.t - 50) {
        history.annotate(tap.id, { x, y });
        return;
      }
      const hit = await hitTest(x, y);
      history.record({
        type: 'touch',
        text: hit ? `Tap on ${hit}, nothing responded` : 'Tap on empty space, nothing responded',
        x,
        y,
      });
    }, SETTLE_MS);
  };

  // Pointer events on web cover mouse and touch; raw touch events on native.
  const listeners =
    Platform.OS === 'web'
      ? ({ onPointerDown: onStart, onPointerUp: onEnd } as object)
      : { onTouchStart: onStart, onTouchEnd: onEnd };

  return (
    <View ref={setRef} collapsable={false} style={styles.root} {...listeners}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  // What shows through an app without its own background. Painting it here
  // keeps screenshots honest: a transparent capture renders white on web and
  // black on iOS, neither of which is what the user sees.
  root: { flex: 1, backgroundColor: colors.slate },
});

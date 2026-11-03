import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import React from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  StyleSheet,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const POSITION_KEY = 'blank-slate.badge-position';
// Movement (in px) before a touch counts as a drag rather than a tap.
const DRAG_THRESHOLD = 6;
// Gap between the badge and the safe-area edge it docks against.
const EDGE_GAP = 8;

type Side = 'left' | 'right';
// yFrac is a 0..1 fraction of the usable vertical range, so the badge lands
// in a sensible spot after a rotation or window resize.
type StoredPosition = { side: Side; yFrac: number };

const DEFAULT_POSITION: StoredPosition = { side: 'left', yFrac: 0 };

// The badge unmounts while chat is open; remember the position in memory so
// remounting doesn't wait on AsyncStorage (and flash invisible).
let cachedPosition: StoredPosition | null = null;

type Props = {
  size: number;
  onPress: () => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), Math.max(min, max));
}

function haptic(kind: 'pickup' | 'drop') {
  if (Platform.OS === 'web') return;
  const p =
    kind === 'pickup'
      ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      : Haptics.selectionAsync();
  p.catch(() => {});
}

function parseStored(raw: string | null): StoredPosition | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if ((v?.side === 'left' || v?.side === 'right') && typeof v.yFrac === 'number') {
      return { side: v.side, yFrac: clamp(v.yFrac, 0, 1) };
    }
  } catch {}
  return null;
}

/**
 * Floating round badge that can be dragged anywhere and snaps to the nearest
 * left/right edge on release. A touch that moves less than DRAG_THRESHOLD is
 * treated as a tap. Position persists across launches.
 *
 * Built on PanResponder + Animated (no gesture-handler/reanimated) so it
 * ships over the air and works on react-native-web with mouse input.
 */
export function DraggableBadge({ size, onPress, accessibilityLabel, style, children }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const bounds = React.useMemo(
    () => ({
      minX: insets.left + EDGE_GAP,
      maxX: width - insets.right - EDGE_GAP - size,
      minY: insets.top + EDGE_GAP,
      maxY: height - insets.bottom - EDGE_GAP - size,
    }),
    [width, height, insets.left, insets.right, insets.top, insets.bottom, size],
  );
  const boundsRef = React.useRef(bounds);
  boundsRef.current = bounds;

  // Kept in a ref so settling a drag doesn't re-run the placement effect
  // (which would cut the snap spring short).
  const storedRef = React.useRef<StoredPosition>(cachedPosition ?? DEFAULT_POSITION);
  const [loaded, setLoaded] = React.useState(cachedPosition !== null);

  const pos = React.useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scale = React.useRef(new Animated.Value(1)).current;
  const draggingRef = React.useRef(false);
  const startRef = React.useRef({ x: 0, y: 0 });
  const lastRef = React.useRef({ x: 0, y: 0 });
  const onPressRef = React.useRef(onPress);
  onPressRef.current = onPress;

  const toXY = React.useCallback((p: StoredPosition, b = boundsRef.current) => {
    return {
      x: p.side === 'left' ? b.minX : Math.max(b.minX, b.maxX),
      y: b.minY + clamp(p.yFrac, 0, 1) * Math.max(0, b.maxY - b.minY),
    };
  }, []);

  React.useEffect(() => {
    if (cachedPosition) return;
    let cancelled = false;
    AsyncStorage.getItem(POSITION_KEY)
      .catch(() => null)
      .then((raw) => {
        if (cancelled) return;
        storedRef.current = cachedPosition = parseStored(raw) ?? DEFAULT_POSITION;
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Place on load, and re-clamp whenever the screen size or insets change.
  // Layout effect so a remount never paints a frame at (0, 0).
  React.useLayoutEffect(() => {
    if (!loaded || draggingRef.current) return;
    pos.stopAnimation();
    pos.setValue(toXY(storedRef.current, bounds));
  }, [loaded, bounds, pos, toXY]);

  const settle = React.useCallback(() => {
    const b = boundsRef.current;
    const cur = lastRef.current;
    const side: Side = cur.x + size / 2 < (b.minX + b.maxX + size) / 2 ? 'left' : 'right';
    const range = Math.max(0, b.maxY - b.minY);
    const yFrac = range > 0 ? clamp((cur.y - b.minY) / range, 0, 1) : 0;
    const next = { side, yFrac };
    Animated.parallel([
      Animated.spring(pos, {
        toValue: toXY(next, b),
        useNativeDriver: false,
        friction: 7,
        tension: 70,
      }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: false, friction: 6 }),
    ]).start();
    storedRef.current = cachedPosition = next;
    AsyncStorage.setItem(POSITION_KEY, JSON.stringify(next)).catch(() => {});
    haptic('drop');
  }, [pos, scale, size, toXY]);

  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        // Claim every touch on the badge so nothing reaches the generated app.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => !draggingRef.current,
        onPanResponderGrant: () => {
          // Picking the badge up mid-snap starts the drag from where it is now.
          pos.stopAnimation((v) => {
            startRef.current = v;
          });
          draggingRef.current = false;
        },
        onPanResponderMove: (_e, g) => {
          if (!draggingRef.current) {
            if (Math.hypot(g.dx, g.dy) < DRAG_THRESHOLD) return;
            draggingRef.current = true;
            haptic('pickup');
            Animated.spring(scale, { toValue: 1.12, useNativeDriver: false, friction: 6 }).start();
          }
          const b = boundsRef.current;
          lastRef.current = {
            x: clamp(startRef.current.x + g.dx, b.minX, b.maxX),
            y: clamp(startRef.current.y + g.dy, b.minY, b.maxY),
          };
          pos.setValue(lastRef.current);
        },
        onPanResponderRelease: () => {
          if (draggingRef.current) {
            draggingRef.current = false;
            settle();
          } else {
            onPressRef.current();
          }
        },
        onPanResponderTerminate: () => {
          if (draggingRef.current) {
            draggingRef.current = false;
            settle();
          }
        },
      }),
    [pos, scale, settle],
  );

  return (
    <Animated.View
      {...panResponder.panHandlers}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Double tap to open. Drag to move."
      onAccessibilityTap={onPress}
      style={[
        style,
        styles.base,
        { width: size, height: size },
        Platform.OS === 'web' ? (styles.web as any) : null,
        {
          opacity: loaded ? 1 : 0,
          transform: [{ translateX: pos.x }, { translateY: pos.y }, { scale }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: { position: 'absolute', top: 0, left: 0 },
  // Stop the browser from scrolling, selecting text or dragging the <img>.
  web: { touchAction: 'none', userSelect: 'none', cursor: 'grab' } as any,
});

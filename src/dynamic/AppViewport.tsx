import * as React from 'react';
import { Animated, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  useSafeAreaInsets,
  type EdgeInsets,
  type Rect,
} from 'react-native-safe-area-context';
import { HostInsetsContext, setViewportSize } from './viewport';

type Props = {
  // What the app should treat as its safe area inside the viewport.
  insets: EdgeInsets;
  style?: StyleProp<ViewStyle> | Animated.WithAnimatedValue<StyleProp<ViewStyle>>;
  children: React.ReactNode;
};

/**
 * The pane the generated app renders in. Its size is what the app's
 * `useWindowDimensions` reports, and the app subtree gets `insets` as its
 * safe area, so an app's `useSafeAreaInsets()` agrees with the geometry (a
 * nested native SafeAreaProvider measures the same thing).
 */
export const AppViewport = React.forwardRef<React.ComponentRef<typeof Animated.View>, Props>(
  function AppViewport({ insets, style, children }, ref) {
    const host = useSafeAreaInsets();
    const [frame, setFrame] = React.useState<Rect | null>(null);

    React.useEffect(() => () => setViewportSize(null), []);

    const onLayout = (e: LayoutChangeEvent) => {
      const { x, y, width, height } = e.nativeEvent.layout;
      setViewportSize({ width, height });
      setFrame((f) =>
        f && f.x === x && f.y === y && f.width === width && f.height === height ? f : { x, y, width, height },
      );
    };

    const stableInsets = React.useMemo(
      () => insets,
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [insets.top, insets.right, insets.bottom, insets.left],
    );

    return (
      <Animated.View ref={ref} collapsable={false} style={style} onLayout={onLayout}>
        <HostInsetsContext.Provider value={host}>
          <SafeAreaInsetsContext.Provider value={stableInsets}>
            <SafeAreaFrameContext.Provider value={frame ?? { x: 0, y: 0, width: 0, height: 0 }}>
              {/* Nothing mounts until the size is known, so the app's first render already sees it. */}
              {frame ? children : null}
            </SafeAreaFrameContext.Provider>
          </SafeAreaInsetsContext.Provider>
        </HostInsetsContext.Provider>
      </Animated.View>
    );
  },
);

import * as React from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
  processColor,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppCoveredContext } from './covered';
import { useColorScheme } from './theme';

// Layout plumbing for generated apps: safe areas, the keyboard, full-height
// layout and the status bar. No colours, borders or fonts of its own; the
// app styles everything through `style` and `contentContainerStyle`.

type Edge = 'top' | 'bottom' | 'left' | 'right';
const ALL_EDGES: Edge[] = ['top', 'bottom', 'left', 'right'];

// Inside a React Navigation screen with a header, the header owns the top
// inset. Read lazily so apps that don't navigate never load the module.
type HeaderContexts = { shown: React.Context<boolean>; height: React.Context<number | undefined> };
let headerContexts: HeaderContexts | null | undefined;
const NoHeaderShown = React.createContext(false);
const NoHeaderHeight = React.createContext<number | undefined>(undefined);
function useHeader(): { shown: boolean; height: number } {
  if (headerContexts === undefined) {
    try {
      const el = require('@react-navigation/elements') as {
        HeaderShownContext: React.Context<boolean>;
        HeaderHeightContext: React.Context<number | undefined>;
      };
      headerContexts = { shown: el.HeaderShownContext, height: el.HeaderHeightContext };
    } catch {
      headerContexts = null;
    }
  }
  const shown = React.useContext(headerContexts?.shown ?? NoHeaderShown);
  const height = React.useContext(headerContexts?.height ?? NoHeaderHeight);
  return { shown: !!shown, height: height ?? 0 };
}

// A transparent native header (every large title on iOS) lays the screen
// out underneath it. Measures how far the header overlaps this view.
function useHeaderOverlap(active: boolean, headerHeight: number) {
  const ref = React.useRef<View | null>(null);
  const [overlap, setOverlap] = React.useState(0);
  const measure = React.useCallback(() => {
    if (!active) return;
    ref.current?.measureInWindow((_x, y) => {
      if (Number.isFinite(y)) setOverlap(Math.max(0, Math.round(headerHeight - y)));
    });
  }, [active, headerHeight]);
  React.useEffect(measure, [measure]);
  return { ref, overlap: active ? overlap : 0, onLayout: measure };
}

function paddingOf(s: ViewStyle, side: 'Top' | 'Bottom' | 'Left' | 'Right'): number {
  const axis = side === 'Top' || side === 'Bottom' ? s.paddingVertical : s.paddingHorizontal;
  const v = s[`padding${side}`] ?? axis ?? s.padding;
  return typeof v === 'number' ? v : 0;
}

// Dark text on light backgrounds and vice versa. A literal background colour
// decides; otherwise (PlatformColor, none) the colour scheme does.
function barStyleFor(background: unknown, scheme: 'light' | 'dark'): 'light-content' | 'dark-content' {
  if (typeof background === 'string') {
    let n: unknown;
    try {
      n = processColor(background);
    } catch {}
    if (typeof n === 'number') {
      const a = ((n >>> 24) & 255) / 255;
      if (a > 0.5) {
        const lin = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
        return l > 0.4 ? 'dark-content' : 'light-content';
      }
    }
  }
  return scheme === 'dark' ? 'light-content' : 'dark-content';
}

export type KeyboardAwareScrollViewProps = ScrollViewProps;

/**
 * A ScrollView that keeps the focused input above the keyboard, lets taps
 * through while the keyboard is up, and dismisses it on drag.
 */
export const KeyboardAwareScrollView = React.forwardRef<ScrollView, KeyboardAwareScrollViewProps>(
  function KeyboardAwareScrollView({ contentContainerStyle, ...rest }, ref) {
    const inner = React.useRef<ScrollView | null>(null);
    React.useImperativeHandle(ref, () => inner.current as ScrollView);

    React.useEffect(() => {
      if (Platform.OS === 'web') return;
      const sub = Keyboard.addListener('keyboardDidShow', (e) => {
        const input = TextInput.State.currentlyFocusedInput?.() as
          | { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void }
          | null;
        const scroll = inner.current as unknown as {
          scrollResponderScrollNativeHandleToKeyboard?: (node: unknown, offset: number, preventNegative: boolean) => void;
        } | null;
        if (!input?.measureInWindow || !scroll?.scrollResponderScrollNativeHandleToKeyboard) return;
        input.measureInWindow((_x, y, _w, h) => {
          if (y + h + 16 <= e.endCoordinates.screenY) return;
          try {
            scroll.scrollResponderScrollNativeHandleToKeyboard!(input, 32, true);
          } catch {}
        });
      });
      return () => sub.remove();
    }, []);

    const scroll = (
      <ScrollView
        ref={inner}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets
        {...rest}
        contentContainerStyle={[styles.grow, contentContainerStyle]}
      />
    );
    // iOS adjusts the insets natively; Android needs the view to shrink.
    return Platform.OS === 'android' ? (
      <KeyboardAvoidingView style={styles.fill} behavior="height">
        {scroll}
      </KeyboardAvoidingView>
    ) : (
      scroll
    );
  },
);

export type ScreenProps = Omit<ScrollViewProps, 'style'> & {
  /** Wrap the content in a keyboard-aware ScrollView. */
  scroll?: boolean;
  /** Safe-area edges to pad. Default: all; `top` is skipped under a navigation header. */
  edges?: Edge[];
  /** Avoid the keyboard. Default true. */
  keyboard?: boolean;
  /** Status bar text colour. Default: from the background colour or scheme. */
  statusBar?: 'auto' | 'light' | 'dark' | 'none';
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

/**
 * The root of a screen: fills the available height, keeps content out of the
 * notch and home indicator, and keeps inputs above the keyboard.
 */
export function Screen({
  scroll = false,
  edges = ALL_EDGES,
  keyboard = true,
  statusBar = 'auto',
  style,
  contentContainerStyle,
  children,
  ...scrollProps
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const header = useHeader();
  const headerShown = header.shown;
  const native = headerShown && Platform.OS === 'ios';
  const headerOverlap = useHeaderOverlap(native && !scroll, header.height);
  const [scrollHeight, setScrollHeight] = React.useState(0);
  const covered = React.useContext(AppCoveredContext);
  const flat = StyleSheet.flatten(style) ?? {};
  const has = (e: Edge) => edges.includes(e);

  // A native iOS header (large titles that collapse on scroll) needs the
  // scroll view to adjust its own insets.
  const nativeInsets = scroll && native;
  const top = has('top') && !headerShown ? insets.top : headerOverlap.overlap;
  const bottom = has('bottom') && !nativeInsets ? insets.bottom : 0;
  // Insets add to the app's own padding rather than replacing it.
  const pad: ViewStyle = {
    paddingTop: paddingOf(flat, 'Top') + top,
    paddingLeft: paddingOf(flat, 'Left') + (has('left') ? insets.left : 0),
    paddingRight: paddingOf(flat, 'Right') + (has('right') ? insets.right : 0),
  };
  const padBottom = paddingOf(flat, 'Bottom') + bottom;

  const bar =
    statusBar === 'none' || covered ? null : (
      <StatusBar
        barStyle={
          statusBar === 'light'
            ? 'light-content'
            : statusBar === 'dark'
              ? 'dark-content'
              : barStyleFor(flat.backgroundColor, scheme)
        }
      />
    );

  if (scroll) {
    const Scroll = keyboard ? KeyboardAwareScrollView : ScrollView;
    // The navigation bar only collapses a large title for a scroll view at
    // the root of the screen, so here the scroll view is the root.
    if (nativeInsets) {
      return (
        <>
          {bar}
          <Scroll
            contentInsetAdjustmentBehavior="automatic"
            {...scrollProps}
            onLayout={(e) => {
              setScrollHeight(e.nativeEvent.layout.height);
              scrollProps.onLayout?.(e);
            }}
            style={[styles.fill, style]}
            // The header and home indicator are content insets here, so
            // flexGrow would make the content a full frame tall and push a
            // centred empty state down by the header's height. Fill only
            // the space between them.
            contentContainerStyle={[
              scrollHeight ? { minHeight: Math.max(0, scrollHeight - header.height - insets.bottom) } : null,
              pad,
              contentContainerStyle,
            ]}
          >
            {children}
          </Scroll>
        </>
      );
    }
    return (
      <View style={[styles.fill, style, pad]}>
        {bar}
        <Scroll
          contentInsetAdjustmentBehavior={nativeInsets ? 'automatic' : 'never'}
          {...scrollProps}
          style={styles.fill}
          contentContainerStyle={[styles.grow, { paddingBottom: bottom }, contentContainerStyle]}
        >
          {children}
        </Scroll>
      </View>
    );
  }

  const body = (
    <View
      ref={headerOverlap.ref}
      onLayout={headerOverlap.onLayout}
      style={[styles.fill, style, pad, { paddingBottom: padBottom }]}
    >
      {bar}
      {children}
    </View>
  );
  return keyboard && Platform.OS === 'ios' ? (
    <KeyboardAvoidingView style={styles.fill} behavior="padding">
      {body}
    </KeyboardAvoidingView>
  ) : (
    body
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
});

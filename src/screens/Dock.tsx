import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { AppIcon } from '../components/AppIcon';
import type { Project } from '../project/store';
import { colors, radii } from '../theme';
import { LogoMark } from '../theme/LogoMark';
import { useAppActions } from './YourAppsScreen';

// Blank Slate's own strip beside the generated app: the logo (opens the
// chat), then every app in Your apps order, then "+". Along the bottom on a
// phone, down the left edge on desktop.

const ICON = 44;
// The current app's yellow ring sits 2pt outside its icon.
const ITEM = ICON + 8;
const GAP = 6;
const PAD = 10;

/** Height of the bottom dock's bar, not counting the home-indicator inset. */
export const DOCK_BAR_HEIGHT = ITEM + 12;
/** Width of the desktop rail. */
export const RAIL_WIDTH = ITEM + 20;

type Props = {
  projects: Project[];
  currentId: string | null;
  vertical?: boolean;
  onLogo: () => void;
};

function webContextMenu(fn: () => void): object | null {
  if (Platform.OS !== 'web') return null;
  return {
    onContextMenu: (e: { preventDefault: () => void }) => {
      e.preventDefault();
      fn();
    },
  };
}

export function Dock({ projects, currentId, vertical = false, onLogo }: Props) {
  const actions = useAppActions();
  const scrollRef = React.useRef<ScrollView | null>(null);
  const scrollPos = React.useRef(0);
  const [viewLength, setViewLength] = React.useState(0);

  const currentIndex = projects.findIndex((p) => p.id === currentId);

  // Keep the current app in view: after a switch, or when the list or the
  // dock's size changes. Only scrolls when it's (partly) out of view.
  React.useEffect(() => {
    if (currentIndex < 0 || !viewLength) return;
    const start = PAD + currentIndex * (ITEM + GAP);
    const end = start + ITEM;
    const pos = scrollPos.current;
    if (start >= pos && end <= pos + viewLength) return;
    const target = Math.max(0, start - (viewLength - ITEM) / 2);
    scrollRef.current?.scrollTo(vertical ? { y: target, animated: true } : { x: target, animated: true });
  }, [currentIndex, viewLength, vertical, projects.length]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setViewLength(vertical ? height : width);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { x, y } = e.nativeEvent.contentOffset;
    scrollPos.current = vertical ? y : x;
  };

  const tap = (p: Project) => {
    if (actions.busy || p.id === currentId) return;
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
    actions.open(p);
  };

  return (
    <View style={[styles.dock, vertical ? styles.rail : styles.bar]}>
      <Pressable
        onPress={onLogo}
        style={({ pressed }) => [styles.logo, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Open Blank Slate chat"
      >
        <LogoMark size={22} />
      </Pressable>
      <View style={vertical ? styles.dividerH : styles.dividerV} />
      <ScrollView
        ref={scrollRef}
        horizontal={!vertical}
        style={styles.scroll}
        contentContainerStyle={vertical ? styles.listV : styles.listH}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        onLayout={onLayout}
        onScroll={onScroll}
        scrollEventThrottle={32}
        accessibilityRole="tablist"
      >
        {projects.map((p) => {
          const isCurrent = p.id === currentId;
          return (
            <Pressable
              key={p.id}
              onPress={() => tap(p)}
              onLongPress={() => actions.openMenu(p)}
              delayLongPress={400}
              // Right-click opens the same menu on web and desktop.
              {...webContextMenu(() => actions.openMenu(p))}
              style={({ pressed }) => [styles.item, isCurrent && styles.itemCurrent, pressed && styles.pressed]}
              accessibilityRole="tab"
              accessibilityState={{ selected: isCurrent }}
              accessibilityLabel={`${p.name}${p.importedFrom ? ', imported' : ''}`}
              accessibilityHint="Hold for more options"
            >
              <AppIcon project={p} size={ICON} />
            </Pressable>
          );
        })}
        <Pressable
          onPress={actions.create}
          style={({ pressed }) => [styles.item, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="New app"
        >
          <View style={styles.newItem}>
            <Ionicons name="add" size={22} color={colors.accent} />
          </View>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { backgroundColor: colors.slate },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: DOCK_BAR_HEIGHT,
    paddingLeft: PAD,
  },
  rail: {
    width: RAIL_WIDTH,
    alignItems: 'center',
    paddingTop: PAD,
  },
  pressed: { opacity: 0.7 },
  logo: {
    width: ITEM,
    height: ITEM,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.board,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dividerV: { width: 1, height: 28, marginLeft: PAD, backgroundColor: colors.lineStrong },
  dividerH: { height: 1, width: 28, marginTop: PAD, backgroundColor: colors.lineStrong },
  scroll: { flex: 1, alignSelf: 'stretch' },
  listH: { flexDirection: 'row', alignItems: 'center', gap: GAP, paddingHorizontal: PAD },
  listV: { alignItems: 'center', gap: GAP, paddingVertical: PAD },
  item: {
    width: ITEM,
    height: ITEM,
    borderRadius: Math.round(ITEM * 0.3),
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemCurrent: { borderColor: colors.accent },
  newItem: {
    width: ICON,
    height: ICON,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Math.round(ICON * 0.28),
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.lineFaint,
  },
});

import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import type { Entry, ServerToolEntry, ToolEntry } from '../project/chatStore';
import { colors, fonts, radii, space } from '../theme';
import { Markdown } from './Markdown';
import { buildRenderItems, ToolGroupCard, type PendingCall, type RenderItem } from './ToolGroup';

// Scrolling back to within this distance of the bottom re-anchors.
const ANCHOR_THRESHOLD = 32;
// How long after a wheel/touch/key event a web scroll still counts as the
// user's (wheel momentum keeps emitting events, so this only bridges gaps).
const WEB_INPUT_WINDOW_MS = 300;
// While running, this long without visible progress (text, a tool row
// changing, a result) brings up a status row, so the chat never sits still.
const IDLE_STATUS_MS = 1200;

// Outlives a ChatList mount, so leaving for Files/History (or closing the
// chat) and coming back restores where the reader was.
export type ChatScrollMemory = {
  anchored: boolean;
  offset: number;
  lastUserId: string | null;
};

export function newChatScrollMemory(): ChatScrollMemory {
  return { anchored: true, offset: 0, lastUserId: null };
}

type PillState = 'hidden' | 'latest' | 'new';

type Props = {
  entries: Entry[];
  running: boolean;
  reasoningTokens: number;
  pendingCall: PendingCall | null;
  // No bytes from the model for a long while; offers Stop and Retry.
  stalled: boolean;
  memory: React.RefObject<ChatScrollMemory>;
  // Re-sends the latest request after a failed turn, or (while stalled)
  // gives up on the quiet one and sends it again.
  onRetry: () => void;
  onStop: () => void;
  // Sends one of the empty chat's starter prompts.
  onSuggest: (text: string) => void;
};

const STARTERS = [
  'A habit tracker with a streak for each habit',
  'A tip calculator that splits the bill',
  'A packing list with categories and checkboxes',
  'A focus timer with a progress ring',
];

// The chat log keeps an explicit anchored-to-bottom state. While anchored it
// re-pins to the end on every content or viewport change (streaming text,
// tool cards, images, keyboard, composer growth, resizes). Only the user
// scrolling up unanchors it; scrolling back near the bottom, tapping the pill
// or sending a message re-anchors.
//
// Manual pinning rather than an inverted list or maintainVisibleContentPosition:
// the growth is in the last item, which mVCP doesn't cover (it holds the first
// visible item's position and its autoscroll threshold is for the top), and
// react-native-web supports neither it nor inverted wheel scrolling well.
export function ChatList({
  entries,
  running,
  reasoningTokens,
  pendingCall,
  stalled,
  memory,
  onRetry,
  onStop,
  onSuggest,
}: Props) {
  const items = React.useMemo(
    () => buildRenderItems(entries, running, pendingCall),
    [entries, running, pendingCall],
  );
  const last = items[items.length - 1];
  const idleSince = useIdleSince(running, entries, pendingCall);
  // A live tool group always shows what's happening (a pending call being
  // written, a tool running, or "Thinking…" between requests). Otherwise a
  // status row covers the request's first moments, and any quiet spell after
  // reply text (e.g. a provider that sends a whole tool call at the end).
  // Long reasoning gets a row with a count even under a live tool group.
  const liveGroup = last?.type === 'tools' && last.active;
  const afterReply = last?.type === 'entry' && last.entry.kind !== 'user';
  const status: 'thinking' | 'working' | null =
    !running ? null
    : reasoningTokens >= 200 ? 'thinking'
    : liveGroup ? null
    : !afterReply ? 'thinking'
    : idleSince !== null ? 'working'
    : null;
  // Only the latest turn's error (or cut-short row) offers Retry / Continue.
  const retryId = running ? null : latestRecoverableId(items);

  const scrollRef = React.useRef<ScrollView | null>(null);
  const anchoredRef = React.useRef(memory.current.anchored);
  const [pill, setPill] = React.useState<PillState>(
    memory.current.anchored ? 'hidden' : 'latest',
  );
  const lastYRef = React.useRef(memory.current.offset);
  const restoredRef = React.useRef(memory.current.anchored);
  // Native: the finger (or its fling) is driving; pinning would fight it.
  const draggingRef = React.useRef(false);
  const momentumRef = React.useRef(false);
  // Web: the last wheel/touch/key/scrollbar input on the scroller.
  const webInputAtRef = React.useRef(0);
  const webPointerDownRef = React.useRef(false);

  const setAnchored = React.useCallback(
    (anchored: boolean) => {
      memory.current.anchored = anchored;
      if (anchoredRef.current === anchored) return;
      anchoredRef.current = anchored;
      setPill(anchored ? 'hidden' : 'latest');
    },
    [memory],
  );

  // Coalesced to at most one leading and one trailing jump per frame, so a
  // stream of deltas doesn't issue dozens of scrolls per second but the first
  // one still lands in the same frame as the growth.
  const frameRef = React.useRef<number | null>(null);
  const trailingRef = React.useRef(false);
  const pin = React.useCallback(() => {
    if (frameRef.current !== null) {
      trailingRef.current = true;
      return;
    }
    const jump = () => {
      if (!anchoredRef.current || draggingRef.current || momentumRef.current) return;
      scrollRef.current?.scrollToEnd({ animated: false });
    };
    jump();
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (trailingRef.current) {
        trailingRef.current = false;
        jump();
      }
    });
  }, []);

  React.useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  // Sending a message always re-anchors. Compared against memory so a send
  // that happens while this list is unmounted (e.g. "Fix it" from another
  // tab) still counts on the next mount.
  const lastUserId = findLastUserId(entries);
  const firstEntriesRef = React.useRef(true);
  React.useLayoutEffect(() => {
    const isFirst = firstEntriesRef.current;
    firstEntriesRef.current = false;
    if (lastUserId !== memory.current.lastUserId) {
      const hadPrevious = memory.current.lastUserId !== null || !isFirst;
      memory.current.lastUserId = lastUserId;
      if (hadPrevious && lastUserId !== null) {
        restoredRef.current = true;
        setAnchored(true);
        pin();
        return;
      }
    }
    if (!isFirst && !anchoredRef.current) setPill('new');
  }, [entries, lastUserId, memory, setAnchored, pin]);

  // The keyboard shrinks the viewport through KeyboardAvoidingView, which
  // onLayout already catches; these cover the frames where it doesn't fire.
  React.useEffect(() => {
    if (Platform.OS === 'web') return;
    const subs = [
      Keyboard.addListener('keyboardDidShow', pin),
      Keyboard.addListener('keyboardDidHide', pin),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [pin]);

  // Web has no drag callbacks for wheel/trackpad, so watch the scroller for
  // input. Scrolling up by wheel, touch or key unanchors immediately: waiting
  // for the scroll event would let a streaming re-pin swallow the movement.
  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = getScrollNode(scrollRef.current);
    if (!node) return;
    const scrollable = () => node.scrollHeight - node.clientHeight > 1 && node.scrollTop > 0;
    const mark = () => {
      webInputAtRef.current = performance.now();
    };
    let touchY: number | null = null;
    const onWheel = (e: WheelEvent) => {
      // Horizontal wheels over code blocks and tables aren't vertical intent.
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      mark();
      if (e.deltaY < 0 && scrollable()) setAnchored(false);
    };
    const onTouchStart = (e: TouchEvent) => {
      mark();
      touchY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      mark();
      const y = e.touches[0]?.clientY;
      // Finger moving down drags the content down, i.e. scrolls up.
      if (touchY !== null && y !== undefined && y > touchY + 2 && scrollable()) {
        setAnchored(false);
      }
      if (y !== undefined) touchY = y;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(e.key)) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName))) {
        return;
      }
      mark();
      if (UP_KEYS.has(e.key) && scrollable()) setAnchored(false);
    };
    // A press on the scroller itself (not its content) is the scrollbar.
    const onPointerDown = (e: PointerEvent) => {
      if (e.target === node) webPointerDownRef.current = true;
    };
    const onPointerUp = () => {
      webPointerDownRef.current = false;
    };
    node.addEventListener('wheel', onWheel, { passive: true });
    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: true });
    node.addEventListener('keydown', onKeyDown);
    node.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('keydown', onKeyDown);
      node.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [setAnchored]);

  const userDriving = () =>
    Platform.OS === 'web'
      ? webPointerDownRef.current || performance.now() - webInputAtRef.current < WEB_INPUT_WINDOW_MS
      : draggingRef.current || momentumRef.current;

  // Nested horizontal scrollers (code blocks, tables) fire their own onScroll,
  // not this one, so everything here is the vertical log.
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const n = e.nativeEvent;
    const y = n.contentOffset.y;
    const fromBottom = n.contentSize.height - n.layoutMeasurement.height - y;
    const movedUp = y < lastYRef.current - 1;
    lastYRef.current = y;
    memory.current.offset = y;
    const user = userDriving();
    // fromBottom > 1 ignores iOS bouncing back from overscroll past the end.
    if (user && movedUp && fromBottom > 1) setAnchored(false);
    else if (fromBottom <= ANCHOR_THRESHOLD && !anchoredRef.current && (user || !movedUp)) {
      setAnchored(true);
    }
  };

  const settle = () => {
    // Let go near the bottom: snap the last few pixels and keep following.
    if (anchoredRef.current) pin();
  };

  const onContentSizeChange = () => {
    if (!restoredRef.current) {
      restoredRef.current = true;
      scrollRef.current?.scrollTo({ y: memory.current.offset, animated: false });
      return;
    }
    pin();
  };

  const jumpToLatest = () => {
    setAnchored(true);
    scrollRef.current?.scrollToEnd({ animated: true });
  };

  return (
    <View style={styles.wrap}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={onScroll}
        onScrollBeginDrag={() => {
          draggingRef.current = true;
        }}
        onScrollEndDrag={() => {
          draggingRef.current = false;
          settle();
        }}
        onMomentumScrollBegin={() => {
          momentumRef.current = true;
        }}
        onMomentumScrollEnd={() => {
          momentumRef.current = false;
          settle();
        }}
        onContentSizeChange={onContentSizeChange}
        onLayout={pin}
      >
        {items.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>What should this app become?</Text>
            <Text style={styles.emptyBody}>Describe it below, or start from one of these.</Text>
            <View style={styles.starters}>
              {STARTERS.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => onSuggest(s)}
                  style={({ pressed }) => [styles.starter, pressed && styles.starterPressed]}
                  accessibilityRole="button"
                >
                  <Text style={styles.starterText}>{s}</Text>
                  <Ionicons name="arrow-up" size={15} color={colors.dust} />
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          items.map((item) => (
            <ItemView
              key={item.id}
              item={item}
              onRetry={item.id === retryId ? onRetry : undefined}
            />
          ))
        )}
        {running && stalled ? (
          <StallRow onStop={onStop} onRetry={onRetry} />
        ) : status ? (
          <View style={styles.thinking}>
            <ActivityIndicator size="small" color={colors.dust} />
            <Text style={styles.thinkingText}>
              {status === 'working' && idleSince !== null ? (
                <WorkingLabel since={idleSince} />
              ) : reasoningTokens >= 200 ? (
                `Thinking… ${formatTokens(reasoningTokens)} tokens`
              ) : (
                'Thinking…'
              )}
            </Text>
          </View>
        ) : null}
      </ScrollView>
      <JumpPill state={pill} onPress={jumpToLatest} />
    </View>
  );
}

// When visible progress last happened, once it's been quiet for
// IDLE_STATUS_MS; null while things are moving.
function useIdleSince(running: boolean, entries: Entry[], pendingCall: PendingCall | null): number | null {
  const [idleSince, setIdleSince] = React.useState<number | null>(null);
  React.useEffect(() => {
    setIdleSince(null);
    if (!running) return;
    const at = Date.now();
    const t = setTimeout(() => setIdleSince(at), IDLE_STATUS_MS);
    return () => clearTimeout(t);
  }, [running, entries, pendingCall]);
  return idleSince;
}

// "Working…", then "Working… 23s" once the wait is long enough to count.
function WorkingLabel({ since }: { since: number }) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.floor((now - since) / 1000);
  return <>{s >= 3 ? `Working… ${s}s` : 'Working…'}</>;
}

function StallRow({ onStop, onRetry }: { onStop: () => void; onRetry: () => void }) {
  return (
    <View style={styles.stallCard}>
      <ActivityIndicator size="small" color={colors.dust} />
      <Text style={styles.stallText}>Still waiting on the model…</Text>
      <Pressable
        onPress={onStop}
        style={({ pressed }) => [styles.stallBtn, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.stallBtnText}>Stop</Text>
      </Pressable>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Ionicons name="refresh" size={14} color={colors.slate} />
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}

// Sits at the bottom of the list's own box, so it always clears the composer
// and rides up with the keyboard.
function JumpPill({ state, onPress }: { state: PillState; onPress: () => void }) {
  const visible = state !== 'hidden';
  const progress = React.useRef(new Animated.Value(visible ? 1 : 0)).current;
  // Keep the last label while fading out.
  const [label, setLabel] = React.useState(state === 'new' ? 'New messages' : 'Jump to latest');
  React.useEffect(() => {
    if (state !== 'hidden') setLabel(state === 'new' ? 'New messages' : 'Jump to latest');
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: 160,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [state, visible, progress]);
  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      aria-hidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      style={[
        styles.pillWrap,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
          ],
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Scroll to latest message"
        hitSlop={8}
      >
        <Ionicons name="arrow-down" size={15} color={colors.chalk} />
        <Text style={styles.pillText}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
const UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home']);

function getScrollNode(ref: ScrollView | null): HTMLElement | null {
  const node = (ref as unknown as { getScrollableNode?: () => unknown } | null)
    ?.getScrollableNode?.();
  return node instanceof HTMLElement ? node : null;
}

function findLastUserId(entries: Entry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].kind === 'user') return entries[i].id;
  }
  return null;
}

function formatTokens(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`;
}

// Retry and Continue resume a turn without a new request, so a turn starts
// after a user message or after the previous turn's end.
function latestRecoverableId(items: RenderItem[]): string | null {
  let i = items.length - 1;
  if (items[i]?.type === 'turnEnd') i--;
  for (; i >= 0; i--) {
    const it = items[i];
    if (it.type === 'turnEnd') return null;
    if (it.type !== 'entry') continue;
    if (it.entry.kind === 'user') return null;
    if (it.entry.kind === 'error' || it.entry.kind === 'cutShort') return it.id;
  }
  return null;
}

function ItemView({ item, onRetry }: { item: RenderItem; onRetry?: () => void }) {
  if (item.type === 'tools') return <ToolGroupCard steps={item.steps} active={item.active} />;
  if (item.type === 'turnEnd') {
    // Only a stop needs saying; the partial reply stays above it.
    return item.entry.status === 'stopped' ? (
      <View style={styles.notice}>
        <Ionicons name="stop-circle-outline" size={14} color={colors.dust} />
        <Text style={styles.noticeText}>Stopped</Text>
      </View>
    ) : null;
  }
  return <EntryView entry={item.entry} onRetry={onRetry} />;
}

// Memoized so a streaming chunk only re-renders the entry it touched —
// handleEvent keeps object identity for every other entry.
const EntryView = React.memo(function EntryView({
  entry,
  onRetry,
}: {
  entry: Exclude<Entry, ToolEntry | ServerToolEntry | { kind: 'turnEnd' }>;
  onRetry?: () => void;
}) {
  if (entry.kind === 'user') {
    return (
      <View style={styles.userBubble}>
        <Text style={styles.userText}>{entry.text}</Text>
      </View>
    );
  }
  if (entry.kind === 'assistant') return <AssistantText text={entry.text} />;
  if (entry.kind === 'notice') {
    return (
      <View style={styles.notice}>
        <Ionicons name="stop-circle-outline" size={14} color={colors.dust} />
        <Text style={styles.noticeText}>{entry.text}</Text>
      </View>
    );
  }
  if (entry.kind === 'cutShort') {
    const paused = entry.reason === 'paused';
    return (
      <View style={styles.cutCard}>
        <Ionicons
          name={paused ? 'pause-circle-outline' : 'power-outline'}
          size={16}
          color={colors.dust}
          style={styles.errorIcon}
        />
        <View style={styles.errorBody}>
          <Text style={styles.cutTitle}>
            {paused ? 'Paused when you left Blank Slate' : 'Interrupted, Blank Slate closed while this was running'}
          </Text>
        </View>
        {onRetry ? (
          <Pressable
            onPress={onRetry}
            style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Ionicons name="play" size={13} color={colors.slate} />
            <Text style={styles.retryText}>Continue</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  return (
    <View style={styles.errorCard}>
      <Ionicons name="alert-circle-outline" size={16} color={colors.danger} style={styles.errorIcon} />
      <View style={styles.errorBody}>
        <Text style={styles.errorTitle}>{errorTitle(entry.text)}</Text>
        <Text style={styles.errorText}>{entry.text}</Text>
      </View>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Ionicons name="refresh" size={14} color={colors.slate} />
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
});

// Long-press copies the message on native; on web the text is selectable.
// No visible chrome until it's used.
function AssistantText({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  // Whitespace-only blocks are filtered out by buildRenderItems.
  const body = <Markdown text={text.trim()} />;
  if (Platform.OS === 'web') return <View style={styles.assistant}>{body}</View>;
  const copy = () => {
    Clipboard.setStringAsync(text.trim())
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  };
  return (
    <Pressable
      onLongPress={copy}
      delayLongPress={400}
      style={styles.assistant}
      accessibilityHint="Long-press to copy"
    >
      {body}
      {copied ? <Text style={styles.copiedText}>Copied</Text> : null}
    </Pressable>
  );
}

function errorTitle(message: string): string {
  if (/output (limit|budget)/i.test(message)) return 'Reply cut off';
  if (/OpenRouter (5\d\d|429)/.test(message)) return 'The model provider had a problem';
  if (/OpenRouter 4\d\d/.test(message)) return 'OpenRouter rejected the request';
  if (/^No response from the model|stream ended before/.test(message)) return 'The model stopped responding';
  if (/network|fetch|timed? ?out|connection/i.test(message)) return 'Connection problem';
  return "This turn didn't finish";
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  scroll: { flex: 1 },
  pressed: { opacity: 0.7 },
  messages: {
    flexGrow: 1,
    gap: 12,
    paddingHorizontal: space.chatGutter,
    paddingTop: 8,
    paddingBottom: 16,
  },
  empty: { flex: 1, justifyContent: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 40 },
  emptyTitle: {
    fontFamily: fonts.displaySemi,
    fontSize: 20,
    letterSpacing: -0.2,
    textAlign: 'center',
    color: colors.chalk,
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    color: colors.dust,
  },
  starters: { gap: 8, marginTop: 12 },
  starter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.board,
  },
  starterPressed: { backgroundColor: colors.raised },
  starterText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.chalkSoft },
  userBubble: {
    alignSelf: 'flex-end',
    // Extra air above each request separates one turn from the next.
    marginTop: 8,
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 6,
    borderBottomLeftRadius: 18,
    backgroundColor: colors.chalk,
  },
  userText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.slate },
  assistant: { alignSelf: 'stretch' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  noticeText: { fontFamily: fonts.mono, fontSize: 12, color: colors.dust },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerBg,
  },
  errorIcon: { alignSelf: 'flex-start', marginTop: 1 },
  errorBody: { flex: 1, minWidth: 0, gap: 2 },
  errorTitle: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.danger },
  errorText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.dangerSoft },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radii.chip,
    backgroundColor: colors.accent,
  },
  retryText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.slate },
  copiedText: { marginTop: 6, fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.success },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  thinkingText: { fontFamily: fonts.body, fontSize: 13, color: colors.dust },
  cutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.board,
  },
  cutTitle: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.chalk },  stallCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.board,
  },
  stallText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.chalkSoft },
  stallBtn: {
    justifyContent: 'center',
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: colors.line,
  },
  stallBtnText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.chalk },

  pillWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 12,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.raised,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
  },
  pillText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.chalk },
});

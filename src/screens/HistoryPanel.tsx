import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as history from '../debug/history';
import type { FilterGroup, HistoryEvent } from '../debug/history';
import { captureApp, screenshotsAvailable } from '../debug/screenshot';
import { colors, fonts, noLigatures, radii, space, type } from '../theme';

// The History tab: what the generated app did at runtime, newest first and
// grouped by session (one per remount).

type Props = {
  projectId: string | null;
  appOpened: boolean;
  // Opens Chat with this text in the composer (not sent).
  onAskAgent: (text: string) => void;
};

type Filter = 'all' | FilterGroup;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'taps', label: 'Taps' },
  { key: 'logs', label: 'Logs' },
  { key: 'errors', label: 'Errors' },
  { key: 'network', label: 'Network' },
  { key: 'screenshots', label: 'Screenshots' },
];

// Rendering more than this is never useful on a phone; the agent can query all.
const MAX_ROWS = 400;

type Row =
  | { kind: 'session'; key: string; session: number; ts: number }
  | { kind: 'event'; key: string; event: HistoryEvent };

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export function HistoryPanel({ projectId, appOpened, onAskAgent }: Props) {
  const version = React.useSyncExternalStore(history.subscribe, history.getVersion);
  const [filter, setFilter] = React.useState<Filter>('all');
  const [viewing, setViewing] = React.useState<HistoryEvent | null>(null);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [shooting, setShooting] = React.useState(false);
  const [shotError, setShotError] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    setLoaded(false);
    history.ready().then(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [projectId]);

  React.useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const rows = React.useMemo(() => {
    const events = history.query({
      groups: filter === 'all' ? undefined : [filter],
      limit: MAX_ROWS,
    });
    return buildRows(events);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, version, projectId, loaded]);

  const clear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    history.clear();
  };

  const shoot = async () => {
    setShooting(true);
    setShotError(null);
    const r = await captureApp('manual');
    setShooting(false);
    if (!r.ok) setShotError(r.error);
  };

  const canShoot = appOpened && screenshotsAvailable();

  return (
    <View style={styles.root}>
      <View style={styles.subHeader}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={styles.chipScroll}
        >
          {FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable
          onPress={shoot}
          disabled={!canShoot || shooting}
          style={({ pressed }) => [styles.iconBtn, (!canShoot || pressed) && styles.dim]}
          accessibilityRole="button"
          accessibilityLabel="Take screenshot"
        >
          {shooting ? (
            <ActivityIndicator size="small" color={colors.dust} />
          ) : (
            <Ionicons name="camera-outline" size={17} color={colors.dust} />
          )}
        </Pressable>
        <Pressable
          onPress={clear}
          style={({ pressed }) => [
            styles.iconBtn,
            confirmClear && styles.clearConfirm,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={confirmClear ? 'Tap again to clear history' : 'Clear history'}
        >
          {confirmClear ? (
            <Text style={styles.clearConfirmText}>Clear</Text>
          ) : (
            <Ionicons name="trash-outline" size={16} color={colors.dust} />
          )}
        </Pressable>
      </View>
      {shotError ? <Text style={styles.shotError}>{shotError}</Text> : null}

      {!loaded ? (
        <View style={styles.emptyWrap}>
          <ActivityIndicator color={colors.dust} />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="pulse-outline" size={28} color={colors.lineFaint} />
          <Text style={styles.empty}>
            {filter === 'all'
              ? 'Nothing recorded yet. Logs, taps, errors, network requests and screenshots from your app show up here.'
              : 'Nothing of this kind yet.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          renderItem={({ item }) =>
            item.kind === 'session' ? (
              <SessionHeader row={item} />
            ) : (
              <EventRow event={item.event} onAsk={onAskAgent} onView={setViewing} />
            )
          }
          contentContainerStyle={styles.list}
          initialNumToRender={30}
          windowSize={7}
        />
      )}

      <ShotViewer event={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}

// Newest first; a header precedes each session's events.
function buildRows(events: HistoryEvent[]): Row[] {
  const rows: Row[] = [];
  let session = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.session !== session) {
      session = e.session;
      rows.push({ kind: 'session', key: `s-${e.session}-${e.id}`, session: e.session, ts: e.ts });
    }
    rows.push({ kind: 'event', key: `e-${e.id}`, event: e });
  }
  return rows;
}

function SessionHeader({ row }: { row: Extract<Row, { kind: 'session' }> }) {
  return (
    <View style={styles.sessionHead}>
      <Text style={styles.sessionLabel}>
        Session {row.session} · {history.formatTime(row.ts)}
      </Text>
      <View style={styles.sessionRule} />
    </View>
  );
}

function iconFor(e: HistoryEvent): { name: IconName; color: string } {
  switch (e.type) {
    case 'error':
      return { name: 'alert-circle-outline', color: colors.danger };
    case 'log':
      if (e.level === 'error') return { name: 'alert-circle-outline', color: colors.danger };
      if (e.level === 'warn') return { name: 'warning-outline', color: colors.accent };
      return { name: 'terminal-outline', color: colors.dust };
    case 'tap':
      return { name: 'finger-print-outline', color: colors.chalkSoft };
    case 'touch':
      return { name: 'hand-left-outline', color: colors.dust };
    case 'network':
      return {
        name: 'swap-vertical-outline',
        color: history.isProblem(e) ? colors.danger : colors.info,
      };
    case 'screenshot':
      return { name: 'camera-outline', color: colors.dust };
    case 'lifecycle':
      return { name: 'refresh-outline', color: colors.dust };
  }
}

const EventRow = React.memo(function EventRow({
  event: e,
  onAsk,
  onView,
}: {
  event: HistoryEvent;
  onAsk: (text: string) => void;
  onView: (e: HistoryEvent) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const icon = iconFor(e);
  const isError = e.type === 'error' || (e.type === 'log' && e.level === 'error');
  const isWarn = e.type === 'log' && e.level === 'warn';
  const mono = e.type === 'log' || e.type === 'error' || e.type === 'network';
  const askable = isError || isWarn || (e.type === 'network' && history.isProblem(e)) || e.type === 'touch';
  const meta = [
    e.repeat && e.repeat > 1 ? `×${e.repeat}` : null,
    e.type === 'network' && e.ms !== undefined ? `${e.ms} ms` : null,
  ].filter(Boolean);

  return (
    <View style={[styles.row, isError && styles.rowError]}>
      <Pressable
        onPress={() => (e.detail ? setOpen((v) => !v) : undefined)}
        style={styles.rowMain}
        accessibilityRole={e.detail ? 'button' : undefined}
        accessibilityState={e.detail ? { expanded: open } : undefined}
      >
        <Ionicons name={icon.name} size={14} color={icon.color} style={styles.rowIcon} />
        <View style={styles.rowBody}>
          <Text
            style={[
              mono ? styles.rowTextMono : styles.rowText,
              isError && styles.rowTextError,
              e.type === 'touch' && styles.rowTextMuted,
            ]}
            numberOfLines={open ? undefined : 4}
          >
            {e.text}
          </Text>
          <Text style={styles.rowMeta}>
            #{e.id} · {history.formatTime(e.ts)}
            {meta.length ? ` · ${meta.join(' · ')}` : ''}
            {e.detail && !open ? ' · details' : ''}
          </Text>
          {open && e.detail ? <Text style={styles.detail}>{e.detail}</Text> : null}
        </View>
      </Pressable>
      {e.type === 'screenshot' && e.uri ? <ShotThumb event={e} onPress={() => onView(e)} /> : null}
      {askable ? (
        <Pressable
          onPress={() => onAsk(askText(e))}
          style={({ pressed }) => [styles.askBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Ask agent about event ${e.id}`}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={13} color={colors.chalkSoft} />
          <Text style={styles.askText}>Ask agent</Text>
        </Pressable>
      ) : null}
    </View>
  );
});

function askText(e: HistoryEvent): string {
  const short = e.text.length > 160 ? `${e.text.slice(0, 160)}…` : e.text;
  const what =
    e.type === 'touch'
      ? `tap #${e.id} (${short})`
      : e.type === 'network'
        ? `request #${e.id} (${short})`
        : `${history.kindLabel(e) === 'warn' ? 'warning' : 'error'} #${e.id}: ${short}`;
  return `Debug this: ${what}. Check the app history around it and fix the cause.`;
}

function useShotUri(e: HistoryEvent | null): string | null {
  const [uri, setUri] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    setUri(null);
    if (e) history.shotDisplayUri(e).then((u) => alive && setUri(u));
    return () => {
      alive = false;
    };
  }, [e]);
  return uri;
}

function ShotThumb({ event, onPress }: { event: HistoryEvent; onPress: () => void }) {
  const uri = useShotUri(event);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.thumbWrap, pressed && styles.pressed]}
      accessibilityRole="imagebutton"
      accessibilityLabel={`Screenshot ${event.id}, tap to enlarge`}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={[styles.thumb, { aspectRatio: (event.w ?? 1) / (event.h ?? 2) }]}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty, { aspectRatio: (event.w ?? 1) / (event.h ?? 2) }]} />
      )}
    </Pressable>
  );
}

function ShotViewer({ event, onClose }: { event: HistoryEvent | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const uri = useShotUri(event);
  return (
    <Modal visible={!!event} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.viewer} onPress={onClose} accessibilityLabel="Close screenshot">
        <View style={[styles.viewerHead, { paddingTop: insets.top + 8 }]}>
          <Text style={styles.viewerTitle}>
            {event ? `#${event.id} · ${history.formatTime(event.ts)} · ${event.source ?? ''}` : ''}
          </Text>
          <Ionicons name="close" size={22} color={colors.chalk} />
        </View>
        {uri && event ? (
          <Image
            source={{ uri }}
            style={[styles.viewerImage, { aspectRatio: (event.w ?? 1) / (event.h ?? 2) }]}
            resizeMode="contain"
          />
        ) : (
          <ActivityIndicator color={colors.dust} />
        )}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.slate },
  pressed: { opacity: 0.7 },
  dim: { opacity: 0.45 },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: space.chatGutter,
    paddingBottom: 12,
  },
  chipScroll: { flex: 1 },
  chips: { gap: 6, paddingLeft: space.chatGutter, paddingRight: 4 },
  chip: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.raised, borderColor: colors.lineStrong },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.dust },
  chipTextActive: { fontFamily: fonts.bodySemi, color: colors.chalk },
  iconBtn: {
    minWidth: 36,
    height: 36,
    paddingHorizontal: 8,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.board,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearConfirm: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerBg },
  clearConfirmText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.danger },
  shotError: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.dust,
    paddingHorizontal: space.chatGutter,
    paddingBottom: 10,
  },

  list: { paddingHorizontal: space.chatGutter, paddingBottom: 32, gap: 6 },
  sessionHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, paddingBottom: 2 },
  sessionLabel: { ...type.sectionLabel, fontSize: 10 },
  sessionRule: { flex: 1, height: 1, backgroundColor: colors.line },

  row: {
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.board,
  },
  rowError: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerBg },
  rowMain: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rowIcon: { marginTop: 2 },
  rowBody: { flex: 1, minWidth: 0, gap: 3 },
  rowText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.chalkSoft },
  rowTextMono: {
    ...noLigatures,
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 17,
    color: colors.chalkMuted,
  },
  rowTextError: { color: colors.danger },
  rowTextMuted: { color: colors.dust },
  rowMeta: { fontFamily: fonts.mono, fontSize: 10, color: colors.dust },
  detail: {
    ...noLigatures,
    marginTop: 4,
    padding: 8,
    borderRadius: 8,
    backgroundColor: colors.slate,
    fontFamily: fonts.mono,
    fontSize: 10,
    lineHeight: 15,
    color: colors.dangerSoft,
  },
  askBtn: {
    alignSelf: 'flex-start',
    marginLeft: 24,
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.raised,
  },
  askText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.chalkSoft },
  thumbWrap: { alignSelf: 'flex-start', marginLeft: 24 },
  thumb: { width: 88, borderRadius: 8, borderWidth: 1, borderColor: colors.lineStrong },
  thumbEmpty: { backgroundColor: colors.raised },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  empty: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    color: colors.dust,
  },

  viewer: { flex: 1, backgroundColor: 'rgba(10, 10, 12, 0.94)', alignItems: 'center', justifyContent: 'center' },
  viewerHead: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.gutter,
    paddingBottom: 8,
  },
  viewerTitle: { fontFamily: fonts.mono, fontSize: 12, color: colors.chalkSoft },
  viewerImage: { width: '86%', maxHeight: '80%', borderRadius: radii.button },
});

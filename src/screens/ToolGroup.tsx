import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Image,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as debugHistory from '../debug/history';
import type { Entry, ServerToolEntry, ToolEntry } from '../project/chatStore';
import { colors, fonts, noLigatures, radii } from '../theme';
import { readFile } from '../vfs/vfs';

// Claude Code-style tool grouping: consecutive tool calls collapse into one
// card with a summary ("Read 1 file, created 1, edited 1") and a total diff.
// Diff counts are line-count approximations from the tool inputs plus the
// last-known size of each file seen earlier in the chat.

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type ToolLike = ToolEntry | ServerToolEntry;

type SummaryKey =
  | 'read'
  | 'created'
  | 'wrote'
  | 'edited'
  | 'deleted'
  | 'listed'
  | 'image'
  | 'search'
  | 'fetch'
  | 'debug'
  | 'screenshot'
  | 'other';

export type ToolStep = {
  id: string;
  key: SummaryKey;
  icon: IconName;
  web: boolean;
  label: string; // "Read App.tsx"
  doing: string; // "Reading App.tsx"
  detail: string | null;
  add: number;
  del: number;
  status: 'pending' | 'ok' | 'error';
  input: Record<string, unknown>;
  resultText: string | null;
  thumbPath: string | null;
  // Debug-history screenshot shown under the row (take/get_screenshot).
  shotId: number | null;
};

export type RenderItem =
  | { type: 'entry'; id: string; entry: Exclude<Entry, ToolLike> }
  | { type: 'tools'; id: string; steps: ToolStep[]; active: boolean };

// ---- grouping ---------------------------------------------------------------

export function buildRenderItems(entries: Entry[], running: boolean): RenderItem[] {
  const items: RenderItem[] = [];
  // path → last known line count, so a rewrite or delete can report "−N".
  const known = new Map<string, number>();
  let group: Extract<RenderItem, { type: 'tools' }> | null = null;

  for (const e of entries) {
    if (e.kind === 'tool' || e.kind === 'serverTool') {
      const step = describe(e, known);
      if (!group) {
        group = { type: 'tools', id: `g-${e.id}`, steps: [], active: false };
        items.push(group);
      }
      group.steps.push(step);
      continue;
    }
    // Whitespace-only text between tool calls shouldn't split a group.
    if (e.kind === 'assistant' && !e.text.trim()) continue;
    group = null;
    items.push({ type: 'entry', id: e.id, entry: e });
  }

  const last = items[items.length - 1];
  if (running && last?.type === 'tools') last.active = true;
  return items;
}

const lineCache = new Map<string, number>();

function lines(s: unknown): number {
  if (typeof s !== 'string' || s.length === 0) return 0;
  // Long strings recur on every streaming re-render; count them once.
  const cacheable = s.length > 512;
  if (cacheable) {
    const hit = lineCache.get(s);
    if (hit !== undefined) return hit;
  }
  let n = 1;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  if (s.endsWith('\n')) n--;
  if (cacheable) {
    if (lineCache.size > 200) lineCache.clear();
    lineCache.set(s, n);
  }
  return n;
}

function describe(e: ToolLike, known: Map<string, number>): ToolStep {
  const base = {
    id: e.id,
    input: e.input,
    add: 0,
    del: 0,
    detail: null as string | null,
    thumbPath: null as string | null,
    shotId: null as number | null,
    web: false,
  };

  if (e.kind === 'serverTool') {
    const r = e.result;
    const status: ToolStep['status'] = !r ? 'pending' : r.kind === 'error' ? 'error' : 'ok';
    const resultText = r ? serverResultText(r) : null;
    if (e.name === 'web_fetch') {
      const host = hostOf(str(e.input.url));
      return {
        ...base,
        key: 'fetch',
        icon: 'globe-outline',
        web: true,
        label: `Read ${host}`,
        doing: `Reading ${host}`,
        status,
        resultText,
        detail: status === 'error' ? 'failed' : null,
      };
    }
    const count = r?.kind === 'web_search' ? r.results.length : 0;
    const query = str(e.input.query);
    return {
      ...base,
      key: 'search',
      icon: 'search-outline',
      web: true,
      label: query ? `Searched "${query}"` : 'Searched the web',
      doing: query ? `Searching "${query}"` : 'Searching the web',
      status,
      resultText,
      detail:
        status === 'error'
          ? 'failed'
          : r
            ? `${count} ${e.name === 'web_sources' ? 'source' : 'result'}${count === 1 ? '' : 's'}`
            : null,
    };
  }

  const path = str(e.input.path) || '?';
  const status: ToolStep['status'] = !e.result ? 'pending' : e.result.ok ? 'ok' : 'error';
  const resultText = e.result?.text ?? null;
  const ok = status === 'ok';
  const failed = status === 'error' ? 'failed' : null;

  switch (e.name) {
    case 'read_file': {
      const n = ok ? lines(resultText) : 0;
      if (ok && !resultText?.startsWith('(image file')) known.set(path, n);
      return {
        ...base,
        key: 'read',
        icon: 'document-outline',
        label: `Read ${path}`,
        doing: `Reading ${path}`,
        status,
        resultText,
        detail: failed ?? (ok ? `${n} line${n === 1 ? '' : 's'}` : null),
      };
    }
    case 'write_file': {
      const prev = known.get(path);
      const existed = prev !== undefined || path === 'App.tsx';
      const n = lines(e.input.content);
      const add = ok ? n : 0;
      const del = ok ? (prev ?? 0) : 0;
      if (ok) known.set(path, n);
      return {
        ...base,
        key: existed ? 'wrote' : 'created',
        icon: existed ? 'create-outline' : 'add-outline',
        label: `${existed ? 'Wrote' : 'Created'} ${path}`,
        doing: `${existed ? 'Writing' : 'Creating'} ${path}`,
        status,
        resultText,
        add,
        del,
        detail: failed,
      };
    }
    case 'edit_file': {
      const removed = lines(e.input.old_string);
      const added = lines(e.input.new_string);
      if (ok && known.has(path)) known.set(path, known.get(path)! + added - removed);
      return {
        ...base,
        key: 'edited',
        icon: 'create-outline',
        label: `Edited ${path}`,
        doing: `Editing ${path}`,
        status,
        resultText,
        add: ok ? added : 0,
        del: ok ? removed : 0,
        detail: failed,
      };
    }
    case 'delete_file': {
      const prev = known.get(path) ?? 0;
      if (ok) known.delete(path);
      return {
        ...base,
        key: 'deleted',
        icon: 'trash-outline',
        label: `Deleted ${path}`,
        doing: `Deleting ${path}`,
        status,
        resultText,
        del: ok ? prev : 0,
        detail: failed,
      };
    }
    case 'list_files': {
      const n = ok && resultText !== '(empty filesystem)' ? lines(resultText) : 0;
      return {
        ...base,
        key: 'listed',
        icon: 'folder-open-outline',
        label: 'Listed files',
        doing: 'Listing files',
        status,
        resultText,
        detail: failed ?? (ok ? `${n} file${n === 1 ? '' : 's'}` : null),
      };
    }
    case 'generate_image':
      return {
        ...base,
        key: 'image',
        icon: 'image-outline',
        label: `Generated ${path}`,
        doing: `Generating ${path}`,
        status,
        resultText,
        detail: failed ?? (ok ? 'image' : null),
        thumbPath: ok ? path : null,
      };
    case 'set_app_icon':
      return {
        ...base,
        key: 'other',
        icon: 'apps-outline',
        label: 'Set app icon',
        doing: 'Setting app icon',
        status,
        resultText,
        detail: failed ?? (ok ? path : null),
      };
    case 'get_app_history': {
      const n = ok ? countEventLines(resultText) : 0;
      return {
        ...base,
        key: 'debug',
        icon: 'pulse-outline',
        label: 'Checked app history',
        doing: 'Checking app history',
        status,
        resultText,
        detail: failed ?? (ok ? `${n} event${n === 1 ? '' : 's'}` : null),
      };
    }
    case 'get_ui_tree':
      return {
        ...base,
        key: 'debug',
        icon: 'git-network-outline',
        label: 'Inspected the UI',
        doing: 'Inspecting the UI',
        status,
        resultText,
        detail: failed,
      };
    case 'take_screenshot':
    case 'get_screenshot': {
      const shotId = ok ? shotIdIn(resultText) : null;
      const live = e.name === 'take_screenshot';
      return {
        ...base,
        key: 'screenshot',
        icon: 'camera-outline',
        label: live ? 'Took a screenshot' : `Looked at screenshot #${String(e.input.id ?? '?')}`,
        doing: live ? 'Taking a screenshot' : 'Opening screenshot',
        status,
        resultText,
        shotId,
        detail:
          failed ??
          (ok ? (shotId === null ? 'unavailable' : resultText?.includes('described it') ? 'described' : 'image') : null),
      };
    }
    default:
      return {
        ...base,
        key: 'other',
        icon: 'construct-outline',
        label: `Ran ${e.name}`,
        doing: `Running ${e.name}`,
        status,
        resultText,
        detail: failed,
      };
  }
}

function countEventLines(text: string | null): number {
  if (!text) return 0;
  let n = 0;
  for (const line of text.split('\n')) if (/^#\d+ /.test(line)) n++;
  return n;
}

function shotIdIn(text: string | null): number | null {
  const m = text ? /^Screenshot #(\d+)/.exec(text) : null;
  return m ? Number(m[1]) : null;
}

function serverResultText(r: NonNullable<ServerToolEntry['result']>): string {
  if (r.kind === 'error') return `error: ${r.error_code}`;
  if (r.kind === 'web_search') {
    return r.results.length
      ? r.results.map((x) => `${x.title}\n${x.url}`).join('\n\n')
      : '(no results)';
  }
  return [r.title, r.url, r.preview].filter(Boolean).join('\n');
}

// ---- summary ----------------------------------------------------------------

const FILE_KEYS: SummaryKey[] = ['read', 'created', 'wrote', 'edited', 'deleted'];
const VERBS: Record<SummaryKey, string> = {
  read: 'read',
  created: 'created',
  wrote: 'rewrote',
  edited: 'edited',
  deleted: 'deleted',
  listed: 'listed files',
  image: 'generated',
  search: 'searched the web',
  fetch: 'read',
  debug: 'checked the app',
  screenshot: 'took',
  other: 'ran',
};

export function summarize(steps: ToolStep[]): string {
  const order: SummaryKey[] = [];
  const counts = new Map<SummaryKey, number>();
  for (const s of steps) {
    if (!counts.has(s.key)) order.push(s.key);
    counts.set(s.key, (counts.get(s.key) ?? 0) + 1);
  }
  // "Listed files" is noise next to real work; keep it only when it's alone.
  const keys = order.length > 1 ? order.filter((k) => k !== 'listed') : order;
  let fileNounUsed = false;
  const parts = keys.map((key) => {
    const n = counts.get(key)!;
    const verb = VERBS[key];
    switch (key) {
      case 'listed':
        return verb;
      case 'search':
        return n > 1 ? `${verb} ${n} times` : verb;
      case 'image':
        return `${verb} ${n} image${n === 1 ? '' : 's'}`;
      case 'fetch':
        return `${verb} ${n} page${n === 1 ? '' : 's'}`;
      case 'debug':
        return verb;
      case 'screenshot':
        return `looked at ${n} screenshot${n === 1 ? '' : 's'}`;
      case 'other':
        return `${verb} ${n} tool${n === 1 ? '' : 's'}`;
      default: {
        if (FILE_KEYS.includes(key) && !fileNounUsed) {
          fileNounUsed = true;
          return `${verb} ${n} file${n === 1 ? '' : 's'}`;
        }
        return `${verb} ${n}`;
      }
    }
  });
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---- view -------------------------------------------------------------------

export const ToolGroupCard = React.memo(
  function ToolGroupCard({ steps, active }: { steps: ToolStep[]; active: boolean }) {
    const [open, setOpen] = React.useState(false);
    const expanded = active || open;
    const add = steps.reduce((n, s) => n + s.add, 0);
    const del = steps.reduce((n, s) => n + s.del, 0);
    const failed = steps.filter((s) => s.status === 'error').length;
    const stopped = !active && steps.some((s) => s.status === 'pending');
    const current = active ? steps.find((s) => s.status === 'pending') : undefined;
    const elapsed = useElapsed(active);

    const toggle = () => {
      if (active) return;
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setOpen((v) => !v);
    };

    return (
      <View style={[styles.card, active && styles.cardActive]}>
        <Pressable
          onPress={toggle}
          disabled={active}
          style={({ pressed }) => [styles.head, pressed && styles.headPressed]}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
        >
          {active ? (
            <ActivityIndicator size="small" color={colors.accent} style={styles.headSpinner} />
          ) : failed || stopped ? (
            <Ionicons
              name={failed ? 'alert-circle-outline' : 'stop-circle-outline'}
              size={15}
              color={failed ? colors.danger : colors.dust}
            />
          ) : (
            <Ionicons name="checkmark" size={15} color={colors.success} />
          )}
          <Text
            style={[styles.headText, active && styles.headTextActive]}
            numberOfLines={1}
          >
            {active ? (current?.doing ?? 'Thinking…') : summarize(steps)}
          </Text>
          {active ? (
            <Text style={styles.headMeta}>
              {steps.length} step{steps.length === 1 ? '' : 's'} · {formatElapsed(elapsed)}
            </Text>
          ) : (
            <>
              {failed ? <Text style={styles.failedMeta}>{failed} failed</Text> : null}
              {stopped && !failed ? <Text style={styles.headMeta}>Stopped</Text> : null}
              <Diff add={add} del={del} />
              <Ionicons
                name={open ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={colors.dust}
              />
            </>
          )}
        </Pressable>
        {expanded ? (
          <View style={styles.rows}>
            {steps.map((s) => (
              <StepRow key={s.id} step={s} live={active && s === current} />
            ))}
          </View>
        ) : null}
      </View>
    );
  },
  (a, b) =>
    a.active === b.active &&
    a.steps.length === b.steps.length &&
    a.steps.every((s, i) => sameStep(s, b.steps[i])),
);

function sameStep(a: ToolStep, b: ToolStep): boolean {
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.add === b.add &&
    a.del === b.del &&
    a.detail === b.detail &&
    a.label === b.label
  );
}

function StepRow({ step, live }: { step: ToolStep; live: boolean }) {
  const [open, setOpen] = React.useState(false);
  const iconColor = step.web ? colors.info : colors.dust;
  return (
    <View style={[styles.rail, live && styles.railLive]}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Ionicons name={step.icon} size={13} color={iconColor} />
        <Text style={[styles.rowLabel, live && styles.rowLabelLive]} numberOfLines={1}>
          {live ? step.doing : step.label}
        </Text>
        {step.status === 'error' ? (
          <Text style={styles.failedMeta}>failed</Text>
        ) : step.add || step.del ? (
          <Diff add={step.add} del={step.del} />
        ) : step.detail ? (
          <Text style={styles.rowDetail}>{step.detail}</Text>
        ) : null}
      </Pressable>
      {step.thumbPath ? <VfsImageThumb path={step.thumbPath} /> : null}
      {step.shotId !== null ? <ShotThumb id={step.shotId} /> : null}
      {open ? (
        <View style={styles.rowBody}>
          <Text style={styles.rowBodyLabel}>Input</Text>
          <Text style={styles.rowBodyText} numberOfLines={30}>
            {safeJson(step.input)}
          </Text>
          {step.resultText !== null ? (
            <>
              <Text style={styles.rowBodyLabel}>Result</Text>
              <Text style={styles.rowBodyText} numberOfLines={30}>
                {step.resultText}
              </Text>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Diff({ add, del }: { add: number; del: number }) {
  if (!add && !del) return null;
  return (
    <Text style={styles.diff}>
      {add ? <Text style={styles.diffAdd}>+{add}</Text> : null}
      {add && del ? ' ' : null}
      {del ? <Text style={styles.diffDel}>−{del}</Text> : null}
    </Text>
  );
}

function VfsImageThumb({ path }: { path: string }) {
  const [uri, setUri] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    readFile(path).then((c) => {
      if (alive && c?.startsWith('data:image/')) setUri(c);
    });
    return () => {
      alive = false;
    };
  }, [path]);
  if (!uri) return null;
  return <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />;
}

function ShotThumb({ id }: { id: number }) {
  const [shot, setShot] = React.useState<{ uri: string; w: number; h: number } | null>(null);
  React.useEffect(() => {
    let alive = true;
    // Saved chats render before the stored history has loaded.
    debugHistory.ready().then(async () => {
      const ev = debugHistory.getEvent(id);
      const uri = ev ? await debugHistory.shotDisplayUri(ev) : null;
      if (alive && ev && uri) setShot({ uri, w: ev.w ?? 1, h: ev.h ?? 2 });
    });
    return () => {
      alive = false;
    };
  }, [id]);
  if (!shot) return null;
  return (
    <Image
      source={{ uri: shot.uri }}
      style={[styles.shotThumb, { aspectRatio: shot.w / shot.h }]}
      resizeMode="cover"
    />
  );
}

function useElapsed(active: boolean): number {
  const start = React.useRef(Date.now());
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return Math.max(0, Math.round((now - start.current) / 1000));
}

function formatElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function hostOf(url: string): string {
  const m = /^https?:\/\/([^/]+)/i.exec(url);
  return m ? m[1].replace(/^www\./, '') : url || 'a page';
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.board,
    overflow: 'hidden',
  },
  cardActive: { borderColor: colors.lineStrong },
  head: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
  headPressed: { backgroundColor: colors.raised },
  headSpinner: { width: 15, height: 15, transform: [{ scale: 0.7 }] },
  headText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.chalkSoft },
  headTextActive: { color: colors.chalk },
  headMeta: { fontFamily: fonts.mono, fontSize: 11, color: colors.dust },
  failedMeta: { fontFamily: fonts.mono, fontSize: 11, color: colors.danger },
  diff: { fontFamily: fonts.mono, fontSize: 11 },
  diffAdd: { color: colors.success },
  diffDel: { color: colors.danger },

  rows: { gap: 2, paddingLeft: 18, paddingRight: 12, paddingBottom: 10 },
  rail: { borderLeftWidth: 1, borderLeftColor: colors.lineStrong, paddingLeft: 14 },
  railLive: { borderLeftColor: colors.accent },
  row: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowPressed: { opacity: 0.7 },
  rowLabel: { flex: 1, fontFamily: fonts.mono, fontSize: 12, color: colors.chalkMuted },
  rowLabelLive: { color: colors.chalk },
  rowDetail: { fontFamily: fonts.mono, fontSize: 11, color: colors.dust },
  rowBody: {
    gap: 4,
    marginTop: 2,
    marginBottom: 8,
    padding: 10,
    borderRadius: radii.chip,
    backgroundColor: colors.slate,
  },
  rowBodyLabel: {
    fontFamily: fonts.monoMedium,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.dust,
  },
  rowBodyText: { ...noLigatures, fontFamily: fonts.mono, fontSize: 11, lineHeight: 16, color: colors.chalkMuted },
  thumb: { width: 120, height: 120, borderRadius: radii.chip, marginTop: 4, marginBottom: 6 },
  shotThumb: {
    width: 96,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: colors.line,
    marginTop: 4,
    marginBottom: 6,
  },
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCurrentProjectIdSync, subscribe as subscribeProjects } from '../project/store';
import { fs } from './nativeModules';

// Runtime history of the generated app (never Blank Slate's own UI): console
// output, errors, taps, network, lifecycle and screenshots. One ring buffer per
// project, kept in memory and persisted in debounced batches. It stays on the
// device; the model only sees it through the debugging tools or "Ask agent".

export type EventType = 'log' | 'error' | 'tap' | 'touch' | 'network' | 'lifecycle' | 'screenshot';
export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export type HistoryEvent = {
  id: number;
  ts: number;
  // A new session starts each time the generated app is (re)mounted.
  session: number;
  type: EventType;
  // One line, already truncated.
  text: string;
  level?: LogLevel;
  // error: render | compile | handler | timer | promise | global
  // tap: the component (Pressable, Button, TextInput…)
  source?: string;
  // Stack, component stack, or other multi-line context.
  detail?: string;
  // Consecutive identical console lines collapse into one event.
  repeat?: number;
  // Tap position in the app view's coordinates.
  x?: number;
  y?: number;
  status?: number;
  ms?: number;
  // Screenshot file (native only), its size in pixels, and why it was taken.
  uri?: string;
  w?: number;
  h?: number;
};

export type NewEvent = Omit<HistoryEvent, 'id' | 'ts' | 'session'>;

// Filter groups shared by the History tab chips and get_app_history.
export type FilterGroup = 'taps' | 'logs' | 'errors' | 'network' | 'screenshots' | 'lifecycle';
export const FILTER_GROUPS: FilterGroup[] = ['taps', 'logs', 'errors', 'network', 'screenshots', 'lifecycle'];

export function inGroup(e: HistoryEvent, group: FilterGroup): boolean {
  switch (group) {
    case 'taps':
      return e.type === 'tap' || e.type === 'touch';
    case 'logs':
      return e.type === 'log';
    case 'errors':
      return e.type === 'error' || (e.type === 'log' && (e.level === 'error' || e.level === 'warn'));
    case 'network':
      return e.type === 'network';
    case 'screenshots':
      return e.type === 'screenshot';
    case 'lifecycle':
      return e.type === 'lifecycle';
  }
}

export function isProblem(e: HistoryEvent): boolean {
  return inGroup(e, 'errors') || (e.type === 'network' && (!!e.status ? e.status >= 400 : true));
}

const MAX_EVENTS = 2000;
const MAX_BYTES = 1_000_000;
const MAX_SHOTS = 30;
const PERSIST_DELAY_MS = 1500;
const NOTIFY_DELAY_MS = 150;
// Console budget per second; anything past it is counted, not stored.
const LOG_BUDGET_PER_SEC = 60;

type Persisted = { v: 1; nextId: number; session: number; events: HistoryEvent[] };

type Buffer = {
  projectId: string;
  events: HistoryEvent[];
  bytes: number;
  nextId: number;
  session: number;
  loaded: boolean;
  // Recorded before the persisted buffer finished loading; renumbered after.
  early: NewEvent[];
};

let buf: Buffer | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let version = 0;
const listeners = new Set<() => void>();

let logWindowStart = 0;
let logWindowCount = 0;
let droppedLogs = 0;

function sizeOf(e: HistoryEvent): number {
  return 80 + e.text.length + (e.detail?.length ?? 0) + (e.uri?.length ?? 0);
}

function current(): Buffer {
  const id = getCurrentProjectIdSync();
  if (buf && buf.projectId === id) return buf;
  if (buf) flushNow(buf);
  buf = { projectId: id, events: [], bytes: 0, nextId: 1, session: 0, loaded: false, early: [] };
  void load(buf);
  return buf;
}

async function load(b: Buffer): Promise<void> {
  let data: Persisted | null = null;
  try {
    const raw = await readPersisted(b.projectId);
    if (raw) {
      const parsed = JSON.parse(raw) as Persisted;
      if (parsed && parsed.v === 1 && Array.isArray(parsed.events)) data = parsed;
    }
  } catch {}
  if (data) {
    b.events = data.events;
    b.bytes = data.events.reduce((n, e) => n + sizeOf(e), 0);
    b.nextId = Math.max(data.nextId, (data.events[data.events.length - 1]?.id ?? 0) + 1);
    // Events recorded before the load belong to a session after the stored ones.
    b.session = data.session + (b.session > 0 ? b.session : 0);
  }
  b.loaded = true;
  const early = b.early;
  b.early = [];
  for (const e of early) push(b, e);
  if (early.length) schedulePersist();
  notify();
}

/** Resolves once the current project's stored history is in memory. */
export async function ready(): Promise<void> {
  const b = current();
  if (b.loaded) return;
  await new Promise<void>((resolve) => {
    const check = () => (b.loaded || buf !== b ? resolve() : setTimeout(check, 20));
    check();
  });
}

function push(b: Buffer, e: NewEvent, ts = Date.now()): HistoryEvent {
  const ev: HistoryEvent = { ...e, id: b.nextId++, ts, session: Math.max(b.session, 1) };
  b.events.push(ev);
  b.bytes += sizeOf(ev);
  trim(b);
  return ev;
}

function trim(b: Buffer): void {
  let drop = 0;
  let bytes = b.bytes;
  while (b.events.length - drop > MAX_EVENTS || (bytes > MAX_BYTES && b.events.length - drop > 1)) {
    bytes -= sizeOf(b.events[drop]);
    drop++;
  }
  if (!drop) return;
  const removed = b.events.splice(0, drop);
  b.bytes = bytes;
  for (const e of removed) if (e.uri) void deleteShotFile(e.uri);
}

/** Appends an event. Returns null when it was collapsed, rate-limited or deferred. */
export function record(e: NewEvent): HistoryEvent | null {
  const b = current();
  if (!b.loaded) {
    if (b.early.length < 200) b.early.push(e);
    return null;
  }
  if (e.type === 'log') {
    const last = b.events[b.events.length - 1];
    if (
      last &&
      last.type === 'log' &&
      last.level === e.level &&
      last.text === e.text &&
      last.session === Math.max(b.session, 1)
    ) {
      last.repeat = (last.repeat ?? 1) + 1;
      last.ts = Date.now();
      schedulePersist();
      notify();
      return null;
    }
    const now = Date.now();
    if (now - logWindowStart > 1000) {
      if (droppedLogs) {
        push(b, { type: 'log', level: 'warn', text: `… ${droppedLogs} console lines dropped (more than ${LOG_BUDGET_PER_SEC}/s)` });
        droppedLogs = 0;
      }
      logWindowStart = now;
      logWindowCount = 0;
    }
    if (++logWindowCount > LOG_BUDGET_PER_SEC) {
      droppedLogs++;
      return null;
    }
  }
  const ev = push(b, e);
  schedulePersist();
  notify();
  return ev;
}

/** Fills in fields on an existing event, e.g. tap coordinates. */
export function annotate(id: number, patch: Partial<NewEvent>): void {
  const b = current();
  const ev = b.events.find((e) => e.id === id);
  if (!ev) return;
  Object.assign(ev, patch);
  schedulePersist();
  notify();
}

/** Starts a new session (the generated app was mounted again). */
export function startSession(text: string): number {
  const b = current();
  b.session += 1;
  record({ type: 'lifecycle', text });
  return b.session;
}

export function currentSession(): number {
  return Math.max(current().session, 1);
}

export type Query = {
  groups?: FilterGroup[];
  sinceId?: number;
  search?: string;
  limit?: number;
  session?: number;
};

/** Oldest first. */
export function query(q: Query = {}): HistoryEvent[] {
  const b = current();
  const needle = q.search?.toLowerCase();
  const out: HistoryEvent[] = [];
  const limit = q.limit ?? Infinity;
  for (let i = b.events.length - 1; i >= 0 && out.length < limit; i--) {
    const e = b.events[i];
    if (q.sinceId !== undefined && e.id <= q.sinceId) break;
    if (q.session !== undefined && e.session !== q.session) continue;
    if (q.groups?.length && !q.groups.some((g) => inGroup(e, g))) continue;
    if (needle && !`${e.text}\n${e.detail ?? ''}`.toLowerCase().includes(needle)) continue;
    out.push(e);
  }
  return out.reverse();
}

export function getEvent(id: number): HistoryEvent | undefined {
  return current().events.find((e) => e.id === id);
}

export function lastEvent(): HistoryEvent | undefined {
  const b = current();
  return b.events[b.events.length - 1];
}

export async function clear(): Promise<void> {
  const b = current();
  const shots = b.events.filter((e) => e.uri).map((e) => e.uri!);
  b.events = [];
  b.bytes = 0;
  // Keep ids and the session counter moving so old references stay unambiguous.
  notify();
  schedulePersist();
  await Promise.all(shots.map(deleteShotFile));
}

/** Drops a deleted project's history and screenshots. */
export async function removeProject(projectId: string): Promise<void> {
  if (buf?.projectId === projectId) buf = null;
  try {
    const keys = await AsyncStorage.getAllKeys();
    const prefix = `project:${projectId}:debug:`;
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(prefix)));
    if (fs?.documentDirectory) {
      await fs.deleteAsync(projectDir(projectId), { idempotent: true });
    }
    await AsyncStorage.removeItem(storageKey(projectId));
  } catch {}
}

// ---- subscription -------------------------------------------------------------

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Changes on every (coalesced) notification; for useSyncExternalStore. */
export function getVersion(): number {
  return version;
}

function notify(): void {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    version++;
    for (const l of listeners) {
      try {
        l();
      } catch {}
    }
  }, NOTIFY_DELAY_MS);
}

// Switching projects swaps the buffer; tell the History tab.
subscribeProjects(() => {
  if (buf && buf.projectId !== getCurrentProjectIdSync()) {
    current();
    notify();
  }
});

// ---- persistence --------------------------------------------------------------

function storageKey(projectId: string): string {
  return `project:${projectId}:debug:history`;
}

export function projectDir(projectId: string): string {
  return `${fs!.documentDirectory}debug/${projectId}/`;
}

async function readPersisted(projectId: string): Promise<string | null> {
  if (fs?.documentDirectory) {
    const path = projectDir(projectId) + 'events.json';
    const info = await fs.getInfoAsync(path);
    return info.exists ? fs.readAsStringAsync(path) : null;
  }
  return AsyncStorage.getItem(storageKey(projectId));
}

async function writePersisted(projectId: string, data: string): Promise<void> {
  if (fs?.documentDirectory) {
    const dir = projectDir(projectId);
    await fs.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    await fs.writeAsStringAsync(dir + 'events.json', data);
    return;
  }
  await AsyncStorage.setItem(storageKey(projectId), data);
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (buf) flushNow(buf);
  }, PERSIST_DELAY_MS);
}

function flushNow(b: Buffer): void {
  if (!b.loaded) return;
  const data: Persisted = { v: 1, nextId: b.nextId, session: b.session, events: b.events };
  writePersisted(b.projectId, JSON.stringify(data)).catch(() => {});
}

// ---- screenshots ----------------------------------------------------------------

// Native: JPEG files in the project's directory. Web (no file system): data
// URLs in AsyncStorage, fewer of them, referenced as `store:<key>`.
const STORE_PREFIX = 'store:';
const MAX_SHOTS_WEB = 10;

export type ShotCapture = { kind: 'base64' | 'data-uri'; data: string };

/**
 * Records a capture: base64 JPEG data (native) or a data URL (web).
 * Returns null if it couldn't be stored.
 */
export async function addScreenshot(
  capture: ShotCapture,
  w: number,
  h: number,
  reason: string,
): Promise<HistoryEvent | null> {
  const b = current();
  await ready();
  if (buf !== b) return null;
  let uri: string;
  const stamp = Date.now().toString(36);
  if (capture.kind === 'base64' && fs?.documentDirectory) {
    const dir = projectDir(b.projectId);
    await fs.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    uri = `${dir}shot-${stamp}.jpg`;
    await fs.writeAsStringAsync(uri, capture.data, { encoding: fs.EncodingType.Base64 });
  } else if (capture.kind === 'data-uri') {
    const key = `project:${b.projectId}:debug:shot:${stamp}`;
    await AsyncStorage.setItem(key, capture.data);
    uri = STORE_PREFIX + key;
  } else {
    return null;
  }
  const ev = record({ type: 'screenshot', text: `Screenshot (${reason})`, source: reason, uri, w, h });
  pruneShots(b);
  return ev;
}

function pruneShots(b: Buffer): void {
  const max = fs?.documentDirectory ? MAX_SHOTS : MAX_SHOTS_WEB;
  const shots = b.events.filter((e) => e.type === 'screenshot' && e.uri);
  for (const e of shots.slice(0, Math.max(0, shots.length - max))) {
    void deleteShotFile(e.uri!);
    e.uri = undefined;
    e.text += ` (deleted, only the last ${max} are kept)`;
  }
}

async function deleteShotFile(uri: string): Promise<void> {
  try {
    if (uri.startsWith(STORE_PREFIX)) await AsyncStorage.removeItem(uri.slice(STORE_PREFIX.length));
    else await fs?.deleteAsync(uri, { idempotent: true });
  } catch {}
}

/** Something an <Image> can show. */
export async function shotDisplayUri(e: HistoryEvent): Promise<string | null> {
  if (!e.uri) return null;
  if (!e.uri.startsWith(STORE_PREFIX)) return e.uri;
  return AsyncStorage.getItem(e.uri.slice(STORE_PREFIX.length));
}

/** The screenshot as a `data:image/jpeg;base64,…` URL, for the model. */
export async function readShotDataUrl(e: HistoryEvent): Promise<string | null> {
  if (!e.uri) return null;
  try {
    if (e.uri.startsWith(STORE_PREFIX)) return await AsyncStorage.getItem(e.uri.slice(STORE_PREFIX.length));
    if (!fs) return null;
    const b64 = await fs.readAsStringAsync(e.uri, { encoding: 'base64' });
    return `data:image/jpeg;base64,${b64}`;
  } catch {
    return null;
  }
}

// ---- formatting -------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** `log.warn`, `error`, `tap`… — the type column in agent and prompt text. */
export function kindLabel(e: HistoryEvent): string {
  if (e.type === 'log') return e.level === 'log' || !e.level ? 'log' : e.level;
  if (e.type === 'error') return 'error';
  return e.type;
}

/** One compact line for the model: `#812 12:01:03 error  TypeError: … at App.tsx:12`. */
export function formatLine(e: HistoryEvent, opts: { detailLines?: number } = {}): string {
  const kind = kindLabel(e).padEnd(10);
  let text = e.text;
  if (e.repeat && e.repeat > 1) text += ` (×${e.repeat})`;
  if (e.type === 'tap' || e.type === 'touch') {
    if (e.x !== undefined && e.y !== undefined) text += ` @${Math.round(e.x)},${Math.round(e.y)}`;
  }
  if (e.type === 'screenshot' && e.uri) text += ` ${e.w}×${e.h} (get_screenshot id ${e.id})`;
  let line = `#${e.id} ${formatTime(e.ts)} ${kind} ${text}`;
  const n = opts.detailLines ?? 0;
  if (n > 0 && e.detail) {
    const extra = e.detail
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, n)
      .map((l) => `    ${l.slice(0, 160)}`)
      .join('\n');
    if (extra) line += `\n${extra}`;
  }
  return line;
}

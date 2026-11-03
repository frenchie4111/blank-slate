import * as React from 'react';
import * as ReactNative from 'react-native';
import * as history from './history';

// Everything the generated app sees that reports into the debug history:
// a scoped console/fetch/XHR/timers (passed in as module-scope bindings by the
// resolver, so Blank Slate's own globals are untouched) and a react-native
// module whose touchables, text inputs and Text log interactions and register
// themselves for get_ui_tree.

// ---- value formatting -------------------------------------------------------------

const MAX_STRING = 500;
const MAX_LINE = 1500;

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}… (+${s.length - max} chars)` : s;
}

function fmt(v: unknown, depth: number, seen: Set<unknown>): string {
  if (typeof v === 'string') return depth === 0 ? truncate(v, MAX_STRING) : JSON.stringify(truncate(v, 200));
  if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'bigint') return `${v}n`;
  if (typeof v === 'symbol') return v.toString();
  if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (seen.has(v)) return '[Circular]';
  if (depth >= 3) return Array.isArray(v) ? `[Array(${v.length})]` : '{…}';
  seen.add(v);
  try {
    if (Array.isArray(v)) {
      const items = v.slice(0, 20).map((x) => fmt(x, depth + 1, seen));
      if (v.length > 20) items.push(`… ${v.length - 20} more`);
      return `[${items.join(', ')}]`;
    }
    if (React.isValidElement(v)) return `<${elementName(v)} />`;
    const keys = Object.keys(v as object);
    const parts = keys.slice(0, 20).map((k) => `${k}: ${fmt((v as Record<string, unknown>)[k], depth + 1, seen)}`);
    if (keys.length > 20) parts.push(`… ${keys.length - 20} more`);
    return `{${parts.join(', ')}}`;
  } catch {
    return '[Unserializable]';
  } finally {
    seen.delete(v);
  }
}

export function formatArgs(args: unknown[]): string {
  return truncate(args.map((a) => fmt(a, 0, new Set())).join(' '), MAX_LINE);
}

function errorParts(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: `${err.name}: ${err.message}`, stack: err.stack };
  return { message: formatArgs([err]) };
}

// Generated modules are evaluated with a `//# sourceURL=vfs:///<path>`, so
// their frames read `vfs:///App.tsx:12:5`. Shorten those and drop the rest of
// Blank Slate's frames, which only add noise for the agent.
export function cleanStack(stack: string | undefined, max = 8): string | undefined {
  if (!stack) return undefined;
  const lines = stack.split('\n');
  const app = lines.filter((l) => l.includes('vfs:///')).map((l) => l.replace(/vfs:\/\/\//g, '').trim());
  const out = (app.length ? app : lines.slice(1)).slice(0, max);
  return out.join('\n') || undefined;
}

export function isAppStack(stack: string | undefined): boolean {
  return !!stack && stack.includes('vfs:///');
}

// ---- errors -------------------------------------------------------------------------

export type AppError = { event: history.HistoryEvent | null; message: string; source: string };
const errorListeners = new Set<(e: AppError) => void>();

/** Non-render errors from the generated app (handlers, timers, promises). */
export function onAppError(fn: (e: AppError) => void): () => void {
  errorListeners.add(fn);
  return () => {
    errorListeners.delete(fn);
  };
}

export function reportError(source: string, err: unknown, context?: string): history.HistoryEvent | null {
  const { message, stack } = errorParts(err);
  const text = truncate(context ? `${message} (${context})` : message, 600);
  const event = history.record({ type: 'error', source, text, detail: cleanStack(stack) });
  for (const l of errorListeners) {
    try {
      l({ event, message: text, source });
    } catch {}
  }
  return event;
}

// Errors thrown inside the app's handlers and timers are recorded and
// swallowed. Rethrowing would show a red box in dev and kill Blank Slate
// outright in a release build.
function guarded<A extends unknown[], R>(
  fn: (...args: A) => R,
  source: string,
  context: () => string,
): (...args: A) => R | undefined {
  return (...args: A) => {
    try {
      const r = fn(...args);
      if (r && typeof (r as { then?: unknown }).then === 'function') {
        (r as unknown as Promise<unknown>).then(undefined, (e) => reportError('promise', e, context()));
      }
      return r;
    } catch (e) {
      reportError(source, e, context());
      return undefined;
    }
  };
}

let globalHandlersInstalled = false;

// Uncaught errors and unhandled rejections that reach the global handlers are
// only recorded when their stack runs through generated code.
export function installGlobalHandlers(): void {
  if (globalHandlersInstalled) return;
  globalHandlersInstalled = true;
  const g = globalThis as {
    ErrorUtils?: {
      getGlobalHandler: () => (e: unknown, fatal?: boolean) => void;
      setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void;
    };
    addEventListener?: (t: string, fn: (ev: { error?: unknown; reason?: unknown }) => void) => void;
  };
  if (g.ErrorUtils) {
    const prev = g.ErrorUtils.getGlobalHandler();
    g.ErrorUtils.setGlobalHandler((e, fatal) => {
      if (e instanceof Error && isAppStack(e.stack)) reportError('global', e);
      prev(e, fatal);
    });
  }
  if (ReactNative.Platform.OS === 'web' && g.addEventListener) {
    g.addEventListener('error', (ev) => {
      if (ev.error instanceof Error && isAppStack(ev.error.stack)) reportError('global', ev.error);
    });
    g.addEventListener('unhandledrejection', (ev) => {
      if (ev.reason instanceof Error && isAppStack(ev.reason.stack)) reportError('promise', ev.reason);
    });
  }
}

// ---- console -----------------------------------------------------------------------

const LEVELS: history.LogLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

const appConsole: Record<string, unknown> = { ...console };
for (const level of LEVELS) {
  appConsole[level] = (...args: unknown[]) => {
    history.record({ type: 'log', level, text: formatArgs(args) });
    // Mirror to Metro in dev, as plain logs so LogBox doesn't pop up for
    // warnings that belong to the generated app.
    if (__DEV__) console.log(`[app:${level}]`, ...args);
  };
}
appConsole.trace = appConsole.debug;

// ---- network -----------------------------------------------------------------------

function redactUrl(url: string): string {
  return truncate(
    url.replace(/([?&](?:[^=&]*(?:key|token|secret|auth|password|sig)[^=&]*)=)[^&#]*/gi, '$1…'),
    240,
  );
}

const baseFetch: typeof fetch = (...a) => globalThis.fetch(...a);

const appFetch: typeof fetch = (input, init) => {
  const req = input as { url?: string; method?: string };
  const url = typeof input === 'string' ? input : (req.url ?? String(input));
  const method = (init?.method ?? req.method ?? 'GET').toUpperCase();
  const start = Date.now();
  return baseFetch(input, init).then(
    (res) => {
      const ms = Date.now() - start;
      const ev = history.record({
        type: 'network',
        text: `${method} ${redactUrl(url)} → ${res.status}`,
        status: res.status,
        ms,
      });
      // Error bodies are the most useful thing when an API call fails.
      if (ev && res.status >= 400) {
        res
          .clone()
          .text()
          .then((t) => history.annotate(ev.id, { detail: truncate(t, 500) }))
          .catch(() => {});
      }
      return res;
    },
    (err: unknown) => {
      history.record({
        type: 'network',
        text: `${method} ${redactUrl(url)} ✕ ${errorParts(err).message}`,
        ms: Date.now() - start,
      });
      throw err;
    },
  );
};

const BaseXHR = globalThis.XMLHttpRequest;
const AppXHR = BaseXHR
  ? class extends BaseXHR {
      private debugMethod = 'GET';
      private debugUrl = '';
      open(method: string, url: string | URL, ...rest: unknown[]): void {
        this.debugMethod = method.toUpperCase();
        this.debugUrl = String(url);
        return (super.open as (...a: unknown[]) => void)(method, url, ...rest);
      }
      send(body?: Document | XMLHttpRequestBodyInit | null): void {
        const start = Date.now();
        this.addEventListener('loadend', () => {
          const failed = this.status === 0;
          history.record({
            type: 'network',
            text: `${this.debugMethod} ${redactUrl(this.debugUrl)} ${failed ? '✕ network error' : `→ ${this.status}`} (XHR)`,
            status: failed ? undefined : this.status,
            ms: Date.now() - start,
          });
        });
        return super.send(body);
      }
    }
  : undefined;

// ---- timers ------------------------------------------------------------------------

type Timer = (cb: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => unknown;

function wrapTimer(name: string, base: Timer): Timer {
  return (cb, ms, ...args) =>
    typeof cb === 'function'
      ? base(guarded(cb, 'timer', () => `in ${name} callback`), ms, ...args)
      : base(cb, ms, ...args);
}

let scopeCache: { names: string[]; values: unknown[] } | null = null;

/** Module-scope bindings for generated code (see resolver). */
export function moduleScope(): { names: string[]; values: unknown[] } {
  if (scopeCache) return scopeCache;
  const g = globalThis as unknown as Record<string, Timer>;
  const scope: Record<string, unknown> = {
    console: appConsole,
    fetch: appFetch,
    XMLHttpRequest: AppXHR ?? BaseXHR,
    setTimeout: wrapTimer('setTimeout', (...a) => g.setTimeout(...a)),
    setInterval: wrapTimer('setInterval', (...a) => g.setInterval(...a)),
    requestAnimationFrame: (cb: (t: number) => void) =>
      globalThis.requestAnimationFrame(guarded(cb, 'timer', () => 'in requestAnimationFrame callback')),
  };
  scopeCache = { names: Object.keys(scope), values: Object.values(scope) };
  return scopeCache;
}

// ---- labels ------------------------------------------------------------------------

function elementName(el: React.ReactElement): string {
  const t = el.type as unknown;
  if (typeof t === 'string') return t;
  const c = t as { displayName?: string; name?: string; render?: { name?: string } };
  return c?.displayName || c?.name || c?.render?.name || 'Component';
}

/** Text children flattened, plus icon names, without rendering anything. */
export function textOf(node: unknown, depth = 0): string {
  if (depth > 8 || node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) {
    return node
      .map((n) => textOf(n, depth + 1))
      .filter(Boolean)
      .join(' ');
  }
  if (React.isValidElement(node)) {
    const p = node.props as Record<string, unknown>;
    if (typeof p.accessibilityLabel === 'string') return p.accessibilityLabel;
    const inner = textOf(p.children, depth + 1);
    if (inner) return inner;
    // @expo/vector-icons: <Ionicons name="add" />
    if (typeof p.name === 'string') return `[icon ${p.name}]`;
    if (typeof p.placeholder === 'string') return p.placeholder;
  }
  return '';
}

function labelFor(props: Record<string, unknown>): string {
  const direct = [props.accessibilityLabel, props['aria-label'], props.title, props.testID].find(
    (v) => typeof v === 'string' && v,
  ) as string | undefined;
  let label = direct ?? '';
  if (!label) {
    const children = props.children;
    if (typeof children === 'function') {
      // Pressable's render-prop children.
      try {
        label = textOf((children as (s: object) => unknown)({ pressed: false, hovered: false }));
      } catch {}
    } else {
      label = textOf(children);
    }
  }
  if (!label && typeof props.placeholder === 'string') label = props.placeholder;
  return truncate(label.replace(/\s+/g, ' ').trim(), 60);
}

// ---- UI registry (get_ui_tree, tap hit-testing) ----------------------------------------

type Measurable = {
  measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void;
};

type Registered = { name: string; props: React.RefObject<Record<string, unknown>>; node: Measurable };

const registry = new Map<number, Registered>();
let nextKey = 1;

const InText = React.createContext(false);

function useRegistered(
  name: string,
  props: React.RefObject<Record<string, unknown>>,
  forwarded: React.Ref<unknown>,
  enabled: boolean,
): (node: unknown) => void {
  const key = React.useRef(0);
  if (!key.current) key.current = nextKey++;
  React.useEffect(() => () => void registry.delete(key.current), []);
  return React.useCallback(
    (node: unknown) => {
      if (typeof forwarded === 'function') forwarded(node);
      else if (forwarded && typeof forwarded === 'object') (forwarded as React.RefObject<unknown>).current = node;
      if (node && enabled && typeof (node as Measurable).measureInWindow === 'function') {
        registry.set(key.current, { name, props, node: node as Measurable });
      } else {
        registry.delete(key.current);
      }
    },
    [forwarded, name, props, enabled],
  );
}

type Frame = { x: number; y: number; w: number; h: number };

function measure(node: Measurable): Promise<Frame | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 500);
    try {
      node.measureInWindow!((x, y, w, h) => {
        clearTimeout(timer);
        resolve(Number.isFinite(x) && w > 0 && h > 0 ? { x, y, w, h } : null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

let appContainer: Measurable | null = null;

/** The generated app's root view; frames are reported relative to it. */
export function setAppContainer(node: unknown): void {
  appContainer = (node as Measurable) ?? null;
}

export async function appFrame(): Promise<Frame | null> {
  return appContainer?.measureInWindow ? measure(appContainer) : null;
}

type UiNode = { kind: string; name: string; label: string; extra: string; frame: Frame };

async function snapshotUi(): Promise<{ root: Frame | null; nodes: UiNode[] }> {
  const root = await appFrame();
  const entries = [...registry.values()];
  const frames = await Promise.all(entries.map((e) => measure(e.node)));
  const nodes: UiNode[] = [];
  entries.forEach((e, i) => {
    const f = frames[i];
    if (!f) return;
    const frame = root ? { ...f, x: f.x - root.x, y: f.y - root.y } : f;
    if (root && (frame.x + frame.w <= 0 || frame.y + frame.h <= 0 || frame.x >= root.w || frame.y >= root.h)) return;
    const p = e.props.current ?? {};
    const kind = KIND[e.name] ?? 'view';
    let extra = '';
    if (e.name === 'TextInput') {
      const value = typeof p.value === 'string' ? p.value : typeof p.defaultValue === 'string' ? p.defaultValue : '';
      extra = value ? ` value="${truncate(value, 40)}"` : ' (empty)';
    }
    if (e.name === 'Switch') extra = ` ${p.value ? 'on' : 'off'}`;
    if (p.disabled) extra += ' disabled';
    if (e.name === 'Text' && typeof p.onPress === 'function') extra += ' tappable';
    const label = e.name === 'Text' ? truncate(textOf(p.children).replace(/\s+/g, ' ').trim(), 80) : labelFor(p);
    if (e.name === 'Text' && !label) return;
    nodes.push({ kind, name: e.name, label, extra, frame });
  });
  nodes.sort((a, b) => a.frame.y - b.frame.y || a.frame.x - b.frame.x);
  return { root, nodes };
}

const KIND: Record<string, string> = {
  Pressable: 'button',
  TouchableOpacity: 'button',
  TouchableHighlight: 'button',
  Button: 'button',
  TextInput: 'input',
  Switch: 'switch',
  Text: 'text',
};

/** Compact, top-to-bottom dump of what the instrumented components rendered. */
export async function describeUi(maxLines = 120): Promise<string> {
  const { root, nodes } = await snapshotUi();
  const r = (n: number) => Math.round(n);
  const head = root ? `App view ${r(root.w)}×${r(root.h)} pt. Frames are x,y w×h in points from its top-left.` : 'App view not mounted.';
  if (!nodes.length) {
    return `${head}\n(no text, buttons or inputs on screen; the app may be blank, still loading, or drawing only Views/Images/SVG)`;
  }
  const buttons = nodes.filter((n) => n.kind === 'button').length;
  const lines = nodes.slice(0, maxLines).map((n) => {
    const f = n.frame;
    const name = n.kind === 'button' && n.name !== 'Pressable' ? ` (${n.name})` : '';
    return `${n.kind.padEnd(6)} "${n.label}"${name}${n.extra}  ${r(f.x)},${r(f.y)} ${r(f.w)}×${r(f.h)}`;
  });
  if (nodes.length > maxLines) lines.push(`… ${nodes.length - maxLines} more`);
  return `${head} ${nodes.length} elements, ${buttons} tappable.\n${lines.join('\n')}`;
}

/** What's drawn at a point in the app view, innermost first, for unhandled taps. */
export async function hitTest(x: number, y: number): Promise<string | null> {
  const { nodes } = await snapshotUi();
  const hits = nodes
    .filter((n) => x >= n.frame.x && x <= n.frame.x + n.frame.w && y >= n.frame.y && y <= n.frame.y + n.frame.h)
    .sort((a, b) => a.frame.w * a.frame.h - b.frame.w * b.frame.h);
  const top = hits[0];
  return top ? `${top.kind} "${top.label}"` : null;
}

// ---- touch correlation ------------------------------------------------------------------

let lastTapAt = 0;
let lastTapId: number | null = null;

export function lastTap(): { at: number; id: number | null } {
  return { at: lastTapAt, id: lastTapId };
}

function noteTap(ev: history.HistoryEvent | null): void {
  lastTapAt = Date.now();
  lastTapId = ev?.id ?? null;
}

// ---- wrapped react-native components ------------------------------------------------------

type HandlerSpec = {
  // Recorded when the app passed this prop.
  record?: Record<string, string>;
  // Recorded even when the app didn't pass the prop (we attach our own).
  always?: Record<string, string>;
};

function describeValue(prop: string, args: unknown[]): string {
  if (prop === 'onValueChange') return ` → ${fmt(args[0], 1, new Set())}`;
  return '';
}

function wrapComponent(Base: React.ComponentType<any>, name: string, spec: HandlerSpec) {
  const keys = { ...spec.record, ...spec.always };
  const Wrapped = React.forwardRef<unknown, Record<string, unknown>>(function Instrumented(props, ref) {
    const propsRef = React.useRef(props);
    propsRef.current = props;
    const inText = React.useContext(InText);
    const isText = name === 'Text';
    const setRef = useRegistered(name, propsRef, ref, !(isText && inText));

    // Rebuilt only when the set of handlers the app passes changes, so normal
    // re-renders do no extra work.
    let present = '';
    for (const k in keys) if (typeof props[k] === 'function' || spec.always?.[k]) present += k + ',';
    const handlers = React.useMemo(() => {
      const out: Record<string, (...a: unknown[]) => unknown> = {};
      for (const k of present.split(',').filter(Boolean)) {
        const verb = keys[k];
        out[k] = (...args: unknown[]) => {
          const p = propsRef.current;
          const label = labelFor(p);
          const ev = history.record({
            type: 'tap',
            source: name,
            text: `${verb} ${name}${label ? ` "${label}"` : ''}${describeValue(k, args)}`,
          });
          noteTap(ev);
          const fn = p[k];
          if (typeof fn !== 'function') return undefined;
          return guarded(fn as (...a: unknown[]) => unknown, 'handler', () => `in ${k} of ${name}${label ? ` "${label}"` : ''}`)(...args);
        };
      }
      return out;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [present]);

    const el = React.createElement(Base, { ...props, ...handlers, ref: setRef });
    return isText && !inText ? React.createElement(InText.Provider, { value: true }, el) : el;
  });
  Wrapped.displayName = name;
  // Keep statics such as TextInput.State.
  for (const k of Object.keys(Base)) {
    if (k in Wrapped || k === 'displayName' || k === 'propTypes') continue;
    try {
      (Wrapped as unknown as Record<string, unknown>)[k] = (Base as unknown as Record<string, unknown>)[k];
    } catch {}
  }
  return Wrapped;
}

const PRESS: HandlerSpec = { record: { onPress: 'tap', onLongPress: 'long-press' } };

let instrumentedRN: Record<string, unknown> | null = null;

/** react-native as generated code sees it. Built lazily, once. */
export function instrumentedReactNative(): Record<string, unknown> {
  if (instrumentedRN) return instrumentedRN;
  const RN = ReactNative as unknown as Record<string, any>;
  const wrapped: Record<string, unknown> = {
    Pressable: wrapComponent(RN.Pressable, 'Pressable', PRESS),
    TouchableOpacity: wrapComponent(RN.TouchableOpacity, 'TouchableOpacity', PRESS),
    TouchableHighlight: wrapComponent(RN.TouchableHighlight, 'TouchableHighlight', PRESS),
    TouchableWithoutFeedback: wrapComponent(RN.TouchableWithoutFeedback, 'TouchableWithoutFeedback', PRESS),
    Button: wrapComponent(RN.Button, 'Button', { record: { onPress: 'tap' } }),
    Switch: wrapComponent(RN.Switch, 'Switch', { record: { onValueChange: 'toggle' } }),
    TextInput: wrapComponent(RN.TextInput, 'TextInput', {
      always: { onFocus: 'focus', onSubmitEditing: 'submit' },
    }),
    Text: wrapComponent(RN.Text, 'Text', PRESS),
  };
  const out: Record<string, unknown> = {};
  // Getters, so RN's lazy (and deprecated) exports aren't evaluated up front.
  for (const key of Object.getOwnPropertyNames(RN)) {
    if (key in wrapped) continue;
    Object.defineProperty(out, key, { enumerable: true, configurable: true, get: () => RN[key] });
  }
  Object.assign(out, wrapped);
  instrumentedRN = out;
  return out;
}

// ---- expo-sensors ------------------------------------------------------------------

let instrumentedSensorsCache: Record<string, unknown> | null = null;

/**
 * expo-sensors as generated code sees it: listener callbacks (sensor updates,
 * step counts) report thrown errors to the history like timer callbacks do,
 * instead of dying silently inside the native event emitter.
 */
export function instrumentedSensors(mod: Record<string, any>): Record<string, unknown> {
  if (instrumentedSensorsCache) return instrumentedSensorsCache;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(mod)) {
    const real = mod[key];
    if (real && typeof real === 'object' && typeof real.addListener === 'function') {
      out[key] = new Proxy(real, {
        get(target, prop) {
          if (prop === 'addListener') {
            return (listener: (...a: unknown[]) => void) =>
              target.addListener(guarded(listener, 'sensor', () => `in ${key} listener`));
          }
          const v = Reflect.get(target, prop);
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    } else {
      out[key] = real;
    }
  }
  // Pedometer is a namespace of functions rather than a sensor object.
  const pedometer = mod.Pedometer as Record<string, any> | undefined;
  if (pedometer && typeof pedometer.watchStepCount === 'function') {
    out.Pedometer = Object.freeze({
      ...pedometer,
      watchStepCount: (cb: (...a: unknown[]) => void) =>
        pedometer.watchStepCount(guarded(cb, 'sensor', () => 'in Pedometer.watchStepCount callback')),
    });
  }
  instrumentedSensorsCache = Object.freeze(out);
  return instrumentedSensorsCache;
}

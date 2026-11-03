import { appKeyPrefix, LEGACY_APP_DATA_MIGRATION_FLAG } from '../storage/namespaces';
import { createScopedAsyncStorage, removeAppKeys, type KVBackend } from './asyncStorage';
import { __test, scopedWebStorage, sandboxScope } from './globals';
import { migrateLegacyAppData } from './migrate';
import { checkSql, scopedDbName } from './sqlite';

// Dev-only checks for the sandbox, against in-memory stores (no test runner
// in this repo). Runs once in __DEV__ when the first sandbox is built; the
// result is logged as `[sandbox] self-test …`.

function memoryKV(seed: Record<string, string> = {}, failAfterWrites = Infinity) {
  const m = new Map(Object.entries(seed));
  let writes = 0;
  const write = () => {
    if (++writes > failAfterWrites) throw new Error('simulated crash');
  };
  const kv: KVBackend = {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => {
      write();
      m.set(k, v);
    },
    removeItem: async (k) => {
      write();
      m.delete(k);
    },
    mergeItem: async (k, v) => {
      write();
      m.set(k, JSON.stringify({ ...JSON.parse(m.get(k) ?? '{}'), ...JSON.parse(v) }));
    },
    multiGet: async (ks) => ks.map((k) => [k, m.get(k) ?? null] as [string, string | null]),
    multiSet: async (ps) => {
      write();
      ps.forEach(([k, v]) => m.set(k, v));
    },
    multiRemove: async (ks) => {
      write();
      ks.forEach((k) => m.delete(k));
    },
    multiMerge: async (ps) => {
      for (const [k, v] of ps) await kv.mergeItem(k, v);
    },
    getAllKeys: async () => [...m.keys()],
  };
  return { kv, m };
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
}

export async function runSandboxSelfTest(): Promise<{ passed: number; failures: string[] }> {
  let passed = 0;
  const failures: string[] = [];
  const eq = (name: string, actual: unknown, expected: unknown) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) passed++;
    else failures.push(`${name}: expected ${e}, got ${a}`);
  };
  const throws = (name: string, fn: () => unknown) => {
    try {
      fn();
      failures.push(`${name}: did not throw`);
    } catch {
      passed++;
    }
  };

  // -- scoped AsyncStorage
  {
    const { kv, m } = memoryKV({ 'blank-slate.openrouter-key': 'sk-secret', 'projects:index': '[]' });
    const a = createScopedAsyncStorage('A', kv);
    const b = createScopedAsyncStorage('B', kv);
    await a.setItem('notes', 'from A');
    await b.setItem('notes', 'from B');
    eq('A reads own notes', await a.getItem('notes'), 'from A');
    eq('B reads own notes', await b.getItem('notes'), 'from B');
    eq('A cannot read the API key', await a.getItem('blank-slate.openrouter-key'), null);
    eq('real key layout', m.get('app:A:notes'), 'from A');
    await a.multiSet([['x', '1'], ['y', '2']]);
    eq('getAllKeys is own + stripped', [...(await a.getAllKeys())].sort(), ['notes', 'x', 'y']);
    eq('multiGet strips', await a.multiGet(['x', 'nope']), [['x', '1'], ['nope', null]]);
    await a.setItem('obj', '{"p":1}');
    await a.mergeItem('obj', '{"q":2}');
    eq('mergeItem', JSON.parse((await a.getItem('obj'))!), { p: 1, q: 2 });
    eq('default export is the same API', await a.default.getItem('x'), '1');
    eq('useAsyncStorage', await a.useAsyncStorage('y').getItem(), '2');
    await a.multiRemove(['x']);
    eq('multiRemove', await a.getItem('x'), null);
    await a.clear();
    eq('clear only clears own keys', [...(await a.getAllKeys())], []);
    eq('clear leaves other apps', await b.getItem('notes'), 'from B');
    eq('clear leaves Blank Slate', m.get('blank-slate.openrouter-key'), 'sk-secret');
    eq('frozen', Object.isFrozen(a) && Object.isFrozen(a.default), true);
    let cbResult: unknown;
    await b.getItem('notes', (_e, r) => (cbResult = r));
    eq('callback API', cbResult, 'from B');
    await removeAppKeys('B', kv);
    eq('removeAppKeys', await b.getItem('notes'), null);
  }

  // -- migration
  {
    const seed = {
      'projects:index': '[]',
      'project:A:vfs:index': '[]',
      'blank-slate.openrouter-key': 'sk-secret',
      'agent:inputModalities': '{}',
      EXPO_CONSTANTS_INSTALLATION_ID: 'x',
      notes: 'shared',
      'app:settings': 'legacy key that looks namespaced',
    };
    const { kv, m } = memoryKV(seed);
    const { moved } = await migrateLegacyAppData(['A', 'B'], kv);
    eq('migration moved legacy keys only', [...moved].sort(), ['app:settings', 'notes']);
    eq('copied to A', m.get('app:A:notes'), 'shared');
    eq('copied to B', m.get('app:B:notes'), 'shared');
    eq('copied odd key', m.get('app:B:app:settings'), 'legacy key that looks namespaced');
    eq('original removed', m.has('notes'), false);
    eq('Blank Slate keys untouched', m.get('blank-slate.openrouter-key'), 'sk-secret');
    eq('third-party key untouched', m.get('EXPO_CONSTANTS_INSTALLATION_ID'), 'x');
    eq('flag set', m.get(LEGACY_APP_DATA_MIGRATION_FLAG), 'done');
    await kv.setItem('late', 'v');
    eq('runs once', (await migrateLegacyAppData(['A', 'B'], kv)).moved, []);

    // Crash after copying into A but before B / before deleting originals.
    const crashing = memoryKV({ notes: 'shared', todo: '[1]' }, 1);
    await migrateLegacyAppData(['A', 'B'], crashing.kv).catch(() => {});
    eq('crash left originals', crashing.m.get('notes'), 'shared');
    eq('crash left no flag', crashing.m.has(LEGACY_APP_DATA_MIGRATION_FLAG), false);
    const resumed = memoryKV(Object.fromEntries(crashing.m));
    await migrateLegacyAppData(['A', 'B'], resumed.kv);
    eq('resume: A', resumed.m.get(`${appKeyPrefix('A')}todo`), '[1]');
    eq('resume: B', resumed.m.get(`${appKeyPrefix('B')}notes`), 'shared');
    eq('resume: originals gone', resumed.m.has('notes') || resumed.m.has('todo'), false);
  }

  // -- SQLite names and SQL
  {
    eq('db name scoped', scopedDbName('A', 'notes.db'), 'app_A__notes.db');
    eq(':memory: untouched', scopedDbName('A', ':memory:'), ':memory:');
    throws('rejects ..', () => scopedDbName('A', '../app_B__notes.db'));
    throws('rejects absolute', () => scopedDbName('A', '/etc/passwd'));
    throws('rejects subdir', () => scopedDbName('A', 'x/y.db'));
    throws('rejects file: URI', () => scopedDbName('A', 'file:x.db?mode=ro'));
    throws('rejects empty', () => scopedDbName('A', ''));
    throws('rejects ATTACH', () => checkSql("ATTACH DATABASE '/x/app_B__notes.db' AS b"));
    throws('rejects VACUUM INTO', () => checkSql("VACUUM INTO '/tmp/x.db'"));
    eq('allows normal SQL', (checkSql('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)'), true), true);
  }

  // -- web storage shim and shadowed globals
  {
    const real = memoryStorage();
    real.setItem('blank-slate.openrouter-key', 'sk-secret');
    const a = scopedWebStorage(real, 'app:A:');
    const b = scopedWebStorage(real, 'app:B:');
    a.setItem('notes', 'A');
    (b as unknown as Record<string, string>).notes = 'B';
    eq('localStorage scoped', [a.getItem('notes'), b.getItem('notes')], ['A', 'B']);
    eq('localStorage hides key', a.getItem('blank-slate.openrouter-key'), null);
    eq('localStorage length/key', [a.length, a.key(0)], [1, 'notes']);
    eq('Object.keys(localStorage)', Object.keys(b), ['notes']);
    a.clear();
    eq('localStorage clear scoped', [a.length, b.getItem('notes')], [0, 'B']);

    // Electron's contextBridge makes `blankSlateDesktop` read-only and
    // non-configurable; hiding such a property must not throw.
    const fakeWindow = {} as Record<string, unknown>;
    Object.defineProperty(fakeWindow, 'bridge', { value: { secret: 1 }, writable: false, configurable: false, enumerable: true });
    fakeWindow.other = 2;
    const shadowed = __test.shadow(fakeWindow, () => ({ bridge: undefined }));
    eq('hides non-configurable prop', [shadowed.bridge, 'bridge' in shadowed, Object.keys(shadowed)], [undefined, false, ['other']]);
    eq('forwards the rest', shadowed.other, 2);

    const g = globalThis as Record<string, unknown>;
    const had = 'blankSlateDesktop' in g;
    const prev = g.blankSlateDesktop;
    g.blankSlateDesktop = { claimSecureStore: () => null };
    try {
      const scope = sandboxScope('A');
      const get = (n: string) => scope.values[scope.names.indexOf(n)] as Record<string, unknown>;
      eq('blankSlateDesktop hidden', get('blankSlateDesktop'), undefined);
      eq('window.blankSlateDesktop hidden', get('window').blankSlateDesktop, undefined);
      eq("'blankSlateDesktop' in window", 'blankSlateDesktop' in get('window'), false);
      eq('globalThis.globalThis is shadowed', get('globalThis').globalThis === get('window'), true);
      eq('Metro require hidden', get('window').__r, undefined);
      eq('window still works', typeof (get('window').setTimeout as unknown), 'function');
    } finally {
      if (had) g.blankSlateDesktop = prev;
      else delete g.blankSlateDesktop;
    }
  }

  return { passed, failures };
}

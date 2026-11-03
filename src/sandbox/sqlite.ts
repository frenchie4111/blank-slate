import * as React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { fs } from '../debug/nativeModules';
import { sqlitePrefix, sqliteRegistryKey } from '../storage/namespaces';

// expo-sqlite as a generated app sees it. Database names are rewritten to
// `app_<projectId>__<name>` in the default directory; custom directories,
// paths, ATTACH, VACUUM INTO and native extensions are refused, so an app
// can't open another app's file by name or path.

const NAME_RE = /^[A-Za-z0-9 _.\-]{1,100}$/;

export function scopedDbName(projectId: string, name: unknown): string {
  if (name === ':memory:') return name;
  if (typeof name !== 'string' || !NAME_RE.test(name) || name.includes('..') || name.startsWith('.')) {
    throw new Error(
      `Invalid database name ${JSON.stringify(name)}. Use a plain file name like "notes.db" ` +
        `(letters, digits, space, _ . -; no paths).`,
    );
  }
  return sqlitePrefix(projectId) + name;
}

function noDirectory(directory: unknown): void {
  if (directory !== undefined && directory !== null) {
    throw new Error("Custom SQLite directories aren't available. Omit the directory argument.");
  }
}

// ATTACH reaches any file by path; VACUUM INTO writes one anywhere.
const FORBIDDEN_SQL = /\bATTACH\b|\bVACUUM\b[\s\S]*?\bINTO\b/i;

export function checkSql(sql: unknown): void {
  if (typeof sql === 'string' && FORBIDDEN_SQL.test(sql)) {
    throw new Error('ATTACH and VACUUM INTO are not available. Each app has its own private databases.');
  }
}

const SQL_METHOD = /^(exec|run|getFirst|getAll|getEach|prepare)(Async|Sync)$/;

const wrapped = new WeakMap<object, object>();
const unwrapped = new WeakMap<object, object>();

function wrapDb<T extends object>(db: T): T {
  if (!db || typeof db !== 'object') return db;
  const hit = wrapped.get(db);
  if (hit) return hit as T;
  const proxy = new Proxy(db, {
    get(target, prop) {
      const v = Reflect.get(target, prop);
      if (typeof v !== 'function' || typeof prop !== 'string') return v;
      if (prop.startsWith('loadExtension')) {
        return () => {
          throw new Error('SQLite extensions are not available.');
        };
      }
      if (SQL_METHOD.test(prop)) {
        return (sql: unknown, ...rest: unknown[]) => {
          checkSql(sql);
          return v.call(target, sql, ...rest);
        };
      }
      if (prop === 'withExclusiveTransactionAsync') {
        return (task: (txn: object) => Promise<void>) => v.call(target, (txn: object) => task(wrapDb(txn)));
      }
      return v.bind(target);
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value);
    },
  });
  wrapped.set(db, proxy);
  unwrapped.set(proxy, db);
  return proxy as T;
}

function unwrapDb<T>(db: T): T {
  return ((db && typeof db === 'object' && unwrapped.get(db as object)) ?? db) as T;
}

// ---- bookkeeping, for cleanup on delete ---------------------------------------------

const knownNames = new Map<string, Set<string>>();
const openHandles = new Map<string, Set<{ closeAsync?: () => Promise<void> }>>();

async function readRegistry(projectId: string): Promise<string[]> {
  try {
    const parsed = JSON.parse((await AsyncStorage.getItem(sqliteRegistryKey(projectId))) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function noteName(projectId: string, scoped: string): void {
  if (scoped === ':memory:') return;
  let set = knownNames.get(projectId);
  if (!set) knownNames.set(projectId, (set = new Set()));
  if (set.has(scoped)) return;
  set.add(scoped);
  readRegistry(projectId)
    .then((names) =>
      names.includes(scoped)
        ? undefined
        : AsyncStorage.setItem(sqliteRegistryKey(projectId), JSON.stringify([...names, scoped])),
    )
    .catch(() => {});
}

function noteHandle(projectId: string, db: { closeAsync?: () => Promise<void> }): void {
  let set = openHandles.get(projectId);
  if (!set) openHandles.set(projectId, (set = new Set()));
  set.add(db);
}

/** Closes and deletes every database the app created. */
export async function removeAppDatabases(projectId: string): Promise<void> {
  for (const db of openHandles.get(projectId) ?? []) await db.closeAsync?.().catch(() => {});
  openHandles.delete(projectId);
  const names = new Set([...(await readRegistry(projectId)), ...(knownNames.get(projectId) ?? [])]);
  knownNames.delete(projectId);
  for (const name of names) await SQLite.deleteDatabaseAsync(name).catch(() => {});
  // Native: also sweep the directory for anything the registry missed
  // (e.g. -wal/-shm files, or a write interrupted before it was recorded).
  if (fs?.documentDirectory) {
    const dir = `${fs.documentDirectory}SQLite/`;
    try {
      const files = await fs.readDirectoryAsync(dir);
      const prefix = sqlitePrefix(projectId);
      for (const f of files) {
        if (f.startsWith(prefix)) await fs.deleteAsync(dir + f, { idempotent: true });
      }
    } catch {}
  }
  await AsyncStorage.removeItem(sqliteRegistryKey(projectId));
}

// ---- the module ---------------------------------------------------------------------

type ProviderProps = React.ComponentProps<typeof SQLite.SQLiteProvider>;

export function createScopedSQLite(projectId: string) {
  const name = (n: unknown) => {
    const scoped = scopedDbName(projectId, n);
    noteName(projectId, scoped);
    return scoped;
  };
  const prefix = sqlitePrefix(projectId);

  function SQLiteProvider(props: ProviderProps) {
    const { databaseName, directory, onInit, ...rest } = props;
    noDirectory(directory);
    const scoped = name(databaseName);
    const scopedOnInit = React.useMemo(
      () => (onInit ? (db: SQLite.SQLiteDatabase) => onInit(wrapDb(db)) : undefined),
      [onInit],
    );
    return React.createElement(SQLite.SQLiteProvider, {
      ...rest,
      databaseName: scoped,
      ...(scopedOnInit ? { onInit: scopedOnInit } : {}),
    });
  }

  const mod = {
    __esModule: true,
    SQLiteDatabase: SQLite.SQLiteDatabase,
    SQLiteStatement: SQLite.SQLiteStatement,
    SQLiteSession: SQLite.SQLiteSession,
    defaultDatabaseDirectory: SQLite.defaultDatabaseDirectory,
    async openDatabaseAsync(n: string, options?: SQLite.SQLiteOpenOptions, directory?: string) {
      noDirectory(directory);
      const db = await SQLite.openDatabaseAsync(name(n), options);
      noteHandle(projectId, db);
      return wrapDb(db);
    },
    openDatabaseSync(n: string, options?: SQLite.SQLiteOpenOptions, directory?: string) {
      noDirectory(directory);
      const db = SQLite.openDatabaseSync(name(n), options);
      noteHandle(projectId, db);
      return wrapDb(db);
    },
    deleteDatabaseAsync(n: string, directory?: string) {
      noDirectory(directory);
      return SQLite.deleteDatabaseAsync(scopedDbName(projectId, n));
    },
    deleteDatabaseSync(n: string, directory?: string) {
      noDirectory(directory);
      return SQLite.deleteDatabaseSync(scopedDbName(projectId, n));
    },
    async deserializeDatabaseAsync(data: Uint8Array, options?: SQLite.SQLiteOpenOptions) {
      return wrapDb(await SQLite.deserializeDatabaseAsync(data, options));
    },
    deserializeDatabaseSync(data: Uint8Array, options?: SQLite.SQLiteOpenOptions) {
      return wrapDb(SQLite.deserializeDatabaseSync(data, options));
    },
    backupDatabaseAsync(o: Parameters<typeof SQLite.backupDatabaseAsync>[0]) {
      return SQLite.backupDatabaseAsync({
        ...o,
        sourceDatabase: unwrapDb(o.sourceDatabase),
        destDatabase: unwrapDb(o.destDatabase),
      });
    },
    backupDatabaseSync(o: Parameters<typeof SQLite.backupDatabaseSync>[0]) {
      return SQLite.backupDatabaseSync({
        ...o,
        sourceDatabase: unwrapDb(o.sourceDatabase),
        destDatabase: unwrapDb(o.destDatabase),
      });
    },
    // The native event is device-wide; only pass on this app's databases.
    addDatabaseChangeListener(listener: (e: SQLite.DatabaseChangeEvent) => void) {
      return SQLite.addDatabaseChangeListener((e) => {
        const file = e.databaseFilePath.split('/').pop() ?? '';
        if (file.startsWith(prefix)) listener(e);
      });
    },
    importDatabaseFromAssetAsync(n: string, asset: SQLite.SQLiteProviderAssetSource, directory?: string) {
      noDirectory(directory);
      return SQLite.importDatabaseFromAssetAsync(name(n), asset);
    },
    SQLiteProvider,
    useSQLiteContext: () => wrapDb(SQLite.useSQLiteContext()),
  };
  return Object.freeze({ ...mod, default: Object.freeze({ ...mod }) });
}

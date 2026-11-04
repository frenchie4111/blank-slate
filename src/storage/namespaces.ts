// Every AsyncStorage key in the device-wide store belongs to exactly one of:
//
//   1. Blank Slate itself. Prefixes below; keep this list in sync when adding
//      a new key anywhere in src/.
//   2. A generated app: `app:<projectId>:<key>`. Generated code never sees the
//      prefix; src/sandbox/asyncStorage.ts adds and strips it. On web the same
//      prefix is used for the scoped localStorage/sessionStorage shims, since
//      AsyncStorage *is* localStorage there.
//   3. Third-party libraries sharing the web origin's localStorage (Expo dev
//      tools etc.). Left alone.
//
// Anything else is legacy app data from before per-app sandboxing, which
// src/sandbox/migrate.ts moves into each project's namespace once.

export const BLANK_SLATE_KEY_PREFIXES = [
  // Project index and current project (src/project/store.ts).
  'projects:',
  // Per-project VFS, chat history/entries, debug history and screenshots,
  // SQLite database registry (store.ts, chatStore.ts, debug/history.ts,
  // sandbox/sqlite.ts).
  'project:',
  // Pre-projects VFS, migrated by store.ts into the first project.
  'vfs:',
  // API key (web only; SecureStore on iOS), legacy Anthropic key, model,
  // auto app icons, the old badge position, v1 source history
  // (storage/keyStore.ts, project/store.ts, storage/sourceStore.ts).
  'blank-slate.',
  // Model capability cache (agent/vision.ts).
  'agent:',
  // Sandbox bookkeeping, e.g. the migration flag below.
  'sandbox:',
] as const;

export const APP_KEY_ROOT = 'app:';

export function appKeyPrefix(projectId: string): string {
  return `${APP_KEY_ROOT}${projectId}:`;
}

// SQLite file names: `app_<projectId>__<name>`. Blank Slate has no databases
// of its own; any it adds later must not start with `app_`.
export function sqlitePrefix(projectId: string): string {
  return `app_${projectId}__`;
}

export function sqliteRegistryKey(projectId: string): string {
  return `project:${projectId}:sqlite:databases`;
}

export const LEGACY_APP_DATA_MIGRATION_FLAG = 'sandbox:legacy-app-data-migrated.v1';

export function isBlankSlateKey(key: string): boolean {
  return BLANK_SLATE_KEY_PREFIXES.some((p) => key.startsWith(p));
}

// Keys other libraries keep in the web origin's localStorage. Generated apps
// can't reach these after sandboxing; migration leaves them where they are.
const THIRD_PARTY_PATTERNS = [/^EXPO_/, /^expo[-_.:]/i, /^__/, /^debug$/, /^loglevel/, /^RCT/];

export function isThirdPartyKey(key: string): boolean {
  return THIRD_PARTY_PATTERNS.some((re) => re.test(key));
}

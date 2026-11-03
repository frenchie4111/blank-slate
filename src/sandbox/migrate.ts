import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  APP_KEY_ROOT,
  LEGACY_APP_DATA_MIGRATION_FLAG,
  appKeyPrefix,
  isBlankSlateKey,
  isThirdPartyKey,
} from '../storage/namespaces';
import type { KVBackend } from './asyncStorage';

const BATCH = 50;

/**
 * Before sandboxing, generated apps wrote straight into the shared store, so
 * every app saw every other app's keys. Copy each such key into *every*
 * project's namespace (keeping what each app saw unchanged), then delete the
 * original. Runs once.
 *
 * Interruption-safe: copying is an idempotent overwrite with the same value
 * and originals are only removed after their batch is copied everywhere, so a
 * rerun just finishes the remaining keys. Must complete before any generated
 * app runs (store.init awaits it).
 */
export async function migrateLegacyAppData(
  projectIds: string[],
  base: KVBackend = AsyncStorage,
): Promise<{ moved: string[] }> {
  if ((await base.getItem(LEGACY_APP_DATA_MIGRATION_FLAG)) === 'done') return { moved: [] };
  if (projectIds.length === 0) return { moved: [] };

  const prefixes = projectIds.map(appKeyPrefix);
  const legacy = (await base.getAllKeys()).filter(
    (k) =>
      !isBlankSlateKey(k) &&
      !isThirdPartyKey(k) &&
      // An app's own key could start with `app:`; only skip real namespaces.
      !(k.startsWith(APP_KEY_ROOT) && prefixes.some((p) => k.startsWith(p))),
  );

  for (let i = 0; i < legacy.length; i += BATCH) {
    const batch = legacy.slice(i, i + BATCH);
    const present = (await base.multiGet(batch)).filter(
      (pair): pair is [string, string] => pair[1] !== null,
    );
    for (const prefix of prefixes) {
      if (present.length) await base.multiSet(present.map(([k, v]) => [prefix + k, v] as [string, string]));
    }
    await base.multiRemove(batch);
  }

  await base.setItem(LEGACY_APP_DATA_MIGRATION_FLAG, 'done');
  return { moved: legacy };
}

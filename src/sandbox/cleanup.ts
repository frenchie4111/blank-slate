import { removeAppKeys } from './asyncStorage';
import { removeAppDatabases } from './sqlite';

// Kept apart from index.ts so the project store can import it without
// pulling in requireShim (and, through it, modules that import the store).

/** Removes everything a deleted app stored: AsyncStorage keys and databases. */
export async function removeAppData(projectId: string): Promise<void> {
  await Promise.all([
    removeAppKeys(projectId).catch(() => {}),
    removeAppDatabases(projectId).catch(() => {}),
  ]);
}

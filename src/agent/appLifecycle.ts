import { AppState, Platform } from 'react-native';

// iOS suspends a backgrounded app within seconds and may cut its sockets. A
// request that fails while we're away, or just after we're back, failed
// because the user left, not because of the network, and the chat says so.
// Web and the desktop shell keep running when hidden or minimised, so only
// native tracks this.

// A failure this soon after returning still counts: the dead socket often
// only reports once the app is running again.
const RETURN_GRACE_MS = 5_000;

let backgroundSince: number | null = null;
let lastBackgroundAt = 0;
let lastForegroundAt = 0;
const foregroundListeners = new Set<() => void>();

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    const now = Date.now();
    if (state === 'background') {
      if (backgroundSince === null) backgroundSince = now;
      lastBackgroundAt = now;
    } else if (state === 'active' && backgroundSince !== null) {
      backgroundSince = null;
      lastForegroundAt = now;
      foregroundListeners.forEach((l) => l());
    }
  });
}

/** Thrown when the user leaving the app is what ended a request. */
export class LeftAppError extends Error {}

/** Whether the app was backgrounded at some point since `since` and is either still away or only just back. */
export function leftAppSince(since: number): boolean {
  if (devSimulatesLeaving()) return true;
  if (backgroundSince !== null) return true;
  return lastBackgroundAt >= since && Date.now() - lastForegroundAt <= RETURN_GRACE_MS;
}

export function onReturnToForeground(listener: () => void): () => void {
  foregroundListeners.add(listener);
  return () => {
    foregroundListeners.delete(listener);
  };
}

// Dev only, web: ?left makes every failure count as the user having left, so
// the paused state can be seen without a device (pair with ?stall=drop).
function devSimulatesLeaving(): boolean {
  if (!__DEV__ || Platform.OS !== 'web' || typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).has('left');
}

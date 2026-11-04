import * as React from 'react';
import { Dimensions, useWindowDimensions, type ScaledSize } from 'react-native';
import { initialWindowMetrics, type EdgeInsets } from 'react-native-safe-area-context';

// The generated app lives in a viewport (the rounded pane above the dock, or
// beside the rail on desktop), not the whole window. Inside generated code,
// `useWindowDimensions()` and `Dimensions.get('window')` report that viewport
// (see instrumentedReactNative); Blank Slate's own code keeps the real ones.

type Size = { width: number; height: number };

let viewport: Size | null = null;
const listeners = new Set<() => void>();

/** Called by the viewport's onLayout; null when it unmounts. */
export function setViewportSize(next: Size | null): void {
  if (next === viewport || (next && viewport && next.width === viewport.width && next.height === viewport.height)) return;
  viewport = next;
  for (const fn of [...listeners]) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getViewport(): Size | null {
  return viewport;
}

function viewportWindow(): ScaledSize {
  const real = Dimensions.get('window');
  return viewport ? { ...real, width: viewport.width, height: viewport.height } : real;
}

// True inside a generated app's Modal, which covers the whole window.
export const FullWindowContext = React.createContext(false);

// The window's real safe-area insets, for that Modal: the app subtree itself
// sees the viewport's (bottom 0, the dock owns it).
export const HostInsetsContext = React.createContext<EdgeInsets | null>(null);

/** `useWindowDimensions` as generated code sees it. */
export function useAppWindowDimensions(): ScaledSize {
  const real = useWindowDimensions();
  const full = React.useContext(FullWindowContext);
  const size = React.useSyncExternalStore(subscribe, getViewport, getViewport);
  return React.useMemo(
    () => (full || !size ? real : { ...real, width: size.width, height: size.height }),
    [full, size, real],
  );
}

type DimensionsHandler = (dims: { window: ScaledSize; screen: ScaledSize }) => void;

/**
 * `Dimensions` as generated code sees it. `get('window')` can't know whether
 * it's called from inside a Modal, so it always reports the viewport.
 */
export const appDimensions = {
  get(dim: 'window' | 'screen'): ScaledSize {
    return dim === 'window' ? viewportWindow() : Dimensions.get(dim);
  },
  set(dims: Record<string, unknown>): void {
    Dimensions.set(dims as never);
  },
  addEventListener(type: 'change', handler: DimensionsHandler): { remove: () => void } {
    const fire = () => handler({ window: viewportWindow(), screen: Dimensions.get('screen') });
    // A window resize also resizes the viewport, which fires again; apps
    // only ever read the latest values, so the repeat is harmless.
    const sub = Dimensions.addEventListener(type, fire);
    const off = subscribe(fire);
    return {
      remove: () => {
        sub.remove();
        off();
      },
    };
  },
};

export const ZERO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export function realInsetsFallback(): EdgeInsets {
  return initialWindowMetrics?.insets ?? ZERO_INSETS;
}

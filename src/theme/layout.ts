import { useWindowDimensions } from 'react-native';
import { runtimePlatform } from '../platform/desktop';

// At or above this width in the desktop shell, Blank Slate lays out like a
// desktop app: chat in a sidebar, the generated app filling the rest. Below
// it, the phone layout. A plain browser keeps the phone layout, matching the
// web variant of the system prompt.
export const WIDE_MIN_WIDTH = 900;

export const SIDEBAR_WIDTH = 400;

// Forms and lists on full-window screens stop growing past this.
export const CONTENT_MAX_WIDTH = 720;

export function useWideLayout(): boolean {
  const { width } = useWindowDimensions();
  return runtimePlatform() === 'desktop' && width >= WIDE_MIN_WIDTH;
}

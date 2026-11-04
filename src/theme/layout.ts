import { useWindowDimensions } from 'react-native';
import { runtimePlatform } from '../platform/desktop';

// At or above this width on desktop or web, Blank Slate lays out like a
// desktop app: the dock as a rail down the left, the generated app, and the
// chat in a sidebar. Below it (and always on a phone), the phone layout with
// the dock along the bottom.
export const WIDE_MIN_WIDTH = 900;

export const SIDEBAR_WIDTH = 400;

// Forms and lists on full-window screens stop growing past this.
export const CONTENT_MAX_WIDTH = 720;

export function useWideLayout(): boolean {
  const { width } = useWindowDimensions();
  return runtimePlatform() !== 'native' && width >= WIDE_MIN_WIDTH;
}

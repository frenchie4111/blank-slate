import { Platform } from 'react-native';

// expo-file-system and react-native-view-shot are native modules added with
// the debug history. JS ships over the air, so an older dev client or store
// binary can run this code without them: load them defensively and degrade
// (history falls back to AsyncStorage, screenshots are just unavailable).

type FsModule = typeof import('expo-file-system/legacy');
type ViewShotModule = typeof import('react-native-view-shot');

function load<T>(get: () => T): T | null {
  try {
    return get();
  } catch {
    return null;
  }
}

export const fs: FsModule | null =
  Platform.OS === 'web' ? null : load(() => require('expo-file-system/legacy') as FsModule);

type CaptureRef = ViewShotModule['captureRef'];

// view-shot's own captureRef calls findNodeHandle, which RN Web doesn't
// support; its web implementation (html2canvas) takes the DOM node directly.
export const captureView: CaptureRef | null =
  Platform.OS === 'web'
    ? load(() => {
        const web = require('react-native-view-shot/src/RNViewShot.web').default as {
          captureRef: CaptureRef;
        };
        return web.captureRef;
      })
    : load(() => (require('react-native-view-shot') as ViewShotModule).captureRef);

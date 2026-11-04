import { PixelRatio, Platform } from 'react-native';
import * as history from './history';
import { appFrame } from './instrument';
import { captureView } from './nativeModules';

// Captures the generated app's view only (not the chat overlay on top of it):
// view-shot renders that view's own hierarchy. Downscaled JPEGs, ~600px wide.

const TARGET_WIDTH_PX = 600;
const QUALITY = 0.6;
const AUTO_MIN_GAP_MS = 2500;

let target: unknown = null;

export function setCaptureTarget(node: unknown): void {
  target = node;
}

export function screenshotsAvailable(): boolean {
  return !!captureView;
}

export const UNAVAILABLE_REASON =
  'Screenshots need a Blank Slate build that includes react-native-view-shot (rebuild the dev client).';

export type Capture =
  | { ok: true; event: history.HistoryEvent }
  | { ok: false; error: string };

let inFlight: Promise<Capture> | null = null;

export function captureApp(reason: string): Promise<Capture> {
  // One capture at a time; a second caller gets the same shot.
  if (inFlight) return inFlight;
  inFlight = doCapture(reason).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doCapture(reason: string): Promise<Capture> {
  if (!captureView) return { ok: false, error: UNAVAILABLE_REASON };
  if (!target) return { ok: false, error: 'The app view is not on screen (open the app first).' };
  const frame = await appFrame();
  if (!frame) return { ok: false, error: 'The app view has no size yet.' };
  // iOS renders at device scale, so the size is given in points.
  const scale = Platform.OS === 'web' ? 1 : PixelRatio.get();
  const widthPx = Math.min(TARGET_WIDTH_PX, Math.round(frame.w * scale));
  const heightPx = Math.round((frame.h / frame.w) * widthPx);
  try {
    // Native captures as base64 rather than a temp file: view-shot's temp
    // files live in tmp/, which expo-file-system's legacy API can't move from.
    const kind = Platform.OS === 'web' ? 'data-uri' : 'base64';
    const data = await captureView(target as never, {
      format: 'jpg',
      quality: QUALITY,
      width: widthPx / scale,
      height: heightPx / scale,
      result: kind,
    });
    const event = await history.addScreenshot({ kind, data }, widthPx, heightPx, reason);
    return event ? { ok: true, event } : { ok: false, error: 'Could not store the screenshot.' };
  } catch (e) {
    return { ok: false, error: `Capture failed: ${(e as Error).message}` };
  }
}

let lastAuto = 0;
let autoTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced background capture (after an agent turn, on errors). */
export function scheduleAutoCapture(reason: string, delayMs = 900): void {
  if (!captureView) return;
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    autoTimer = null;
    if (Date.now() - lastAuto < AUTO_MIN_GAP_MS) return;
    lastAuto = Date.now();
    void captureApp(reason);
  }, delayMs);
}

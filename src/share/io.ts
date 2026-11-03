import { Platform } from 'react-native';
import { fs } from '../debug/nativeModules';
import { base64ToBytes, bytesToBase64 } from './base64';
import {
  BUNDLE_EXTENSION,
  BUNDLE_MIME,
  BUNDLE_UTI,
  BundleError,
  MAX_TOTAL_BYTES,
  type BuiltBundle,
} from './bundle';

// Getting a .blankslate file out of and into Blank Slate on each platform.
// iOS: the share sheet out, the document picker or an opened file in. Web and
// the Electron shell: a download out (Electron shows its own save dialog for
// downloads), a file input or a drop in. Nothing here needs the desktop
// preload bridge.
//
// expo-sharing and expo-document-picker are native modules newer than some
// binaries this JS can reach over the air, so they're loaded on demand and a
// missing one becomes a "needs an update" message rather than a crash.

type SharingModule = typeof import('expo-sharing');
type PickerModule = typeof import('expo-document-picker');

export class ShareUnavailableError extends Error {}

function loadNative<T>(get: () => T, what: string): T {
  try {
    const mod = get();
    if (mod) return mod;
  } catch {}
  throw new ShareUnavailableError(`${what} needs a newer build of Blank Slate.`);
}

function tooLarge(): BundleError {
  return new BundleError(`The app file is larger than the ${MAX_TOTAL_BYTES / (1024 * 1024)} MB limit.`);
}

export const shareVerb = Platform.OS === 'web' ? 'Download' : 'Share';

/** Hands the bundle to the system: the share sheet on iOS, a download on web. */
export async function deliverBundle(bundle: BuiltBundle): Promise<void> {
  if (Platform.OS === 'web') {
    downloadOnWeb(bundle);
    return;
  }
  const Sharing = loadNative(() => require('expo-sharing') as SharingModule, 'Sharing');
  if (!fs?.cacheDirectory) throw new ShareUnavailableError('Sharing needs a newer build of Blank Slate.');
  const dir = `${fs.cacheDirectory}share/`;
  await fs.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const uri = dir + bundle.fileName;
  await fs.writeAsStringAsync(uri, bytesToBase64(bundle.bytes), { encoding: fs.EncodingType.Base64 });
  try {
    await Sharing.shareAsync(uri, { UTI: BUNDLE_UTI, mimeType: BUNDLE_MIME, dialogTitle: 'Share app' });
  } finally {
    // The share sheet has finished with it (AirDrop and Messages copy the file).
    fs.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}

function downloadOnWeb(bundle: BuiltBundle): void {
  const blob = new Blob([bundle.bytes as BlobPart], { type: BUNDLE_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = bundle.fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export type PickedBundle = { name: string; bytes: Uint8Array };

/** Lets the user choose a .blankslate file. Null if they cancel. */
export async function pickBundle(): Promise<PickedBundle | null> {
  if (Platform.OS === 'web') return pickOnWeb();
  const Picker = loadNative(() => require('expo-document-picker') as PickerModule, 'Importing apps');
  const result = await Picker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  try {
    return { name: asset.name, bytes: await readFileUri(asset.uri) };
  } finally {
    fs?.deleteAsync(asset.uri, { idempotent: true }).catch(() => {});
  }
}

function pickOnWeb(): Promise<PickedBundle | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `.${BUNDLE_EXTENSION},${BUNDLE_MIME},application/zip`;
    input.style.display = 'none';
    let settled = false;
    const done = (v: PickedBundle | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(v);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return done(null);
      readWebFile(file).then(done, (e) => {
        settled = true;
        input.remove();
        reject(e);
      });
    });
    input.addEventListener('cancel', () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}

export async function readWebFile(file: File): Promise<PickedBundle> {
  if (file.size > MAX_TOTAL_BYTES) throw tooLarge();
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

/** A .blankslate file iOS handed us (opened from Files, Messages, AirDrop). */
export function isBundleUrl(url: string | null | undefined): url is string {
  if (!url || !url.startsWith('file://')) return false;
  return decodeURIComponent(url.split(/[?#]/)[0]).toLowerCase().endsWith(`.${BUNDLE_EXTENSION}`);
}

export async function readIncomingBundle(url: string): Promise<PickedBundle> {
  const name = decodeURIComponent(url.split('/').pop() ?? 'App');
  try {
    return { name, bytes: await readFileUri(url) };
  } finally {
    // iOS copies opened documents into Documents/Inbox; don't let them pile up.
    if (url.includes('/Inbox/')) fs?.deleteAsync(url, { idempotent: true }).catch(() => {});
  }
}

async function readFileUri(uri: string): Promise<Uint8Array> {
  if (!fs) throw new ShareUnavailableError('Importing apps needs a newer build of Blank Slate.');
  const info = await fs.getInfoAsync(uri);
  if (!info.exists) throw new Error("Couldn't read that file.");
  if (info.size > MAX_TOTAL_BYTES) throw tooLarge();
  const b64 = await fs.readAsStringAsync(uri, { encoding: fs.EncodingType.Base64 });
  return base64ToBytes(b64);
}

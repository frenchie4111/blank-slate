import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha2.js';
import Constants from 'expo-constants';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { APP_KIT_VERSION } from '../appkit';
import { appearanceOf, isGlyph, isTint } from '../project/appearance';
import { loadChat, type ChatSnapshot } from '../project/chatStore';
import * as projectStore from '../project/store';
import { fileKeyFor, indexKeyFor, type Project } from '../project/store';
import { isImagePath } from '../vfs/vfs';
import { base64ToBytes, bytesToBase64, toHex } from './base64';

// A `.blankslate` file is a zip:
//
//   manifest.json   what's inside, with a size and sha256 per entry
//   files/<path>    the app's VFS, one entry per file. Images are the real
//                   binary decoded from the VFS data URL.
//   chat.json       optional: { history, entries } from chatStore
//
// Only the VFS and (if asked) the chat are read. The app's own runtime data
// (its sandboxed AsyncStorage keys and SQLite files), its debug history and
// any API keys live elsewhere and are never touched here.

export const BUNDLE_EXTENSION = 'blankslate';
export const BUNDLE_MIME = 'application/x-blankslate';
export const BUNDLE_UTI = 'org.mikelyons.blank-slate.app';
export const FORMAT = 'blankslate-app';
export const FORMAT_VERSION = 1;

export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ENTRIES = 500;
const MAX_PATH_LENGTH = 200;

const FILES_DIR = 'files/';
const MANIFEST = 'manifest.json';
const CHAT = 'chat.json';

const TEXT_EXTS = [
  '.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs',
  '.json', '.md', '.txt', '.csv', '.svg', '.html', '.css', '.xml', '.yml', '.yaml',
];
const IMAGE_MIMES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const ALLOWED_IMAGE_MIMES = new Set(Object.values(IMAGE_MIMES));

export type ManifestFile = {
  path: string;
  size: number;
  sha256: string;
  // Images only: the data URL's media type, which needn't match the extension.
  mime?: string;
};

export type Manifest = {
  format: typeof FORMAT;
  version: number;
  blankSlateVersion: string;
  // The blank-slate/app helper API the app was built against. Missing from
  // bundles made before it existed.
  appKitVersion?: number;
  app: {
    name: string;
    createdAt: number;
    exportedAt: number;
    tint?: string;
    glyph?: string;
    iconPath?: string;
  };
  files: ManifestFile[];
  chat?: { size: number; sha256: string };
};

export type BuiltBundle = {
  bytes: Uint8Array;
  fileName: string;
  manifest: Manifest;
  // VFS files left out: an unsupported type, or an image that isn't a data URL.
  skipped: string[];
};

export type ParsedBundle = {
  manifest: Manifest;
  // Path → VFS content (text, or a data URL for images).
  files: Map<string, string>;
  chat: ChatSnapshot | null;
};

export class BundleError extends Error {}

function extOf(path: string): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot > slash ? path.slice(dot).toLowerCase() : '';
}

function isAllowedType(path: string): boolean {
  const ext = extOf(path);
  return TEXT_EXTS.includes(ext) || ext in IMAGE_MIMES;
}

function hashOf(bytes: Uint8Array): string {
  return toHex(sha256(bytes));
}

function blankSlateVersion(): string {
  return Constants.expoConfig?.version ?? 'unknown';
}

// Kept to what every file system accepts; the extension is added by the caller.
export function bundleBaseName(appName: string): string {
  const base = appName
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  return base || 'App';
}

const DATA_URL = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,/i;

async function readProjectFiles(projectId: string): Promise<Map<string, string>> {
  const raw = await AsyncStorage.getItem(indexKeyFor(projectId));
  let paths: string[] = [];
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) paths = parsed.filter((p): p is string => typeof p === 'string');
  } catch {}
  const out = new Map<string, string>();
  for (const path of [...new Set(paths)].sort()) {
    const content = await AsyncStorage.getItem(fileKeyFor(projectId, path));
    if (content !== null) out.set(path, content);
  }
  return out;
}

export async function buildBundle(
  project: Project,
  opts: { includeChat: boolean },
): Promise<BuiltBundle> {
  const contents = await readProjectFiles(project.id);
  const zip: Zippable = {};
  const files: ManifestFile[] = [];
  const skipped: string[] = [];

  for (const [path, content] of contents) {
    if (!isAllowedType(path) || !isSafePath(path)) {
      skipped.push(path);
      continue;
    }
    let bytes: Uint8Array;
    let mime: string | undefined;
    if (isImagePath(path)) {
      const m = DATA_URL.exec(content);
      if (!m || !ALLOWED_IMAGE_MIMES.has(m[1].toLowerCase())) {
        skipped.push(path);
        continue;
      }
      mime = m[1].toLowerCase();
      bytes = base64ToBytes(content.slice(m[0].length));
    } else {
      bytes = strToU8(content);
    }
    // Images are already compressed; deflating them again just costs time.
    zip[FILES_DIR + path] = [bytes, { level: mime ? 0 : 6 }];
    files.push({ path, size: bytes.length, sha256: hashOf(bytes), ...(mime ? { mime } : {}) });
  }

  let chat: Manifest['chat'];
  if (opts.includeChat) {
    const snapshot = await loadChat(project.id);
    if (snapshot.history.length || snapshot.entries.length) {
      const bytes = strToU8(JSON.stringify(snapshot));
      zip[CHAT] = bytes;
      chat = { size: bytes.length, sha256: hashOf(bytes) };
    }
  }

  const look = appearanceOf(project);
  const iconPath = project.iconPath && files.some((f) => f.path === project.iconPath) ? project.iconPath : undefined;
  const manifest: Manifest = {
    format: FORMAT,
    version: FORMAT_VERSION,
    blankSlateVersion: blankSlateVersion(),
    appKitVersion: APP_KIT_VERSION,
    app: {
      name: project.name,
      createdAt: project.createdAt,
      exportedAt: Date.now(),
      tint: look.tint,
      glyph: look.glyph,
      ...(iconPath ? { iconPath } : {}),
    },
    files,
    ...(chat ? { chat } : {}),
  };
  zip[MANIFEST] = strToU8(JSON.stringify(manifest, null, 2));

  const bytes = zipSync(zip, { level: 6 });
  return { bytes, fileName: `${bundleBaseName(project.name)}.${BUNDLE_EXTENSION}`, manifest, skipped };
}

// ---------------------------------------------------------------------------
// Import. Everything in a bundle is untrusted until it has been checked here.

// Relative POSIX paths only: no absolute paths, drive letters, backslashes,
// empty, `.` or `..` segments, or control characters.
export function isSafePath(path: string): boolean {
  if (!path || path.length > MAX_PATH_LENGTH) return false;
  if (path.startsWith('/') || path.includes('\\') || /^[a-z]:/i.test(path)) return false;
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  return path.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

function fail(message: string): never {
  throw new BundleError(message);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function checkManifest(raw: unknown): Manifest {
  if (!isObject(raw) || raw.format !== FORMAT) fail("This isn't a Blank Slate app file.");
  if (typeof raw.version !== 'number') fail("This app file has no format version.");
  if (raw.version > FORMAT_VERSION) {
    fail('This app was shared from a newer version of Blank Slate. Update Blank Slate to open it.');
  }
  if (raw.version !== FORMAT_VERSION) fail(`Unsupported app file version (${raw.version}).`);
  const app = raw.app;
  if (!isObject(app) || typeof app.name !== 'string') fail('The app file has no app name.');
  if (!Array.isArray(raw.files)) fail('The app file has no file list.');
  if (raw.files.length > MAX_ENTRIES) fail(`The app has too many files (over ${MAX_ENTRIES}).`);

  const seen = new Set<string>();
  const files: ManifestFile[] = raw.files.map((f: unknown) => {
    if (!isObject(f) || typeof f.path !== 'string' || typeof f.size !== 'number' || typeof f.sha256 !== 'string') {
      fail('The app file has a malformed file list.');
    }
    const path = f.path;
    if (!isSafePath(path)) fail(`Unsafe file path in app: "${path.slice(0, 80)}".`);
    if (seen.has(path)) fail(`The app lists "${path}" twice.`);
    seen.add(path);
    if (!isAllowedType(path)) fail(`"${path}" isn't a file type Blank Slate apps can contain.`);
    if (f.size > MAX_FILE_BYTES) fail(`"${path}" is larger than the ${mb(MAX_FILE_BYTES)} limit.`);
    let mime: string | undefined;
    if (isImagePath(path)) {
      mime = typeof f.mime === 'string' ? f.mime.toLowerCase() : IMAGE_MIMES[extOf(path)];
      if (!ALLOWED_IMAGE_MIMES.has(mime)) fail(`"${path}" has an unsupported image type.`);
    }
    return { path, size: f.size, sha256: f.sha256.toLowerCase(), ...(mime ? { mime } : {}) };
  });

  let chat: Manifest['chat'];
  if (raw.chat !== undefined) {
    const c = raw.chat;
    if (!isObject(c) || typeof c.size !== 'number' || typeof c.sha256 !== 'string') {
      fail('The app file has a malformed chat entry.');
    }
    chat = { size: c.size, sha256: c.sha256.toLowerCase() };
  }

  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    format: FORMAT,
    version: raw.version,
    blankSlateVersion: typeof raw.blankSlateVersion === 'string' ? raw.blankSlateVersion.slice(0, 40) : 'unknown',
    // Informational: the helper API only grows, so an app built against a
    // newer one usually still runs, and a missing export is a compile error
    // that names it.
    ...(typeof raw.appKitVersion === 'number' && Number.isInteger(raw.appKitVersion) && raw.appKitVersion > 0
      ? { appKitVersion: raw.appKitVersion }
      : {}),
    app: {
      name: app.name,
      createdAt: num(app.createdAt, Date.now()),
      exportedAt: num(app.exportedAt, Date.now()),
      ...(isTint(app.tint) ? { tint: app.tint } : {}),
      ...(isGlyph(app.glyph) ? { glyph: app.glyph } : {}),
      ...(typeof app.iconPath === 'string' && seen.has(app.iconPath) && isImagePath(app.iconPath)
        ? { iconPath: app.iconPath }
        : {}),
    },
    files,
    ...(chat ? { chat } : {}),
  };
}

// A zip entry name as the user would recognise it: the app's own path.
function shown(entry: string): string {
  return (entry.startsWith(FILES_DIR) ? entry.slice(FILES_DIR.length) : entry).slice(0, 80);
}

function mb(n: number): string {
  return `${Math.round(n / (1024 * 1024))} MB`;
}

// First bytes of each allowed image type, so a "PNG" is really a PNG.
function looksLike(mime: string, b: Uint8Array): boolean {
  const at = (i: number, ...v: number[]) => v.every((x, j) => b[i + j] === x);
  switch (mime) {
    case 'image/png':
      return at(0, 0x89, 0x50, 0x4e, 0x47);
    case 'image/jpeg':
      return at(0, 0xff, 0xd8, 0xff);
    case 'image/gif':
      return at(0, 0x47, 0x49, 0x46, 0x38);
    case 'image/webp':
      return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50);
    default:
      return false;
  }
}

function checkChat(raw: unknown): ChatSnapshot {
  if (!isObject(raw) || !Array.isArray(raw.history) || !Array.isArray(raw.entries)) {
    fail('The chat history in this app file is malformed.');
  }
  return { history: raw.history as ChatSnapshot['history'], entries: raw.entries as ChatSnapshot['entries'] };
}

export function parseBundle(bytes: Uint8Array): ParsedBundle {
  if (bytes.length > MAX_TOTAL_BYTES) fail(`The app file is larger than the ${mb(MAX_TOTAL_BYTES)} limit.`);
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) fail("This isn't a Blank Slate app file.");

  // Sizes are checked from the zip's own headers before anything is inflated,
  // and again on the real output below, since headers can lie.
  let declaredTotal = 0;
  let entries = 0;
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes, {
      filter: (file) => {
        entries++;
        if (entries > MAX_ENTRIES + 2) fail(`The app has too many files (over ${MAX_ENTRIES}).`);
        if (file.originalSize > MAX_FILE_BYTES) {
          fail(`"${shown(file.name)}" is larger than the ${mb(MAX_FILE_BYTES)} limit.`);
        }
        declaredTotal += file.originalSize;
        if (declaredTotal > MAX_TOTAL_BYTES) fail(`The app is larger than the ${mb(MAX_TOTAL_BYTES)} limit.`);
        return true;
      },
    });
  } catch (e) {
    if (e instanceof BundleError) throw e;
    fail("This app file is damaged and can't be opened.");
  }

  let total = 0;
  for (const [name, data] of Object.entries(unzipped)) {
    if (name.endsWith('/') && data.length === 0) continue; // directory entry
    if (data.length > MAX_FILE_BYTES) fail(`"${shown(name)}" is larger than the ${mb(MAX_FILE_BYTES)} limit.`);
    total += data.length;
    if (total > MAX_TOTAL_BYTES) fail(`The app is larger than the ${mb(MAX_TOTAL_BYTES)} limit.`);
  }

  const manifestBytes = unzipped[MANIFEST];
  if (!manifestBytes) fail("This isn't a Blank Slate app file (no manifest).");
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(strFromU8(manifestBytes));
  } catch {
    fail("This app file's manifest is damaged.");
  }
  const manifest = checkManifest(manifestJson);

  // Every zip entry must be one the manifest accounts for, and vice versa.
  const expected = new Set([MANIFEST, ...manifest.files.map((f) => FILES_DIR + f.path)]);
  if (manifest.chat) expected.add(CHAT);
  for (const name of Object.keys(unzipped)) {
    if (name.endsWith('/') && unzipped[name].length === 0) continue;
    if (!expected.has(name)) fail(`The app file contains an unexpected entry: "${name.slice(0, 80)}".`);
  }

  const files = new Map<string, string>();
  for (const f of manifest.files) {
    const data = unzipped[FILES_DIR + f.path];
    if (!data) fail(`The app file is missing "${f.path}".`);
    if (data.length !== f.size || hashOf(data) !== f.sha256) {
      fail(`"${f.path}" doesn't match its checksum. The file may be damaged or modified.`);
    }
    if (f.mime) {
      if (!looksLike(f.mime, data)) fail(`"${f.path}" isn't a valid image.`);
      files.set(f.path, `data:${f.mime};base64,${bytesToBase64(data)}`);
    } else {
      files.set(f.path, strFromU8(data));
    }
  }

  let chat: ChatSnapshot | null = null;
  if (manifest.chat) {
    const data = unzipped[CHAT];
    if (!data) fail('The app file is missing its chat history.');
    if (data.length !== manifest.chat.size || hashOf(data) !== manifest.chat.sha256) {
      fail("The chat history doesn't match its checksum. The file may be damaged or modified.");
    }
    try {
      chat = checkChat(JSON.parse(strFromU8(data)));
    } catch (e) {
      if (e instanceof BundleError) throw e;
      fail('The chat history in this app file is malformed.');
    }
  }

  return { manifest, files, chat };
}

/**
 * Validates the bundle and adds it as a new project. Never touches existing
 * ones. hasCode: there's an App.tsx to preview (otherwise open the chat).
 */
export async function importBundle(bytes: Uint8Array): Promise<{ project: Project; hasCode: boolean }> {
  const parsed = parseBundle(bytes);
  const project = await projectStore.createFromBundle(parsed);
  return { project, hasCode: parsed.files.has('App.tsx') };
}

import { Platform } from 'react-native';
import type { ContentPart } from '../agent/openrouter';
import { fs } from '../debug/nativeModules';
import type { EntryAttachment } from '../project/chatStore';
import { TEXT_EXTS } from '../share/bundle';
import { deleteFile, IMAGE_EXTS, readFile, writeFile } from '../vfs/vfs';

// Files the user attaches to a chat message. Each one is saved into the app's
// files under uploads/ (so the agent can use it from code) and sent with the
// request: images as image parts for this turn only, text inline, capped.
//
// Only images and text are accepted: the VFS stores text, and images as data
// URLs. Anything else (PDFs, zips…) the model couldn't read and the app file
// format couldn't carry.

export const UPLOADS_DIR = 'uploads';
export const MAX_ATTACHMENTS = 5;
// On web the app's files live in localStorage (~5 MB for everything), so
// images are shrunk harder there and the caps are lower.
const WEB = Platform.OS === 'web';
const MAX_IMAGE_EDGE = WEB ? 1280 : 1568;
const MAX_IMAGE_BYTES = (WEB ? 1.5 : 4) * 1024 * 1024;
const MAX_TEXT_BYTES = (WEB ? 256 : 512) * 1024;
// How much of a text file goes into the message itself.
const INLINE_TEXT_CHARS = 20_000;
// What's read before anything is decoded: a huge photo is still worth
// shrinking, a huge text file isn't.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export type Attachment = {
  id: string;
  // The name it's saved under (sanitized, with the extension its content has).
  name: string;
  kind: 'image' | 'text';
  // A data URL for images, the text itself otherwise.
  content: string;
  width?: number;
  height?: number;
};

export type SavedAttachment = Attachment & { path: string };

export type PickResult = { attachments: Attachment[]; errors: string[] };

const IMAGE_MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

let nextId = 0;
const newId = () => `att-${Date.now()}-${nextId++}`;

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

function baseOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

// Safe as a VFS path segment and as an import specifier.
function cleanBase(name: string): string {
  const base = baseOf(name.split(/[\\/]/).pop() ?? '')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  return base || 'file';
}

function isImage(name: string, mime: string | null | undefined): boolean {
  return (!!mime && mime.toLowerCase() in IMAGE_MIME_EXT) || IMAGE_EXTS.includes(extOf(name));
}

// Text the app file format can carry keeps its extension; any other text
// (a .py, a .log) is saved with .txt added.
function textName(name: string): string {
  const ext = extOf(name);
  const base = cleanBase(name);
  if (TEXT_EXTS.includes(ext)) return base + ext;
  return `${base}${ext}.txt`;
}

function looksBinary(text: string): boolean {
  const head = text.slice(0, 8192);
  if (head.includes('\u0000')) return true;
  // Many U+FFFD replacement characters: it wasn't UTF-8 text.
  const bad = head.split('�').length - 1;
  return bad > 8 && bad > head.length / 100;
}

function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  return Math.floor(((dataUrl.length - comma - 1) * 3) / 4);
}

const unsupported = (name: string) =>
  `${name} isn't an image or a text file. You can attach photos, screenshots, and text files like CSV, JSON, Markdown, or code.`;
const imageTooBig = (name: string) => `${name} is too large (over ${kb(MAX_IMAGE_BYTES)}, even after shrinking).`;
const textTooBig = (name: string) => `${name} is too large. Text files can be up to ${kb(MAX_TEXT_BYTES)}.`;

// ---------------------------------------------------------------------------
// Web and Electron: a file input, a drop, or a paste all hand us Files.

export function pickWebFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.display = 'none';
    let settled = false;
    const done = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => done([]));
    document.body.appendChild(input);
    input.click();
  });
}

export async function fromWebFiles(files: File[]): Promise<PickResult> {
  const out: PickResult = { attachments: [], errors: [] };
  for (const file of files) {
    try {
      out.attachments.push(await fromWebFile(file));
    } catch (e) {
      out.errors.push((e as Error).message);
    }
  }
  return out;
}

async function fromWebFile(file: File): Promise<Attachment> {
  const name = file.name || 'pasted';
  if (file.size > MAX_SOURCE_BYTES) throw new Error(`${name} is too large to attach.`);
  if (isImage(name, file.type)) {
    const original = await readAsDataUrl(file);
    const shrunk = await shrinkOnWeb(original);
    if (dataUrlBytes(shrunk.dataUrl) > MAX_IMAGE_BYTES) throw new Error(imageTooBig(name));
    return image(name, shrunk.dataUrl, shrunk.width, shrunk.height);
  }
  if (file.size > MAX_TEXT_BYTES) throw new Error(textTooBig(name));
  const text = await file.text();
  if (looksBinary(text)) throw new Error(unsupported(name));
  return { id: newId(), name: textName(name), kind: 'text', content: text };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

// Re-encodes as JPEG no wider or taller than MAX_IMAGE_EDGE. Images already
// that small and under 512 KB are left alone, which keeps a logo's
// transparency or a GIF's animation.
async function shrinkOnWeb(dataUrl: string): Promise<{ dataUrl: string; width?: number; height?: number }> {
  let img: HTMLImageElement;
  try {
    img = new window.Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode failed'));
      img.src = dataUrl;
    });
  } catch {
    throw new Error("Couldn't open that image. Try a PNG or JPEG.");
  }
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(w, h));
  if (scale === 1 && dataUrlBytes(dataUrl) <= 512 * 1024) return { dataUrl, width: w, height: h };
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d')!;
  // JPEG has no alpha; transparent areas would turn black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height };
}

// ---------------------------------------------------------------------------
// iOS: the photo library or Files. Both pickers are in the binary already
// (generated apps use expo-image-picker; importing apps uses the document
// picker), but they're loaded on demand like src/share/io.ts does.

type ImagePickerModule = typeof import('expo-image-picker');
type DocumentPickerModule = typeof import('expo-document-picker');

function loadNative<T>(get: () => T): T {
  try {
    const mod = get();
    if (mod) return mod;
  } catch {}
  throw new Error('Attaching files needs a newer build of Blank Slate.');
}

export async function pickPhotos(room: number): Promise<PickResult> {
  const ImagePicker = loadNative(() => require('expo-image-picker') as ImagePickerModule);
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: room > 1,
    selectionLimit: room,
    // There's no resize option without another native module; re-encoding
    // at this quality keeps a 12 MP photo to a megabyte or two.
    quality: 0.6,
    base64: true,
  });
  const out: PickResult = { attachments: [], errors: [] };
  if (res.canceled) return out;
  for (const asset of res.assets) {
    const name = asset.fileName || 'photo.jpg';
    const mime = asset.mimeType && asset.mimeType in IMAGE_MIME_EXT ? asset.mimeType : 'image/jpeg';
    if (!asset.base64) {
      out.errors.push(`Couldn't read ${name}.`);
      continue;
    }
    const dataUrl = `data:${mime};base64,${asset.base64}`;
    if (dataUrlBytes(dataUrl) > MAX_IMAGE_BYTES) {
      out.errors.push(imageTooBig(name));
      continue;
    }
    out.attachments.push(image(name, dataUrl, asset.width, asset.height));
  }
  return out;
}

export async function pickDocuments(): Promise<PickResult> {
  const Picker = loadNative(() => require('expo-document-picker') as DocumentPickerModule);
  if (!fs) throw new Error('Attaching files needs a newer build of Blank Slate.');
  const res = await Picker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
  const out: PickResult = { attachments: [], errors: [] };
  if (res.canceled) return out;
  for (const asset of res.assets) {
    try {
      out.attachments.push(await fromNativeFile(asset.uri, asset.name, asset.mimeType, asset.size));
    } catch (e) {
      out.errors.push((e as Error).message);
    } finally {
      fs.deleteAsync(asset.uri, { idempotent: true }).catch(() => {});
    }
  }
  return out;
}

async function fromNativeFile(
  uri: string,
  name: string,
  mime: string | undefined,
  size: number | undefined,
): Promise<Attachment> {
  if (isImage(name, mime)) {
    if ((size ?? 0) > MAX_IMAGE_BYTES) throw new Error(imageTooBig(name));
    const b64 = await fs!.readAsStringAsync(uri, { encoding: fs!.EncodingType.Base64 });
    const type = mime && mime in IMAGE_MIME_EXT ? mime : imageMimeFor(name);
    return image(name, `data:${type};base64,${b64}`);
  }
  if ((size ?? 0) > MAX_TEXT_BYTES) throw new Error(textTooBig(name));
  let text: string;
  try {
    text = await fs!.readAsStringAsync(uri, { encoding: fs!.EncodingType.UTF8 });
  } catch {
    throw new Error(unsupported(name));
  }
  if (looksBinary(text)) throw new Error(unsupported(name));
  if (text.length > MAX_TEXT_BYTES) throw new Error(textTooBig(name));
  return { id: newId(), name: textName(name), kind: 'text', content: text };
}

function imageMimeFor(name: string): string {
  const ext = extOf(name);
  return Object.keys(IMAGE_MIME_EXT).find((m) => IMAGE_MIME_EXT[m] === ext) ?? 'image/png';
}

function image(name: string, dataUrl: string, width?: number, height?: number): Attachment {
  const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1]?.toLowerCase() ?? 'image/png';
  return {
    id: newId(),
    name: cleanBase(name) + (IMAGE_MIME_EXT[mime] ?? '.png'),
    kind: 'image',
    content: dataUrl,
    ...(width && height ? { width, height } : {}),
  };
}

// ---------------------------------------------------------------------------
// Sending.

/**
 * Writes each attachment into the current app's uploads/, never overwriting.
 * All or nothing: if one fails, the ones already written are deleted, so a
 * retry doesn't leave -2 copies behind in storage that's already full.
 */
export async function saveAttachments(list: Attachment[]): Promise<SavedAttachment[]> {
  const saved: SavedAttachment[] = [];
  const taken = new Set<string>();
  for (const a of list) {
    const ext = extOf(a.name);
    const base = a.name.slice(0, a.name.length - ext.length);
    let path = `${UPLOADS_DIR}/${a.name}`;
    for (let n = 2; taken.has(path) || (await readFile(path)) !== null; n++) {
      path = `${UPLOADS_DIR}/${base}-${n}${ext}`;
    }
    taken.add(path);
    try {
      await writeFile(path, a.content);
    } catch {
      // writeFile may have indexed the path before the write itself failed.
      // One at a time: each delete rewrites the file index.
      for (const p of [...saved.map((s) => s.path), path]) await deleteFile(p).catch(() => {});
      throw new Error(
        WEB
          ? `Couldn't save ${a.name}: the browser's storage for Blank Slate is full. Delete some files or apps and try again.`
          : `Couldn't save ${a.name}.`,
      );
    }
    saved.push({ ...a, path });
  }
  return saved;
}

export function entryAttachments(saved: SavedAttachment[]): EntryAttachment[] {
  return saved.map((a) => ({ path: a.path, name: a.name, kind: a.kind }));
}

/**
 * The request as the model gets it: the user's words, then a note per file
 * with its path, text files inline (capped). Images ride along as image parts
 * when the model can see, for this turn only; saved history keeps just the
 * text, which tells the model how to look again.
 */
export function composeRequest(
  text: string,
  saved: SavedAttachment[],
  seesImages: boolean,
): { text: string; images: ContentPart[] } {
  if (!saved.length) return { text, images: [] };
  const lines: string[] = [
    `[The user attached ${saved.length === 1 ? 'a file' : `${saved.length} files`}. ` +
      `${saved.length === 1 ? "It's" : "They're"} saved in this app's files, so the app's code can import ${saved.length === 1 ? 'it' : 'them'}.]`,
  ];
  const images: ContentPart[] = [];
  for (const a of saved) {
    if (a.kind === 'image') {
      const size = a.width && a.height ? `, ${a.width}×${a.height}` : '';
      // Saved history keeps this line but not the image, and Retry,
      // Continue and later turns replay it, so it must read true either way.
      lines.push(`- ${a.path} (image${size}): call view_image on it if it isn't attached to this message.`);
      if (seesImages) {
        images.push({ type: 'text', text: `${a.path}:` });
        images.push({ type: 'image_url', image_url: { url: a.content } });
      }
      continue;
    }
    const lineCount = a.content.replace(/\n$/, '').split('\n').length;
    const cut = a.content.length > INLINE_TEXT_CHARS;
    const shown = cut ? a.content.slice(0, INLINE_TEXT_CHARS) : a.content;
    const fence = a.content.includes('```') ? '~~~~' : '```';
    lines.push(
      `- ${a.path} (text, ${kb(a.content.length)}, ${lineCount} ${lineCount === 1 ? 'line' : 'lines'}):`,
      `${fence}${extOf(a.path).slice(1)}`,
      shown,
      fence,
      ...(cut
        ? [`(Only the first ${INLINE_TEXT_CHARS} characters are shown. The whole file is at ${a.path}; import it from code rather than reading it all.)`]
        : []),
    );
  }
  const note = lines.join('\n');
  return { text: text ? `${text}\n\n${note}` : note, images };
}

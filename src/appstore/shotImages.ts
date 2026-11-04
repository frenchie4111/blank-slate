import React from 'react';
import { Platform } from 'react-native';
import { IMAGE_MODEL } from '../agent/models';
import { generateImage } from '../agent/openrouter';
import type { Block, Listing, Screen } from './catalog';

// Real screenshots from the image model. The drawn mockup (Screenshot.tsx)
// shows at once and stays as the fallback; the image replaces it when it
// arrives. ~$0.035 each, so they're made only for what's on screen: the first
// screenshot of each search result, the rest when a listing is opened.

export const SHOT_ASPECT = '9:16';
export const SHOT_RATIO = 16 / 9;

// The image model is slow; a few at a time keeps the first results quick.
const MAX_PARALLEL = 4;

export type ShotState = { status: 'loading' } | { status: 'ready'; uri: string } | { status: 'failed' };

const states = new Map<string, ShotState>();
const listeners = new Map<string, Set<() => void>>();
const queue: (() => Promise<void>)[] = [];
let active = 0;

function keyOf(l: Listing, index: number): string {
  return `${l.id}:${index}`;
}

function set(key: string, state: ShotState): void {
  states.set(key, state);
  for (const fn of listeners.get(key) ?? []) fn();
}

function pump(): void {
  while (active < MAX_PARALLEL && queue.length) {
    const job = queue.shift()!;
    active++;
    job().finally(() => {
      active--;
      pump();
    });
  }
}

/** Starts generating the screenshot unless it's already made or under way. */
export function request(apiKey: string, l: Listing, index: number): void {
  const screen = l.screens[index];
  const key = keyOf(l, index);
  if (!screen || states.has(key)) return;
  set(key, { status: 'loading' });
  queue.push(async () => {
    try {
      const { dataUrl } = await generateImage(apiKey, IMAGE_MODEL, promptFor(l, screen, index), SHOT_ASPECT);
      set(key, { status: 'ready', uri: dataUrl });
    } catch (e) {
      if (__DEV__) console.log('[store] screenshot failed', (e as Error)?.message);
      set(key, { status: 'failed' });
    }
  });
  pump();
}

/**
 * Every screenshot of a listing as a data URL, generating the missing ones and
 * waiting up to `timeoutMs` for them. null where one failed or ran out of time.
 */
export async function collect(apiKey: string, l: Listing, timeoutMs = 90_000): Promise<(string | null)[]> {
  const deadline = Date.now() + timeoutMs;
  return Promise.all(
    l.screens.map(async (_, i) => {
      request(apiKey, l, i);
      const key = keyOf(l, i);
      const settled = () => states.get(key)?.status !== 'loading';
      if (!settled()) {
        await new Promise<void>((resolve) => {
          let subs = listeners.get(key);
          if (!subs) listeners.set(key, (subs = new Set()));
          const done = () => {
            clearTimeout(timer);
            subs!.delete(check);
            resolve();
          };
          const check = () => settled() && done();
          const timer = setTimeout(done, Math.max(0, deadline - Date.now()));
          subs.add(check);
        });
      }
      const state = states.get(key);
      return state?.status === 'ready' ? shrink(state.uri) : null;
    }),
  );
}

// The image model's PNGs run to a couple of MB. On web the project files live
// in localStorage (~5 MB in all), so re-encode as a smaller JPEG there.
async function shrink(dataUrl: string, maxWidth = 640): Promise<string> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return dataUrl;
  try {
    const img = new window.Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode failed'));
      img.src = dataUrl;
    });
    const scale = Math.min(1, maxWidth / img.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    return dataUrl;
  }
}

/** The generated screenshot's state; null until requested. */
export function useShot(l: Listing, index: number): ShotState | null {
  const key = keyOf(l, index);
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    let subs = listeners.get(key);
    if (!subs) listeners.set(key, (subs = new Set()));
    subs.add(bump);
    return () => {
      subs!.delete(bump);
    };
  }, [key]);
  return states.get(key) ?? null;
}

function promptFor(l: Listing, s: Screen, index: number): string {
  const p = l.palette;
  return [
    `An App Store marketing screenshot (portrait, ${SHOT_ASPECT}) for "${l.name}", a ${l.category} app: ${l.tagline}.`,
    `Screenshot ${index + 1} of ${l.screens.length}. Headline text, large and legible: "${s.caption}".`,
    `It shows the app's "${s.title}" screen on an iPhone (or full-bleed UI), containing: ${s.blocks.map(describe).join('; ')}.`,
    `Design it the way the best real app of this kind would look, not like a generic template. Feel: ${l.vibe || 'polished'}.`,
    `Colours: background ${p.bg}, surfaces ${p.surface}, text ${p.text}, accent ${p.accent}.`,
    `Crisp, modern, professional mobile UI with realistic content. All text spelled correctly. No watermarks, no Apple logos.`,
  ].join('\n');
}

function describe(b: Block): string {
  switch (b.t) {
    case 'hero':
      return `a big headline "${b.text}"${b.sub ? ` with "${b.sub}" under it` : ''}`;
    case 'row':
      return `a list item "${b.text}"${b.sub ? ` (${b.sub})` : ''}`;
    case 'card':
      return `a card "${b.text}"${b.sub ? `: ${b.sub}` : ''}`;
    case 'chips':
      return `filter chips: ${b.items.join(', ')}`;
    case 'segment':
      return `a segmented control: ${b.items.join(' / ')}`;
    case 'bars':
      return `a bar chart`;
    case 'progress':
      return `a progress bar${b.text ? ` "${b.text}"` : ''}`;
    case 'ring':
      return `a progress ring showing "${b.text}"${b.sub ? ` (${b.sub})` : ''}`;
    case 'stats':
      return `stat tiles: ${b.items.map((i) => `${i.value} ${i.label}`).join(', ')}`;
    case 'calendar':
      return `a ${b.month} calendar with ${b.marked.length} days marked`;
    case 'chat':
      return `a chat: ${b.messages.map((m) => `${m.me ? 'me' : 'them'}: "${m.text}"`).join(', ')}`;
    case 'photos':
      return `a grid of photos`;
    case 'map':
      return `a map with ${b.pins} pins${b.label ? ` near ${b.label}` : ''}`;
    case 'toggles':
      return `settings toggles: ${b.items.map((i) => i.text).join(', ')}`;
    case 'art':
      return `a big illustration${b.text ? ` captioned "${b.text}"` : ''}`;
    case 'board':
      return `a ${b.cols}-column game board with pieces`;
    case 'keypad':
      return `a keypad: ${b.keys.join(' ')}`;
    case 'quote':
      return `a featured quote "${b.text}"`;
    case 'grid':
      return `a grid of icon tiles`;
    case 'button':
      return `a button "${b.text}"`;
  }
}

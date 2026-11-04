import AsyncStorage from '@react-native-async-storage/async-storage';
import { describeImage, fetchInputModalities } from './openrouter';
import { VISION_MODEL } from './models';

// Whether the chat model can look at images itself, cached per model id for a
// week (model capabilities rarely change). Unknown counts as "no": a
// text-only model gets a description instead of an image it can't read.

const CACHE_KEY = 'agent:inputModalities';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Cache = Record<string, { images: boolean; at: number }>;
let memory: Cache | null = null;

async function loadCache(): Promise<Cache> {
  if (memory) return memory;
  try {
    memory = JSON.parse((await AsyncStorage.getItem(CACHE_KEY)) ?? '{}') as Cache;
  } catch {
    memory = {};
  }
  return memory;
}

export async function modelAcceptsImages(apiKey: string, model: string): Promise<boolean> {
  const cache = await loadCache();
  const hit = cache[model];
  if (hit && Date.now() - hit.at < TTL_MS) return hit.images;
  try {
    const modalities = await fetchInputModalities(apiKey, model);
    if (!modalities) return hit?.images ?? false;
    cache[model] = { images: modalities.includes('image'), at: Date.now() };
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache)).catch(() => {});
    return cache[model].images;
  } catch {
    return hit?.images ?? false;
  }
}

const SIDECAR_PROMPT = `You are the eyes of a coding agent that cannot see images. This is a screenshot of a small mobile app the agent is building in React Native. Describe it so the agent can fix the UI without seeing it:
- Overall layout from top to bottom, with rough positions ("top bar", "centered", "bottom 20%").
- Every piece of visible text, quoted exactly.
- Every control that looks tappable (buttons, inputs, toggles, icons) and where it is.
- Colors, fonts and theme briefly.

Then review it like a strict designer and list every visual defect under "Defects:", one per line with where it is. Look closely for:
- Rows whose parts are stacked when they should sit side by side (an icon above its label, a switch below its text).
- Icons not centered in their circle, tile or button; text not centered on the shape it labels (a value off-center in a dial or ring).
- Text overlapping other text, icons, lines or graphics; text clipped, cut off or running off screen.
- Misaligned left edges, uneven spacing between similar items, items that should line up but don't.
- Unstyled-looking content: default fonts in a styled app, plain black text on a designed background, missing padding.
- Large empty areas, unreadable contrast, content under the notch or home indicator, error messages.
If there are no defects, write "Defects: none". Don't call something fine unless you checked it.
Be concrete and compact. No preamble.`;

export async function describeScreenshot(
  apiKey: string,
  dataUrl: string,
  question: string | undefined,
  signal?: AbortSignal,
): Promise<{ text: string; cost: number | null; model: string; promptTokens: number | null }> {
  const prompt = question ? `${SIDECAR_PROMPT}\n\nThe agent specifically asks: ${question}` : SIDECAR_PROMPT;
  const r = await describeImage(apiKey, VISION_MODEL, dataUrl, prompt, signal);
  return { text: r.text, cost: r.cost, model: VISION_MODEL, promptTokens: r.usage?.prompt_tokens ?? null };
}

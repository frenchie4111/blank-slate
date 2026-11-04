import { fetch as expoFetch } from 'expo/fetch';
import { Platform } from 'react-native';
import { LeftAppError, onReturnToForeground } from './appLifecycle';

// OpenAI-compatible chat-completions client for OpenRouter. We talk to the
// endpoint directly (no SDK) because streaming on iOS needs expo/fetch, and
// the SSE format is simple enough to parse by hand.

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

// Stall detection counts any bytes as a sign of life, including the
// ": OPENROUTER PROCESSING" comments OpenRouter sends while the upstream is busy.
// Providers that buffer a whole tool call (Z.AI, DigitalOcean) can go 15-20s
// with nothing but those comments.
export const STALL_WARN_MS = 45_000;
export const STALL_ABORT_MS = 120_000;
// Back in the foreground after iOS suspended us, a live stream delivers bytes
// right away. If none arrive within this window, the socket died in the background.
export const FOREGROUND_GRACE_MS = 15_000;
const WATCHDOG_TICK_MS = 1000;
const HEADERS_BASE = { 'Content-Type': 'application/json' };
// Attribution headers for OpenRouter's app rankings. Derived from the bundle id.
const APP_URL = 'https://mikelyons.org/blank-slate';
const APP_TITLE = 'Blank Slate';

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ChatMessage =
  // Array content only ever carries a screenshot within a single turn; the
  // agent swaps it back to text before history is saved.
  | { role: 'user'; content: string | ContentPart[] }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: ToolCall[];
      // Opaque reasoning blocks some models return; OpenRouter asks that they be
      // sent back unchanged on the next request so tool-calling stays coherent.
      reasoning_details?: unknown[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export type UrlCitation = { url: string; title: string; content?: string };

export type StreamHandlers = {
  onText: (delta: string) => void;
  onCitation: (c: UrlCitation) => void;
  // Characters of reasoning received so far in this response. Reasoning isn't
  // shown, but without it a long think looks like a hang.
  onReasoning?: (totalChars: number) => void;
  // A tool call's name arrived; its arguments are still streaming.
  onToolCall?: (name: string) => void;
  // More of a tool call's arguments arrived; `args` is everything so far.
  // Fires per chunk, so callers throttle. Some providers send the arguments in
  // one piece at the end, so this may fire only once.
  onToolArgs?: (name: string, args: string) => void;
  // No bytes at all for STALL_WARN_MS (true), or bytes again after that (false).
  onStall?: (stalled: boolean) => void;
};

export class StallError extends Error {}

export type Usage = {
  prompt_tokens: number;
  completion_tokens: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
};

export type StreamResult = {
  message: Extract<ChatMessage, { role: 'assistant' }>;
  finishReason: string | null;
  usage: Usage | null;
  // Which upstream OpenRouter routed to; GLM in particular behaves very
  // differently across providers.
  provider: string | null;
};

type Delta = {
  content?: string | null;
  tool_calls?: {
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }[];
  reasoning?: string | null;
  reasoning_details?: unknown[];
  annotations?: { type: string; url_citation?: UrlCitation }[];
};

type Chunk = {
  provider?: string;
  choices?: { delta?: Delta; finish_reason?: string | null }[];
  error?: { message?: string; code?: number | string };
  usage?: Usage;
};

export async function streamChatCompletion(
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  handlers: StreamHandlers,
): Promise<StreamResult> {
  let provider: string | null = null;
  const watchdog = startWatchdog(signal, handlers, () => provider);
  try {
    return await readCompletion(apiKey, body, watchdog, handlers, (p) => {
      provider = p;
    });
  } catch (e) {
    // The watchdog's abort surfaces as a generic AbortError; say why instead.
    if (watchdog.stall) throw watchdog.stall;
    throw e;
  } finally {
    watchdog.stop();
  }
}

type Watchdog = {
  signal: AbortSignal;
  // Rejects when the watchdog gives up, so a read stuck on a dead socket
  // (which an abort doesn't always unblock) still ends.
  gaveUp: Promise<never>;
  stall: Error | null;
  alive: () => void;
  stop: () => void;
};

// Watches for bytes, not progress: a provider buffering a big tool call is
// slow but alive. Times are wall-clock so that a suspended app doesn't count
// time it couldn't receive anything in.
function startWatchdog(
  outer: AbortSignal,
  handlers: StreamHandlers,
  provider: () => string | null,
): Watchdog {
  const controller = new AbortController();
  let giveUp: (e: Error) => void = () => {};
  const gaveUp = new Promise<never>((_, reject) => {
    giveUp = reject;
  });
  // Never left unhandled when nobody is racing it any more.
  gaveUp.catch(() => {});
  const onOuterAbort = () => {
    controller.abort();
    giveUp(new Error('Aborted'));
  };
  outer.addEventListener('abort', onOuterAbort);
  if (outer.aborted) onOuterAbort();
  const timing = devStallTiming();
  let lastByteAt = Date.now();
  let warned = false;
  let foregroundAt: number | null = null;

  const w: Watchdog = {
    signal: controller.signal,
    gaveUp,
    stall: null,
    alive: () => {
      lastByteAt = Date.now();
      foregroundAt = null;
      if (warned) {
        warned = false;
        handlers.onStall?.(false);
      }
    },
    stop: () => {
      clearInterval(tick);
      unsubscribe();
      outer.removeEventListener('abort', onOuterAbort);
    },
  };

  const fail = (error: Error, why: string) => {
    if (w.stall) return;
    if (__DEV__) console.log(`[agent] stall: ${why} via ${provider() ?? '?'}`);
    w.stall = error;
    controller.abort();
    giveUp(w.stall);
  };

  const tick = setInterval(() => {
    const now = Date.now();
    if (foregroundAt !== null && now - foregroundAt >= timing.graceMs) {
      fail(
        new LeftAppError('The connection was lost while the app was in the background.'),
        `no bytes ${Math.round((now - foregroundAt) / 1000)}s after returning to the foreground`,
      );
      return;
    }
    const idle = now - lastByteAt;
    if (idle >= timing.abortMs) {
      fail(
        new StallError(`No response from the model for ${Math.round(idle / 1000)}s.`),
        `no bytes for ${Math.round(idle / 1000)}s`,
      );
    } else if (idle >= timing.warnMs && !warned) {
      warned = true;
      if (__DEV__) console.log(`[agent] stall warning: no bytes for ${Math.round(idle / 1000)}s via ${provider() ?? '?'}`);
      handlers.onStall?.(true);
    }
  }, WATCHDOG_TICK_MS);

  // iOS suspends a backgrounded app and may drop its sockets without the
  // fetch ever failing. Time spent suspended isn't idleness, so the clock
  // restarts on return, and a short grace period catches the dead socket.
  const unsubscribe = onReturnToForeground(() => {
    lastByteAt = Date.now();
    foregroundAt = lastByteAt;
  });

  return w;
}

async function readCompletion(
  apiKey: string,
  body: Record<string, unknown>,
  watchdog: Watchdog,
  handlers: StreamHandlers,
  setProvider: (p: string) => void,
): Promise<StreamResult> {
  const res = await Promise.race([
    expoFetch(ENDPOINT, {
      method: 'POST',
      headers: headersFor(apiKey),
      body: JSON.stringify({ ...body, ...devProviderPin(), stream: true }),
      signal: watchdog.signal,
    }),
    watchdog.gaveUp,
  ]);
  watchdog.alive();

  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${describeErrorBody(await res.text())}`);
  }
  if (!res.body) throw new Error('OpenRouter returned an empty response body');

  let text = '';
  let finishReason: string | null = null;
  let usage: Usage | null = null;
  let provider: string | null = null;
  let sawDone = false;
  const reasoningDetails: unknown[] = [];
  let reasoningChars = 0;
  // Keyed by the delta's tool_call index. Server tools (web search/fetch) run
  // inside OpenRouter and consume indices without ever appearing here, so the
  // indices we see are not necessarily contiguous.
  const calls = new Map<number, ToolCall>();
  // A hosted search mid-reply splits the text in two with no separator
  // ("…confirm it.The latest…"); its citations arrive at the split.
  let seam = false;

  const handleChunk = (chunk: Chunk) => {
    if (chunk.error) {
      throw new Error(`OpenRouter: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
    }
    if (chunk.usage) usage = chunk.usage;
    if (chunk.provider && chunk.provider !== provider) {
      provider = chunk.provider;
      setProvider(provider);
    }
    const choice = chunk.choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? {};
    if (delta.content) {
      const piece = seam && text && !/\s$/.test(text) ? `\n\n${delta.content}` : delta.content;
      seam = false;
      text += piece;
      handlers.onText(piece);
    }
    for (const tc of delta.tool_calls ?? []) {
      let call = calls.get(tc.index);
      if (!call) {
        call = { id: '', type: 'function', function: { name: '', arguments: '' } };
        calls.set(tc.index, call);
      }
      if (tc.id) call.id = tc.id;
      if (tc.function?.name) {
        const first = !call.function.name;
        call.function.name += tc.function.name;
        if (first) handlers.onToolCall?.(call.function.name);
      }
      if (tc.function?.arguments) {
        call.function.arguments += tc.function.arguments;
        if (call.function.name) handlers.onToolArgs?.(call.function.name, call.function.arguments);
      }
    }
    if (delta.reasoning_details) reasoningDetails.push(...delta.reasoning_details);
    const reasoningText = delta.reasoning ?? detailsText(delta.reasoning_details);
    if (reasoningText) {
      reasoningChars += reasoningText.length;
      handlers.onReasoning?.(reasoningChars);
    }
    for (const a of delta.annotations ?? []) {
      if (a.type === 'url_citation' && a.url_citation) {
        seam = true;
        handlers.onCitation(a.url_citation);
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  };

  await readSse(res.body, watchdog, (data) => {
    if (data === '[DONE]') {
      sawDone = true;
      return;
    }
    let parsed: Chunk;
    try {
      parsed = JSON.parse(data) as Chunk;
    } catch {
      return;
    }
    handleChunk(parsed);
  });

  // A dropped connection can end the body cleanly, mid-reply. Without either
  // marker the reply (and any tool call in it) may be cut short.
  if (!finishReason && !sawDone) {
    if (__DEV__) console.log(`[agent] stall: stream ended without finish_reason via ${provider ?? '?'}`);
    throw new StallError('The reply stream ended before the model finished.');
  }

  const toolCalls = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, c]) => ({ ...c, id: c.id || `call_${index}` }))
    .filter((c) => c.function.name);

  return {
    message: {
      role: 'assistant',
      content: text || null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      ...(reasoningDetails.length ? { reasoning_details: reasoningDetails } : {}),
    },
    finishReason,
    usage,
    provider,
  };
}

// Image models return their output as data URLs on message.images. Not
// streamed: there's nothing useful to show until the image is complete.
export async function generateImage(
  apiKey: string,
  model: string,
  prompt: string,
  aspectRatio: string | undefined,
  signal?: AbortSignal,
): Promise<{ dataUrl: string; cost: number | null }> {
  const res = await expoFetch(ENDPOINT, {
    method: 'POST',
    headers: headersFor(apiKey),
    body: JSON.stringify({
      model,
      modalities: ['image', 'text'],
      messages: [{ role: 'user', content: prompt }],
      ...(aspectRatio ? { image_config: { aspect_ratio: aspectRatio } } : {}),
    }),
    signal,
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${describeErrorBody(raw)}`);
  const parsed = JSON.parse(raw) as {
    choices?: { message?: { content?: string | null; images?: { image_url?: { url?: string } }[] } }[];
    usage?: Usage;
  };
  const message = parsed.choices?.[0]?.message;
  const dataUrl = message?.images?.[0]?.image_url?.url;
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    const said = message?.content ? ` Model said: ${message.content.slice(0, 200)}` : '';
    throw new Error(`No image returned.${said}`);
  }
  return { dataUrl, cost: parsed.usage?.cost ?? null };
}

// One-shot vision call: the "eyes" for chat models that can't take images.
export async function describeImage(
  apiKey: string,
  model: string,
  dataUrl: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<{ text: string; cost: number | null; usage: Usage | null }> {
  const res = await expoFetch(ENDPOINT, {
    method: 'POST',
    headers: headersFor(apiKey),
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      // Describing a screenshot needs no deliberation; reasoning only adds cost.
      reasoning: { effort: 'low', exclude: true },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
    signal,
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${describeErrorBody(raw)}`);
  const parsed = JSON.parse(raw) as {
    choices?: { message?: { content?: string | null } }[];
    usage?: Usage;
  };
  const text = parsed.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('The vision model returned no description.');
  return { text, cost: parsed.usage?.cost ?? null, usage: parsed.usage ?? null };
}

// One-shot, non-streamed completion that should come back as a JSON object
// (the App Store's listings). Returns the raw text; the caller parses it.
export async function completeJson(
  apiKey: string,
  model: string,
  system: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<{ text: string; cost: number | null }> {
  const res = await expoFetch(ENDPOINT, {
    method: 'POST',
    headers: headersFor(apiKey),
    body: JSON.stringify({
      model,
      max_tokens: 12000,
      reasoning: { effort: 'low', exclude: true },
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
    signal,
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${describeErrorBody(raw)}`);
  const parsed = JSON.parse(raw) as {
    choices?: { message?: { content?: string | null } }[];
    usage?: Usage;
  };
  const text = parsed.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('The model returned nothing.');
  return { text, cost: parsed.usage?.cost ?? null };
}

/** input_modalities for a model, e.g. ['text', 'image']. */
export async function fetchInputModalities(apiKey: string, model: string): Promise<string[] | null> {
  // The per-model endpoints route is a few KB; /models is several hundred.
  const id = model.replace(/^~/, '').split(':')[0];
  const res = await expoFetch(`https://openrouter.ai/api/v1/models/${id}/endpoints`, {
    headers: headersFor(apiKey),
  });
  if (!res.ok) return null;
  const parsed = (await res.json()) as {
    data?: { architecture?: { input_modalities?: string[] } };
  };
  return parsed.data?.architecture?.input_modalities ?? null;
}

// Fallback for providers that only send structured reasoning_details.
function detailsText(details: unknown[] | undefined): string {
  if (!details) return '';
  let out = '';
  for (const d of details) {
    const t = (d as { text?: unknown; summary?: unknown }) ?? {};
    if (typeof t.text === 'string') out += t.text;
    else if (typeof t.summary === 'string') out += t.summary;
  }
  return out;
}

function headersFor(apiKey: string): Record<string, string> {
  return {
    ...HEADERS_BASE,
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': APP_URL,
    'X-Title': APP_TITLE,
  };
}

async function readSse(
  body: ReadableStream<Uint8Array>,
  watchdog: Watchdog,
  onData: (data: string) => void,
): Promise<void> {
  const reader = body.getReader();
  watchdog.gaveUp.catch(() => reader.cancel().catch(() => {}));
  const dev = devStallMode();
  let sawText = false;
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];

  const flushEvent = () => {
    if (dataLines.length) onData(dataLines.join('\n'));
    dataLines = [];
  };

  const handleLine = (line: string) => {
    if (line === '') return flushEvent();
    // ":" lines are comments (OpenRouter sends ": OPENROUTER PROCESSING" keepalives).
    if (line.startsWith(':')) return;
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  };

  while (true) {
    const { done, value } = await Promise.race([reader.read(), watchdog.gaveUp]);
    if (done) break;
    if (dev && sawText) {
      // Dev only: once the reply has started, go silent ('hang') or end the
      // body without a finish_reason ('drop').
      if (dev === 'drop') break;
      await watchdog.gaveUp;
    }
    watchdog.alive();
    const piece = decoder.decode(value, { stream: true });
    if (dev && piece.includes('"content":"')) sawText = true;
    buffer += piece;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      handleLine(buffer.slice(0, nl).replace(/\r$/, ''));
      buffer = buffer.slice(nl + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer) handleLine(buffer.replace(/\r$/, ''));
  flushEvent();
}

// Dev-only stall simulation on web, read from the page URL:
// ?stall=hang goes silent once reply text starts, ?stall=drop ends the stream
// there without a finish_reason, and ?stallFast shortens the timeouts to
// 5s / 30s so the states can be seen without waiting two minutes.
// ?provider=z-ai pins the upstream, since tool-call streaming differs by provider.
function devQuery(): URLSearchParams | null {
  if (!__DEV__ || Platform.OS !== 'web' || typeof location === 'undefined') return null;
  return new URLSearchParams(location.search);
}

function devStallMode(): 'hang' | 'drop' | null {
  const mode = devQuery()?.get('stall');
  return mode === 'hang' || mode === 'drop' ? mode : null;
}

function devProviderPin(): Record<string, unknown> {
  const p = devQuery()?.get('provider');
  return p ? { provider: { order: [p], allow_fallbacks: false } } : {};
}

function devStallTiming(): { warnMs: number; abortMs: number; graceMs: number } {
  return devQuery()?.has('stallFast')
    ? { warnMs: 5_000, abortMs: 30_000, graceMs: FOREGROUND_GRACE_MS }
    : { warnMs: STALL_WARN_MS, abortMs: STALL_ABORT_MS, graceMs: FOREGROUND_GRACE_MS };
}

function describeErrorBody(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {}
  return raw.slice(0, 300) || 'request failed';
}

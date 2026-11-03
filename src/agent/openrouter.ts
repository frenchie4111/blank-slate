import { fetch as expoFetch } from 'expo/fetch';

// OpenAI-compatible chat-completions client for OpenRouter. We talk to the
// endpoint directly (no SDK) because streaming on iOS needs expo/fetch, and
// the SSE format is simple enough to parse by hand.

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
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
};

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
  const res = await expoFetch(ENDPOINT, {
    method: 'POST',
    headers: headersFor(apiKey),
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });

  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${describeErrorBody(await res.text())}`);
  }
  if (!res.body) throw new Error('OpenRouter returned an empty response body');

  let text = '';
  let finishReason: string | null = null;
  let usage: Usage | null = null;
  let provider: string | null = null;
  const reasoningDetails: unknown[] = [];
  let reasoningChars = 0;
  // Keyed by the delta's tool_call index. Server tools (web search/fetch) run
  // inside OpenRouter and consume indices without ever appearing here, so the
  // indices we see are not necessarily contiguous.
  const calls = new Map<number, ToolCall>();

  const handleChunk = (chunk: Chunk) => {
    if (chunk.error) {
      throw new Error(`OpenRouter: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
    }
    if (chunk.usage) usage = chunk.usage;
    if (chunk.provider) provider = chunk.provider;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? {};
    if (delta.content) {
      text += delta.content;
      handlers.onText(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      let call = calls.get(tc.index);
      if (!call) {
        call = { id: '', type: 'function', function: { name: '', arguments: '' } };
        calls.set(tc.index, call);
      }
      if (tc.id) call.id = tc.id;
      if (tc.function?.name) call.function.name += tc.function.name;
      if (tc.function?.arguments) call.function.arguments += tc.function.arguments;
    }
    if (delta.reasoning_details) reasoningDetails.push(...delta.reasoning_details);
    const reasoningText = delta.reasoning ?? detailsText(delta.reasoning_details);
    if (reasoningText) {
      reasoningChars += reasoningText.length;
      handlers.onReasoning?.(reasoningChars);
    }
    for (const a of delta.annotations ?? []) {
      if (a.type === 'url_citation' && a.url_citation) handlers.onCitation(a.url_citation);
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  };

  await readSse(res.body, (data) => {
    if (data === '[DONE]') return;
    let parsed: Chunk;
    try {
      parsed = JSON.parse(data) as Chunk;
    } catch {
      return;
    }
    handleChunk(parsed);
  });

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
  onData: (data: string) => void,
): Promise<void> {
  const reader = body.getReader();
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
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
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

function describeErrorBody(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {}
  return raw.slice(0, 300) || 'request failed';
}

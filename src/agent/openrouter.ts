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

export type ChatMessage =
  | { role: 'user'; content: string }
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
};

type Delta = {
  content?: string | null;
  tool_calls?: {
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }[];
  reasoning_details?: unknown[];
  annotations?: { type: string; url_citation?: UrlCitation }[];
};

type Chunk = {
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
  const reasoningDetails: unknown[] = [];
  // Keyed by the delta's tool_call index. Server tools (web search/fetch) run
  // inside OpenRouter and consume indices without ever appearing here, so the
  // indices we see are not necessarily contiguous.
  const calls = new Map<number, ToolCall>();

  const handleChunk = (chunk: Chunk) => {
    if (chunk.error) {
      throw new Error(`OpenRouter: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
    }
    if (chunk.usage) usage = chunk.usage;
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

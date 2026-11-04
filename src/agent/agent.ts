import { streamChatCompletion, type ChatMessage, type ContentPart, type ToolCall } from './openrouter';
import { LeftAppError, leftAppSince } from './appLifecycle';
import { IMAGE_ATTACHED, IMAGE_DROPPED } from './debugTools';
import { executeTool, SERVER_TOOL_DEFINITIONS, TOOL_DEFINITIONS, type ToolResult } from './tools';
import { systemPromptFor } from './systemPrompt';

const MAX_TOKENS = 16384;
// Reasoning models (GLM 5.3 especially) can spend the whole output budget
// thinking and never call a tool. Capping reasoning at half leaves room to act.
const REASONING_BUDGET = 8192;
const MAX_TURNS = 25;
// Tool-call progress (path, chars) re-renders at most this often.
const TOOL_PROGRESS_INTERVAL_MS = 250;
// Screenshots stay as images only while the turn that took them is running,
// and only the latest few: each one is resent with every later request.
const MAX_LIVE_IMAGES = 2;

export type WebSearchHit = {
  title: string;
  url: string;
  page_age?: string | null;
};

// web_search / web_fetch results come from chats saved before the move to
// OpenRouter; new turns only produce web_search-shaped source lists.
export type ServerToolResult =
  | { kind: 'web_search'; results: WebSearchHit[] }
  | {
      kind: 'web_fetch';
      url: string;
      title: string | null;
      preview: string;
      retrieved_at: string | null;
    }
  | { kind: 'error'; error_code: string };

export type ServerToolName = 'web_search' | 'web_fetch' | 'web_sources';

export type AgentEvent =
  | { type: 'text_delta'; delta: string; blockIndex: number }
  // Approximate reasoning tokens so far in the current request; resets to 0
  // when the next request starts.
  | { type: 'reasoning'; tokens: number }
  // The model is writing a tool call; arguments (often a whole file) stream in
  // before tool_use fires. Repeats, throttled, as they grow. path comes from
  // the partial JSON once it's there; chars stays 0 on providers that send the
  // arguments in one piece at the end.
  | { type: 'tool_call_progress'; name: string; path: string | null; chars: number }
  // No bytes from the model for a long while (true), or bytes again (false).
  | { type: 'stall'; stalled: boolean }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; blockIndex: number }
  | { type: 'tool_result'; id: string; ok: boolean; text: string }
  | {
      type: 'server_tool_use';
      id: string;
      name: ServerToolName;
      input: Record<string, unknown>;
      blockIndex: number;
    }
  | { type: 'server_tool_result'; id: string; result: ServerToolResult }
  // The user left the app and that cut the connection; offered as Continue,
  // not as an error.
  | { type: 'paused' }
  // History as it stands mid-turn, already closed so it's valid to send, for
  // saving in case the app is killed before the turn ends.
  | { type: 'checkpoint'; history: ChatMessage[] }
  | { type: 'iteration_end' }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type AgentConfig = {
  apiKey: string;
  model: string;
  // Stable per conversation (we use the project id). OpenRouter uses it for
  // sticky provider routing, which is what keeps prompt caches warm across
  // turns — most providers (Z.AI, DeepSeek, Moonshot, OpenAI…) cache
  // automatically but only if consecutive requests hit the same endpoint.
  sessionId: string;
  // Picks the system prompt variant with or without auto app icons.
  autoAppIcons: boolean;
};

// How a turn ended. 'stopped' and 'error' still carry the partial history, so
// the next turn knows what already happened (files written, text said).
// 'paused': the user left the app mid-turn. 'interrupted': the app was killed
// mid-turn (only ever set when the chat is next loaded).
export type TurnStatus = 'done' | 'stopped' | 'error' | 'paused' | 'interrupted';

// Closes a checkpoint, so a turn cut short by the app being killed reads right.
export const INTERRUPTED_NOTE = '(Interrupted: Blank Slate was closed while this was running.)';

export type TurnOutcome = {
  history: ChatMessage[];
  status: TurnStatus;
};

export type AgentRun = {
  result: Promise<TurnOutcome>;
  // 'stalled' is the user giving up on a model that went quiet, to resend.
  abort: (reason?: 'user' | 'stalled') => void;
};

// userText null continues the last turn instead (Retry, Continue): its
// request and any finished tool rounds are already in prior.
export function runAgentTurn(
  config: AgentConfig,
  prior: ChatMessage[],
  userText: string | null,
  onEvent: (ev: AgentEvent) => void,
): AgentRun {
  const messages: ChatMessage[] =
    userText === null ? resumable(prior) : [...prior, { role: 'user', content: userText }];
  const startedAt = Date.now();
  const systemMessage = systemMessageFor(config.autoAppIcons);
  const controller = new AbortController();
  let aborted: 'user' | 'stalled' | null = null;

  const finish = (status: TurnStatus, note?: string): TurnOutcome => {
    closeTurn(messages, note);
    return { history: withoutImages(messages), status };
  };

  const checkpoint = () => {
    const copy = messages.slice();
    closeTurn(copy, INTERRUPTED_NOTE);
    onEvent({ type: 'checkpoint', history: withoutImages(copy) });
  };

  const result = (async (): Promise<TurnOutcome> => {
    // Text streamed by the request in flight, kept for a stop mid-stream.
    let partial = '';
    try {
      checkpoint();
      // Block indices keep UI entries ordered and unique across iterations. Each
      // iteration reserves: 0 = assistant text, 1 = web sources, 2.. = tool calls.
      let blockOffset = 0;

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        if (aborted) throw new Error('Aborted');

        const textBlock = blockOffset;
        const sourcesBlock = blockOffset + 1;
        const sourcesId = `web-${turn}-${Date.now()}`;
        const sources = new Map<string, { title: string; url: string }>();

        let lastReasoningTokens = 0;
        onEvent({ type: 'reasoning', tokens: 0 });
        partial = '';
        let lastArgsAt = 0;

        const streamed = await streamChatCompletion(
          config.apiKey,
          {
            model: config.model,
            max_tokens: MAX_TOKENS,
            messages: [systemMessage, ...messages],
            tools: [...TOOL_DEFINITIONS, ...SERVER_TOOL_DEFINITIONS],
            session_id: config.sessionId.slice(0, 256),
            ...cacheOptions(config.model),
            ...reasoningOptions(config.model),
          },
          controller.signal,
          {
            onText: (delta) => {
              partial += delta;
              onEvent({ type: 'text_delta', delta, blockIndex: textBlock });
            },
            onToolCall: (name) => {
              lastArgsAt = Date.now();
              onEvent({ type: 'tool_call_progress', name, path: null, chars: 0 });
            },
            onToolArgs: (name, args) => {
              const now = Date.now();
              if (now - lastArgsAt < TOOL_PROGRESS_INTERVAL_MS) return;
              lastArgsAt = now;
              onEvent({ type: 'tool_call_progress', name, path: partialPath(args), chars: args.length });
            },
            onStall: (stalled) => onEvent({ type: 'stall', stalled }),
            onReasoning: (chars) => {
              // ~4 chars per token; only re-render every 50 tokens or so.
              const tokens = Math.round(chars / 4);
              if (tokens - lastReasoningTokens < 50) return;
              lastReasoningTokens = tokens;
              onEvent({ type: 'reasoning', tokens });
            },
            onCitation: (c) => {
              if (sources.has(c.url)) return;
              if (sources.size === 0) {
                onEvent({
                  type: 'server_tool_use',
                  id: sourcesId,
                  name: 'web_sources',
                  input: {},
                  blockIndex: sourcesBlock,
                });
              }
              sources.set(c.url, { title: c.title || c.url, url: c.url });
              onEvent({
                type: 'server_tool_result',
                id: sourcesId,
                result: { kind: 'web_search', results: [...sources.values()] },
              });
            },
          },
        );
        partial = '';

        const { message, finishReason, usage, provider } = streamed;
        if (__DEV__ && usage) {
          const details = usage.prompt_tokens_details;
          console.log(
            `[agent] ${config.model} via ${provider ?? '?'} prompt=${usage.prompt_tokens} cached=${details?.cached_tokens ?? 0} ` +
              `cache_write=${details?.cache_write_tokens ?? 0} completion=${usage.completion_tokens} ` +
              `cost=$${usage.cost ?? '?'} finish=${finishReason} text=${JSON.stringify((message.content ?? '').slice(0, 80))}`,
          );
        }
        messages.push(withSources(message, sources));
        const toolCalls = message.tool_calls ?? [];
        blockOffset += 2 + toolCalls.length;

        if (finishReason === 'length' && toolCalls.length === 0) {
          const text = message.content
            ? 'The model hit its output limit before finishing.'
            : 'The model used its whole output budget thinking and never got to act. Try again, or pick a different model in Settings.';
          onEvent({ type: 'error', message: text });
          return finish('error', '(Cut off: hit the output limit.)');
        }
        if (toolCalls.length === 0) {
          onEvent({ type: 'done' });
          return finish('done');
        }

        const images: NonNullable<ToolResult['image']>[] = [];

        for (let i = 0; i < toolCalls.length; i++) {
          if (aborted) throw new Error('Aborted');
          const call = toolCalls[i];
          const parsed = parseArguments(call);
          onEvent({
            type: 'tool_use',
            id: call.id,
            name: call.function.name,
            input: parsed.ok ? parsed.input : {},
            blockIndex: textBlock + 2 + i,
          });
          const toolResult = parsed.ok
            ? await executeTool(call.function.name, parsed.input, {
                apiKey: config.apiKey,
                model: config.model,
                signal: controller.signal,
              })
            : { ok: false, text: parsed.error };
          if (toolResult.image) images.push(toolResult.image);
          onEvent({ type: 'tool_result', id: call.id, ok: toolResult.ok, text: toolResult.text });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: toolResult.ok ? toolResult.text : `Error: ${toolResult.text}`,
          });
          checkpoint();
        }
        // Tool results must directly follow the assistant message, so
        // screenshots go after all of them, as one user message.
        if (images.length) {
          messages.push({
            role: 'user',
            content: images.flatMap((img): ContentPart[] => [
              { type: 'text', text: img.caption },
              { type: 'image_url', image_url: { url: img.dataUrl } },
            ]),
          });
          dropOldImages(messages, MAX_LIVE_IMAGES);
        }

        onEvent({ type: 'iteration_end' });
      }

      onEvent({
        type: 'error',
        message: `Reached max ${MAX_TURNS} tool-use iterations without finishing.`,
      });
      return finish('error', `(Stopped after ${MAX_TURNS} rounds of tool calls without finishing.)`);
    } catch (e) {
      const message = (e as Error).message;
      if (partial.trim()) messages.push({ role: 'assistant', content: partial });
      if (!aborted && (e instanceof LeftAppError || leftAppSince(startedAt))) {
        if (__DEV__) console.log(`[agent] paused: the app was left mid-turn (${message})`);
        onEvent({ type: 'paused' });
        return finish('paused', '(Paused: the user left Blank Slate, which cut the connection. Nothing failed.)');
      }
      if (!aborted) onEvent({ type: 'error', message });
      if (aborted === 'stalled') {
        return finish('stopped', '(Cut off: the model stopped responding.)');
      }
      return aborted
        ? finish('stopped', '(Stopped by the user before finishing.)')
        : finish('error', `(This reply failed: ${message})`);
    }
  })();

  return {
    result,
    abort: (reason = 'user') => {
      aborted = reason;
      controller.abort();
    },
  };
}

// The system prompt (one variant per auto-icon setting and platform) and tool
// list are identical from request to request, so they form a stable cache
// prefix; history is append-only after them. The breakpoint on
// the system block is what Anthropic, Gemini and Qwen need for explicit
// caching; OpenRouter translates it for OpenAI and drops it elsewhere.
function systemMessageFor(autoAppIcons: boolean) {
  return {
    role: 'system' as const,
    content: [
      { type: 'text', text: systemPromptFor(autoAppIcons), cache_control: { type: 'ephemeral' } },
    ],
  };
}

function cacheOptions(model: string): Record<string, unknown> {
  // Claude also supports automatic caching: a top-level cache_control that
  // advances the breakpoint to the end of the growing conversation each turn,
  // so the tool-use loop re-reads prior iterations from cache.
  if (model.startsWith('anthropic/') || model.startsWith('~anthropic/')) {
    return { cache_control: { type: 'ephemeral' } };
  }
  return {};
}

function reasoningOptions(model: string): Record<string, unknown> {
  // On Claude, reasoning.max_tokens would switch extended thinking on (more
  // cost, different behavior), so leave Anthropic models alone.
  if (model.startsWith('anthropic/') || model.startsWith('~anthropic/')) return {};
  return { reasoning: { max_tokens: REASONING_BUDGET } };
}

// Hosted web search/fetch run inside the provider call and leave no trace in
// the message except url_citation annotations. Without a record, the next
// request shows the model claims with nothing behind them, and it decides it
// made them up, apologises and searches again. So the sources go into the
// saved reply itself. The UI renders from stream events, not this text.
function withSources(
  message: Extract<ChatMessage, { role: 'assistant' }>,
  sources: Map<string, { title: string; url: string }>,
): ChatMessage {
  if (!sources.size) return message;
  const list = [...sources.values()].map((s) => `- ${s.title} — ${s.url}`).join('\n');
  const note = `Web sources I consulted for this:\n${list}`;
  return { ...message, content: message.content ? `${message.content}\n\n${note}` : note };
}

// The path from a tool call's still-incomplete JSON arguments, once its closing quote has arrived.
function partialPath(args: string): string | null {
  return /"path"\s*:\s*"([^"]+)"/.exec(args)?.[1] ?? null;
}

function parseArguments(
  call: ToolCall,
): { ok: true; input: Record<string, unknown> } | { ok: false; error: string } {
  const raw = call.function.arguments.trim();
  if (!raw) return { ok: true, input: {} };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, input: parsed as Record<string, unknown> };
    }
    return { ok: false, error: 'Tool arguments must be a JSON object.' };
  } catch {
    // Truncated or malformed JSON (often from hitting max_tokens mid-call).
    // Tell the model so it can retry instead of silently running with {}.
    return { ok: false, error: `Could not parse tool arguments as JSON (${raw.length} chars).` };
  }
}

function imageCount(m: ChatMessage): number {
  return m.role === 'user' && Array.isArray(m.content)
    ? m.content.filter((p) => p.type === 'image_url').length
    : 0;
}

// Screenshot messages are removed outright rather than left as a text stub:
// a user-role line the user never typed reads to the model as injected text.
// The tool results that pointed at the image say it's gone instead.
function dropOldImages(messages: ChatMessage[], keep: number): void {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const n = imageCount(messages[i]);
    if (!n) continue;
    seen += n;
    if (seen <= keep) continue;
    messages.splice(i, 1);
    for (let j = i - 1; j >= 0; j--) {
      const m = messages[j];
      if (m.role !== 'tool') break;
      if (m.content.includes(IMAGE_ATTACHED)) {
        messages[j] = { ...m, content: m.content.replace(IMAGE_ATTACHED, IMAGE_DROPPED) };
      }
    }
  }
}

// Saved history never holds image data: it would bloat storage and be resent
// (and billed) on every later turn. The agent can fetch a screenshot again
// with get_screenshot.
function withoutImages(messages: ChatMessage[]): ChatMessage[] {
  const copy = messages.slice();
  dropOldImages(copy, 0);
  return copy;
}

// For continuing a turn that ended early: drops the closing note (and any
// partial reply it was appended to), leaving the request and every finished
// tool round, so the model picks up from there. closeTurn has already
// answered any tool call that never ran.
function resumable(prior: ChatMessage[]): ChatMessage[] {
  const messages = prior.slice();
  while (messages.length) {
    const last = messages[messages.length - 1];
    if (last.role !== 'assistant' || last.tool_calls?.length) break;
    messages.pop();
  }
  return messages;
}

// Leaves a stopped or failed turn as valid history: every tool call gets a
// result, and the note says plainly where and why it ended.
function closeTurn(messages: ChatMessage[], note?: string): void {
  const callIdx = findLastIndex(messages, (m) => m.role === 'assistant');
  const call = messages[callIdx];
  if (call?.role === 'assistant' && call.tool_calls?.length) {
    const answered = new Set(
      messages.slice(callIdx + 1).flatMap((m) => (m.role === 'tool' ? [m.tool_call_id] : [])),
    );
    // Results must come straight after the call, before any screenshot message.
    let at = callIdx + 1;
    while (messages[at]?.role === 'tool') at++;
    const missing = call.tool_calls
      .filter((c) => !answered.has(c.id))
      .map((c): ChatMessage => ({ role: 'tool', tool_call_id: c.id, content: 'Error: not run, the turn ended first.' }));
    messages.splice(at, 0, ...missing);
  }
  if (!note) return;
  const last = messages[messages.length - 1];
  if (last.role === 'assistant' && !last.tool_calls?.length) {
    messages[messages.length - 1] = { ...last, content: last.content ? `${last.content}\n\n${note}` : note };
  } else {
    messages.push({ role: 'assistant', content: note });
  }
}

function findLastIndex<T>(arr: T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
  return -1;
}

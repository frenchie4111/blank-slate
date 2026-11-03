import { streamChatCompletion, type ChatMessage, type ToolCall } from './openrouter';
import { executeTool, SERVER_TOOL_DEFINITIONS, TOOL_DEFINITIONS } from './tools';
import { systemPromptFor } from './systemPrompt';

const MAX_TOKENS = 16384;
// Reasoning models (GLM 5.3 especially) can spend the whole output budget
// thinking and never call a tool. Capping reasoning at half leaves room to act.
const REASONING_BUDGET = 8192;
const MAX_TURNS = 25;

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

export type AgentRun = {
  result: Promise<ChatMessage[]>;
  abort: () => void;
};

export function runAgentTurn(
  config: AgentConfig,
  prior: ChatMessage[],
  userText: string,
  onEvent: (ev: AgentEvent) => void,
): AgentRun {
  const messages: ChatMessage[] = [...prior, { role: 'user', content: userText }];
  const systemMessage = systemMessageFor(config.autoAppIcons);
  const controller = new AbortController();
  let aborted = false;

  const result = (async () => {
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

      let streamed;
      try {
        streamed = await streamChatCompletion(
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
            onText: (delta) => onEvent({ type: 'text_delta', delta, blockIndex: textBlock }),
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
      } catch (e) {
        if (aborted) throw new Error('Aborted');
        throw e;
      }

      const { message, finishReason, usage, provider } = streamed;
      if (__DEV__ && usage) {
        const details = usage.prompt_tokens_details;
        console.log(
          `[agent] ${config.model} via ${provider ?? '?'} prompt=${usage.prompt_tokens} cached=${details?.cached_tokens ?? 0} ` +
            `cache_write=${details?.cache_write_tokens ?? 0} completion=${usage.completion_tokens} ` +
            `cost=$${usage.cost ?? '?'} finish=${finishReason} text=${JSON.stringify((message.content ?? '').slice(0, 80))}`,
        );
      }
      messages.push(message);
      const toolCalls = message.tool_calls ?? [];
      blockOffset += 2 + toolCalls.length;

      if (finishReason === 'length' && toolCalls.length === 0) {
        onEvent({
          type: 'error',
          message: message.content
            ? 'The model hit its output limit before finishing.'
            : 'The model used its whole output budget thinking and never got to act. Try again, or pick a different model in Settings.',
        });
        return messages;
      }
      if (toolCalls.length === 0) {
        onEvent({ type: 'done' });
        return messages;
      }

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
              signal: controller.signal,
            })
          : { ok: false, text: parsed.error };
        onEvent({ type: 'tool_result', id: call.id, ok: toolResult.ok, text: toolResult.text });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: toolResult.ok ? toolResult.text : `Error: ${toolResult.text}`,
        });
      }

      onEvent({ type: 'iteration_end' });
    }

    onEvent({
      type: 'error',
      message: `Reached max ${MAX_TURNS} tool-use iterations without finishing.`,
    });
    return messages;
  })();

  result.catch((e) => {
    if (!aborted) onEvent({ type: 'error', message: (e as Error).message });
  });

  return {
    result,
    abort: () => {
      aborted = true;
      controller.abort();
    },
  };
}

// The system prompt (one of two variants, by the auto-icon setting) and tool
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

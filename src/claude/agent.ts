import type Anthropic from '@anthropic-ai/sdk';
import {
  CUSTOM_TOOL_NAMES,
  executeTool,
  SERVER_TOOL_DEFINITIONS,
  TOOL_DEFINITIONS,
} from './tools';
import { SYSTEM_PROMPT } from './systemPrompt';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 8192;
const MAX_TURNS = 25;

export type WebSearchHit = {
  title: string;
  url: string;
  page_age?: string | null;
};

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

export type AgentEvent =
  | { type: 'text_delta'; delta: string; blockIndex: number }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; blockIndex: number }
  | { type: 'tool_result'; id: string; ok: boolean; text: string }
  | {
      type: 'server_tool_use';
      id: string;
      name: 'web_search' | 'web_fetch';
      input: Record<string, unknown>;
      blockIndex: number;
    }
  | { type: 'server_tool_result'; id: string; result: ServerToolResult }
  | { type: 'iteration_end' }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type AgentRun = {
  result: Promise<Anthropic.MessageParam[]>;
  abort: () => void;
};

export function runAgentTurn(
  client: Anthropic,
  prior: Anthropic.MessageParam[],
  userText: string,
  onEvent: (ev: AgentEvent) => void,
): AgentRun {
  const messages: Anthropic.MessageParam[] = [
    ...prior,
    { role: 'user', content: userText },
  ];

  let aborted = false;
  let currentStream: ReturnType<Anthropic['messages']['stream']> | null = null;

  const result = (async () => {
    let blockOffset = 0;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (aborted) throw new Error('Aborted');

      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        tools: [...TOOL_DEFINITIONS, ...SERVER_TOOL_DEFINITIONS],
        messages,
      });
      currentStream = stream;

      const liveToolBlocks = new Map<
        number,
        { id: string; name: string; json: string; server: boolean }
      >();
      const emittedResults = new Set<string>();

      stream.on('streamEvent', (event) => {
        if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            liveToolBlocks.set(event.index, {
              id: block.id,
              name: block.name,
              json: '',
              server: false,
            });
          } else if (block.type === 'server_tool_use') {
            liveToolBlocks.set(event.index, {
              id: block.id,
              name: block.name,
              json: '',
              server: true,
            });
          } else if (
            block.type === 'web_search_tool_result' ||
            block.type === 'web_fetch_tool_result'
          ) {
            const parsed = parseServerToolResult(block);
            if (parsed) {
              emittedResults.add(block.tool_use_id);
              onEvent({ type: 'server_tool_result', id: block.tool_use_id, result: parsed });
            }
          }
        } else if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if (delta.type === 'text_delta') {
            onEvent({
              type: 'text_delta',
              delta: delta.text,
              blockIndex: blockOffset + event.index,
            });
          } else if (delta.type === 'input_json_delta') {
            const b = liveToolBlocks.get(event.index);
            if (b) b.json += delta.partial_json;
          }
        } else if (event.type === 'content_block_stop') {
          const b = liveToolBlocks.get(event.index);
          if (b) {
            let input: Record<string, unknown> = {};
            try {
              input = b.json ? (JSON.parse(b.json) as Record<string, unknown>) : {};
            } catch {}
            if (b.server) {
              onEvent({
                type: 'server_tool_use',
                id: b.id,
                name: b.name as 'web_search' | 'web_fetch',
                input,
                blockIndex: blockOffset + event.index,
              });
            } else {
              onEvent({
                type: 'tool_use',
                id: b.id,
                name: b.name,
                input,
                blockIndex: blockOffset + event.index,
              });
            }
            liveToolBlocks.delete(event.index);
          }
        }
      });

      let final: Anthropic.Message;
      try {
        final = await stream.finalMessage();
      } catch (e) {
        if (aborted) throw new Error('Aborted');
        throw e;
      }

      // Emit any server tool results that weren't surfaced mid-stream (belt-and-suspenders).
      for (const block of final.content) {
        if (
          (block.type === 'web_search_tool_result' ||
            block.type === 'web_fetch_tool_result') &&
          !emittedResults.has(block.tool_use_id)
        ) {
          const parsed = parseServerToolResult(block);
          if (parsed) {
            onEvent({ type: 'server_tool_result', id: block.tool_use_id, result: parsed });
          }
        }
      }

      messages.push({ role: 'assistant', content: final.content });
      blockOffset += final.content.length;

      if (final.stop_reason !== 'tool_use') {
        onEvent({ type: 'done' });
        return messages;
      }

      const customToolUses = final.content.filter(
        (b): b is Anthropic.ToolUseBlock =>
          b.type === 'tool_use' && CUSTOM_TOOL_NAMES.has(b.name),
      );

      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
      for (const use of customToolUses) {
        if (aborted) throw new Error('Aborted');
        const input = (use.input ?? {}) as Record<string, unknown>;
        const toolResult = await executeTool(use.name, input);
        onEvent({ type: 'tool_result', id: use.id, ok: toolResult.ok, text: toolResult.text });
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: toolResult.text,
          is_error: !toolResult.ok,
        });
      }

      if (toolResultBlocks.length === 0) {
        // stop_reason was tool_use but every tool_use was a server tool handled inline;
        // the conversation is effectively complete for this turn.
        onEvent({ type: 'done' });
        return messages;
      }

      messages.push({ role: 'user', content: toolResultBlocks });
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
      currentStream?.abort();
    },
  };
}

function parseServerToolResult(
  block:
    | Anthropic.WebSearchToolResultBlock
    | Anthropic.WebFetchToolResultBlock,
): ServerToolResult | null {
  if (block.type === 'web_search_tool_result') {
    const content = block.content;
    if (Array.isArray(content)) {
      return {
        kind: 'web_search',
        results: content.slice(0, 5).map((r) => ({
          title: r.title,
          url: r.url,
          page_age: r.page_age ?? null,
        })),
      };
    }
    return { kind: 'error', error_code: content.error_code };
  }
  if (block.type === 'web_fetch_tool_result') {
    const content = block.content;
    if (content.type === 'web_fetch_tool_result_error') {
      return { kind: 'error', error_code: content.error_code };
    }
    const doc = content.content;
    const src = doc.source;
    const preview =
      src.type === 'text'
        ? truncate(src.data, 800)
        : `(${src.media_type} content, not previewable)`;
    return {
      kind: 'web_fetch',
      url: content.url,
      title: doc.title ?? null,
      preview,
      retrieved_at: content.retrieved_at ?? null,
    };
  }
  return null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `… (${s.length - max} more chars)`;
}

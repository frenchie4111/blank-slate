import type Anthropic from '@anthropic-ai/sdk';
import { executeTool, TOOL_DEFINITIONS } from './tools';
import { SYSTEM_PROMPT } from './systemPrompt';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 8192;
const MAX_TURNS = 25;

export type AgentEvent =
  | { type: 'text_delta'; delta: string; blockIndex: number }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; blockIndex: number }
  | { type: 'tool_result'; id: string; ok: boolean; text: string }
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
        tools: TOOL_DEFINITIONS,
        messages,
      });
      currentStream = stream;

      const liveToolBlocks = new Map<
        number,
        { id: string; name: string; json: string }
      >();

      stream.on('streamEvent', (event) => {
        if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            liveToolBlocks.set(event.index, {
              id: block.id,
              name: block.name,
              json: '',
            });
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
            onEvent({
              type: 'tool_use',
              id: b.id,
              name: b.name,
              input,
              blockIndex: blockOffset + event.index,
            });
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

      messages.push({ role: 'assistant', content: final.content });
      blockOffset += final.content.length;

      if (final.stop_reason !== 'tool_use') {
        onEvent({ type: 'done' });
        return messages;
      }

      const toolUses = final.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
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

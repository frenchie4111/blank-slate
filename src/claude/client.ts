import Anthropic from '@anthropic-ai/sdk';
import { fetch as expoFetch } from 'expo/fetch';
import { SYSTEM_PROMPT } from './systemPrompt';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 8192;

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type StreamHandle = {
  onText: (fn: (delta: string, accumulated: string) => void) => void;
  result: Promise<string>;
  abort: () => void;
};

export function createClient(apiKey: string) {
  return new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    fetch: expoFetch as unknown as typeof fetch,
  });
}

export function streamReply(
  client: Anthropic,
  history: ChatMessage[],
  currentSource: string | null,
): StreamHandle {
  let listener: ((delta: string, accumulated: string) => void) | null = null;
  let accumulated = '';

  const messages: ChatMessage[] = [...history];
  if (currentSource) {
    messages.unshift({
      role: 'user',
      content: `(Context only — do not repeat this back.) The currently rendered component source is:\n\n\`\`\`tsx\n${currentSource}\n\`\`\``,
    });
    messages.unshift({
      role: 'assistant',
      content: 'Got it — I will replace that with whatever you ask for next.',
    });
  }

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages,
  });

  stream.on('text', (delta) => {
    accumulated += delta;
    listener?.(delta, accumulated);
  });

  const result = stream.finalMessage().then((msg) => {
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return text;
  });

  return {
    onText(fn) {
      listener = fn;
    },
    result,
    abort() {
      stream.abort();
    },
  };
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ServerToolName, ServerToolResult, TurnStatus } from '../agent/agent';
import type { ChatMessage, ToolCall } from '../agent/openrouter';
import { chatEntriesKeyFor, chatHistoryKeyFor } from './store';

export type ToolEntry = {
  kind: 'tool';
  id: string;
  blockIndex: number;
  name: string;
  input: Record<string, unknown>;
  result?: { ok: boolean; text: string };
};

export type ServerToolEntry = {
  kind: 'serverTool';
  id: string;
  blockIndex: number;
  name: ServerToolName;
  input: Record<string, unknown>;
  result?: ServerToolResult;
};

export type Entry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; blockIndex: number; text: string }
  | ToolEntry
  | ServerToolEntry
  | { kind: 'error'; id: string; text: string }
  // Neutral status line in the transcript. Chats saved before turnEnd
  // existed use it for "Stopped".
  | { kind: 'notice'; id: string; text: string }
  // Closes each turn with how it ended; only "stopped" shows anything.
  | { kind: 'turnEnd'; id: string; status: TurnStatus };

export type ChatSnapshot = {
  history: ChatMessage[];
  entries: Entry[];
};

const EMPTY: ChatSnapshot = { history: [], entries: [] };

export async function loadChat(projectId: string): Promise<ChatSnapshot> {
  const [historyRaw, entriesRaw] = await Promise.all([
    AsyncStorage.getItem(chatHistoryKeyFor(projectId)),
    AsyncStorage.getItem(chatEntriesKeyFor(projectId)),
  ]);
  let history: ChatMessage[] = [];
  let entries: Entry[] = [];
  try {
    if (historyRaw) {
      const parsed = JSON.parse(historyRaw);
      if (Array.isArray(parsed)) history = migrateHistory(parsed);
    }
  } catch {}
  try {
    if (entriesRaw) {
      const parsed = JSON.parse(entriesRaw);
      if (Array.isArray(parsed)) entries = parsed as Entry[];
    }
  } catch {}
  return { history, entries };
}

export async function saveChat(projectId: string, snapshot: ChatSnapshot): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(chatHistoryKeyFor(projectId), JSON.stringify(snapshot.history)),
    AsyncStorage.setItem(chatEntriesKeyFor(projectId), JSON.stringify(snapshot.entries)),
  ]);
}

export function emptySnapshot(): ChatSnapshot {
  return { ...EMPTY, history: [], entries: [] };
}

// Chats saved before the switch to OpenRouter hold Anthropic MessageParams,
// whose content can be an array of typed blocks. New-format messages never
// have array content, so we convert only those and pass the rest through.
// Anthropic server-tool blocks (hosted web search/fetch) have no
// chat-completions equivalent and are dropped; the text around them stays.
type LegacyBlock = {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};

function migrateHistory(raw: unknown[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const msg = m as { role?: string; content?: unknown };
    if (!Array.isArray(msg.content)) {
      out.push(m as ChatMessage);
      continue;
    }
    const blocks = msg.content as LegacyBlock[];
    if (msg.role === 'assistant') {
      const text = blocks
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n\n');
      const toolCalls: ToolCall[] = blocks
        .filter((b) => b.type === 'tool_use' && b.id && b.name)
        .map((b) => ({
          id: b.id!,
          type: 'function',
          function: { name: b.name!, arguments: JSON.stringify(b.input ?? {}) },
        }));
      if (!text && toolCalls.length === 0) continue;
      out.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
    } else if (msg.role === 'user') {
      for (const b of blocks) {
        if (b.type === 'tool_result' && b.tool_use_id) {
          const body = legacyContentText(b.content);
          out.push({
            role: 'tool',
            tool_call_id: b.tool_use_id,
            content: b.is_error ? `Error: ${body}` : body,
          });
        }
      }
      const text = blocks
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n\n');
      if (text) out.push({ role: 'user', content: text });
    }
  }
  return out;
}

function legacyContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' && 'text' in c ? String(c.text) : ''))
      .join('');
  }
  return '';
}

import type Anthropic from '@anthropic-ai/sdk';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { chatEntriesKeyFor, chatHistoryKeyFor } from './store';

export type ToolEntry = {
  kind: 'tool';
  id: string;
  blockIndex: number;
  name: string;
  input: Record<string, unknown>;
  result?: { ok: boolean; text: string };
};

export type Entry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; blockIndex: number; text: string }
  | ToolEntry
  | { kind: 'error'; id: string; text: string };

export type ChatSnapshot = {
  history: Anthropic.MessageParam[];
  entries: Entry[];
};

const EMPTY: ChatSnapshot = { history: [], entries: [] };

export async function loadChat(projectId: string): Promise<ChatSnapshot> {
  const [historyRaw, entriesRaw] = await Promise.all([
    AsyncStorage.getItem(chatHistoryKeyFor(projectId)),
    AsyncStorage.getItem(chatEntriesKeyFor(projectId)),
  ]);
  let history: Anthropic.MessageParam[] = [];
  let entries: Entry[] = [];
  try {
    if (historyRaw) {
      const parsed = JSON.parse(historyRaw);
      if (Array.isArray(parsed)) history = parsed as Anthropic.MessageParam[];
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

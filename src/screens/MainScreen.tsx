import type Anthropic from '@anthropic-ai/sdk';
import React from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { runAgentTurn, type AgentEvent, type AgentRun } from '../claude/agent';
import { createClient } from '../claude/client';
import { DynamicView } from '../dynamic/DynamicView';
import { seedIfEmpty } from '../vfs/seed';

const ICON_SRC = require('../../assets/icon.png');

type UserEntry = { kind: 'user'; id: string; text: string };
type AssistantTextEntry = { kind: 'assistant'; id: string; blockIndex: number; text: string };
type ToolEntry = {
  kind: 'tool';
  id: string;
  blockIndex: number;
  name: string;
  input: Record<string, unknown>;
  result?: { ok: boolean; text: string };
};
type ErrorEntry = { kind: 'error'; id: string; text: string };
type Entry = UserEntry | AssistantTextEntry | ToolEntry | ErrorEntry;

type Props = { apiKey: string; onResetKey: () => void };

export function MainScreen({ apiKey, onResetKey }: Props) {
  const clientRef = React.useRef<Anthropic | null>(null);
  if (!clientRef.current) clientRef.current = createClient(apiKey);

  const [entries, setEntries] = React.useState<Entry[]>([]);
  const [input, setInput] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [seeded, setSeeded] = React.useState(false);
  const [chatVisible, setChatVisible] = React.useState(false);
  const historyRef = React.useRef<Anthropic.MessageParam[]>([]);
  const runRef = React.useRef<AgentRun | null>(null);
  const scrollRef = React.useRef<ScrollView | null>(null);

  React.useEffect(() => {
    seedIfEmpty().finally(() => setSeeded(true));
  }, []);

  const handleEvent = React.useCallback((ev: AgentEvent) => {
    if (ev.type === 'text_delta') {
      setEntries((prev) => {
        const idx = prev.findIndex(
          (e) => e.kind === 'assistant' && e.blockIndex === ev.blockIndex,
        );
        if (idx >= 0) {
          const copy = prev.slice();
          const existing = copy[idx] as AssistantTextEntry;
          copy[idx] = { ...existing, text: existing.text + ev.delta };
          return copy;
        }
        return [
          ...prev,
          {
            kind: 'assistant',
            id: `a-${ev.blockIndex}-${prev.length}`,
            blockIndex: ev.blockIndex,
            text: ev.delta,
          },
        ];
      });
    } else if (ev.type === 'tool_use') {
      setEntries((prev) => [
        ...prev,
        {
          kind: 'tool',
          id: ev.id,
          blockIndex: ev.blockIndex,
          name: ev.name,
          input: ev.input,
        },
      ]);
    } else if (ev.type === 'tool_result') {
      setEntries((prev) => {
        const idx = prev.findIndex((e) => e.kind === 'tool' && e.id === ev.id);
        if (idx < 0) return prev;
        const copy = prev.slice();
        const existing = copy[idx] as ToolEntry;
        copy[idx] = { ...existing, result: { ok: ev.ok, text: ev.text } };
        return copy;
      });
    } else if (ev.type === 'error') {
      setEntries((prev) => [
        ...prev,
        { kind: 'error', id: `err-${prev.length}`, text: ev.message },
      ]);
    }
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || running) return;
    setInput('');
    setRunning(true);
    setEntries((prev) => [
      ...prev,
      { kind: 'user', id: `u-${prev.length}`, text },
    ]);
    try {
      const run = runAgentTurn(clientRef.current!, historyRef.current, text, handleEvent);
      runRef.current = run;
      const nextHistory = await run.result;
      historyRef.current = nextHistory;
    } catch (e) {
      // runAgentTurn already emits 'error' to handleEvent; swallow here.
    } finally {
      setRunning(false);
      runRef.current = null;
    }
  };

  if (!seeded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.appLayer}>
        <DynamicView />
      </View>

      {chatVisible ? null : (
        <Pressable
          style={styles.floatingBadge}
          onPress={() => setChatVisible(true)}
          hitSlop={10}
          accessibilityLabel="Open Blank Slate chat"
        >
          <Image source={ICON_SRC} style={styles.floatingBadgeIcon} />
        </Pressable>
      )}

      {chatVisible ? (
        <View style={styles.chatOverlay}>
          <KeyboardAvoidingView
            style={StyleSheet.absoluteFill}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.chatHeader}>
              <Pressable
                onPress={() => setChatVisible(false)}
                hitSlop={10}
                style={styles.chatHeaderLeft}
                accessibilityLabel="Back to app"
              >
                <Image source={ICON_SRC} style={styles.chatHeaderIcon} />
                <Text style={styles.chatHeaderTitle}>Blank Slate</Text>
              </Pressable>
              <View style={styles.chatHeaderActions}>
                <Pressable onPress={() => setChatVisible(false)} hitSlop={10}>
                  <Text style={styles.headerAction}>back to app</Text>
                </Pressable>
                <Pressable onPress={onResetKey} hitSlop={10}>
                  <Text style={styles.headerAction}>reset key</Text>
                </Pressable>
              </View>
            </View>

            <ScrollView
              ref={scrollRef}
              contentContainerStyle={styles.messages}
              onContentSizeChange={() =>
                scrollRef.current?.scrollToEnd({ animated: true })
              }
            >
              {entries.length === 0 ? (
                <Text style={styles.hint}>
                  Tell Claude what to build — e.g. "a counter with a red increment button,
                  and extract the button into components/Button.tsx".
                </Text>
              ) : (
                entries.map((e) => <EntryView key={e.id} entry={e} />)
              )}
              {running ? (
                <View style={styles.statusRow}>
                  <ActivityIndicator size="small" color="#6b7280" />
                  <Text style={styles.statusText}>thinking…</Text>
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.inputRow}>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="ask claude to build something"
                placeholderTextColor="#888"
                style={styles.input}
                editable={!running}
                multiline
                onSubmitEditing={send}
                returnKeyType="send"
                blurOnSubmit
              />
              <Pressable
                style={[styles.sendBtn, (!input.trim() || running) && styles.sendBtnDisabled]}
                onPress={send}
                disabled={!input.trim() || running}
              >
                {running ? (
                  <ActivityIndicator color="#0b0b0f" size="small" />
                ) : (
                  <Text style={styles.sendBtnText}>send</Text>
                )}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      ) : null}
    </View>
  );
}

function EntryView({ entry }: { entry: Entry }) {
  if (entry.kind === 'user') {
    return (
      <View style={[styles.bubble, styles.bubbleUser]}>
        <Text style={styles.bubbleTextUser}>{entry.text}</Text>
      </View>
    );
  }
  if (entry.kind === 'assistant') {
    return (
      <View style={[styles.bubble, styles.bubbleAssistant]}>
        <Text style={styles.bubbleTextAssistant}>{entry.text || '…'}</Text>
      </View>
    );
  }
  if (entry.kind === 'error') {
    return (
      <View style={[styles.bubble, styles.bubbleError]}>
        <Text style={styles.bubbleTextError}>⚠︎ {entry.text}</Text>
      </View>
    );
  }
  return <ToolCard entry={entry} />;
}

function ToolCard({ entry }: { entry: ToolEntry }) {
  const [expanded, setExpanded] = React.useState(false);
  const summary = formatToolSummary(entry.name, entry.input);
  const icon = iconFor(entry.name);
  return (
    <Pressable onPress={() => setExpanded((v) => !v)} style={styles.toolCard}>
      <View style={styles.toolHeader}>
        <Text style={styles.toolIcon}>{icon}</Text>
        <Text style={styles.toolSummary} numberOfLines={expanded ? 0 : 1}>
          {summary}
        </Text>
        {entry.result ? (
          <Text style={[styles.toolStatus, entry.result.ok ? styles.toolOk : styles.toolErr]}>
            {entry.result.ok ? '✓' : '✗'}
          </Text>
        ) : (
          <ActivityIndicator size="small" color="#6b7280" />
        )}
      </View>
      {expanded ? (
        <View style={styles.toolBody}>
          <Text style={styles.toolLabel}>input</Text>
          <Text style={styles.toolDetail}>{safeJson(entry.input)}</Text>
          {entry.result ? (
            <>
              <Text style={styles.toolLabel}>result</Text>
              <Text style={styles.toolDetail}>{entry.result.text}</Text>
            </>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function formatToolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'read_file':
      return `read_file(${stringOr(input.path, '?')})`;
    case 'write_file': {
      const content = typeof input.content === 'string' ? input.content : '';
      return `write_file(${stringOr(input.path, '?')}, ${content.length} chars)`;
    }
    case 'edit_file': {
      const oldLen = typeof input.old_string === 'string' ? input.old_string.length : 0;
      const newLen = typeof input.new_string === 'string' ? input.new_string.length : 0;
      return `edit_file(${stringOr(input.path, '?')}, ${oldLen} → ${newLen} chars)`;
    }
    case 'list_files':
      return 'list_files()';
    case 'delete_file':
      return `delete_file(${stringOr(input.path, '?')})`;
    default:
      return `${name}(${safeJson(input)})`;
  }
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function iconFor(name: string): string {
  switch (name) {
    case 'read_file':
      return '📖';
    case 'write_file':
      return '＋';
    case 'edit_file':
      return '✎';
    case 'list_files':
      return '⧉';
    case 'delete_file':
      return '🗑';
    default:
      return '•';
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0f' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b0b0f' },
  appLayer: { flex: 1 },
  floatingBadge: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 36,
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(11, 11, 15, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  floatingBadgeIcon: { width: 28, height: 28, borderRadius: 6 },
  chatOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0b0b0f',
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 48 : 32,
    paddingBottom: 10,
    backgroundColor: '#0b0b0f',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  chatHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chatHeaderIcon: { width: 22, height: 22, borderRadius: 5 },
  chatHeaderTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  chatHeaderActions: { flexDirection: 'row', gap: 16 },
  headerAction: { color: '#9ca3af', fontSize: 12 },
  messages: { padding: 12, gap: 8, flexGrow: 1 },
  hint: {
    color: '#6b7280',
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 24,
    paddingHorizontal: 16,
    lineHeight: 20,
  },
  bubble: {
    maxWidth: '88%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  bubbleUser: {
    backgroundColor: '#2563eb',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: '#1f2937',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  bubbleError: {
    backgroundColor: '#7f1d1d',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  bubbleTextUser: { color: '#fff', fontSize: 14, lineHeight: 20 },
  bubbleTextAssistant: { color: '#e5e7eb', fontSize: 14, lineHeight: 20 },
  bubbleTextError: { color: '#fecaca', fontSize: 13, lineHeight: 18 },
  toolCard: {
    alignSelf: 'stretch',
    backgroundColor: '#111827',
    borderColor: '#1f2937',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  toolHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toolIcon: { fontSize: 14, color: '#9ca3af', width: 16, textAlign: 'center' },
  toolSummary: {
    flex: 1,
    color: '#d1d5db',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  toolStatus: { fontSize: 13, fontWeight: '700' },
  toolOk: { color: '#10b981' },
  toolErr: { color: '#ef4444' },
  toolBody: { marginTop: 8, gap: 4 },
  toolLabel: { color: '#6b7280', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  toolDetail: {
    color: '#9ca3af',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  statusText: { color: '#6b7280', fontSize: 12 },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    backgroundColor: '#0b0b0f',
  },
  input: {
    flex: 1,
    backgroundColor: '#1a1a1f',
    borderColor: '#2a2a30',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    maxHeight: 120,
  },
  sendBtn: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 64,
  },
  sendBtnDisabled: { opacity: 0.3 },
  sendBtnText: { color: '#0b0b0f', fontWeight: '700', fontSize: 13 },
});

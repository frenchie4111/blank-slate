import type Anthropic from '@anthropic-ai/sdk';
import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { createClient, streamReply, type ChatMessage } from '../claude/client';
import { DynamicView } from '../dynamic/DynamicView';
import { extractCode } from '../dynamic/evaluator';
import {
  latest,
  loadHistory,
  popVersion,
  saveVersion,
  type SourceVersion,
} from '../storage/sourceStore';

type Props = { apiKey: string; onResetKey: () => void };

type Bubble = ChatMessage & { streaming?: boolean };

export function MainScreen({ apiKey, onResetKey }: Props) {
  const clientRef = React.useRef<Anthropic | null>(null);
  if (!clientRef.current) clientRef.current = createClient(apiKey);

  const [history, setHistory] = React.useState<SourceVersion[]>([]);
  const [messages, setMessages] = React.useState<Bubble[]>([]);
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [chatVisible, setChatVisible] = React.useState(true);
  const scrollRef = React.useRef<ScrollView | null>(null);

  const source = latest(history);

  React.useEffect(() => {
    let alive = true;
    loadHistory().then((h) => {
      if (alive) setHistory(h);
    });
    return () => {
      alive = false;
    };
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);

    const nextMessages: Bubble[] = [
      ...messages,
      { role: 'user', content: text },
      { role: 'assistant', content: '', streaming: true },
    ];
    setMessages(nextMessages);

    const forClaude: ChatMessage[] = nextMessages
      .slice(0, -1)
      .map(({ role, content }) => ({ role, content }));

    try {
      const stream = streamReply(clientRef.current!, forClaude, source);
      stream.onText((_delta, accumulated) => {
        setMessages((prev) => {
          const copy = prev.slice();
          const last = copy[copy.length - 1];
          if (last && last.role === 'assistant') {
            copy[copy.length - 1] = { ...last, content: accumulated };
          }
          return copy;
        });
      });

      const final = await stream.result;

      setMessages((prev) => {
        const copy = prev.slice();
        const last = copy[copy.length - 1];
        if (last && last.role === 'assistant') {
          copy[copy.length - 1] = { role: 'assistant', content: final };
        }
        return copy;
      });

      const code = extractCode(final);
      if (code) {
        const nextHistory = await saveVersion(code);
        setHistory(nextHistory);
      }
    } catch (e) {
      const err = e as Error;
      setMessages((prev) => {
        const copy = prev.slice();
        const last = copy[copy.length - 1];
        if (last && last.role === 'assistant' && last.streaming) {
          copy[copy.length - 1] = {
            role: 'assistant',
            content: `[error calling Claude: ${err.message}]`,
          };
        } else {
          copy.push({ role: 'assistant', content: `[error: ${err.message}]` });
        }
        return copy;
      });
    } finally {
      setSending(false);
    }
  };

  const rollback = async () => {
    const next = await popVersion();
    setHistory(next);
  };

  return (
    <View style={styles.root}>
      {chatVisible ? (
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Blank Slate</Text>
          <View style={styles.headerActions}>
            <Pressable onPress={() => setChatVisible(false)} hitSlop={10}>
              <Text style={styles.headerAction}>hide chat</Text>
            </Pressable>
            <Pressable onPress={onResetKey} hitSlop={10}>
              <Text style={styles.headerAction}>reset key</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {chatVisible ? (
          <>
            <View style={styles.chatPane}>
              <ScrollView
                ref={scrollRef}
                contentContainerStyle={styles.messages}
                onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
              >
                {messages.length === 0 ? (
                  <Text style={styles.hint}>
                    Describe what you want. e.g. "a habit tracker with a red theme and a streak
                    counter."
                  </Text>
                ) : (
                  messages.map((m, i) => <MessageBubble key={i} message={m} />)
                )}
              </ScrollView>

              <View style={styles.inputRow}>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder="ask claude to build something"
                  placeholderTextColor="#888"
                  style={styles.input}
                  editable={!sending}
                  multiline
                  onSubmitEditing={send}
                  returnKeyType="send"
                  blurOnSubmit
                />
                <Pressable
                  style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
                  onPress={send}
                  disabled={!input.trim() || sending}
                >
                  {sending ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.sendBtnText}>send</Text>
                  )}
                </Pressable>
              </View>
            </View>
            <View style={styles.divider} />
          </>
        ) : null}

        <View style={styles.dynamicPane}>
          <DynamicView source={source} onRollback={history.length > 1 ? rollback : undefined} />
        </View>
      </KeyboardAvoidingView>

      {!chatVisible ? (
        <Pressable
          style={styles.revealPill}
          onPress={() => setChatVisible(true)}
          hitSlop={8}
          accessibilityLabel="Show chat"
        >
          <Text style={styles.revealPillText}>chat</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function MessageBubble({ message }: { message: Bubble }) {
  const isUser = message.role === 'user';
  return (
    <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
      <Text style={isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant}>
        {message.content || (message.streaming ? '…' : '')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0f' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 48 : 32,
    paddingBottom: 10,
    backgroundColor: '#0b0b0f',
  },
  headerTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  headerActions: { flexDirection: 'row', gap: 16 },
  headerAction: { color: '#9ca3af', fontSize: 12 },
  body: { flex: 1 },
  chatPane: { flex: 1, backgroundColor: '#0b0b0f' },
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
    maxWidth: '85%',
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
  bubbleTextUser: { color: '#fff', fontSize: 14, lineHeight: 20 },
  bubbleTextAssistant: { color: '#e5e7eb', fontSize: 14, lineHeight: 20 },
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
  divider: { height: 1, backgroundColor: '#1f2937' },
  dynamicPane: { flex: 1, backgroundColor: '#fff' },
  revealPill: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 48 : 32,
    right: 16,
    backgroundColor: 'rgba(11, 11, 15, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  revealPillText: { color: '#fff', fontSize: 11, fontWeight: '600' },
});

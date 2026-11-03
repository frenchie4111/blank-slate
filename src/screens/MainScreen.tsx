import { Ionicons } from '@expo/vector-icons';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { runAgentTurn, type AgentEvent, type AgentRun } from '../agent/agent';
import type { ChatMessage } from '../agent/openrouter';
import { DynamicView, type RenderError } from '../dynamic/DynamicView';
import { clearCompileCache } from '../dynamic/resolver';
import { AppIcon } from '../components/AppIcon';
import * as debugHistory from '../debug/history';
import { onAppError } from '../debug/instrument';
import { scheduleAutoCapture } from '../debug/screenshot';
import {
  loadChat,
  saveChat,
  type Entry,
  type ServerToolEntry,
  type ToolEntry,
} from '../project/chatStore';
import * as projectStore from '../project/store';
import type { Project } from '../project/store';
import { getAutoAppIcons, getModel } from '../storage/keyStore';
import { colors, fonts, radii, space } from '../theme';
import { LogoMark } from '../theme/LogoMark';
import * as vfs from '../vfs/vfs';
import { DraggableBadge } from './DraggableBadge';
import { FilesPanel } from './FileViewer';
import { HistoryPanel } from './HistoryPanel';
import { Markdown } from './Markdown';
import { SettingsScreen } from './SettingsScreen';
import { buildRenderItems, ToolGroupCard, type RenderItem } from './ToolGroup';
import { YourAppsScreen } from './YourAppsScreen';

type Props = { apiKey: string; onResetKey: () => void };

export function MainScreen({ apiKey, onResetKey }: Props) {
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = React.useState<Entry[]>([]);
  const [input, setInput] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [reasoningTokens, setReasoningTokens] = React.useState(0);
  const [ready, setReady] = React.useState(false);
  const [chatVisible, setChatVisible] = React.useState(false);
  const [settingsVisible, setSettingsVisible] = React.useState(false);
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [currentId, setCurrentId] = React.useState<string | null>(null);
  // Every cold launch lands on the Your apps home screen.
  const [appsOpen, setAppsOpen] = React.useState(true);
  // The generated app isn't mounted (or evaluated) until one is opened from
  // home, so a crashing app can never get in the way of reaching home.
  const [appOpened, setAppOpened] = React.useState(false);
  const [fileCount, setFileCount] = React.useState(0);
  const [activeTab, setActiveTab] = React.useState<'chat' | 'files' | 'history'>('chat');
  const [renderRevision, setRenderRevision] = React.useState(0);
  const [renderError, setRenderError] = React.useState<RenderError | null>(null);

  const historyRef = React.useRef<ChatMessage[]>([]);
  const runRef = React.useRef<AgentRun | null>(null);
  // The whole in-flight turn, including its bookkeeping after the agent stops.
  const turnRef = React.useRef<Promise<void> | null>(null);
  const stoppedRef = React.useRef(false);
  const scrollRef = React.useRef<ScrollView | null>(null);
  const activeProjectRef = React.useRef<string | null>(null);
  const renderErrorRef = React.useRef<RenderError | null>(null);

  const refreshProjects = React.useCallback(async () => {
    const [list, snapshot] = await Promise.all([
      projectStore.list(),
      Promise.resolve(projectStore.getCurrentProjectIdSync()).then((id) => loadChat(id)),
    ]);
    setProjects(list);
    const id = projectStore.getCurrentProjectIdSync();
    setCurrentId(id);
    activeProjectRef.current = id;
    historyRef.current = snapshot.history;
    setEntries(snapshot.entries);
  }, []);

  React.useEffect(() => {
    let alive = true;
    projectStore
      .init()
      .then(refreshProjects)
      .then(() => alive && setReady(true))
      .catch((e: Error) => {
        console.warn('project init failed', e);
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [refreshProjects]);

  React.useEffect(() => {
    return projectStore.subscribe(() => {
      const nextId = projectStore.getCurrentProjectIdSync();
      if (nextId === activeProjectRef.current) {
        projectStore.list().then(setProjects);
        return;
      }
      clearCompileCache();
      activeProjectRef.current = nextId;
      setCurrentId(nextId);
      setEntries([]);
      historyRef.current = [];
      loadChat(nextId).then((snapshot) => {
        if (activeProjectRef.current !== nextId) return;
        historyRef.current = snapshot.history;
        setEntries(snapshot.entries);
      });
      projectStore.list().then(setProjects);
      setRenderRevision((r) => r + 1);
    });
  }, []);

  React.useEffect(() => {
    if (!currentId) return;
    let alive = true;
    const refresh = () => vfs.listFiles().then((l) => alive && setFileCount(l.length));
    refresh();
    const unsub = vfs.subscribe(refresh);
    return () => {
      alive = false;
      unsub();
    };
  }, [currentId]);

  // Takes the project explicitly: setEntries updaters can run after a switch
  // has already moved activeProjectRef on.
  const persist = React.useCallback(
    (id: string | null, history: ChatMessage[], nextEntries: Entry[]) => {
      if (!id) return;
      saveChat(id, { history, entries: nextEntries }).catch(() => {});
    },
    [],
  );

  const handleEvent = React.useCallback((ev: AgentEvent) => {
    if (ev.type === 'text_delta') {
      setEntries((prev) => {
        // blockIndex restarts at 0 every turn, so only match entries after the
        // latest user message — otherwise new text appends to an old reply.
        const turnStart = findLastIndex(prev, (e) => e.kind === 'user') + 1;
        const found = prev
          .slice(turnStart)
          .findIndex((e) => e.kind === 'assistant' && e.blockIndex === ev.blockIndex);
        const idx = found >= 0 ? turnStart + found : -1;
        if (idx >= 0) {
          const copy = prev.slice();
          const existing = copy[idx] as Extract<Entry, { kind: 'assistant' }>;
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
    } else if (ev.type === 'server_tool_use') {
      setEntries((prev) => [
        ...prev,
        {
          kind: 'serverTool',
          id: ev.id,
          blockIndex: ev.blockIndex,
          name: ev.name,
          input: ev.input,
        },
      ]);
    } else if (ev.type === 'server_tool_result') {
      setEntries((prev) => {
        const idx = prev.findIndex((e) => e.kind === 'serverTool' && e.id === ev.id);
        if (idx < 0) return prev;
        const copy = prev.slice();
        const existing = copy[idx] as ServerToolEntry;
        copy[idx] = { ...existing, result: ev.result };
        return copy;
      });
    } else if (ev.type === 'reasoning') {
      setReasoningTokens(ev.tokens);
    } else if (ev.type === 'error') {
      setEntries((prev) => [
        ...prev,
        { kind: 'error', id: `err-${prev.length}`, text: ev.message },
      ]);
    }
  }, []);

  const doTurn = React.useCallback(
    async (text: string): Promise<void> => {
      setRunning(true);
      stoppedRef.current = false;
      setEntries((prev) => [...prev, { kind: 'user', id: `u-${prev.length}`, text }]);
      const projectAtStart = activeProjectRef.current;
      const priorHistory = historyRef.current;
      // Screenshot the result once the turn is over, if it changed any files.
      let wrote = false;
      const unsubWrites = vfs.subscribe(() => {
        wrote = true;
      });
      try {
        const [model, autoAppIcons] = await Promise.all([getModel(), getAutoAppIcons()]);
        if (stoppedRef.current) throw new Error('Aborted');
        const run = runAgentTurn(
          { apiKey, model, sessionId: `blank-slate:${projectAtStart ?? 'default'}`, autoAppIcons },
          priorHistory,
          text,
          handleEvent,
        );
        runRef.current = run;
        const nextHistory = await run.result;
        historyRef.current = nextHistory;
        if (projectAtStart === activeProjectRef.current) {
          setEntries((latest) => {
            persist(projectAtStart, nextHistory, latest);
            return latest;
          });
        }
        if (projectAtStart) projectStore.touch(projectAtStart).catch(() => {});
      } catch {
        // runAgentTurn already emits 'error' via handleEvent, except on a
        // user stop: keep the request in history so the next turn has context
        // (any files already written stay written).
        if (stoppedRef.current && projectAtStart === activeProjectRef.current) {
          const nextHistory: ChatMessage[] = [
            ...priorHistory,
            { role: 'user', content: text },
            { role: 'assistant', content: '(Stopped by the user before finishing.)' },
          ];
          historyRef.current = nextHistory;
          setEntries((prev) => {
            const next: Entry[] = [
              ...prev,
              { kind: 'notice', id: `stop-${prev.length}`, text: 'Stopped' },
            ];
            persist(projectAtStart, nextHistory, next);
            return next;
          });
        }
      } finally {
        unsubWrites();
        if (wrote && projectAtStart === activeProjectRef.current) {
          scheduleAutoCapture('after agent turn', 1200);
        }
        setRunning(false);
        setReasoningTokens(0);
        runRef.current = null;
      }
    },
    [apiKey, handleEvent, persist],
  );

  const runTurn = React.useCallback(
    async (text: string): Promise<void> => {
      if (!text.trim() || turnRef.current) return;
      const turn = doTurn(text);
      turnRef.current = turn;
      try {
        await turn;
      } finally {
        if (turnRef.current === turn) turnRef.current = null;
      }
    },
    [doTurn],
  );

  const stop = () => {
    if (!runRef.current) return;
    stoppedRef.current = true;
    runRef.current.abort();
  };

  // Stops the running turn and waits until it has fully settled. Tools await
  // their VFS writes, and the VFS writes into whichever project is current, so
  // this must finish before any switch or delete of the current project.
  const stopAndWait = React.useCallback(async () => {
    const turn = turnRef.current;
    if (!turn) return;
    stoppedRef.current = true;
    runRef.current?.abort();
    await turn;
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || running) return;
    setInput('');
    await runTurn(text);
  };

  const fixRenderErrorNow = React.useCallback(() => {
    const err = renderErrorRef.current;
    if (!err || running) return;
    setChatVisible(true);
    setActiveTab('chat');
    runTurn(formatRenderErrorPrompt(err));
  }, [running, runTurn]);

  const handleRenderError = React.useCallback((err: RenderError) => {
    renderErrorRef.current = err;
    setTimeout(() => setRenderError(err), 0);
  }, []);

  const handleRenderClear = React.useCallback(() => {
    renderErrorRef.current = null;
    setTimeout(() => setRenderError(null), 0);
  }, []);

  // Errors thrown in the app's event handlers and timers don't crash the
  // render, so nothing else would tell the user. Show them in the banner until
  // the next edit.
  React.useEffect(() => {
    const offError = onAppError(({ event, message, source }) => {
      scheduleAutoCapture('error', 300);
      if (renderErrorRef.current && renderErrorRef.current.stage !== 'handler') return;
      handleRenderError({
        stage: 'handler',
        path: source,
        message,
        stack: event?.detail,
        eventId: event?.id,
      });
    });
    const offVfs = vfs.subscribe(() => {
      if (renderErrorRef.current?.stage === 'handler') handleRenderClear();
    });
    return () => {
      offError();
      offVfs();
    };
  }, [handleRenderError, handleRenderClear]);

  const askAgent = React.useCallback((text: string) => {
    setInput(text);
    setActiveTab('chat');
  }, []);

  const openApps = () => setAppsOpen(true);

  const showApp = () => {
    setAppOpened(true);
    setChatVisible(false);
  };

  // Leaves home for a project: its preview, or its chat when there's nothing
  // to look at yet (a new or untouched app).
  const enterApp = async (id: string, opts: { chat?: boolean } = {}) => {
    if (id !== activeProjectRef.current) {
      await stopAndWait();
      await projectStore.switchTo(id);
    }
    const chat = opts.chat || (await isUntouched(id));
    setAppOpened(true);
    setAppsOpen(false);
    if (chat) setActiveTab('chat');
    setChatVisible(chat);
  };

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.dust} />
      </View>
    );
  }

  const currentProject = projects.find((p) => p.id === currentId) ?? null;
  const canSend = !!input.trim() && !running;

  return (
    <View style={styles.root}>
      <View style={styles.appLayer}>
        {appOpened ? (
          <DynamicView
            revision={renderRevision}
            onError={handleRenderError}
            onClear={handleRenderClear}
            onFix={fixRenderErrorNow}
          />
        ) : null}
      </View>

      {chatVisible || appsOpen ? null : (
        <DraggableBadge
          size={56}
          style={styles.floatingBadge}
          onPress={() => setChatVisible(true)}
          onLongPress={openApps}
          accessibilityLabel="Open Blank Slate chat"
        >
          <LogoMark size={24} />
        </DraggableBadge>
      )}

      {chatVisible ? (
        <View style={styles.chatOverlay}>
          <KeyboardAvoidingView
            style={[StyleSheet.absoluteFill, { paddingTop: insets.top }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.chatHeader}>
              <Pressable
                onPress={openApps}
                style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Your apps"
              >
                <Ionicons name="home-outline" size={20} color={colors.dust} />
              </Pressable>
              <View style={styles.title} accessibilityRole="header">
                {currentProject ? <AppIcon project={currentProject} size={24} /> : null}
                <Text style={styles.projectTitle} numberOfLines={1}>
                  {currentProject?.name ?? 'Blank Slate'}
                </Text>
              </View>
              <Pressable
                onPress={showApp}
                style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="View app"
              >
                <Ionicons name="eye-outline" size={21} color={colors.dust} />
              </Pressable>
            </View>

            <View style={styles.segmentWrap}>
              <View style={styles.segment}>
                <SegmentButton
                  label="Chat"
                  active={activeTab === 'chat'}
                  onPress={() => setActiveTab('chat')}
                />
                <SegmentButton
                  label={fileCount ? `Files · ${fileCount}` : 'Files'}
                  active={activeTab === 'files'}
                  onPress={() => setActiveTab('files')}
                />
                <SegmentButton
                  label="History"
                  active={activeTab === 'history'}
                  onPress={() => setActiveTab('history')}
                />
              </View>
            </View>

            {renderError ? (
              <View style={styles.crash}>
                <View style={styles.crashText}>
                  <Text style={styles.crashTitle}>
                    {renderError.stage === 'runtime'
                      ? 'App crashed while rendering'
                      : renderError.stage === 'handler'
                        ? 'App threw an error'
                        : `App failed during ${renderError.stage}`}
                  </Text>
                  <Text style={styles.crashMsg} numberOfLines={1}>
                    {renderError.stage === 'handler'
                      ? renderError.message
                      : `${renderError.path} · ${renderError.message}`}
                  </Text>
                </View>
                <Pressable
                  style={({ pressed }) => [
                    styles.fixBtn,
                    (running || pressed) && styles.pressed,
                  ]}
                  onPress={fixRenderErrorNow}
                  disabled={running}
                  accessibilityRole="button"
                >
                  <Text style={styles.fixBtnText}>Fix it</Text>
                </Pressable>
              </View>
            ) : null}

            {activeTab === 'chat' ? (
              <>
                <ChatLog
                  entries={entries}
                  running={running}
                  reasoningTokens={reasoningTokens}
                  scrollRef={scrollRef}
                />

                <View style={[styles.composerWrap, { paddingBottom: 10 + insets.bottom }]}>
                  <View style={styles.composer}>
                    <TextInput
                      value={input}
                      onChangeText={setInput}
                      placeholder="Describe something to build"
                      placeholderTextColor={colors.dust}
                      style={styles.input}
                      multiline
                      // RN Web renders a 2-row textarea by default.
                      numberOfLines={Platform.OS === 'web' ? 1 : undefined}
                      onSubmitEditing={send}
                      returnKeyType="send"
                      blurOnSubmit
                      accessibilityLabel="Message"
                    />
                    {running ? (
                      <Pressable
                        style={({ pressed }) => [styles.sendBtn, pressed && styles.pressed]}
                        onPress={stop}
                        accessibilityRole="button"
                        accessibilityLabel="Stop"
                      >
                        <View style={styles.stopSquare} />
                      </Pressable>
                    ) : (
                      <Pressable
                        style={({ pressed }) => [
                          styles.sendBtn,
                          !canSend && styles.sendBtnIdle,
                          pressed && styles.pressed,
                        ]}
                        onPress={send}
                        disabled={!canSend}
                        accessibilityRole="button"
                        accessibilityLabel="Send"
                      >
                        <Ionicons
                          name="arrow-up"
                          size={22}
                          color={canSend ? colors.slate : colors.dust}
                        />
                      </Pressable>
                    )}
                  </View>
                </View>
              </>
            ) : activeTab === 'files' ? (
              <FilesPanel projectId={currentId} />
            ) : (
              <HistoryPanel projectId={currentId} appOpened={appOpened} onAskAgent={askAgent} />
            )}
          </KeyboardAvoidingView>
        </View>
      ) : null}

      {appsOpen ? (
        <View style={styles.fullOverlay}>
          <YourAppsScreen
            projects={projects}
            currentId={currentId}
            running={running}
            onStopBuild={stopAndWait}
            onSettings={() => setSettingsVisible(true)}
            onOpen={(id) => enterApp(id)}
            onCreated={(id) => enterApp(id, { chat: true })}
          />
        </View>
      ) : null}

      {settingsVisible ? (
        <View style={styles.fullOverlay}>
          <SettingsScreen
            apiKey={apiKey}
            onBack={() => setSettingsVisible(false)}
            onResetKey={async () => {
              setSettingsVisible(false);
              await onResetKey();
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

function SegmentButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.segmentBtn, active && styles.segmentBtnActive]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ChatLog({
  entries,
  running,
  reasoningTokens,
  scrollRef,
}: {
  entries: Entry[];
  running: boolean;
  reasoningTokens: number;
  scrollRef: React.RefObject<ScrollView | null>;
}) {
  const items = React.useMemo(() => buildRenderItems(entries, running), [entries, running]);
  const last = items[items.length - 1];
  // A live tool group shows its own spinner; otherwise show "Thinking" until
  // the reply's first text arrives. Long reasoning gets a row (with a count)
  // even under a live tool group, so it never looks hung.
  const thinking =
    running &&
    !isStreamingText(last) &&
    (!(last?.type === 'tools' && last.active) || reasoningTokens >= 200);
  // Follow new output only while the reader is at the bottom, so expanding a
  // tool card further up doesn't yank the view away. Jumps (not animated
  // scrolls) keep onScroll from seeing mid-animation offsets.
  const stickRef = React.useRef(true);
  React.useEffect(() => {
    if (running) stickRef.current = true;
  }, [running]);
  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.messages}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={64}
      onScroll={({ nativeEvent: n }) => {
        const fromBottom = n.contentSize.height - n.layoutMeasurement.height - n.contentOffset.y;
        stickRef.current = fromBottom < 48;
      }}
      onContentSizeChange={() => {
        if (stickRef.current) scrollRef.current?.scrollToEnd({ animated: false });
      }}
    >
      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>What should this app become?</Text>
          <Text style={styles.emptyBody}>
            Try "a counter with a red increment button, and pull the button into
            components/Button.tsx".
          </Text>
        </View>
      ) : (
        items.map((item) => <ItemView key={item.id} item={item} />)
      )}
      {thinking ? (
        <View style={styles.thinking}>
          <ActivityIndicator size="small" color={colors.dust} />
          <Text style={styles.thinkingText}>
            {reasoningTokens >= 200 ? `Thinking… ${formatTokens(reasoningTokens)} tokens` : 'Thinking…'}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function formatTokens(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`;
}

function isStreamingText(item: RenderItem | undefined): boolean {
  return item?.type === 'entry' && item.entry.kind === 'assistant';
}

function ItemView({ item }: { item: RenderItem }) {
  if (item.type === 'tools') return <ToolGroupCard steps={item.steps} active={item.active} />;
  return <EntryView entry={item.entry} />;
}

// Memoized so a streaming chunk only re-renders the entry it touched —
// handleEvent keeps object identity for every other entry.
const EntryView = React.memo(function EntryView({
  entry,
}: {
  entry: Exclude<Entry, ToolEntry | ServerToolEntry>;
}) {
  if (entry.kind === 'user') {
    return (
      <View style={styles.userBubble}>
        <Text style={styles.userText}>{entry.text}</Text>
      </View>
    );
  }
  if (entry.kind === 'assistant') {
    // Whitespace-only blocks are filtered out by buildRenderItems.
    return (
      <View style={styles.assistant}>
        <Markdown text={entry.text.trim()} />
      </View>
    );
  }
  if (entry.kind === 'notice') {
    return (
      <View style={styles.notice}>
        <Ionicons name="stop-circle-outline" size={14} color={colors.dust} />
        <Text style={styles.noticeText}>{entry.text}</Text>
      </View>
    );
  }
  return (
    <View style={styles.errorCard}>
      <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
      <Text style={styles.errorText}>{entry.text}</Text>
    </View>
  );
});

// Nothing built yet: just the starter App.tsx and an empty chat. Reads the
// current project, so call it after switching. Matches on the starter's title
// line so apps seeded with older starter copy still count.
async function isUntouched(id: string): Promise<boolean> {
  const [files, chat] = await Promise.all([vfs.listFiles(), loadChat(id)]);
  if (chat.history.length > 0 || chat.entries.length > 0) return false;
  if (files.length !== 1 || files[0] !== 'App.tsx') return false;
  const code = await vfs.readFile('App.tsx');
  return !!code && code.includes('<Text style={styles.title}>Blank Slate</Text>');
}

function formatRenderErrorPrompt(err: RenderError): string {
  const ref = err.eventId !== undefined ? ` (error #${err.eventId})` : '';
  const label =
    err.stage === 'runtime'
      ? `crashed at runtime in ${err.path}${ref}`
      : err.stage === 'handler'
        ? `threw an error in an event handler or timer${ref}`
        : `failed during ${err.stage} in ${err.path}${ref}`;
  const trimmedStack = err.stack
    ? err.stack.split('\n').slice(0, 8).join('\n')
    : '';
  const stackBlock = trimmedStack ? `\n\nStack (first frames):\n${trimmedStack}` : '';
  const recent = recentHistoryLines(err.eventId);
  const recentBlock = recent ? `\n\nRecent app history:\n${recent}` : '';
  const ask =
    err.stage === 'handler'
      ? 'Please find the cause and fix it.'
      : `Please read ${err.path} and fix it so the app loads.`;
  return `The app ${label}:\n\n${err.message}${stackBlock}${recentBlock}\n\n${ask}`;
}

// The last few events leading up to (and including) the error, so the agent
// starts with context. Screenshots are left out; it can fetch them.
function recentHistoryLines(eventId: number | undefined): string {
  const events = debugHistory
    .query({ session: debugHistory.currentSession(), limit: 40 })
    .filter((e) => e.type !== 'screenshot' && (eventId === undefined || e.id <= eventId));
  return events
    .slice(-8)
    .map((e) => debugHistory.formatLine(e))
    .join('\n');
}

function findLastIndex<T>(arr: T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
  return -1;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.slate },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.slate },
  appLayer: { flex: 1 },
  pressed: { opacity: 0.7 },
  floatingBadge: {
    // Position and size come from DraggableBadge.
    backgroundColor: colors.board,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
  },
  chatOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.slate },
  fullOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.slate },

  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 12,
  },
  title: {
    flex: 1,
    minWidth: 0,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  projectTitle: {
    flexShrink: 1,
    fontFamily: fonts.displaySemi,
    fontSize: 19,
    letterSpacing: -0.2,
    color: colors.chalk,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.board,
    alignItems: 'center',
    justifyContent: 'center',
  },

  segmentWrap: { paddingHorizontal: space.chatGutter, paddingTop: 4, paddingBottom: 12 },
  segment: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.board,
  },
  segmentBtn: {
    flex: 1,
    height: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnActive: { backgroundColor: colors.line },
  segmentText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.dust },
  segmentTextActive: { fontFamily: fonts.bodySemi, color: colors.chalk },

  crash: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: space.chatGutter,
    marginBottom: 8,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 12,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerBg,
  },
  crashText: { flex: 1, minWidth: 0, gap: 2 },
  crashTitle: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.danger },
  crashMsg: { fontFamily: fonts.mono, fontSize: 11, color: colors.dangerSoft },
  fixBtn: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radii.chip,
    backgroundColor: colors.accent,
    justifyContent: 'center',
  },
  fixBtnText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.slate },

  messages: {
    flexGrow: 1,
    gap: 12,
    paddingHorizontal: space.chatGutter,
    paddingTop: 8,
    paddingBottom: 16,
  },
  empty: { flex: 1, justifyContent: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 40 },
  emptyTitle: {
    fontFamily: fonts.displaySemi,
    fontSize: 20,
    letterSpacing: -0.2,
    textAlign: 'center',
    color: colors.chalk,
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    color: colors.dust,
  },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 6,
    borderBottomLeftRadius: 18,
    backgroundColor: colors.chalk,
  },
  userText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.slate },
  assistant: { alignSelf: 'stretch' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  noticeText: { fontFamily: fonts.mono, fontSize: 12, color: colors.dust },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerBg,
  },
  errorText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.danger },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  thinkingText: { fontFamily: fonts.body, fontSize: 13, color: colors.dust },

  composerWrap: {
    paddingTop: 10,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.slate,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingVertical: 6,
    paddingRight: 6,
    paddingLeft: 16,
    borderRadius: radii.composer,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.board,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    paddingTop: 12,
    paddingBottom: 12,
    color: colors.chalk,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 20,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnIdle: { backgroundColor: colors.raised },
  stopSquare: { width: 12, height: 12, borderRadius: 3, backgroundColor: colors.slate },
});

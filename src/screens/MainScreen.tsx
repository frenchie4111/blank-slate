import type Anthropic from '@anthropic-ai/sdk';
import React from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { runAgentTurn, type AgentEvent, type AgentRun } from '../claude/agent';
import { createClient } from '../claude/client';
import { DynamicView, type RenderError } from '../dynamic/DynamicView';
import { clearCompileCache } from '../dynamic/resolver';
import {
  emptySnapshot,
  loadChat,
  saveChat,
  type Entry,
  type ToolEntry,
} from '../project/chatStore';
import * as projectStore from '../project/store';
import type { Project } from '../project/store';
import { FilesPanel } from './FileViewer';

const ICON_SRC = require('../../assets/icon.png');

type Props = { apiKey: string; onResetKey: () => void };

export function MainScreen({ apiKey, onResetKey }: Props) {
  const insets = useSafeAreaInsets();
  const clientRef = React.useRef<Anthropic | null>(null);
  if (!clientRef.current) clientRef.current = createClient(apiKey);

  const [entries, setEntries] = React.useState<Entry[]>([]);
  const [input, setInput] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [chatVisible, setChatVisible] = React.useState(false);
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [currentId, setCurrentId] = React.useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<'chat' | 'files'>('chat');
  const [renderRevision, setRenderRevision] = React.useState(0);
  const [renderError, setRenderError] = React.useState<RenderError | null>(null);

  const historyRef = React.useRef<Anthropic.MessageParam[]>([]);
  const runRef = React.useRef<AgentRun | null>(null);
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

  const persist = React.useCallback(
    (history: Anthropic.MessageParam[], nextEntries: Entry[]) => {
      const id = activeProjectRef.current;
      if (!id) return;
      saveChat(id, { history, entries: nextEntries }).catch(() => {});
    },
    [],
  );

  const handleEvent = React.useCallback((ev: AgentEvent) => {
    if (ev.type === 'text_delta') {
      setEntries((prev) => {
        const idx = prev.findIndex(
          (e) => e.kind === 'assistant' && e.blockIndex === ev.blockIndex,
        );
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
    } else if (ev.type === 'error') {
      setEntries((prev) => [
        ...prev,
        { kind: 'error', id: `err-${prev.length}`, text: ev.message },
      ]);
    }
  }, []);

  const runTurn = React.useCallback(
    async (text: string): Promise<void> => {
      if (!text.trim()) return;
      setRunning(true);
      setEntries((prev) => [...prev, { kind: 'user', id: `u-${prev.length}`, text }]);
      const projectAtStart = activeProjectRef.current;
      try {
        const run = runAgentTurn(clientRef.current!, historyRef.current, text, handleEvent);
        runRef.current = run;
        const nextHistory = await run.result;
        historyRef.current = nextHistory;
        if (projectAtStart === activeProjectRef.current) {
          setEntries((latest) => {
            persist(nextHistory, latest);
            return latest;
          });
        }
      } catch {
        // runAgentTurn already emits 'error' via handleEvent.
      } finally {
        setRunning(false);
        runRef.current = null;
      }
    },
    [handleEvent, persist],
  );

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

  const openSwitcher = () => {
    if (running) return;
    setSwitcherOpen(true);
  };

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  const currentProject = projects.find((p) => p.id === currentId) ?? null;

  return (
    <View style={styles.root}>
      <View style={styles.appLayer}>
        <DynamicView
          revision={renderRevision}
          onError={handleRenderError}
          onClear={handleRenderClear}
          onFix={fixRenderErrorNow}
        />
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
                style={styles.chatHeaderBadge}
                accessibilityLabel="Back to app"
              >
                <Image source={ICON_SRC} style={styles.chatHeaderIcon} />
              </Pressable>
              <Pressable
                onPress={openSwitcher}
                hitSlop={8}
                style={styles.projectTitleBtn}
                disabled={running}
              >
                <Text style={styles.projectTitle} numberOfLines={1}>
                  {currentProject?.name ?? 'Blank Slate'}
                </Text>
                <Text style={styles.projectChevron}>▾</Text>
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

            <View style={styles.tabBar}>
              <TabButton
                label="Chat"
                active={activeTab === 'chat'}
                onPress={() => setActiveTab('chat')}
              />
              <TabButton
                label="Files"
                active={activeTab === 'files'}
                onPress={() => setActiveTab('files')}
              />
            </View>

            {renderError ? (
              <View style={styles.errorBanner}>
                <View style={styles.errorBannerText}>
                  <Text style={styles.errorBannerTitle}>
                    App crashed: {renderError.stage} in {renderError.path}
                  </Text>
                  <Text style={styles.errorBannerMsg} numberOfLines={2}>
                    {renderError.message}
                  </Text>
                </View>
                <Pressable
                  style={[styles.errorBannerBtn, running && styles.errorBannerBtnDisabled]}
                  onPress={fixRenderErrorNow}
                  disabled={running}
                >
                  <Text style={styles.errorBannerBtnText}>Fix</Text>
                </Pressable>
              </View>
            ) : null}

            {activeTab === 'chat' ? (
              <>
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

                <View style={[styles.inputRow, { paddingBottom: 10 + insets.bottom }]}>
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
              </>
            ) : (
              <FilesPanel projectId={currentId} />
            )}
          </KeyboardAvoidingView>
        </View>
      ) : null}

      <ProjectSwitcher
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        projects={projects}
        currentId={currentId}
      />
    </View>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.tabBtn, active && styles.tabBtnActive]}>
      <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ProjectSwitcher({
  open,
  onClose,
  projects,
  currentId,
}: {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  currentId: string | null;
}) {
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState('');

  React.useEffect(() => {
    if (!open) {
      setCreating(false);
      setNewName('');
      setRenamingId(null);
      setRenameValue('');
    }
  }, [open]);

  const handleSwitch = async (id: string) => {
    if (id === currentId || busy) return;
    setBusy(true);
    try {
      await projectStore.switchTo(id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const project = await projectStore.create(newName);
      await projectStore.switchTo(project.id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleStartRename = (p: Project) => {
    setRenamingId(p.id);
    setRenameValue(p.name);
  };

  const handleSubmitRename = async () => {
    if (!renamingId || busy) return;
    setBusy(true);
    try {
      await projectStore.rename(renamingId, renameValue);
      setRenamingId(null);
      setRenameValue('');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (busy || projects.length <= 1) return;
    setBusy(true);
    try {
      await projectStore.remove(id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      transparent
      visible={open}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.sheetOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Projects</Text>

          <ScrollView style={styles.sheetList}>
            {projects.map((p) => {
              const isCurrent = p.id === currentId;
              const isRenaming = renamingId === p.id;
              return (
                <View key={p.id} style={styles.projectRow}>
                  {isRenaming ? (
                    <TextInput
                      value={renameValue}
                      onChangeText={setRenameValue}
                      autoFocus
                      style={styles.renameInput}
                      onSubmitEditing={handleSubmitRename}
                      returnKeyType="done"
                      placeholder="project name"
                      placeholderTextColor="#6b7280"
                    />
                  ) : (
                    <Pressable
                      style={styles.projectNameBtn}
                      onPress={() => handleSwitch(p.id)}
                      disabled={busy}
                    >
                      <Text style={[styles.projectName, isCurrent && styles.projectNameCurrent]}>
                        {p.name}
                      </Text>
                      {isCurrent ? <Text style={styles.currentMark}>current</Text> : null}
                    </Pressable>
                  )}
                  <View style={styles.projectActions}>
                    {isRenaming ? (
                      <>
                        <Pressable onPress={handleSubmitRename} hitSlop={6}>
                          <Text style={styles.actionText}>save</Text>
                        </Pressable>
                        <Pressable onPress={() => setRenamingId(null)} hitSlop={6}>
                          <Text style={styles.actionTextMuted}>cancel</Text>
                        </Pressable>
                      </>
                    ) : (
                      <>
                        <Pressable onPress={() => handleStartRename(p)} hitSlop={6}>
                          <Text style={styles.actionTextMuted}>rename</Text>
                        </Pressable>
                        {projects.length > 1 ? (
                          <Pressable onPress={() => handleDelete(p.id)} hitSlop={6}>
                            <Text style={styles.actionTextDanger}>delete</Text>
                          </Pressable>
                        ) : null}
                      </>
                    )}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.sheetFooter}>
            {creating ? (
              <View style={styles.newRow}>
                <TextInput
                  value={newName}
                  onChangeText={setNewName}
                  autoFocus
                  placeholder="name (e.g. habit tracker)"
                  placeholderTextColor="#6b7280"
                  style={styles.newInput}
                  onSubmitEditing={handleCreate}
                  returnKeyType="done"
                />
                <Pressable
                  style={[styles.newBtn, busy && styles.newBtnDisabled]}
                  onPress={handleCreate}
                  disabled={busy}
                >
                  <Text style={styles.newBtnText}>create</Text>
                </Pressable>
                <Pressable onPress={() => setCreating(false)} hitSlop={6}>
                  <Text style={styles.actionTextMuted}>cancel</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={styles.addProjectBtn}
                onPress={() => setCreating(true)}
                disabled={busy}
              >
                <Text style={styles.addProjectText}>+ New project</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
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

function formatRenderErrorPrompt(err: RenderError): string {
  const label = err.stage === 'runtime' ? 'crashed at runtime' : `failed during ${err.stage}`;
  const trimmedStack = err.stack
    ? err.stack.split('\n').slice(0, 8).join('\n')
    : '';
  const stackBlock = trimmedStack ? `\n\nStack (first frames):\n${trimmedStack}` : '';
  return `The app ${label} in ${err.path}:\n\n${err.message}${stackBlock}\n\nPlease read ${err.path} and fix it so the app loads.`;
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
    // Positioned so the 26px icon centered inside this 44px badge lines
    // up with the 26px chat-header icon at paddingHorizontal:16,
    // paddingTop:(ios?48:32) — i.e. top-left offset by (44-26)/2 = 9 px.
    position: 'absolute',
    top: Platform.OS === 'ios' ? 39 : 23,
    left: 7,
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
  floatingBadgeIcon: { width: 26, height: 26, borderRadius: 6 },
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
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 48 : 32,
    paddingBottom: 10,
    backgroundColor: '#0b0b0f',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  chatHeaderBadge: { flexShrink: 0 },
  chatHeaderIcon: { width: 26, height: 26, borderRadius: 6 },
  projectTitleBtn: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#111827',
  },
  projectTitle: { color: '#fff', fontSize: 14, fontWeight: '600', maxWidth: 180 },
  projectChevron: { color: '#9ca3af', fontSize: 12 },
  chatHeaderActions: { flexDirection: 'row', gap: 16, marginLeft: 'auto' },
  headerAction: { color: '#9ca3af', fontSize: 12 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#0b0b0f',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  tabBtn: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -1,
  },
  tabBtnActive: { borderBottomColor: '#fff' },
  tabBtnText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  tabBtnTextActive: { color: '#fff' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#3b0d10',
    borderBottomWidth: 1,
    borderBottomColor: '#7f1d1d',
  },
  errorBannerText: { flex: 1 },
  errorBannerTitle: { color: '#fecaca', fontSize: 12, fontWeight: '700' },
  errorBannerMsg: { color: '#fca5a5', fontSize: 11, marginTop: 2 },
  errorBannerBtn: {
    backgroundColor: '#d93025',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
  },
  errorBannerBtnDisabled: { opacity: 0.5 },
  errorBannerBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
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

  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  sheet: {
    backgroundColor: '#111827',
    borderRadius: 14,
    maxHeight: '80%',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  sheetTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  sheetList: { maxHeight: 360 },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    gap: 10,
  },
  projectNameBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  projectName: { color: '#e5e7eb', fontSize: 14 },
  projectNameCurrent: { color: '#fff', fontWeight: '700' },
  currentMark: {
    color: '#10b981',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  renameInput: {
    flex: 1,
    backgroundColor: '#0b0b0f',
    borderWidth: 1,
    borderColor: '#2a2a30',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: '#fff',
    fontSize: 14,
  },
  projectActions: { flexDirection: 'row', gap: 10 },
  actionText: { color: '#60a5fa', fontSize: 12 },
  actionTextMuted: { color: '#9ca3af', fontSize: 12 },
  actionTextDanger: { color: '#ef4444', fontSize: 12 },
  sheetFooter: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    backgroundColor: '#0b0b0f',
  },
  addProjectBtn: {
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#1f2937',
  },
  addProjectText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  newInput: {
    flex: 1,
    backgroundColor: '#1a1a1f',
    borderWidth: 1,
    borderColor: '#2a2a30',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#fff',
    fontSize: 13,
  },
  newBtn: {
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  newBtnDisabled: { opacity: 0.4 },
  newBtnText: { color: '#0b0b0f', fontWeight: '700', fontSize: 12 },
});

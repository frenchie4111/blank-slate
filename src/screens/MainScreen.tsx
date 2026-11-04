import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppStoreScreen } from '../appstore/AppStoreScreen';
import { buildPrompt, tileFor, type Listing } from '../appstore/catalog';
import * as shotImages from '../appstore/shotImages';
import { runAgentTurn, type AgentEvent, type AgentRun } from '../agent/agent';
import type { ChatMessage } from '../agent/openrouter';
import { modelAcceptsImages } from '../agent/vision';
import {
  composeRequest,
  entryAttachments,
  fromWebFiles,
  MAX_ATTACHMENTS,
  pickDocuments,
  pickPhotos,
  pickWebFiles,
  saveAttachments,
  type Attachment,
  type PickResult,
  type SavedAttachment,
} from '../chat/uploads';
import { AppViewport } from '../dynamic/AppViewport';
import { DynamicView, type RenderError } from '../dynamic/DynamicView';
import { clearCompileCache } from '../dynamic/resolver';
import { AppIcon } from '../components/AppIcon';
import * as debugHistory from '../debug/history';
import { onAppError } from '../debug/instrument';
import { scheduleAutoCapture } from '../debug/screenshot';
import {
  loadChat,
  markTurnEnded,
  markTurnStarted,
  saveChat,
  type Entry,
  type ServerToolEntry,
  type ToolEntry,
} from '../project/chatStore';
import { registerMcpHost, whenMcpIdle } from '../mcp/host';
import * as projectStore from '../project/store';
import type { Project } from '../project/store';
import { isBundleUrl, readIncomingBundle, type PickedBundle } from '../share/io';
import { ShareSheet } from '../share/ShareSheet';
import { getAutoAppIcons, getModel } from '../storage/keyStore';
import { colors, fonts, radii, space } from '../theme';
import { SIDEBAR_WIDTH, useWideLayout } from '../theme/layout';
import * as vfs from '../vfs/vfs';
import { ChatList, newChatScrollMemory, type ChatScrollMemory } from './ChatList';
import type { PendingCall } from './ToolGroup';
import { Dock, DOCK_BAR_HEIGHT, dockChin } from './Dock';
import { FilesPanel } from './FileViewer';
import { HistoryPanel } from './HistoryPanel';
import { SettingsScreen } from './SettingsScreen';
import { useKeyboardShown } from './useKeyboardShown';
import { AppActionsProvider, YourAppsScreen } from './YourAppsScreen';

type Props = { apiKey: string; onResetKey: () => void };

// chat: open the chat rather than the preview. draft: text to leave in the
// composer, unsent.
// fromMcp: opened by a coding agent over MCP (src/mcp/host.ts).
type EnterOpts = { chat?: boolean; draft?: string; fromMcp?: boolean };

// The app is full bleed, raised over the dock: its corners on the dock's
// side are rounded (close to an iPhone's own display corners) and it casts a
// shadow onto the dock.
const VIEWPORT_RADIUS = 24;

export function MainScreen({ apiKey, onResetKey }: Props) {
  const insets = useSafeAreaInsets();
  const wide = useWideLayout();
  const [entries, setEntries] = React.useState<Entry[]>([]);
  const [input, setInput] = React.useState('');
  // Files attached to the message being written, and why the last ones
  // couldn't be (too big, wrong type, too many).
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const [attachError, setAttachError] = React.useState<string | null>(null);
  const [attaching, setAttaching] = React.useState(false);
  const attachmentsRef = React.useRef(attachments);
  attachmentsRef.current = attachments;
  const [running, setRunning] = React.useState(false);
  const [reasoningTokens, setReasoningTokens] = React.useState(0);
  // The tool call the in-flight request is writing, if any (its arguments,
  // often a whole file, stream in before it runs).
  const [pendingCall, setPendingCall] = React.useState<PendingCall | null>(null);
  // No bytes from the model for a long while.
  const [stalled, setStalled] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [chatVisible, setChatVisible] = React.useState(false);
  // Desktop only: the chat sidebar can be hidden to give the app the window.
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [settingsVisible, setSettingsVisible] = React.useState(false);
  // The App Store is showing in the viewport, over the current app (which
  // stays mounted underneath).
  const [storeOpen, setStoreOpen] = React.useState(false);
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
  const [sharing, setSharing] = React.useState<Project | null>(null);
  // An imported app waiting on the one-time trust notice before it opens.
  const [pendingTrust, setPendingTrust] = React.useState<{ project: Project; opts: EnterOpts } | null>(
    null,
  );
  // A .blankslate file iOS opened us with; Your apps imports it.
  const [incoming, setIncoming] = React.useState<PickedBundle | null>(null);

  const historyRef = React.useRef<ChatMessage[]>([]);
  const runRef = React.useRef<AgentRun | null>(null);
  // The whole in-flight turn, including its bookkeeping after the agent stops.
  const turnRef = React.useRef<Promise<void> | null>(null);
  const stoppedRef = React.useRef(false);
  const chatScrollRef = React.useRef<ChatScrollMemory>(newChatScrollMemory());
  const activeProjectRef = React.useRef<string | null>(null);
  // The chat load a project switch started. A turn started right after the
  // switch (App Store installs) waits for it, or the load would wipe the turn.
  const chatLoadRef = React.useRef<Promise<void>>(Promise.resolve());
  const renderErrorRef = React.useRef<RenderError | null>(null);
  const viewportRef = React.useRef<React.ComponentRef<typeof Animated.View> | null>(null);

  // The bottom dock steps aside while the keyboard is up, so the app gets
  // the full height. The viewport resizes once at the start of each move
  // (not every frame, which would relayout the app throughout); the keyboard
  // covers the dock as it slides.
  const keyboard = useKeyboardShown(!wide, viewportRef);
  const dockHidden = !wide && keyboard.shown;
  const dockSlide = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(dockSlide, {
      toValue: dockHidden ? 1 : 0,
      duration: keyboard.duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [dockHidden, keyboard.duration, dockSlide]);

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
      chatScrollRef.current = newChatScrollMemory();
      setCurrentId(nextId);
      setEntries([]);
      setAttachments([]);
      setAttachError(null);
      historyRef.current = [];
      chatLoadRef.current = loadChat(nextId).then((snapshot) => {
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
        // latest user message or turn end (Continue starts a turn without a
        // message) — otherwise new text appends to an old reply.
        const turnStart = findLastIndex(prev, (e) => e.kind === 'user' || e.kind === 'turnEnd') + 1;
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
    } else if (ev.type === 'tool_call_progress') {
      setPendingCall({ name: ev.name, path: ev.path, chars: ev.chars });
    } else if (ev.type === 'stall') {
      setStalled(ev.stalled);
    } else if (ev.type === 'paused') {
      setEntries((prev) => [...prev, { kind: 'cutShort', id: `cut-${prev.length}`, reason: 'paused' }]);
    } else if (ev.type === 'tool_use') {
      setPendingCall(null);
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
      if (ev.tokens === 0) {
        setPendingCall(null);
        setStalled(false);
      }
      setReasoningTokens(ev.tokens);
    } else if (ev.type === 'error') {
      setEntries((prev) => [
        ...prev,
        { kind: 'error', id: `err-${prev.length}`, text: ev.message },
      ]);
    }
  }, []);

  // text null continues the last turn from its saved history (Retry, Continue).
  // files were attached to the message and are already in the app's files.
  const doTurn = React.useCallback(
    async (text: string | null, files: SavedAttachment[] = []): Promise<void> => {
      setRunning(true);
      stoppedRef.current = false;
      if (text !== null) {
        const shown = files.length ? { attachments: entryAttachments(files) } : {};
        setEntries((prev) => [...prev, { kind: 'user', id: `u-${prev.length}`, text, ...shown }]);
      }
      // What the model gets: the words plus a note on each file. Images are
      // sent as images only if the model can see them.
      let request = text === null ? null : composeRequest(text, files, false);
      const projectAtStart = activeProjectRef.current;
      const priorHistory = historyRef.current;
      // Screenshot the result once the turn is over, if it changed any files.
      let wrote = false;
      const unsubWrites = vfs.subscribe(() => {
        wrote = true;
      });
      try {
        const [model, autoAppIcons, , project] = await Promise.all([
          getModel(),
          getAutoAppIcons(),
          projectAtStart ? markTurnStarted(projectAtStart) : null,
          projectAtStart ? projectStore.get(projectAtStart) : null,
        ]);
        if (text !== null && files.some((f) => f.kind === 'image')) {
          request = composeRequest(text, files, await modelAcceptsImages(apiKey, model));
        }
        if (stoppedRef.current) throw new Error('Aborted');
        const run = runAgentTurn(
          {
            apiKey,
            model,
            sessionId: `blank-slate:${projectAtStart ?? 'default'}`,
            autoAppIcons,
            vibe: project?.vibe,
          },
          priorHistory,
          request?.text ?? null,
          (ev) => {
            // Saved as the turn goes, so closing the app mid-turn keeps the
            // request and the tool rounds already done.
            if (ev.type !== 'checkpoint') return handleEvent(ev);
            if (projectAtStart !== activeProjectRef.current) return;
            setEntries((prev) => {
              persist(projectAtStart, ev.history, prev);
              return prev;
            });
          },
          request?.images,
        );
        runRef.current = run;
        const outcome = await run.result;
        historyRef.current = outcome.history;
        if (projectAtStart === activeProjectRef.current) {
          setEntries((prev) => {
            const next: Entry[] = [
              ...prev,
              { kind: 'turnEnd', id: `end-${prev.length}`, status: outcome.status },
            ];
            persist(projectAtStart, outcome.history, next);
            return next;
          });
        }
        if (projectAtStart) projectStore.touch(projectAtStart).catch(() => {});
      } catch {
        // Only a stop before the agent started lands here; there's nothing to
        // record but the request itself.
        if (stoppedRef.current && projectAtStart === activeProjectRef.current) {
          const nextHistory: ChatMessage[] =
            request === null
              ? priorHistory
              : [
                  ...priorHistory,
                  { role: 'user', content: request.text },
                  { role: 'assistant', content: '(Stopped by the user before finishing.)' },
                ];
          historyRef.current = nextHistory;
          setEntries((prev) => {
            const next: Entry[] = [
              ...prev,
              { kind: 'turnEnd', id: `end-${prev.length}`, status: 'stopped' },
            ];
            persist(projectAtStart, nextHistory, next);
            return next;
          });
        }
      } finally {
        if (projectAtStart) markTurnEnded(projectAtStart).catch(() => {});
        unsubWrites();
        if (wrote && projectAtStart === activeProjectRef.current) {
          scheduleAutoCapture('after agent turn', 1200);
        }
        setRunning(false);
        setReasoningTokens(0);
        setPendingCall(null);
        setStalled(false);
        runRef.current = null;
      }
    },
    [apiKey, handleEvent, persist],
  );

  const runTurn = React.useCallback(
    async (text: string | null, files: SavedAttachment[] = []): Promise<void> => {
      if ((text !== null && !text.trim() && !files.length) || turnRef.current) return;
      const turn = doTurn(text, files);
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
    if ((!text && !attachments.length) || running || attaching) return;
    let files: SavedAttachment[] = [];
    if (attachments.length) {
      // Saved first, so a failure (web storage full) keeps the message and
      // its attachments in the composer.
      setAttaching(true);
      try {
        files = await saveAttachments(attachments);
      } catch (e) {
        setAttachError((e as Error).message);
        return;
      } finally {
        setAttaching(false);
      }
    }
    setInput('');
    setAttachments([]);
    setAttachError(null);
    await runTurn(text, files);
  };

  // Adds what a picker, drop or paste produced, up to MAX_ATTACHMENTS.
  const addPicked = React.useCallback(async (pick: () => Promise<PickResult>) => {
    setAttaching(true);
    try {
      const { attachments: picked, errors } = await pick();
      const room = Math.max(0, MAX_ATTACHMENTS - attachmentsRef.current.length);
      if (picked.length > room) errors.push(`You can attach up to ${MAX_ATTACHMENTS} files to a message.`);
      const next = [...attachmentsRef.current, ...picked.slice(0, room)];
      attachmentsRef.current = next;
      setAttachments(next);
      setAttachError(errors.length ? errors.join('\n') : null);
    } catch (e) {
      setAttachError((e as Error).message);
    } finally {
      setAttaching(false);
    }
  }, []);

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    setAttachError(null);
  };

  const attach = () => {
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      setAttachError(`You can attach up to ${MAX_ATTACHMENTS} files to a message.`);
      return;
    }
    if (Platform.OS === 'web') {
      addPicked(async () => fromWebFiles(await pickWebFiles()));
      return;
    }
    const photos = () => addPicked(() => pickPhotos(room));
    const files = () => addPicked(pickDocuments);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Photo Library', 'Files', 'Cancel'], cancelButtonIndex: 2, userInterfaceStyle: 'dark' },
        (i) => (i === 0 ? photos() : i === 1 ? files() : undefined),
      );
    } else {
      Alert.alert('Attach', undefined, [
        { text: 'Photo Library', onPress: photos },
        { text: 'Files', onPress: files },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  // Web and desktop: drop files onto the chat, or paste an image, while the
  // composer is showing. Your apps has its own drop target for .blankslate
  // files and isn't covered by this.
  const composerShowing = !appsOpen && activeTab === 'chat' && (wide ? sidebarOpen : chatVisible);
  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !composerShowing) return;
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      addPicked(() => fromWebFiles(files));
    };
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      addPicked(() => fromWebFiles(files));
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, [composerShowing, addPicked]);

  // Retry and Continue pick the last turn up from its saved history rather
  // than sending the request again. While running this is the stall prompt's
  // Retry: give up on the quiet request first.
  const retry = React.useCallback(async () => {
    if (running) {
      const turn = turnRef.current;
      runRef.current?.abort('stalled');
      await turn;
    }
    runTurn(null);
  }, [running, runTurn]);

  const fixRenderErrorNow = React.useCallback(() => {
    const err = renderErrorRef.current;
    if (!err || running) return;
    setChatVisible(true);
    setSidebarOpen(true);
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

  // Cmd+\ (Ctrl+\ off the Mac) shows and hides the sidebar on desktop.
  React.useEffect(() => {
    if (!wide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '\\' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSidebarOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wide]);

  // Files opened from Files, Messages or AirDrop arrive as file:// URLs, at
  // launch or while running. Your apps does the import.
  React.useEffect(() => {
    if (Platform.OS === 'web') return;
    let alive = true;
    const handle = (url: string | null) => {
      if (!isBundleUrl(url)) return;
      readIncomingBundle(url)
        .then((picked) => {
          if (!alive) return;
          setIncoming(picked);
          setSettingsVisible(false);
          setAppsOpen(true);
        })
        .catch((e) => console.warn('[share] could not read incoming file', e));
    };
    Linking.getInitialURL().then(handle, () => {});
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  const clearIncoming = React.useCallback(() => setIncoming(null), []);

  const askAgent = React.useCallback((text: string) => {
    setInput(text);
    setActiveTab('chat');
  }, []);

  const openApps = () => setAppsOpen(true);

  const openChat = () => {
    setActiveTab('chat');
    if (wide) setSidebarOpen(true);
    else setChatVisible(true);
  };

  const showApp = () => {
    setAppOpened(true);
    setChatVisible(false);
  };

  // Leaves home for a project: its preview, or its chat when there's nothing
  // to look at yet (a new or untouched app). An imported app shows the trust
  // notice first, once.
  const enterApp = async (id: string, opts: EnterOpts = {}) => {
    const target = await projectStore.get(id);
    if (projectStore.needsTrustNotice(target)) {
      // Accepting is the user's tap, not the MCP call (which has returned).
      setPendingTrust({ project: target!, opts: { ...opts, fromMcp: false } });
      return;
    }
    if (id !== activeProjectRef.current) {
      await stopAndWait();
      // An MCP call writes into the current app too. One coming from MCP is
      // that call, so it can't wait for itself.
      if (!opts.fromMcp) await whenMcpIdle();
      await projectStore.switchTo(id);
    }
    // A coding agent wants to see what it builds, even in a brand-new app.
    const chat = !opts.fromMcp && (opts.chat || (await isUntouched(id)));
    setAppOpened(true);
    setAppsOpen(false);
    setStoreOpen(false);
    if (chat) setActiveTab('chat');
    setChatVisible(chat);
    if (opts.draft !== undefined) setInput(opts.draft);
  };

  // "Get" in the App Store: a new project named and styled after the listing,
  // opened on its chat with the listing sent as the first request.
  // Its screenshots go into the project as the design the agent recreates;
  // any not generated yet are made first (the Get button spins meanwhile).
  const installFromStore = async (listing: Listing) => {
    const shots = await shotImages.collect(apiKey, listing);
    const project = await projectStore.create(listing.name, tileFor(listing), listing.vibe);
    await enterApp(project.id, { chat: true });
    const paths: string[] = [];
    for (const [i, dataUrl] of shots.entries()) {
      const path = `design/store-screenshot-${i + 1}.${dataUrl?.startsWith('data:image/jpeg') ? 'jpg' : 'png'}`;
      if (dataUrl && (await vfs.writeFile(path, dataUrl).then(() => true, () => false))) paths[i] = path;
    }
    await chatLoadRef.current.catch(() => {});
    runTurn(buildPrompt(listing, paths));
  };

  // Opening the store switches no project, so a running build carries on.
  const openStore = () => {
    setStoreOpen(true);
    setAppsOpen(false);
    setChatVisible(false);
  };

  const acceptTrust = async () => {
    const pending = pendingTrust;
    if (!pending) return;
    setPendingTrust(null);
    await projectStore.acknowledgeImport(pending.project.id);
    await enterApp(pending.project.id, pending.opts);
  };

  // A coding agent building over MCP (desktop only) opens apps as a tap would.
  const enterAppRef = React.useRef(enterApp);
  enterAppRef.current = enterApp;
  React.useEffect(() => {
    if (!ready) return;
    return registerMcpHost({
      apiKey,
      openApp: (id) => enterAppRef.current(id, { fromMcp: true }),
    });
  }, [ready, apiKey]);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.dust} />
      </View>
    );
  }

  const currentProject = projects.find((p) => p.id === currentId) ?? null;
  // Belt and braces for the trust notice: an imported app that hasn't been
  // accepted never runs, even if it became current some other way (e.g. the
  // app before it in the list was deleted).
  const canRun = appOpened && !!currentProject && !projectStore.needsTrustNotice(currentProject);
  const canSend = (!!input.trim() || attachments.length > 0) && !running && !attaching;

  const chatPanel = (
    <>
      <View style={styles.chatHeader}>
        <Pressable
          onPress={openApps}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Your apps"
        >
          <Ionicons name="home-outline" size={20} color={colors.dust} />
        </Pressable>
        <ProjectTitle key={currentProject?.id ?? 'none'} project={currentProject} />
        {currentProject ? (
          <Pressable
            onPress={() => setSharing(currentProject)}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Share app"
          >
            <Ionicons name="share-outline" size={19} color={colors.dust} />
          </Pressable>
        ) : null}
        {wide ? (
          <Pressable
            onPress={() => setSidebarOpen(false)}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Full-screen app"
          >
            <Ionicons name="expand-outline" size={19} color={colors.dust} />
          </Pressable>
        ) : (
          <Pressable
            onPress={showApp}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="View app"
          >
            <Ionicons name="eye-outline" size={21} color={colors.dust} />
          </Pressable>
        )}
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
          <ChatList
            key={currentId ?? 'none'}
            entries={entries}
            running={running}
            reasoningTokens={reasoningTokens}
            pendingCall={pendingCall}
            stalled={stalled}
            onStop={stop}
            memory={chatScrollRef}
            onRetry={retry}
            onSuggest={runTurn}
          />

          {/* The home indicator sits under the keyboard, so drop its inset
              while the keyboard is up. */}
          <View
            style={[styles.composerWrap, { paddingBottom: 10 + (keyboard.shown ? 0 : insets.bottom) }]}
          >
            {attachError ? (
              <View style={styles.attachError}>
                <Ionicons name="alert-circle-outline" size={14} color={colors.danger} style={styles.attachErrorIcon} />
                <Text style={styles.attachErrorText}>{attachError}</Text>
                <Pressable
                  onPress={() => setAttachError(null)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss"
                >
                  <Ionicons name="close" size={14} color={colors.dust} />
                </Pressable>
              </View>
            ) : null}
            {attachments.length ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.pendingRow}
                contentContainerStyle={styles.pendingRowContent}
                keyboardShouldPersistTaps="handled"
              >
                {attachments.map((a) => (
                  <PendingChip key={a.id} attachment={a} onRemove={() => removeAttachment(a.id)} />
                ))}
              </ScrollView>
            ) : null}
            <View style={styles.composer}>
              <Pressable
                style={({ pressed }) => [styles.attachBtn, pressed && styles.pressed]}
                onPress={attach}
                disabled={attaching}
                accessibilityRole="button"
                accessibilityLabel="Attach files"
              >
                {attaching ? (
                  <ActivityIndicator size="small" color={colors.dust} />
                ) : (
                  <Ionicons name="attach" size={22} color={colors.dust} />
                )}
              </Pressable>
              <TextInput
                keyboardAppearance="dark"
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
    </>
  );

  const dockChinHeight = dockChin(insets.bottom);
  const dockHeight = DOCK_BAR_HEIGHT + dockChinHeight;
  const viewportInsets = wide
    ? { top: 0, right: 0, bottom: 0, left: 0 }
    : { top: insets.top, right: insets.right, bottom: 0, left: insets.left };

  return (
    <View style={[styles.root, wide && styles.rootWide]}>
      <AppActionsProvider
        projects={projects}
        currentId={currentId}
        running={running}
        onStopBuild={stopAndWait}
        onOpen={(id, opts) => enterApp(id, opts)}
        onCreated={(id) => enterApp(id, { chat: true })}
        onChangeIcon={(id) => enterApp(id, { chat: true, draft: 'Make a new app icon for this app' })}
      >
      {wide ? (
        <Dock
          vertical
          projects={projects}
          currentId={currentId}
          onLogo={openChat}
          storeOpen={storeOpen}
          onStore={openStore}
        />
      ) : null}

      {wide ? null : (
        <Animated.View
          style={[
            styles.dock,
            { height: dockHeight, paddingBottom: dockChinHeight },
            { transform: [{ translateY: Animated.multiply(dockSlide, dockHeight) }] },
          ]}
          pointerEvents={dockHidden ? 'none' : 'auto'}
          accessibilityElementsHidden={dockHidden}
          importantForAccessibility={dockHidden ? 'no-hide-descendants' : 'auto'}
        >
          <Dock
            projects={projects}
            currentId={currentId}
            onLogo={openChat}
            storeOpen={storeOpen}
            onStore={openStore}
          />
        </Animated.View>
      )}

      <View
        style={
          wide
            ? [styles.raised, styles.raisedWide]
            : [styles.raised, styles.raisedPhone, { bottom: dockHidden ? 0 : dockHeight }]
        }
      >
        <AppViewport
          ref={viewportRef}
          insets={viewportInsets}
          style={[styles.viewport, wide ? styles.viewportWide : styles.viewportPhone]}
        >
          {canRun ? (
            <DynamicView
              revision={renderRevision}
              onError={handleRenderError}
              onClear={handleRenderClear}
              onFix={fixRenderErrorNow}
              covered={(!wide && chatVisible) || appsOpen || settingsVisible || storeOpen}
            />
          ) : null}
          {storeOpen ? (
            <View style={styles.storePane}>
              <AppStoreScreen
                apiKey={apiKey}
                projects={projects}
                running={running}
                onHome={() => {
                  setStoreOpen(false);
                  setAppsOpen(true);
                }}
                onInstall={installFromStore}
                onOpenProject={(id) => enterApp(id)}
              />
            </View>
          ) : null}
        </AppViewport>
      </View>

      {wide && sidebarOpen ? <View style={styles.sidebar}>{chatPanel}</View> : null}

      {wide ? null : chatVisible ? (
        <View style={styles.chatOverlay}>
          <HostStatusBar />
          <KeyboardAvoidingView
            style={[StyleSheet.absoluteFill, { paddingTop: insets.top }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            {chatPanel}
          </KeyboardAvoidingView>
        </View>
      ) : null}

      {appsOpen ? (
        <View style={styles.fullOverlay}>
          <HostStatusBar />
          <YourAppsScreen
            projects={projects}
            currentId={currentId}
            onSettings={() => setSettingsVisible(true)}
            onStore={openStore}
            onOpen={(id, opts) => enterApp(id, opts)}
            incoming={incoming}
            onIncomingHandled={clearIncoming}
          />
        </View>
      ) : null}

      <ShareSheet project={sharing} onClose={() => setSharing(null)} />

      {pendingTrust ? (
        <TrustNotice
          project={pendingTrust.project}
          stopsBuild={running && pendingTrust.project.id !== currentId}
          onOpen={acceptTrust}
          onCancel={() => setPendingTrust(null)}
        />
      ) : null}

      {settingsVisible ? (
        <View style={styles.fullOverlay}>
          <HostStatusBar />
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
      </AppActionsProvider>
    </View>
  );
}

// The chat header's centred title. Tap it to rename the app inline: Enter or
// blur saves, Escape (web) or an empty name cancels.
function ProjectTitle({ project }: { project: Project | null }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  // Enter saves and then blurs; Escape cancels and then blurs. Either way the
  // blur that follows must not save again.
  const settledRef = React.useRef(false);
  const inputRef = React.useRef<TextInput | null>(null);

  // selectTextOnFocus covers native, but on web the tap that opened the field
  // lands after focus and clears the selection, so select once it settles.
  React.useEffect(() => {
    if (!editing || Platform.OS !== 'web') return;
    const t = setTimeout(() => {
      (inputRef.current as unknown as HTMLInputElement | null)?.select?.();
    }, 0);
    return () => clearTimeout(t);
  }, [editing]);

  if (!project) {
    return (
      <View style={styles.title} accessibilityRole="header">
        <Text style={styles.projectTitle} numberOfLines={1}>
          Blank Slate
        </Text>
      </View>
    );
  }

  const begin = () => {
    settledRef.current = false;
    setDraft(project.name);
    setEditing(true);
  };

  const finish = (save: boolean) => {
    if (settledRef.current) return;
    settledRef.current = true;
    setEditing(false);
    const name = projectStore.cleanName(draft);
    if (save && name && name !== project.name) {
      projectStore.rename(project.id, name).catch(() => {});
    }
  };

  if (editing) {
    return (
      <View style={styles.title}>
        <AppIcon project={project} size={24} />
        <TextInput
          keyboardAppearance="dark"
          ref={inputRef}
          value={draft}
          onChangeText={setDraft}
          autoFocus
          selectTextOnFocus
          maxLength={projectStore.MAX_NAME_LENGTH}
          returnKeyType="done"
          autoCapitalize="words"
          autoCorrect={false}
          onSubmitEditing={() => finish(true)}
          onBlur={() => finish(true)}
          onKeyPress={(e) => {
            if (e.nativeEvent.key === 'Escape') {
              finish(false);
              inputRef.current?.blur();
            }
          }}
          style={[styles.projectTitle, styles.titleInput]}
          accessibilityLabel="App name"
        />
      </View>
    );
  }

  return (
    <Pressable
      onPress={begin}
      style={({ pressed }) => [styles.title, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${project.name}${project.importedFrom ? ', imported' : ''}, rename`}
      accessibilityHint="Double-tap to rename"
    >
      <View>
        <AppIcon project={project} size={24} />
        {project.importedFrom ? <ImportedMark /> : null}
      </View>
      <Text style={styles.projectTitle} numberOfLines={1}>
        {project.name}
      </Text>
      <Ionicons name="pencil-outline" size={12} color={colors.dust} style={styles.titlePencil} />
    </Pressable>
  );
}

// Same arrow badge as the Your apps tile, small enough to keep the title.
function ImportedMark() {
  return (
    <View style={styles.importedMark} pointerEvents="none">
      <Ionicons name="arrow-down" size={8} color={colors.chalk} />
    </View>
  );
}

// One-time notice before an imported app's code first runs. A plain overlay,
// not a Modal: it often follows another dialog (stop build, import), and iOS
// won't present a Modal while another is still dismissing.
function TrustNotice({
  project,
  stopsBuild,
  onOpen,
  onCancel,
}: {
  project: Project;
  stopsBuild: boolean;
  onOpen: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.trustBackdrop}>
      <View style={styles.trustDialog} accessibilityViewIsModal>
        <View style={styles.trustHead}>
          <AppIcon project={project} size={44} />
          <View style={styles.trustHeadText}>
            <Text style={styles.trustTitle} numberOfLines={2}>
              Open {project.name}?
            </Text>
            <Text style={styles.trustMeta}>Imported app</Text>
          </View>
        </View>
        <Text style={styles.trustBody}>
          Someone else made this app. Its code runs inside Blank Slate. Its storage is kept separate from
          your other apps, but that isn't a full security boundary, so only open apps from people you
          trust.
          {stopsBuild ? ' The build that is running will be stopped.' : ''}
        </Text>
        <View style={styles.trustActions}>
          <Pressable
            style={({ pressed }) => [styles.trustBtn, styles.trustBtnSecondary, pressed && styles.pressed]}
            onPress={onCancel}
            accessibilityRole="button"
          >
            <Text style={styles.trustBtnSecondaryText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.trustBtn, styles.trustBtnPrimary, pressed && styles.pressed]}
            onPress={onOpen}
            accessibilityRole="button"
          >
            <Text style={styles.trustBtnPrimaryText}>Open</Text>
          </Pressable>
        </View>
      </View>
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

// An attachment waiting in the composer: a thumbnail for images, a file chip
// otherwise, each with a remove button.
function PendingChip({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  const remove = (
    <Pressable
      onPress={onRemove}
      hitSlop={6}
      style={({ pressed }) => [styles.chipRemove, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Remove ${attachment.name}`}
    >
      <Ionicons name="close" size={12} color={colors.chalk} />
    </Pressable>
  );
  if (attachment.kind === 'image') {
    return (
      <View style={styles.thumbWrap}>
        <Image source={{ uri: attachment.content }} style={styles.thumb} accessibilityLabel={attachment.name} />
        {remove}
      </View>
    );
  }
  return (
    <View style={styles.fileChip}>
      <Ionicons name="document-text-outline" size={16} color={colors.dust} />
      <Text style={styles.fileChipText} numberOfLines={1}>
        {attachment.name}
      </Text>
      {remove}
    </View>
  );
}

function formatRenderErrorPrompt(err: RenderError): string {
  const ref = err.eventId !== undefined ? ` (error #${err.eventId})` : '';
  const label =
    err.stage === 'runtime'
      ? `crashed at runtime in ${err.path}${ref}`
      : err.stage === 'handler'
        ? `threw an error in an event handler or timer${ref}`
        : `failed during ${err.stage} in ${err.path}${ref}`;
  // Only the app's own frames (vfs:///path); Blank Slate's bundle frames are
  // long URLs that say nothing about the app's code.
  const appFrames = err.stack
    ? err.stack.split('\n').filter((l) => l.includes('vfs:///')).slice(0, 8)
    : [];
  const trimmedStack = appFrames.map((l) => l.trim()).join('\n');
  const stackBlock = trimmedStack ? `\n\nStack (app code frames):\n${trimmedStack}` : '';
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

// Web: an app wider than its pane (or one that focuses an input off to the
// side) would otherwise scroll the whole page sideways, chat and all. 'clip',
// unlike 'hidden', can't be scrolled by focus or scrollIntoView.
const clipOnWeb = Platform.OS === 'web' ? ({ overflow: 'clip' } as object) : null;

// Generated apps set the status bar to suit their own background. Blank
// Slate's overlays are always dark, so each mounts its own light one on top.
function HostStatusBar() {
  return <StatusBar style="light" />;
}

function radiusBottom(r: number) {
  return { borderBottomLeftRadius: r, borderBottomRightRadius: r };
}

function radiusLeft(r: number) {
  return { borderTopLeftRadius: r, borderBottomLeftRadius: r };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.slate, ...clipOnWeb },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.slate },
  rootWide: { flexDirection: 'row' },
  sidebar: { width: SIDEBAR_WIDTH, backgroundColor: colors.slate },
  // Carries the shadow; iOS clips a shadow on a view that clips its content,
  // so the clipping happens one level down.
  raised: {},
  raisedPhone: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    ...radiusBottom(VIEWPORT_RADIUS),
    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)',
  },
  // Lighter beside the rail, where a shadow runs the window's full height.
  raisedWide: { flex: 1, ...radiusLeft(VIEWPORT_RADIUS), boxShadow: '0 0 6px rgba(0, 0, 0, 0.2)' },
  // The app's pane. Clipped, so the app's content (but not its Modals, which
  // cover the window) stays inside.
  viewport: { flex: 1, overflow: 'hidden', backgroundColor: colors.slate, ...clipOnWeb },
  viewportPhone: radiusBottom(VIEWPORT_RADIUS),
  viewportWide: radiusLeft(VIEWPORT_RADIUS),
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.slate },
  pressed: { opacity: 0.7 },
  chatOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.slate },
  fullOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.slate },
  storePane: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.slate },

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
  titlePencil: { marginLeft: -2, opacity: 0.8 },
  importedMark: {
    position: 'absolute',
    right: -5,
    bottom: -5,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.slate,
    backgroundColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },

  trustBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,10,12,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  trustDialog: {
    width: '100%',
    maxWidth: 380,
    padding: 20,
    gap: 14,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.board,
  },
  trustHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  trustHeadText: { flex: 1, minWidth: 0, gap: 2 },
  trustTitle: { fontFamily: fonts.displaySemi, fontSize: 20, color: colors.chalk },
  trustMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.dust },
  trustBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.chalkMuted },
  trustActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  trustBtn: {
    flex: 1,
    height: 48,
    borderRadius: radii.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustBtnPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  trustBtnPrimaryText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.slate },
  trustBtnSecondary: { backgroundColor: colors.board, borderColor: colors.lineStrong },
  trustBtnSecondaryText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.chalk },
  titleInput: {
    flex: 1,
    height: 36,
    paddingVertical: 0,
    paddingHorizontal: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
    // RN Web draws a focus ring; the underline already shows it's editable.
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
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
    paddingLeft: 4,
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
  attachBtn: {
    width: 40,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerBg,
  },
  attachErrorIcon: { marginTop: 2 },
  attachErrorText: { flex: 1, fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.dangerSoft },
  pendingRow: { flexGrow: 0, marginBottom: 8 },
  // Top padding leaves room for the remove buttons that overhang each chip.
  pendingRowContent: { gap: 8, paddingTop: 6, paddingRight: 6 },
  thumbWrap: { width: 56, height: 56 },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.raised,
  },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 56,
    maxWidth: 200,
    paddingLeft: 12,
    paddingRight: 14,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.board,
  },
  fileChipText: { flexShrink: 1, fontFamily: fonts.mono, fontSize: 12, color: colors.chalkSoft },
  chipRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.raised,
  },
  stopSquare: { width: 12, height: 12, borderRadius: 3, backgroundColor: colors.slate },
});

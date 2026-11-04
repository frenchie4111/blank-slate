import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import {
  ActivityIndicator,
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
import { StoreAppIcon } from '../appstore/AppStoreScreen';
import { AppIcon } from '../components/AppIcon';
import * as debugHistory from '../debug/history';
import {
  appearanceOf,
  defaultGlyph,
  defaultTint,
  GLYPHS,
  TINT_KEYS,
  TINTS,
  type Glyph,
  type Tint,
} from '../project/appearance';
import * as projectStore from '../project/store';
import type { Project } from '../project/store';
import { colors, fonts, radii, type } from '../theme';
import { runtimePlatform } from '../platform/desktop';
import { BundleError, importBundle } from '../share/bundle';
import { pickBundle, readWebFile, ShareUnavailableError, type PickedBundle } from '../share/io';
import { ShareSheet } from '../share/ShareSheet';
import { useWideLayout } from '../theme/layout';
import { useKeyboardShown } from './useKeyboardShown';

type Props = {
  projects: Project[];
  currentId: string | null;
  onSettings: () => void;
  // Opens the App Store, which sits on the grid like an app.
  onStore: () => void;
  // Switches to the project (if needed) and shows the running app, or its
  // chat with { chat: true }.
  onOpen: (id: string, opts?: { chat?: boolean }) => void;
  // A .blankslate file iOS opened Blank Slate with, waiting to be imported.
  incoming: PickedBundle | null;
  onIncomingHandled: () => void;
};

type Draft = { mode: 'create' } | { mode: 'edit'; project: Project } | { mode: 'style'; project: Project };

// Suggestions on the "How should it feel?" field. The first is the default.
const VIBES = ['iOS native', 'Cozy', 'Bold', 'Minimal', 'Playful', 'Retro'];

type ActionsProps = {
  projects: Project[];
  currentId: string | null;
  // An agent turn is running in the current project.
  running: boolean;
  // Stops that turn and resolves once it can no longer write files.
  onStopBuild: () => Promise<void>;
  // Switches to the project (if needed) and shows the running app, or its
  // chat with { chat: true }.
  onOpen: (id: string, opts?: { chat?: boolean }) => void;
  // A freshly created project: switch to it and start chatting.
  onCreated: (id: string) => void;
  // Opens the project's chat with an icon request typed but not sent.
  onChangeIcon: (id: string) => void;
  children: React.ReactNode;
};

export type AppActions = {
  // Opens the app, asking first if that would stop a running build.
  open: (p: Project) => void;
  // The long-press menu: Rename, Change icon, Share, Delete.
  openMenu: (p: Project) => void;
  create: () => void;
  edit: (p: Project) => void;
  remove: (p: Project) => void;
  // A confirmation or delete is in progress.
  busy: boolean;
};

const AppActionsContext = React.createContext<AppActions | null>(null);

export function useAppActions(): AppActions {
  const actions = React.useContext(AppActionsContext);
  if (!actions) throw new Error('useAppActions outside AppActionsProvider');
  return actions;
}

/**
 * Opening, creating and managing apps, shared by Your apps and the dock: the
 * tile menu, the new/edit sheet, and the delete and "Stop the current
 * build?" confirmations. Its overlays render after `children`, on top.
 */
export function AppActionsProvider({
  projects,
  currentId,
  running,
  onStopBuild,
  onOpen,
  onCreated,
  onChangeIcon,
  children,
}: ActionsProps) {
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<Project | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Leaving the current app mid-build asks first, then stops the build.
  const [pendingStop, setPendingStop] = React.useState<(() => void) | null>(null);
  // Long-pressed tile: its context menu is open.
  const [menuFor, setMenuFor] = React.useState<Project | null>(null);
  const [sharing, setSharing] = React.useState<Project | null>(null);

  const current = projects.find((p) => p.id === currentId) ?? null;
  const canDelete = projects.length > 1;

  const afterStop = (action: () => void) => {
    if (running) setPendingStop(() => action);
    else action();
  };

  const confirmStop = async () => {
    const action = pendingStop;
    if (!action || busy) return;
    setBusy(true);
    try {
      await onStopBuild();
    } finally {
      setBusy(false);
      setPendingStop(null);
    }
    action();
  };

  const open = (p: Project) => {
    if (busy) return;
    // An imported app's trust notice also mentions a build it would stop.
    if (p.id === currentId || projectStore.needsTrustNotice(p)) onOpen(p.id);
    else afterStop(() => onOpen(p.id));
  };

  const openMenu = (p: Project) => {
    if (busy) return;
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    setMenuFor(p);
  };

  const menuAction = (action: MenuAction) => {
    const p = menuFor;
    setMenuFor(null);
    if (!p) return;
    if (action === 'rename') setDraft({ mode: 'edit', project: p });
    else if (action === 'style') setDraft({ mode: 'style', project: p });
    else if (action === 'share') setSharing(p);
    else if (action === 'delete') setPendingDelete(p);
    else if (p.id === currentId || projectStore.needsTrustNotice(p)) onChangeIcon(p.id);
    else afterStop(() => onChangeIcon(p.id));
  };

  const deletingCurrentBuild = running && pendingDelete?.id === currentId;

  const confirmDelete = async () => {
    if (!pendingDelete || busy) return;
    setBusy(true);
    try {
      if (pendingDelete.id === currentId) await onStopBuild();
      await projectStore.remove(pendingDelete.id);
      await debugHistory.removeProject(pendingDelete.id);
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  };

  const actions: AppActions = {
    open,
    openMenu,
    create: () => setDraft({ mode: 'create' }),
    edit: (p) => setDraft({ mode: 'edit', project: p }),
    remove: (p) => setPendingDelete(p),
    busy,
  };

  return (
    <AppActionsContext.Provider value={actions}>
      {children}

      {menuFor ? (
        <TileMenu
          project={menuFor}
          canDelete={canDelete}
          onClose={() => setMenuFor(null)}
          onAction={menuAction}
        />
      ) : null}

      <ShareSheet project={sharing} onClose={() => setSharing(null)} />

      <AppSheet
        draft={draft}
        stopsBuild={running}
        onClose={() => setDraft(null)}
        onCreated={(id) => {
          setDraft(null);
          onCreated(id);
        }}
      />

      <Modal
        transparent
        visible={!!pendingDelete}
        animationType="fade"
        onRequestClose={() => setPendingDelete(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Delete {pendingDelete?.name}?</Text>
            <Text style={styles.dialogBody}>
              Its code and chat are removed from this phone. This can't be undone.
              {deletingCurrentBuild ? ' The build running in it will be stopped.' : ''}
            </Text>
            <View style={styles.dialogActions}>
              <Pressable
                style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && styles.pressed]}
                onPress={() => setPendingDelete(null)}
                disabled={busy}
              >
                <Text style={styles.btnSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnDanger,
                  (busy || pressed) && styles.pressed,
                ]}
                onPress={confirmDelete}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={colors.danger} />
                ) : (
                  <Text style={styles.btnDangerText}>Delete</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={!!pendingStop}
        animationType="fade"
        onRequestClose={() => setPendingStop(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Stop the current build?</Text>
            <Text style={styles.dialogBody}>
              An agent working on{' '}
              <Text style={styles.dialogBodyStrong}>{current?.name ?? 'this app'}</Text> is still
              working. Switching apps will stop it
            </Text>
            <View style={styles.dialogActions}>
              <Pressable
                style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && styles.pressed]}
                onPress={() => setPendingStop(null)}
                disabled={busy}
              >
                <Text style={styles.btnSecondaryText}>Keep building</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnDanger,
                  (busy || pressed) && styles.pressed,
                ]}
                onPress={confirmStop}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={colors.danger} />
                ) : (
                  <Text style={styles.btnDangerText}>Stop and switch</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </AppActionsContext.Provider>
  );
}

export function YourAppsScreen({
  projects,
  currentId,
  onSettings,
  onStore,
  onOpen,
  incoming,
  onIncomingHandled,
}: Props) {
  const insets = useSafeAreaInsets();
  const wide = useWideLayout();
  const actions = useAppActions();
  const [editing, setEditing] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [importError, setImportError] = React.useState<string | null>(null);

  const current = projects.find((p) => p.id === currentId) ?? null;
  const canDelete = projects.length > 1;

  const handleTile = (p: Project) => {
    if (editing) actions.edit(p);
    else actions.open(p);
  };

  const openMenu = (p: Project) => {
    if (!editing) actions.openMenu(p);
  };

  // Imports always land in a new project, which opens behind its trust notice.
  const importingRef = React.useRef(false);
  const runImport = React.useCallback(
    async (get: () => Promise<PickedBundle | null>) => {
      if (importingRef.current) return;
      importingRef.current = true;
      try {
        const picked = await get();
        if (!picked) return;
        setImporting(true);
        const { project, hasCode } = await importBundle(picked.bytes);
        onOpen(project.id, { chat: !hasCode });
      } catch (e) {
        setImportError(
          e instanceof BundleError || e instanceof ShareUnavailableError
            ? e.message
            : `Something went wrong reading that file. ${(e as Error)?.message ?? ''}`.trim(),
        );
      } finally {
        importingRef.current = false;
        setImporting(false);
      }
    },
    [onOpen],
  );

  React.useEffect(() => {
    if (!incoming) return;
    onIncomingHandled();
    runImport(async () => incoming);
  }, [incoming, onIncomingHandled, runImport]);

  // Web and desktop: drop a .blankslate file anywhere on Your apps.
  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      e.preventDefault();
      runImport(() => readWebFile(file));
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [runImport]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Your apps</Text>
          <Text style={styles.count}>
            {projects.length} app{projects.length === 1 ? '' : 's'} on this {runtimePlatform() === 'desktop' ? 'computer' : 'phone'}
          </Text>
        </View>
        <Pressable
          onPress={() => setEditing((v) => !v)}
          style={({ pressed }) => [
            styles.headerBtn,
            editing && styles.headerBtnOn,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
        >
          <Text style={[styles.headerBtnText, editing && styles.headerBtnTextOn]}>
            {editing ? 'Done' : 'Edit'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => runImport(pickBundle)}
          disabled={importing}
          style={({ pressed }) => [styles.iconBtn, (pressed || importing) && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Import app"
        >
          {importing ? (
            <ActivityIndicator size="small" color={colors.dust} />
          ) : (
            <Ionicons name="download-outline" size={20} color={colors.dust} />
          )}
        </Pressable>
        <Pressable
          onPress={onSettings}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Settings"
        >
          <Ionicons name="settings-outline" size={20} color={colors.dust} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.grid}>
        <View style={[styles.cell, wide && styles.cellWide]}>
          <Pressable
            onPress={onStore}
            disabled={editing}
            style={({ pressed }) => [styles.tile, (pressed || editing) && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="App Store"
          >
            <StoreAppIcon size={70} />
          </Pressable>
          <Text style={styles.tileLabel} numberOfLines={1}>
            App Store
          </Text>
        </View>
        {projects.map((p) => {
          const isCurrent = p.id === currentId;
          return (
            <View key={p.id} style={[styles.cell, wide && styles.cellWide]}>
              <View style={editing && styles.tilted}>
                <Pressable
                  onPress={() => handleTile(p)}
                  onLongPress={() => openMenu(p)}
                  delayLongPress={400}
                  // Right-click opens the same menu on web and desktop.
                  {...(Platform.OS === 'web'
                    ? ({
                        onContextMenu: (e: { preventDefault: () => void }) => {
                          e.preventDefault();
                          openMenu(p);
                        },
                      } as object)
                    : null)}
                  style={({ pressed }) => [
                    styles.tile,
                    isCurrent ? styles.tileCurrent : null,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={
                    editing ? `Edit ${p.name}` : `Open ${p.name}${p.importedFrom ? ', imported' : ''}`
                  }
                >
                  <AppIcon project={p} size={isCurrent ? 68 : 70} />
                </Pressable>
                {p.importedFrom && !editing ? (
                  <View
                    style={styles.importedBadge}
                    accessibilityLabel="Imported"
                    pointerEvents="none"
                  >
                    <Ionicons name="arrow-down" size={11} color={colors.chalk} />
                  </View>
                ) : null}
                {editing && canDelete ? (
                  <Pressable
                    onPress={() => actions.remove(p)}
                    style={styles.deleteBadge}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${p.name}`}
                  >
                    <Ionicons name="close" size={13} color={colors.chalk} />
                  </Pressable>
                ) : null}
              </View>
              <Text style={styles.tileLabel} numberOfLines={1}>
                {p.name}
              </Text>
              {isCurrent ? <View style={styles.currentDot} /> : null}
            </View>
          );
        })}
        <View style={[styles.cell, wide && styles.cellWide]}>
          <Pressable
            onPress={actions.create}
            style={({ pressed }) => [styles.tile, styles.newTile, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="New app"
          >
            <Ionicons name="add" size={30} color={colors.accent} />
          </Pressable>
          <Text style={[styles.tileLabel, styles.newLabel]}>New app</Text>
        </View>
      </ScrollView>

      {current && !editing ? (
        <View style={[styles.resumeWrap, { paddingBottom: Math.max(insets.bottom, 16) + 10 }]}>
          <View style={[styles.resume, wide && styles.resumeWide]}>
            <AppIcon project={current} size={44} />
            <View style={styles.resumeText}>
              <Text style={styles.resumeName} numberOfLines={1}>
                {current.name}
              </Text>
              <Text style={styles.resumeMeta} numberOfLines={1}>
                Open now · edited {timeAgo(current.updatedAt)}
              </Text>
            </View>
            <Pressable
              onPress={() => onOpen(current.id)}
              style={({ pressed }) => [styles.resumeBtn, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.resumeBtnText}>Resume</Text>
            </Pressable>
          </View>
        </View>
      ) : null}


      <Modal
        transparent
        visible={!!importError}
        animationType="fade"
        onRequestClose={() => setImportError(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Couldn't import app</Text>
            <Text style={styles.dialogBody}>{importError}</Text>
            <View style={styles.dialogActions}>
              <Pressable
                style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && styles.pressed]}
                onPress={() => setImportError(null)}
              >
                <Text style={styles.btnSecondaryText}>OK</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

type MenuAction = 'rename' | 'icon' | 'style' | 'share' | 'delete';

// iOS-style context menu for a long-pressed tile. A plain overlay rather than
// a Modal: Rename and Delete open Modals of their own, and iOS won't present
// one while another is still dismissing.
function TileMenu({
  project,
  canDelete,
  onClose,
  onAction,
}: {
  project: Project;
  canDelete: boolean;
  onClose: () => void;
  onAction: (action: MenuAction) => void;
}) {
  return (
    <View style={styles.menuBackdrop}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close menu"
      />
      <View style={styles.menuHead} pointerEvents="none">
        <AppIcon project={project} size={84} />
        <Text style={styles.menuName} numberOfLines={1}>
          {project.name}
        </Text>
      </View>
      <View style={styles.menu} accessibilityRole="menu">
        <MenuRow icon="pencil-outline" label="Rename" onPress={() => onAction('rename')} />
        <MenuRow icon="image-outline" label="Change icon" onPress={() => onAction('icon')} />
        <MenuRow icon="color-palette-outline" label="Style…" onPress={() => onAction('style')} />
        <MenuRow icon="share-outline" label="Share" onPress={() => onAction('share')} />
        <MenuRow
          icon="trash-outline"
          label="Delete"
          danger
          disabled={!canDelete}
          onPress={() => onAction('delete')}
          last
        />
      </View>
    </View>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
  danger,
  disabled,
  last,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
  last?: boolean;
}) {
  const color = disabled ? colors.dust : danger ? colors.danger : colors.chalk;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.menuRow,
        !last && styles.menuRowDivider,
        pressed && styles.menuRowPressed,
        disabled && styles.menuRowDisabled,
      ]}
      accessibilityRole="menuitem"
      accessibilityState={{ disabled }}
    >
      <Text style={[styles.menuLabel, { color }]}>{label}</Text>
      <Ionicons name={icon} size={18} color={color} />
    </Pressable>
  );
}

// Bottom sheet for naming a new app or renaming / restyling an existing one.
function AppSheet({
  draft,
  stopsBuild,
  onClose,
  onCreated,
}: {
  draft: Draft | null;
  stopsBuild: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const wide = useWideLayout();
  const keyboardRef = React.useRef(null);
  const keyboard = useKeyboardShown(!!draft, keyboardRef);
  const [name, setName] = React.useState('');
  const [tint, setTint] = React.useState<Tint>('yellow');
  const [glyph, setGlyph] = React.useState<Glyph | null>(null);
  const [vibe, setVibe] = React.useState(VIBES[0]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!draft) return;
    if (draft.mode === 'create') {
      setName('');
      setTint(defaultTint(String(Date.now())));
      setGlyph(null);
      setVibe(VIBES[0]);
    } else {
      const look = appearanceOf(draft.project);
      setName(draft.project.name);
      setTint(look.tint);
      setGlyph(look.glyph);
      setVibe(draft.project.vibe ?? '');
    }
  }, [draft]);

  // Until the user picks a glyph, follow the name ("Plant watering" → leaf).
  const shownGlyph = glyph ?? defaultGlyph(name);

  const submit = async () => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      if (draft.mode === 'create') {
        const project = await projectStore.create(name, { tint, glyph: shownGlyph }, vibe);
        onCreated(project.id);
      } else if (draft.mode === 'style') {
        await projectStore.setVibe(draft.project.id, vibe);
        onClose();
      } else {
        if (name.trim() && name.trim() !== draft.project.name) {
          await projectStore.rename(draft.project.id, name);
        }
        await projectStore.setAppearance(draft.project.id, { tint, glyph: shownGlyph });
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      transparent
      visible={!!draft}
      animationType={wide ? 'fade' : 'slide'}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[
          styles.sheetBackdrop,
          wide ? styles.sheetBackdropWide : { paddingTop: insets.top + 12 },
        ]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            // The home indicator sits under the keyboard while it's up.
            { paddingBottom: (keyboard.shown ? 16 : Math.max(insets.bottom, 16)) + 8 },
            wide && styles.sheetWide,
          ]}
        >
          {wide ? null : <View style={styles.grabber} />}
          {/* Scrolls so the title and fields stay reachable when the keyboard
              pushes the sheet up on a short screen. */}
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.sheetHead}>
              {draft?.mode === 'style' ? (
                <AppIcon project={draft.project} size={56} />
              ) : (
                <AppIcon tint={tint} glyph={shownGlyph} size={56} />
              )}
              <View style={styles.sheetHeadText}>
                <Text style={styles.sheetTitle}>
                  {draft?.mode === 'edit' ? 'Edit app' : draft?.mode === 'style' ? 'Style' : 'New app'}
                </Text>
                {draft?.mode === 'style' ? (
                  <Text style={styles.sheetNote} numberOfLines={1}>
                    {draft.project.name}
                  </Text>
                ) : null}
              </View>
            </View>

            {draft?.mode === 'style' ? (
              <>
                <VibeField value={vibe} onChange={setVibe} autoFocus={false} />
                <Text style={styles.sheetNote}>
                  Nothing changes right away. The agent uses it the next time it works on how the app
                  looks, or ask it to restyle the app.
                </Text>
              </>
            ) : (
              <>
                <TextInput
                  keyboardAppearance="dark"
                  value={name}
                  onChangeText={setName}
                  placeholder="Name, e.g. Habit tracker"
                  placeholderTextColor={colors.dust}
                  style={styles.input}
                  autoFocus={draft?.mode === 'create'}
                  onSubmitEditing={submit}
                  returnKeyType="done"
                  accessibilityLabel="App name"
                />

                {draft?.mode === 'create' ? <VibeField value={vibe} onChange={setVibe} /> : null}

                <Text style={type.sectionLabel}>Colour</Text>
                <View style={styles.swatches}>
                  {TINT_KEYS.map((k) => (
                    <Pressable
                      key={k}
                      onPress={() => setTint(k)}
                      style={[styles.swatch, { backgroundColor: TINTS[k].bg }, tint === k && styles.swatchOn]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: tint === k }}
                      accessibilityLabel={k}
                    >
                      <View style={[styles.swatchDot, { backgroundColor: TINTS[k].fg }]} />
                    </Pressable>
                  ))}
                </View>

                <Text style={type.sectionLabel}>Icon</Text>
                <View style={styles.glyphs}>
                  {GLYPHS.map((g) => {
                    const on = g === shownGlyph;
                    return (
                      <Pressable
                        key={g}
                        onPress={() => setGlyph(g)}
                        style={[styles.glyphBtn, on && styles.glyphBtnOn]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={g}
                      >
                        <Ionicons
                          name={`${g}-outline`}
                          size={20}
                          color={on ? TINTS[tint].fg : colors.dust}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            {stopsBuild && draft?.mode === 'create' ? (
              <Text style={styles.sheetNote}>Creating an app stops the build that's running.</Text>
            ) : null}
          </ScrollView>

          <View style={styles.dialogActions}>
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && styles.pressed]}
              onPress={onClose}
            >
              <Text style={styles.btnSecondaryText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnPrimary, (busy || pressed) && styles.pressed]}
              onPress={submit}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.slate} />
              ) : (
                <Text style={styles.btnPrimaryText}>
                  {draft?.mode === 'create' ? 'Create app' : 'Save'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// "How should it feel?": suggestion chips plus free text, one value.
function VibeField({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  const picked = VIBES.find((v) => v.toLowerCase() === value.trim().toLowerCase());
  return (
    <View style={styles.vibe}>
      <Text style={type.sectionLabel}>How should it feel?</Text>
      <View style={styles.chips}>
        {VIBES.map((v) => {
          const on = v === picked;
          return (
            <Pressable
              key={v}
              onPress={() => onChange(on ? '' : v)}
              style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{v}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        keyboardAppearance="dark"
        value={picked ? '' : value}
        onChangeText={onChange}
        placeholder={picked ? 'Or describe it in your own words' : 'e.g. calm, like a paper notebook'}
        placeholderTextColor={colors.dust}
        style={[styles.input, styles.vibeInput]}
        autoFocus={autoFocus}
        maxLength={projectStore.MAX_VIBE_LENGTH}
        returnKeyType="done"
        accessibilityLabel="How should it feel?"
      />
    </View>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.slate },
  pressed: { opacity: 0.75 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  headerText: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.display, fontSize: 30, letterSpacing: -0.3, color: colors.chalk },
  count: { fontFamily: fonts.body, fontSize: 13, color: colors.dust },
  headerBtn: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.board,
    justifyContent: 'center',
  },
  headerBtnOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  headerBtnText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.chalk },
  headerBtnTextOn: { color: colors.slate },
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

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 13,
    rowGap: 24,
    paddingBottom: 24,
  },
  cell: { width: '25%', alignItems: 'center', gap: 8 },
  // Fixed-width cells on desktop, so the grid fills left to right.
  cellWide: { width: 112 },
  tilted: { transform: [{ rotate: '-2deg' }] },
  tile: {
    width: 72,
    height: 72,
    borderRadius: radii.tile,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tileCurrent: { borderWidth: 2, borderColor: colors.accent },
  newTile: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.lineFaint,
  },
  tileLabel: {
    maxWidth: 80,
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 15,
    textAlign: 'center',
    color: colors.chalkSoft,
  },
  newLabel: { color: colors.dust },
  currentDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: -4,
    backgroundColor: colors.accent,
  },
  importedBadge: {
    position: 'absolute',
    right: -6,
    bottom: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.slate,
    backgroundColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBadge: {
    position: 'absolute',
    top: -8,
    left: -8,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.slate,
    backgroundColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },

  resumeWrap: { paddingHorizontal: 20, paddingTop: 12 },
  resume: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 10,
    borderRadius: radii.composer,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.board,
  },
  resumeWide: { alignSelf: 'center', width: '100%', maxWidth: 560 },
  resumeText: { flex: 1, minWidth: 0, gap: 2 },
  resumeName: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.chalk },
  resumeMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.dust },
  resumeBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: radii.input,
    backgroundColor: colors.accent,
    justifyContent: 'center',
  },
  resumeBtnText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.slate },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10,10,12,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 360,
    padding: 20,
    gap: 10,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.board,
  },
  dialogTitle: { fontFamily: fonts.displaySemi, fontSize: 20, color: colors.chalk },
  dialogBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.chalkMuted },
  dialogBodyStrong: { fontFamily: fonts.bodySemi, color: colors.chalk },
  dialogActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  btn: {
    flex: 1,
    height: 48,
    borderRadius: radii.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  btnPrimaryText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.slate },
  btnSecondary: { backgroundColor: colors.board, borderColor: colors.lineStrong },
  btnSecondaryText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.chalk },
  btnDanger: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
  btnDangerText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.danger },

  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,10,12,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  menuHead: { alignItems: 'center', gap: 10, maxWidth: 260 },
  menuName: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.chalk },
  menu: {
    width: 250,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.raised,
    overflow: 'hidden',
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
  },
  menuRow: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  menuRowDivider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  menuRowPressed: { backgroundColor: colors.lineStrong },
  menuRowDisabled: { opacity: 0.5 },
  menuLabel: { fontFamily: fonts.body, fontSize: 15 },

  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(10,10,12,0.72)' },
  sheetBackdropWide: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: {
    flexShrink: 1,
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.line,
    backgroundColor: colors.board,
  },
  // A centered dialog on desktop rather than a bottom sheet.
  sheetWide: {
    width: '100%',
    maxWidth: 480,
    paddingTop: 20,
    borderRadius: radii.sheet,
    borderBottomWidth: 1,
  },
  sheetScroll: { flexGrow: 0 },
  sheetBody: { gap: 14 },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lineStrong,
    marginBottom: 6,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  sheetHeadText: { flex: 1, minWidth: 0, gap: 2 },
  sheetTitle: { ...type.header, fontSize: 22, color: colors.chalk },
  sheetNote: { fontFamily: fonts.body, fontSize: 13, color: colors.dust },
  input: {
    height: 52,
    paddingHorizontal: 16,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.slate,
    color: colors.chalk,
    fontFamily: fonts.body,
    fontSize: 15,
  },
  vibe: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.chalk, borderColor: colors.chalk },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.chalkSoft },
  chipTextOn: { color: colors.slate },
  vibeInput: { height: 44, fontSize: 14 },
  swatches: { flexDirection: 'row', gap: 10 },
  swatch: {
    flex: 1,
    height: 40,
    borderRadius: radii.chip,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchOn: { borderColor: colors.chalk },
  swatchDot: { width: 12, height: 12, borderRadius: 6 },
  glyphs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  glyphBtn: {
    width: 42,
    height: 42,
    borderRadius: radii.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphBtnOn: { backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.lineStrong },
});

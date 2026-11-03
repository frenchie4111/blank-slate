import { Ionicons } from '@expo/vector-icons';
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
import { AppIcon } from '../components/AppIcon';
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

type Props = {
  projects: Project[];
  currentId: string | null;
  onClose: () => void;
  // Switches to the project (if needed) and shows the running app.
  onOpen: (id: string) => void;
  // A freshly created project: switch to it and start chatting.
  onCreated: (id: string) => void;
};

type Draft = { mode: 'create' } | { mode: 'edit'; project: Project };

export function YourAppsScreen({ projects, currentId, onClose, onOpen, onCreated }: Props) {
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<Project | null>(null);
  const [busy, setBusy] = React.useState(false);

  const current = projects.find((p) => p.id === currentId) ?? null;
  const canDelete = projects.length > 1;

  const handleTile = (p: Project) => {
    if (busy) return;
    if (editing) setDraft({ mode: 'edit', project: p });
    else onOpen(p.id);
  };

  const confirmDelete = async () => {
    if (!pendingDelete || busy) return;
    setBusy(true);
    try {
      await projectStore.remove(pendingDelete.id);
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Your apps</Text>
          <Text style={styles.count}>
            {projects.length} app{projects.length === 1 ? '' : 's'} on this phone
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
          onPress={onClose}
          style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={20} color={colors.chalk} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.grid}>
        {projects.map((p) => {
          const isCurrent = p.id === currentId;
          return (
            <View key={p.id} style={styles.cell}>
              <View style={editing && styles.tilted}>
                <Pressable
                  onPress={() => handleTile(p)}
                  style={({ pressed }) => [
                    styles.tile,
                    isCurrent ? styles.tileCurrent : null,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={editing ? `Edit ${p.name}` : `Open ${p.name}`}
                >
                  <AppIcon project={p} size={isCurrent ? 68 : 70} />
                </Pressable>
                {editing && canDelete ? (
                  <Pressable
                    onPress={() => setPendingDelete(p)}
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
        <View style={styles.cell}>
          <Pressable
            onPress={() => setDraft({ mode: 'create' })}
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
          <View style={styles.resume}>
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

      <AppSheet
        draft={draft}
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
    </View>
  );
}

// Bottom sheet for naming a new app or renaming / restyling an existing one.
function AppSheet({
  draft,
  onClose,
  onCreated,
}: {
  draft: Draft | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = React.useState('');
  const [tint, setTint] = React.useState<Tint>('yellow');
  const [glyph, setGlyph] = React.useState<Glyph | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!draft) return;
    if (draft.mode === 'edit') {
      const look = appearanceOf(draft.project);
      setName(draft.project.name);
      setTint(look.tint);
      setGlyph(look.glyph);
    } else {
      setName('');
      setTint(defaultTint(String(Date.now())));
      setGlyph(null);
    }
  }, [draft]);

  // Until the user picks a glyph, follow the name ("Plant watering" → leaf).
  const shownGlyph = glyph ?? defaultGlyph(name);

  const submit = async () => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      if (draft.mode === 'create') {
        const project = await projectStore.create(name, { tint, glyph: shownGlyph });
        onCreated(project.id);
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
    <Modal transparent visible={!!draft} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.sheetBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={styles.grabber} />
          <View style={styles.sheetHead}>
            <AppIcon tint={tint} glyph={shownGlyph} size={56} />
            <Text style={styles.sheetTitle}>{draft?.mode === 'edit' ? 'Edit app' : 'New app'}</Text>
          </View>

          <TextInput
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
                  {draft?.mode === 'edit' ? 'Save' : 'Create app'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
    height: 40,
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
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.input,
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

  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(10,10,12,0.72)' },
  sheet: {
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
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lineStrong,
    marginBottom: 6,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  sheetTitle: { ...type.header, fontSize: 22, color: colors.chalk },
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

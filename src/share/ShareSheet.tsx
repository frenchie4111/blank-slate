import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppIcon } from '../components/AppIcon';
import { SettingSwitch } from '../components/SettingSwitch';
import { loadChat } from '../project/chatStore';
import type { Project } from '../project/store';
import { colors, fonts, radii, type } from '../theme';
import { useWideLayout } from '../theme/layout';
import { buildBundle, type BuiltBundle } from './bundle';
import { deliverBundle, shareVerb } from './io';

type Variant = 'code' | 'withChat';

// Bottom sheet shown before an app is shared: whether to include the chat,
// and how big the file will be. Builds both variants up front so flipping the
// switch updates the size immediately.
export function ShareSheet({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const wide = useWideLayout();
  const [includeChat, setIncludeChat] = React.useState(false);
  const [hasChat, setHasChat] = React.useState(false);
  const [built, setBuilt] = React.useState<Partial<Record<Variant, BuiltBundle>>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [sharing, setSharing] = React.useState(false);

  React.useEffect(() => {
    setIncludeChat(false);
    setHasChat(false);
    setBuilt({});
    setError(null);
    setSharing(false);
    if (!project) return;
    let alive = true;
    (async () => {
      const chat = await loadChat(project.id);
      const chatExists = chat.history.length > 0 || chat.entries.length > 0;
      if (alive) setHasChat(chatExists);
      const code = await buildBundle(project, { includeChat: false });
      if (alive) setBuilt((b) => ({ ...b, code }));
      if (chatExists) {
        const withChat = await buildBundle(project, { includeChat: true });
        if (alive) setBuilt((b) => ({ ...b, withChat }));
      }
    })().catch((e: Error) => alive && setError(e.message || "Couldn't package this app."));
    return () => {
      alive = false;
    };
  }, [project]);

  const variant: Variant = includeChat && hasChat ? 'withChat' : 'code';
  const bundle = built[variant];

  const share = async () => {
    if (!bundle || sharing) return;
    setSharing(true);
    setError(null);
    try {
      await deliverBundle(bundle);
      onClose();
    } catch (e) {
      setError((e as Error).message || "Couldn't share this app.");
    } finally {
      setSharing(false);
    }
  };

  const fileCount = bundle?.manifest.files.length ?? 0;

  return (
    <Modal transparent visible={!!project} animationType={wide ? 'fade' : 'slide'} onRequestClose={onClose}>
      <View style={[styles.backdrop, wide && styles.backdropWide]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }, wide && styles.sheetWide]}>
          {wide ? null : <View style={styles.grabber} />}
          <View style={styles.head}>
            {project ? <AppIcon project={project} size={56} /> : null}
            <View style={styles.headText}>
              <Text style={styles.title} numberOfLines={1}>
                Share {project?.name}
              </Text>
              <Text style={styles.meta}>
                {bundle
                  ? `${fileCount} file${fileCount === 1 ? '' : 's'} · ${formatSize(bundle.bytes.length)}`
                  : 'Packaging…'}
              </Text>
            </View>
          </View>

          <Text style={styles.body}>
            Sends a .blankslate file with this app's code and images. Anyone with Blank Slate can open it
            as a new app. Data saved inside the app, your API key and debug history stay on this device.
          </Text>

          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, !hasChat && styles.dim]}>Include chat history</Text>
              <Text style={styles.rowNote}>
                {hasChat
                  ? 'Your prompts may contain personal details.'
                  : 'This app has no chat yet.'}
              </Text>
            </View>
            <SettingSwitch
              value={includeChat && hasChat}
              onValueChange={setIncludeChat}
              disabled={!hasChat}
              trackColor={{ false: colors.lineStrong, true: colors.accent }}
              thumbColor={colors.chalk}
              accessibilityLabel="Include chat history"
            />
          </View>

          {bundle?.skipped.length ? (
            <Text style={styles.note}>
              Left out: {bundle.skipped.slice(0, 3).join(', ')}
              {bundle.skipped.length > 3 ? ` and ${bundle.skipped.length - 3} more` : ''} (unsupported file
              type).
            </Text>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && styles.pressed]}
              onPress={onClose}
            >
              <Text style={styles.btnSecondaryText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                (!bundle || sharing || pressed) && styles.pressed,
              ]}
              onPress={share}
              disabled={!bundle || sharing}
              accessibilityRole="button"
            >
              {!bundle || sharing ? (
                <ActivityIndicator size="small" color={colors.slate} />
              ) : (
                <Text style={styles.btnPrimaryText}>{shareVerb}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(10,10,12,0.72)' },
  backdropWide: { justifyContent: 'center', alignItems: 'center', padding: 24 },
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
  sheetWide: { width: '100%', maxWidth: 480, paddingTop: 20, borderRadius: radii.sheet, borderBottomWidth: 1 },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lineStrong,
    marginBottom: 6,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...type.header, fontSize: 22, color: colors.chalk },
  meta: { fontFamily: fonts.mono, fontSize: 12, color: colors.dust },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.chalkMuted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.slate,
  },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.chalk },
  rowNote: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.dust },
  dim: { color: colors.dust },
  note: { fontFamily: fonts.body, fontSize: 12, color: colors.dust },
  error: { fontFamily: fonts.body, fontSize: 13, color: colors.danger },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
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
  pressed: { opacity: 0.75 },
});

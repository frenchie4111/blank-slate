import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, fonts, noLigatures, radii, space } from '../theme';
import * as vfs from '../vfs/vfs';

type Props = {
  projectId: string | null;
};

export function FilesPanel({ projectId }: Props) {
  const [files, setFiles] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [content, setContent] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);

  const refreshList = React.useCallback(async () => {
    const list = await vfs.listFiles();
    setFiles(list);
    setSelected((prev) => {
      if (prev && list.includes(prev)) return prev;
      const preferred = list.includes('App.tsx') ? 'App.tsx' : list[0] ?? null;
      return preferred;
    });
  }, []);

  const loadContent = React.useCallback(async (path: string) => {
    setLoading(true);
    try {
      const text = await vfs.readFile(path);
      setContent(text ?? '');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refreshList();
    const unsub = vfs.subscribe((change) => {
      refreshList();
      if (selected && change.path === selected && change.type === 'write') {
        loadContent(selected);
      }
    });
    return unsub;
  }, [refreshList, loadContent, selected]);

  React.useEffect(() => {
    setSelected(null);
    setContent(null);
    setPickerOpen(false);
    refreshList();
  }, [projectId, refreshList]);

  React.useEffect(() => {
    if (selected) loadContent(selected);
    else setContent(null);
  }, [selected, loadContent]);

  const pick = (path: string) => {
    setSelected(path);
    setPickerOpen(false);
  };

  return (
    <View style={styles.root}>
      <View style={styles.subHeader}>
        <Pressable
          onPress={() => setPickerOpen((v) => !v)}
          style={({ pressed }) => [styles.picker, (pickerOpen || pressed) && styles.pickerOpen]}
          disabled={files.length === 0}
          accessibilityRole="button"
          accessibilityLabel="Choose file"
        >
          <Ionicons
            name={selected ? iconForPath(selected) : 'document-outline'}
            size={15}
            color={colors.dust}
          />
          <Text style={styles.pickerText} numberOfLines={1}>
            {selected ?? (files.length === 0 ? 'No files yet' : 'Select a file')}
          </Text>
          <Ionicons
            name={pickerOpen ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={colors.dust}
          />
        </Pressable>
        <Text style={styles.countText}>
          {files.length} file{files.length === 1 ? '' : 's'}
        </Text>
      </View>

      <View style={styles.bodyWrap}>
        {selected ? (
          <ScrollView
            style={styles.contentScroll}
            contentContainerStyle={styles.contentInner}
          >
            {loading && content === null ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={colors.dust} />
              </View>
            ) : content?.startsWith('data:image/') ? (
              <Image source={{ uri: content }} style={styles.imagePreview} resizeMode="contain" />
            ) : (
              <CodeView code={content ?? ''} />
            )}
          </ScrollView>
        ) : (
          <View style={styles.emptyWrap}>
            <Ionicons name="folder-open-outline" size={28} color={colors.lineFaint} />
            <Text style={styles.empty}>
              {files.length === 0
                ? 'No files yet. Ask the agent in the Chat tab to build something.'
                : 'Pick a file to view its contents.'}
            </Text>
          </View>
        )}

        {pickerOpen ? (
          <>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setPickerOpen(false)}
            />
            <View style={styles.dropdown}>
              <ScrollView style={styles.dropdownScroll}>
                {files.map((path, i) => {
                  const isCurrent = path === selected;
                  return (
                    <Pressable
                      key={path}
                      onPress={() => pick(path)}
                      style={({ pressed }) => [
                        styles.dropdownRow,
                        i === files.length - 1 && styles.dropdownRowLast,
                        (isCurrent || pressed) && styles.dropdownRowCurrent,
                      ]}
                    >
                      <Ionicons name={iconForPath(path)} size={14} color={colors.dust} />
                      <Text
                        style={[
                          styles.dropdownPath,
                          isCurrent && styles.dropdownPathCurrent,
                        ]}
                        numberOfLines={1}
                      >
                        {path}
                      </Text>
                      {isCurrent ? (
                        <Ionicons name="checkmark" size={14} color={colors.success} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}

function CodeView({ code }: { code: string }) {
  const gutter = React.useMemo(() => {
    const count = code.split('\n').length;
    return Array.from({ length: count }, (_, i) => String(i + 1)).join('\n');
  }, [code]);
  return (
    <View style={styles.codeRow}>
      <Text style={styles.gutter}>{gutter}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator style={styles.codeScroll}>
        <Text style={styles.code} selectable>
          {code}
        </Text>
      </ScrollView>
    </View>
  );
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function iconForPath(path: string): IconName {
  if (vfs.isImagePath(path)) return 'image-outline';
  if (/\.(tsx|jsx|ts|js)$/.test(path)) return 'code-slash-outline';
  return 'document-text-outline';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.slate },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: space.chatGutter,
    paddingBottom: 12,
    zIndex: 2,
  },
  picker: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.board,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pickerOpen: { borderColor: colors.lineStrong, backgroundColor: colors.raised },
  pickerText: { flex: 1, fontFamily: fonts.mono, fontSize: 13, color: colors.chalk },
  countText: { fontFamily: fonts.mono, fontSize: 11, color: colors.dust },

  bodyWrap: { flex: 1, position: 'relative' },
  contentScroll: { flex: 1 },
  contentInner: { paddingHorizontal: space.chatGutter, paddingBottom: 24 },
  imagePreview: { width: '100%', aspectRatio: 1, borderRadius: radii.button },
  loadingRow: { padding: 24, alignItems: 'center' },
  codeRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.board,
  },
  gutter: {
    paddingLeft: 12,
    paddingRight: 10,
    textAlign: 'right',
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 19,
    color: colors.lineFaint,
  },
  codeScroll: { flex: 1 },
  code: {
    ...noLigatures,
    paddingRight: 14,
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 19,
    color: colors.chalkSoft,
  },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  empty: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    color: colors.dust,
  },

  dropdown: {
    position: 'absolute',
    top: 0,
    left: space.chatGutter,
    right: space.chatGutter,
    maxHeight: 320,
    backgroundColor: colors.raised,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    zIndex: 3,
  },
  dropdownScroll: { maxHeight: 320 },
  dropdownRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  dropdownRowLast: { borderBottomWidth: 0 },
  dropdownRowCurrent: { backgroundColor: colors.line },
  dropdownPath: { flex: 1, fontFamily: fonts.mono, fontSize: 13, color: colors.chalkMuted },
  dropdownPathCurrent: { color: colors.chalk },
});

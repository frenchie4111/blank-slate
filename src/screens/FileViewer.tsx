import React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
          style={[styles.picker, pickerOpen && styles.pickerOpen]}
          disabled={files.length === 0}
        >
          <Text style={styles.pickerIcon}>{selected ? iconForPath(selected) : '·'}</Text>
          <Text style={styles.pickerText} numberOfLines={1}>
            {selected ?? (files.length === 0 ? 'No files yet' : 'Select a file')}
          </Text>
          <Text style={styles.pickerChevron}>▾</Text>
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
            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color="#9ca3af" />
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator>
                <Text style={styles.code} selectable>
                  {content ?? ''}
                </Text>
              </ScrollView>
            )}
          </ScrollView>
        ) : (
          <View style={styles.emptyWrap}>
            <Text style={styles.empty}>
              {files.length === 0
                ? 'No files yet. Ask Claude in the Chat tab to build something.'
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
                {files.map((path) => {
                  const isCurrent = path === selected;
                  return (
                    <Pressable
                      key={path}
                      onPress={() => pick(path)}
                      style={[styles.dropdownRow, isCurrent && styles.dropdownRowCurrent]}
                    >
                      <Text style={styles.dropdownIcon}>{iconForPath(path)}</Text>
                      <Text
                        style={[
                          styles.dropdownPath,
                          isCurrent && styles.dropdownPathCurrent,
                        ]}
                        numberOfLines={1}
                      >
                        {path}
                      </Text>
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

function iconForPath(path: string): string {
  if (path.endsWith('.tsx') || path.endsWith('.jsx')) return '⚛︎';
  if (path.endsWith('.ts') || path.endsWith('.js')) return 'JS';
  if (path.endsWith('.json')) return '{}';
  if (path.endsWith('.md')) return 'M';
  return '•';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0f' },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
    backgroundColor: '#0b0b0f',
    zIndex: 2,
  },
  picker: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#111827',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  pickerOpen: { borderColor: '#374151', backgroundColor: '#1a1f2e' },
  pickerIcon: {
    color: '#60a5fa',
    fontSize: 11,
    fontWeight: '700',
    width: 20,
    textAlign: 'center',
  },
  pickerText: {
    flex: 1,
    color: '#e5e7eb',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  pickerChevron: { color: '#9ca3af', fontSize: 12 },
  countText: { color: '#6b7280', fontSize: 11 },

  bodyWrap: { flex: 1, position: 'relative' },
  contentScroll: { flex: 1, backgroundColor: '#0b0b0f' },
  contentInner: { padding: 14 },
  loadingRow: { padding: 24, alignItems: 'center' },
  code: {
    color: '#e5e7eb',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: {
    color: '#6b7280',
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: 20,
  },

  dropdown: {
    position: 'absolute',
    top: 6,
    left: 14,
    right: 14,
    maxHeight: 320,
    backgroundColor: '#111827',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f2937',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    zIndex: 3,
  },
  dropdownScroll: { maxHeight: 320 },
  dropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  dropdownRowCurrent: { backgroundColor: '#1a1f2e' },
  dropdownIcon: {
    color: '#60a5fa',
    fontSize: 11,
    fontWeight: '700',
    width: 20,
    textAlign: 'center',
  },
  dropdownPath: {
    flex: 1,
    color: '#e5e7eb',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  dropdownPathCurrent: { color: '#fff', fontWeight: '700' },
});

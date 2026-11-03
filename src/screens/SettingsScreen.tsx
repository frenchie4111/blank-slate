import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import React from 'react';
import {
  ActivityIndicator,
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
import { MODEL_OPTIONS } from '../agent/models';
import { getModel, setModel } from '../storage/keyStore';

type Props = {
  onBack: () => void;
  onResetKey: () => void | Promise<void>;
};

type CheckStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'available' }
  | { kind: 'error'; message: string };

export function SettingsScreen({ onBack, onResetKey }: Props) {
  const insets = useSafeAreaInsets();
  const {
    currentlyRunning,
    availableUpdate,
    isUpdateAvailable,
    isDownloading,
  } = Updates.useUpdates();

  const [checkStatus, setCheckStatus] = React.useState<CheckStatus>({ kind: 'idle' });
  const [applyError, setApplyError] = React.useState<string | null>(null);
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);

  const handleCheck = async () => {
    setCheckStatus({ kind: 'checking' });
    setApplyError(null);
    try {
      const result = await Updates.checkForUpdateAsync();
      setCheckStatus({ kind: result.isAvailable ? 'available' : 'up-to-date' });
    } catch (e) {
      setCheckStatus({ kind: 'error', message: describeUpdatesError(e) });
    }
  };

  const handleApply = async () => {
    setApplyError(null);
    try {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch (e) {
      setApplyError(describeUpdatesError(e));
    }
  };

  const [model, setModelState] = React.useState<string | null>(null);
  const [customModel, setCustomModel] = React.useState('');

  React.useEffect(() => {
    getModel().then((m) => {
      setModelState(m);
      if (!MODEL_OPTIONS.some((o) => o.id === m)) setCustomModel(m);
    });
  }, []);

  const chooseModel = async (id: string) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    setModelState(trimmed);
    await setModel(trimmed);
  };

  const customIsActive = model !== null && !MODEL_OPTIONS.some((o) => o.id === model);

  const handleConfirmReset = async () => {
    setResetting(true);
    try {
      await onResetKey();
    } finally {
      setResetting(false);
      setConfirmReset(false);
    }
  };

  const appVersion = Application.nativeApplicationVersion ?? '—';
  const buildNumber = Application.nativeBuildVersion ?? '—';
  const runtimeVersion = currentlyRunning.runtimeVersion ?? Updates.runtimeVersion ?? '—';
  const channel = currentlyRunning.channel ?? Updates.channel ?? 'development';
  const updateId = currentlyRunning.isEmbeddedLaunch
    ? 'bundled'
    : (currentlyRunning.updateId ?? 'bundled');
  const published = currentlyRunning.createdAt ? formatDate(currentlyRunning.createdAt) : '—';

  const applyEnabled = isUpdateAvailable && !isDownloading;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.headerBack}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
          <Text style={styles.headerBackText}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Section title="Model">
          {MODEL_OPTIONS.map((o) => (
            <Pressable
              key={o.id}
              style={({ pressed }) => [styles.modelRow, pressed && styles.rowBtnPressed]}
              onPress={() => chooseModel(o.id)}
            >
              <View style={styles.modelText}>
                <Text style={styles.modelLabel}>{o.label}</Text>
                <Text style={styles.modelNote}>{o.note}</Text>
              </View>
              {model === o.id ? <Ionicons name="checkmark" size={18} color="#34d399" /> : null}
            </Pressable>
          ))}
          <View style={styles.customRow}>
            <TextInput
              value={customModel}
              onChangeText={setCustomModel}
              placeholder="any OpenRouter model ID, e.g. qwen/qwen3.8-max-prime"
              placeholderTextColor="#6b7280"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.customInput}
              onSubmitEditing={() => chooseModel(customModel)}
              returnKeyType="done"
            />
            <Pressable
              style={[styles.customBtn, !customModel.trim() && styles.buttonDisabled]}
              onPress={() => chooseModel(customModel)}
              disabled={!customModel.trim()}
            >
              {customIsActive && customModel.trim() === model ? (
                <Ionicons name="checkmark" size={16} color="#0b0b0f" />
              ) : (
                <Text style={styles.customBtnText}>Use</Text>
              )}
            </Pressable>
          </View>
        </Section>
        <Text style={styles.sectionHint}>
          Prices are USD per million input / output tokens. Browse more models at
          openrouter.ai/models. Takes effect on your next message.
        </Text>

        <Section title="OpenRouter API Key">
          <Pressable
            style={({ pressed }) => [styles.rowBtn, pressed && styles.rowBtnPressed]}
            onPress={() => setConfirmReset(true)}
          >
            <Text style={styles.rowBtnDanger}>Reset API Key</Text>
            <Ionicons name="chevron-forward" size={16} color="#6b7280" />
          </Pressable>
        </Section>
        <Text style={styles.sectionHint}>
          Clears your key from the device. You'll need to paste it again to continue using
          Blank Slate.
        </Text>

        <Section title="Updates">
          <Row label="App version" value={`${appVersion} (build ${buildNumber})`} />
          <Row label="Runtime version" value={runtimeVersion} mono />
          <Row label="Channel" value={channel} mono />
          <Row label="Current update" value={updateId} mono />
          <Row label="Published" value={published} />

          <View style={styles.buttonStack}>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.buttonSecondary,
                checkStatus.kind === 'checking' && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleCheck}
              disabled={checkStatus.kind === 'checking'}
            >
              {checkStatus.kind === 'checking' ? (
                <ActivityIndicator size="small" color="#e5e7eb" />
              ) : (
                <Text style={styles.buttonSecondaryText}>Check for updates</Text>
              )}
            </Pressable>
            {checkStatusText(checkStatus) ? (
              <Text
                style={[
                  styles.statusNote,
                  checkStatus.kind === 'error' && styles.statusNoteError,
                  checkStatus.kind === 'available' && styles.statusNoteGood,
                ]}
              >
                {checkStatusText(checkStatus)}
              </Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.buttonPrimary,
                !applyEnabled && styles.buttonDisabled,
                pressed && applyEnabled && styles.buttonPressed,
              ]}
              onPress={handleApply}
              disabled={!applyEnabled}
            >
              {isDownloading ? (
                <ActivityIndicator size="small" color="#0b0b0f" />
              ) : (
                <Text style={styles.buttonPrimaryText}>
                  {isUpdateAvailable ? 'Download and restart' : 'No update to apply'}
                </Text>
              )}
            </Pressable>
            {applyError ? <Text style={styles.statusNoteError}>{applyError}</Text> : null}
            {availableUpdate?.createdAt ? (
              <Text style={styles.statusNote}>
                Pending update published {formatDate(availableUpdate.createdAt)}
              </Text>
            ) : null}
          </View>
        </Section>
      </ScrollView>

      <Modal
        transparent
        visible={confirmReset}
        animationType="fade"
        onRequestClose={() => setConfirmReset(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reset API Key?</Text>
            <Text style={styles.modalBody}>
              This will log you out. You'll need to paste your OpenRouter API key again to
              continue.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalBtn}
                onPress={() => setConfirmReset(false)}
                disabled={resetting}
              >
                <Text style={styles.modalBtnMuted}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, resetting && styles.buttonDisabled]}
                onPress={handleConfirmReset}
                disabled={resetting}
              >
                {resetting ? (
                  <ActivityIndicator size="small" color="#ef4444" />
                ) : (
                  <Text style={styles.modalBtnDanger}>Reset</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[styles.rowValue, mono && styles.rowValueMono]}
        numberOfLines={1}
        ellipsizeMode="middle"
      >
        {value}
      </Text>
    </View>
  );
}

function checkStatusText(s: CheckStatus): string | null {
  switch (s.kind) {
    case 'idle':
      return null;
    case 'checking':
      return 'Checking…';
    case 'up-to-date':
      return 'Up to date';
    case 'available':
      return 'Update available';
    case 'error':
      return s.message;
  }
}

function describeUpdatesError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  // checkForUpdateAsync throws in Expo Go / dev client / web because the
  // updates runtime is gated on the native build. Surface a friendlier hint.
  if (/development|disabled|not enabled|Expo Go/i.test(msg)) {
    return 'Updates only available in preview/production builds.';
  }
  return msg;
}

function formatDate(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0f' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  headerBack: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4, paddingRight: 8 },
  headerBackText: { color: '#fff', fontSize: 15 },
  headerTitle: {
    // Spans the full row to stay centered; don't let it swallow taps on Back.
    pointerEvents: 'none',
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  headerSpacer: { flex: 1 },
  scroll: { padding: 16, gap: 24, paddingBottom: 64 },

  section: { gap: 10 },
  sectionTitle: {
    color: '#9ca3af',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
    paddingHorizontal: 4,
  },
  sectionBody: {
    backgroundColor: '#111827',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f2937',
    overflow: 'hidden',
  },
  sectionHint: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 4,
    marginTop: -14,
  },

  rowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rowBtnPressed: { backgroundColor: '#1f2937' },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1f2937',
    gap: 12,
  },
  modelText: { flex: 1, gap: 2 },
  modelLabel: { color: '#e5e7eb', fontSize: 14, fontWeight: '600' },
  modelNote: { color: '#6b7280', fontSize: 12 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  customInput: {
    flex: 1,
    backgroundColor: '#0b0b0f',
    borderWidth: 1,
    borderColor: '#2a2a30',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#fff',
    fontSize: 13,
    fontFamily: MONO,
  },
  customBtn: {
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    minWidth: 52,
    alignItems: 'center',
  },
  customBtnText: { color: '#0b0b0f', fontWeight: '700', fontSize: 13 },
  rowBtnDanger: { color: '#ef4444', fontSize: 14, fontWeight: '600' },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: '#111827',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 18,
    gap: 10,
    width: '100%',
    maxWidth: 360,
  },
  modalTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalBody: { color: '#d1d5db', fontSize: 13, lineHeight: 19 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 6 },
  modalBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  modalBtnMuted: { color: '#9ca3af', fontSize: 14, fontWeight: '600' },
  modalBtnDanger: { color: '#ef4444', fontSize: 14, fontWeight: '700' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1f2937',
    gap: 12,
  },
  rowLabel: { color: '#9ca3af', fontSize: 13 },
  rowValue: { color: '#e5e7eb', fontSize: 13, flexShrink: 1, textAlign: 'right' },
  rowValueMono: { fontFamily: MONO, fontSize: 12 },

  buttonStack: { gap: 8, padding: 12 },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: { backgroundColor: '#fff' },
  buttonPrimaryText: { color: '#0b0b0f', fontWeight: '700', fontSize: 14 },
  buttonSecondary: { backgroundColor: '#1f2937', borderWidth: 1, borderColor: '#374151' },
  buttonSecondaryText: { color: '#e5e7eb', fontWeight: '600', fontSize: 14 },
  buttonPressed: { opacity: 0.85 },
  buttonDisabled: { opacity: 0.4 },

  statusNote: { color: '#9ca3af', fontSize: 12, paddingHorizontal: 2 },
  statusNoteError: { color: '#f87171', fontSize: 12, paddingHorizontal: 2 },
  statusNoteGood: { color: '#34d399', fontSize: 12, paddingHorizontal: 2 },
});

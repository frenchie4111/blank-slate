import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MODEL_OPTIONS } from '../agent/models';
import { SettingSwitch } from '../components/SettingSwitch';
import { getAutoAppIcons, getModel, setAutoAppIcons, setModel } from '../storage/keyStore';
import { colors, fonts, radii, type } from '../theme';
import { CONTENT_MAX_WIDTH, useWideLayout } from '../theme/layout';
import { McpSettings } from './McpSettings';

type Props = {
  onBack: () => void;
  onResetKey: () => void | Promise<void>;
  apiKey?: string;
};

type CheckStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'available' }
  | { kind: 'error'; message: string };

export function SettingsScreen({ onBack, onResetKey, apiKey }: Props) {
  const insets = useSafeAreaInsets();
  const wide = useWideLayout();
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

  const [autoIcons, setAutoIconsState] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    getAutoAppIcons().then(setAutoIconsState);
  }, []);

  const toggleAutoIcons = async (on: boolean) => {
    setAutoIconsState(on);
    await setAutoAppIcons(on);
  };

  const customIsActive = model !== null && !MODEL_OPTIONS.some((o) => o.id === model);
  const customInUse = customIsActive && customModel.trim() === model;

  const handleConfirmReset = async () => {
    setResetting(true);
    try {
      await onResetKey();
    } finally {
      setResetting(false);
      setConfirmReset(false);
    }
  };

  // `||`, not `??`: on web and in dev builds these come back as ''.
  const appVersion = Application.nativeApplicationVersion || '—';
  const buildNumber = Application.nativeBuildVersion || '—';
  const runtimeVersion = currentlyRunning.runtimeVersion || Updates.runtimeVersion || '—';
  const channel = currentlyRunning.channel || Updates.channel || 'development';
  const updateId = currentlyRunning.isEmbeddedLaunch
    ? 'bundled'
    : currentlyRunning.updateId || 'bundled';
  const published = currentlyRunning.createdAt ? formatDate(currentlyRunning.createdAt) : '—';

  const updateReady = isUpdateAvailable || checkStatus.kind === 'available';
  const status = statusFor(checkStatus, isUpdateAvailable);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          hitSlop={4}
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.chalk} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 34 },
          wide && styles.scrollWide,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Section title="Model">
          {MODEL_OPTIONS.map((o) => {
            const selected = model === o.id;
            return (
              <Pressable
                key={o.id}
                style={({ pressed }) => [styles.modelRow, pressed && styles.rowPressed]}
                onPress={() => chooseModel(o.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <View style={[styles.radio, selected && styles.radioOn]} />
                <View style={styles.modelText}>
                  <Text style={[styles.modelLabel, selected && styles.modelLabelOn]}>
                    {o.label}
                  </Text>
                  <Text style={styles.modelNote}>{o.note}</Text>
                </View>
              </Pressable>
            );
          })}
          <View style={styles.customRow}>
            <View style={[styles.radio, customIsActive && styles.radioOn]} />
            <TextInput
              keyboardAppearance="dark"
              value={customModel}
              onChangeText={setCustomModel}
              placeholder="Custom OpenRouter model ID"
              placeholderTextColor={colors.dust}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.customInput}
              onSubmitEditing={() => chooseModel(customModel)}
              returnKeyType="done"
              accessibilityLabel="Custom model ID"
            />
            <Pressable
              style={({ pressed }) => [
                styles.smallBtn,
                !customModel.trim() && styles.disabled,
                pressed && styles.pressed,
              ]}
              onPress={() => chooseModel(customModel)}
              disabled={!customModel.trim() || customInUse}
            >
              {customInUse ? (
                <Ionicons name="checkmark" size={16} color={colors.success} />
              ) : (
                <Text style={styles.smallBtnText}>Use</Text>
              )}
            </Pressable>
          </View>
        </Section>
        <Text style={styles.hint}>
          Prices are USD per million input / output tokens. Browse more models at
          openrouter.ai/models. Takes effect on your next message.
        </Text>

        <Section title="Icons">
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Auto-generate app icons</Text>
            <SettingSwitch
              value={autoIcons ?? true}
              onValueChange={toggleAutoIcons}
              disabled={autoIcons === null}
              trackColor={{ false: colors.lineStrong, true: colors.success }}
              thumbColor={colors.chalk}
              accessibilityLabel="Auto-generate app icons"
            />
          </View>
        </Section>
        <Text style={styles.hint}>
          The agent makes an icon for each new app (about $0.035 each). When off, it only
          makes one if you ask.
        </Text>

        <McpSettings />

        <Section title="App">
          <Row label="Version" value={`${appVersion} (build ${buildNumber})`} />
          <Row label="Runtime" value={runtimeVersion} />
          <Row label="Channel" value={channel} />
          <Row label="Update" value={updateId} />
          <Row label="Published" value={published} />
          <View style={styles.statusRow}>
            {checkStatus.kind === 'checking' ? (
              <ActivityIndicator size="small" color={colors.dust} style={styles.statusSpinner} />
            ) : (
              <View style={[styles.statusDot, { backgroundColor: status.dot }]} />
            )}
            <Text
              style={[styles.statusText, checkStatus.kind === 'error' && styles.statusTextError]}
              numberOfLines={2}
            >
              {status.text}
            </Text>
            {updateReady ? (
              <Pressable
                style={({ pressed }) => [
                  styles.smallBtn,
                  styles.smallBtnPrimary,
                  (pressed || isDownloading) && styles.pressed,
                ]}
                onPress={handleApply}
                disabled={isDownloading}
              >
                {isDownloading ? (
                  <ActivityIndicator size="small" color={colors.slate} />
                ) : (
                  <Text style={[styles.smallBtnText, styles.smallBtnPrimaryText]}>
                    Restart to update
                  </Text>
                )}
              </Pressable>
            ) : (
              <Pressable
                style={({ pressed }) => [
                  styles.smallBtn,
                  checkStatus.kind === 'checking' && styles.disabled,
                  pressed && styles.pressed,
                ]}
                onPress={handleCheck}
                disabled={checkStatus.kind === 'checking'}
              >
                <Text style={styles.smallBtnText}>Check now</Text>
              </Pressable>
            )}
          </View>
        </Section>
        {applyError || availableUpdate?.createdAt ? (
          <Text style={[styles.hint, applyError ? styles.statusTextError : null]}>
            {applyError ?? `Pending update published ${formatDate(availableUpdate!.createdAt!)}`}
          </Text>
        ) : null}

        <Section title="API key">
          <Row label="OpenRouter" value={maskKey(apiKey)} />
          <Pressable
            style={({ pressed }) => [styles.dangerRow, pressed && styles.rowPressed]}
            onPress={() => setConfirmReset(true)}
            accessibilityRole="button"
          >
            <Text style={styles.dangerText}>Reset API key</Text>
          </Pressable>
        </Section>
        <Text style={styles.hint}>
          Clears your key from the device. You'll need to paste it again to continue using
          Blank Slate.
        </Text>
      </ScrollView>

      <Modal
        transparent
        visible={confirmReset}
        animationType="fade"
        onRequestClose={() => setConfirmReset(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reset API key?</Text>
            <Text style={styles.modalBody}>
              This will log you out. You'll need to paste your OpenRouter API key again to
              continue.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [styles.modalBtn, styles.modalBtnSecondary, pressed && styles.pressed]}
                onPress={() => setConfirmReset(false)}
                disabled={resetting}
              >
                <Text style={styles.modalBtnSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.modalBtn,
                  styles.modalBtnDanger,
                  (resetting || pressed) && styles.pressed,
                ]}
                onPress={handleConfirmReset}
                disabled={resetting}
              >
                {resetting ? (
                  <ActivityIndicator size="small" color={colors.danger} />
                ) : (
                  <Text style={styles.modalBtnDangerText}>Reset key</Text>
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
      <Text style={type.sectionLabel}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1} ellipsizeMode="middle">
        {value}
      </Text>
    </View>
  );
}

function statusFor(s: CheckStatus, available: boolean): { dot: string; text: string } {
  if (available && s.kind !== 'error') return { dot: colors.info, text: 'An update is ready' };
  switch (s.kind) {
    case 'idle':
      return { dot: colors.lineFaint, text: 'Not checked yet' };
    case 'checking':
      return { dot: colors.dust, text: 'Checking…' };
    case 'up-to-date':
      return { dot: colors.success, text: "You're on the latest update" };
    case 'available':
      return { dot: colors.info, text: 'An update is ready' };
    case 'error':
      return { dot: colors.danger, text: s.message };
  }
}

function maskKey(key: string | undefined): string {
  if (!key) return 'sk-or-••••';
  return `sk-or-••••${key.slice(-4)}`;
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.slate },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 20,
    paddingTop: 10,
    paddingBottom: 8,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { ...type.screenTitle, color: colors.chalk },
  scroll: { paddingHorizontal: 20, paddingTop: 16, gap: 24 },
  scrollWide: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' },

  section: { gap: 10 },
  card: {
    backgroundColor: colors.board,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.dust,
    paddingHorizontal: 4,
    marginTop: -14,
  },

  rowPressed: { backgroundColor: colors.raised },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.4 },

  modelRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.lineFaint,
  },
  radioOn: { borderWidth: 6, borderColor: colors.accent },
  modelText: { flex: 1, gap: 2 },
  modelLabel: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.chalk },
  modelLabelOn: { fontFamily: fonts.bodySemi },
  modelNote: { ...type.caption, color: colors.dust },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingLeft: 16,
    paddingRight: 10,
  },
  customInput: {
    flex: 1,
    minWidth: 0,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.slate,
    color: colors.chalk,
    fontFamily: fonts.mono,
    fontSize: 12,
  },
  smallBtn: {
    height: 40,
    minWidth: 56,
    paddingHorizontal: 14,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallBtnText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.chalk },
  smallBtnPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  smallBtnPrimaryText: { fontFamily: fonts.bodySemi, color: colors.slate },

  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.chalk },
  rowValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.chalkMuted,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusSpinner: { width: 8, transform: [{ scale: 0.6 }] },
  statusText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.dust },
  statusTextError: { color: colors.danger },

  dangerRow: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 16 },
  dangerText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.danger },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(10,10,12,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    padding: 20,
    gap: 10,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.board,
  },
  modalTitle: { fontFamily: fonts.displaySemi, fontSize: 20, color: colors.chalk },
  modalBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.chalkMuted },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  modalBtn: {
    flex: 1,
    height: 48,
    borderRadius: radii.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnSecondary: { backgroundColor: colors.board, borderColor: colors.lineStrong },
  modalBtnSecondaryText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.chalk },
  modalBtnDanger: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
  modalBtnDangerText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.danger },
});

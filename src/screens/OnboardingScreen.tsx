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
import { setApiKey } from '../storage/keyStore';

type Props = { onDone: () => void };

export function OnboardingScreen({ onDone }: Props) {
  const [key, setKey] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    const trimmed = key.trim();
    if (!trimmed.startsWith('sk-ant-')) {
      setError('That does not look like an Anthropic API key (expected "sk-ant-...").');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setApiKey(trimmed);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Blank Slate</Text>
        <Text style={styles.subtitle}>
          An empty app. Paste your Anthropic API key to start asking Claude to build things.
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>Anthropic API key</Text>
          <TextInput
            value={key}
            onChangeText={setKey}
            placeholder="sk-ant-..."
            placeholderTextColor="#888"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={styles.input}
            editable={!saving}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.btn, saving && styles.btnDisabled]}
          onPress={submit}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Save key and continue</Text>
          )}
        </Pressable>

        <Text style={styles.note}>
          Your key is stored locally on this device (Keychain / Keystore). It is never sent anywhere
          except directly to api.anthropic.com.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0f' },
  scroll: { padding: 24, paddingTop: 80, flexGrow: 1, gap: 20 },
  title: { color: '#fff', fontSize: 36, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: '#a3a3a3', fontSize: 15, lineHeight: 22 },
  field: { gap: 8, marginTop: 12 },
  label: { color: '#e5e5e5', fontSize: 13, fontWeight: '600' },
  input: {
    backgroundColor: '#1a1a1f',
    borderColor: '#2a2a30',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 14,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  error: { color: '#f87171', fontSize: 13 },
  btn: {
    backgroundColor: '#fff',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#0b0b0f', fontWeight: '700', fontSize: 15 },
  note: { color: '#6b7280', fontSize: 12, lineHeight: 18, marginTop: 8 },
});

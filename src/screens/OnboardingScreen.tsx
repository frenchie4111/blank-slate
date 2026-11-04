import React from 'react';
import {
  ActivityIndicator,
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
import { setApiKey } from '../storage/keyStore';
import { colors, fonts, radii, type } from '../theme';
import { runtimePlatform } from '../platform/desktop';
import { useWideLayout } from '../theme/layout';
import { LogoMark } from '../theme/LogoMark';

type Props = { onDone: () => void };

export function OnboardingScreen({ onDone }: Props) {
  const insets = useSafeAreaInsets();
  const wide = useWideLayout();
  const [key, setKey] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [focused, setFocused] = React.useState(false);

  const submit = async () => {
    const trimmed = key.trim();
    if (!trimmed.startsWith('sk-or-')) {
      setError('That does not look like an OpenRouter API key (expected "sk-or-…").');
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
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: Math.max(insets.top, 20) + 52, paddingBottom: Math.max(insets.bottom, 16) + 24 },
          wide && styles.scrollWide,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.intro}>
          <View style={styles.logoTile}>
            <LogoMark size={30} />
          </View>
          <Text style={styles.title}>Build any app,{'\n'}right here.</Text>
          <Text style={styles.subtitle}>
            Describe what you want. Blank Slate writes the code on your{' '}
            {runtimePlatform() === 'desktop' ? 'computer' : 'phone'} and runs it the moment it's
            ready.
          </Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>OpenRouter API key</Text>
          <TextInput
            keyboardAppearance="dark"
            value={key}
            onChangeText={(v) => {
              setKey(v);
              if (error) setError(null);
            }}
            placeholder="sk-or-…"
            placeholderTextColor={colors.dust}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={[styles.input, focused && styles.inputFocused, error && styles.inputError]}
            editable={!saving}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={submit}
            returnKeyType="done"
            accessibilityLabel="OpenRouter API key"
          />
          {error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <Text style={styles.help}>
              Stored only on this device, in the secure keychain, and sent only to
              openrouter.ai.{' '}
              <Text
                style={styles.link}
                accessibilityRole="link"
                onPress={() => Linking.openURL('https://openrouter.ai/keys').catch(() => {})}
              >
                Get a key
              </Text>
            </Text>
          )}
        </View>

        <View style={styles.spacer} />

        <Pressable
          style={({ pressed }) => [styles.cta, (saving || pressed) && styles.ctaPressed]}
          onPress={submit}
          disabled={saving}
          accessibilityRole="button"
        >
          {saving ? (
            <ActivityIndicator color={colors.slate} />
          ) : (
            <Text style={styles.ctaText}>Save key and continue</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.slate },
  scroll: { flexGrow: 1, paddingHorizontal: 24, gap: 40 },
  // A centered column on desktop instead of a full-width phone screen.
  scrollWide: { width: '100%', maxWidth: 480, alignSelf: 'center', justifyContent: 'center' },
  intro: { gap: 20 },
  logoTile: {
    width: 64,
    height: 64,
    borderRadius: radii.tile,
    backgroundColor: colors.board,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...type.display, color: colors.chalk },
  subtitle: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: colors.chalkMuted },
  field: { gap: 10 },
  label: { ...type.labelStrong, color: colors.chalk },
  input: {
    height: 52,
    paddingHorizontal: 16,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.board,
    color: colors.chalk,
    fontFamily: fonts.mono,
    fontSize: 14,
  },
  inputFocused: { borderColor: colors.dust },
  inputError: { borderColor: colors.dangerBorder },
  help: { fontFamily: fonts.body, fontSize: 13, lineHeight: 20, color: colors.dust },
  link: { color: colors.accent, fontFamily: fonts.bodyMedium },
  error: { fontFamily: fonts.body, fontSize: 13, lineHeight: 20, color: colors.danger },
  spacer: { flexGrow: 1 },
  cta: {
    height: 54,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPressed: { opacity: 0.85 },
  ctaText: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.slate },
});

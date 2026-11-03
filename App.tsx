import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, LogBox, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { MainScreen } from './src/screens/MainScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { clearApiKey, getApiKey } from './src/storage/keyStore';
import { colors } from './src/theme';
import { useAppFonts } from './src/theme/useAppFonts';

LogBox.ignoreAllLogs();
// ignoreAllLogs() doesn't suppress the fullscreen "Render Error" overlay
// because addException() bypasses the disabled flag. A catch-all ignore
// pattern IS consulted, so this hides the overlay and lets our
// ErrorBoundary's card be the visible crash UI.
LogBox.ignoreLogs([/./]);

type ErrorUtilsType = {
  setGlobalHandler: (fn: (err: Error, isFatal?: boolean) => void) => void;
};
const errorUtils = (globalThis as unknown as { ErrorUtils?: ErrorUtilsType }).ErrorUtils;
errorUtils?.setGlobalHandler((err) => {
  console.warn('[blank-slate] suppressed global error:', err?.message);
});

(console as unknown as { reportErrorsAsExceptions?: boolean }).reportErrorsAsExceptions = false;

type Gate = { stage: 'loading' } | { stage: 'onboarding' } | { stage: 'ready'; apiKey: string };

export default function App() {
  const [gate, setGate] = React.useState<Gate>({ stage: 'loading' });
  const fontsReady = useAppFonts();

  React.useEffect(() => {
    let alive = true;
    getApiKey()
      .then((key) => {
        if (!alive) return;
        setGate(key ? { stage: 'ready', apiKey: key } : { stage: 'onboarding' });
      })
      .catch(() => alive && setGate({ stage: 'onboarding' }));
    return () => {
      alive = false;
    };
  }, []);

  const handleOnboardingDone = async () => {
    const key = await getApiKey();
    if (key) setGate({ stage: 'ready', apiKey: key });
  };

  const handleResetKey = async () => {
    await clearApiKey();
    setGate({ stage: 'onboarding' });
  };

  return (
    // Outer SafeAreaProvider with initialMetrics means any nested
    // SafeAreaProvider inside Claude-generated code reads insets from
    // context synchronously on mount and never gets stuck waiting for a
    // native inset event — which was the cause of blank screens after
    // recovering from an error state.
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <View style={styles.root}>
        {gate.stage === 'loading' || !fontsReady ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.dust} />
          </View>
        ) : gate.stage === 'onboarding' ? (
          <OnboardingScreen onDone={handleOnboardingDone} />
        ) : (
          <MainScreen apiKey={gate.apiKey} onResetKey={handleResetKey} />
        )}
        <StatusBar style="light" />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.slate },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, LogBox, StyleSheet, View } from 'react-native';
import { MainScreen } from './src/screens/MainScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { clearApiKey, getApiKey } from './src/storage/keyStore';

LogBox.ignoreAllLogs();

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
    <View style={styles.root}>
      {gate.stage === 'loading' ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : gate.stage === 'onboarding' ? (
        <OnboardingScreen onDone={handleOnboardingDone} />
      ) : (
        <MainScreen apiKey={gate.apiKey} onResetKey={handleResetKey} />
      )}
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0f' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

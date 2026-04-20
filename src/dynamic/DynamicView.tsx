import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { subscribe as subscribeVfs } from '../vfs/vfs';
import { compileEntry, invalidate, type CompileError, type CompileResult } from './resolver';

type Props = {
  entry?: string;
  revision?: number;
};

type BoundaryState = { error: Error | null };

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; resetKey: string | number },
  BoundaryState
> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidUpdate(prev: Readonly<{ resetKey: string | number }>) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorCard
          title="The rendered component crashed"
          stage="runtime"
          path="App.tsx"
          message={this.state.error.message}
          stack={this.state.error.stack}
        />
      );
    }
    return this.props.children;
  }
}

function ErrorCard({
  title,
  stage,
  path,
  message,
  stack,
}: {
  title: string;
  stage: string;
  path: string;
  message: string;
  stack?: string;
}) {
  return (
    <ScrollView contentContainerStyle={styles.errorContainer}>
      <View style={styles.errorCard}>
        <Text style={styles.errorTitle}>{title}</Text>
        <Text style={styles.errorMeta}>
          {stage} · {path}
        </Text>
        <Text style={styles.errorMessage}>{message}</Text>
        {stack ? <Text style={styles.errorStack}>{stack}</Text> : null}
      </View>
    </ScrollView>
  );
}

export function DynamicView({ entry = 'App.tsx', revision = 0 }: Props) {
  const [result, setResult] = React.useState<CompileResult | null>(null);
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    const unsub = subscribeVfs((change) => {
      invalidate(change.path);
      setVersion((v) => v + 1);
    });
    return unsub;
  }, []);

  React.useEffect(() => {
    let alive = true;
    setResult(null);
    compileEntry(entry).then((r) => {
      if (alive) setResult(r);
    });
    return () => {
      alive = false;
    };
  }, [entry, version, revision]);

  if (!result) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#666" />
      </View>
    );
  }

  if (!result.ok) {
    return <ErrorCardFromError error={result.error} />;
  }

  const { Component } = result;
  return (
    <ErrorBoundary resetKey={`${entry}:${version}:${revision}`}>
      <View style={styles.renderWrap}>
        <Component />
      </View>
    </ErrorBoundary>
  );
}

function ErrorCardFromError({ error }: { error: CompileError }) {
  return (
    <ErrorCard
      title={`Build failed (${error.stage})`}
      stage={error.stage}
      path={error.path}
      message={error.message}
      stack={error.stack}
    />
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fafafa' },
  renderWrap: { flex: 1 },
  errorContainer: { padding: 16, flexGrow: 1, backgroundColor: '#fff5f5' },
  errorCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderColor: '#d93025',
    borderWidth: 1,
    padding: 16,
  },
  errorTitle: { color: '#d93025', fontWeight: '700', fontSize: 15, marginBottom: 4 },
  errorMeta: { color: '#991b1b', fontSize: 11, marginBottom: 10, fontFamily: 'Courier' },
  errorMessage: { color: '#333', fontSize: 13, marginBottom: 8 },
  errorStack: { fontFamily: 'Courier', fontSize: 11, color: '#666' },
});

import React from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { evaluate, type EvalResult } from './evaluator';

type Props = {
  source: string | null;
  onRollback?: () => void;
  placeholder?: React.ReactNode;
};

type BoundaryState = { error: Error | null };

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; onRollback?: () => void; resetKey: string },
  BoundaryState
> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidUpdate(prev: Readonly<{ resetKey: string }>) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorCard
          title="The generated component crashed while rendering"
          error={this.state.error}
          onRollback={this.props.onRollback}
        />
      );
    }
    return this.props.children;
  }
}

function ErrorCard({
  title,
  error,
  onRollback,
}: {
  title: string;
  error: Error;
  onRollback?: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.errorContainer}>
      <View style={styles.errorCard}>
        <Text style={styles.errorTitle}>{title}</Text>
        <Text style={styles.errorMessage}>{error.message}</Text>
        {error.stack ? <Text style={styles.errorStack}>{error.stack}</Text> : null}
        {onRollback ? (
          <Pressable style={styles.rollbackBtn} onPress={onRollback}>
            <Text style={styles.rollbackText}>Roll back to previous version</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

export function DynamicView({ source, onRollback, placeholder }: Props) {
  const result: EvalResult | null = React.useMemo(() => {
    if (!source) return null;
    return evaluate(source);
  }, [source]);

  if (!source) {
    return <View style={styles.placeholderWrap}>{placeholder ?? <DefaultPlaceholder />}</View>;
  }

  if (!result || !result.ok) {
    const error = result ? result.error : new Error('No result');
    const stage = result && !result.ok ? result.stage : 'unknown';
    return (
      <ErrorCard
        title={`Build failed (${stage})`}
        error={error}
        onRollback={onRollback}
      />
    );
  }

  const { Component } = result;
  return (
    <ErrorBoundary resetKey={source} onRollback={onRollback}>
      <View style={styles.renderWrap}>
        <Component />
      </View>
    </ErrorBoundary>
  );
}

function DefaultPlaceholder() {
  return (
    <View style={styles.placeholderInner}>
      <Text style={styles.placeholderTitle}>Blank Slate</Text>
      <Text style={styles.placeholderBody}>
        Chat with Claude above and it will write the app that appears here.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholderWrap: { flex: 1, backgroundColor: '#fafafa' },
  placeholderInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  placeholderTitle: { fontSize: 20, fontWeight: '600', marginBottom: 8, color: '#111' },
  placeholderBody: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20 },
  renderWrap: { flex: 1 },
  errorContainer: { padding: 16, flexGrow: 1, backgroundColor: '#fff5f5' },
  errorCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderColor: '#d93025',
    borderWidth: 1,
    padding: 16,
  },
  errorTitle: { color: '#d93025', fontWeight: '700', fontSize: 15, marginBottom: 8 },
  errorMessage: { color: '#333', fontSize: 13, marginBottom: 8 },
  errorStack: {
    fontFamily: 'Courier',
    fontSize: 11,
    color: '#666',
    marginBottom: 12,
  },
  rollbackBtn: {
    backgroundColor: '#d93025',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  rollbackText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});

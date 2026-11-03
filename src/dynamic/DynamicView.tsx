import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { subscribe as subscribeVfs } from '../vfs/vfs';
import { compileEntry, invalidate, type CompileError, type CompileResult } from './resolver';

export type RenderError = {
  stage: 'missing' | 'transpile' | 'resolve' | 'execute' | 'runtime';
  path: string;
  message: string;
  stack?: string;
};

type Props = {
  entry?: string;
  revision?: number;
  onError?: (err: RenderError) => void;
  onClear?: () => void;
  onFix?: () => void;
};

type BoundaryProps = {
  children: React.ReactNode;
  resetKey: string | number;
  onError?: (err: Error) => void;
  onClear?: () => void;
  onFix?: () => void;
};
type BoundaryState = { error: Error | null; lastResetKey: string | number };

class ErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, lastResetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    nextProps: BoundaryProps,
    prevState: BoundaryState,
  ): Partial<BoundaryState> | null {
    if (prevState.lastResetKey !== nextProps.resetKey) {
      return { error: null, lastResetKey: nextProps.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  componentDidUpdate(_prevProps: BoundaryProps, prevState: BoundaryState) {
    if (prevState.error && !this.state.error) {
      this.props.onClear?.();
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
          onFix={this.props.onFix}
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
  onFix,
}: {
  title: string;
  stage: string;
  path: string;
  message: string;
  stack?: string;
  onFix?: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.errorContainer}>
      <View style={styles.errorCard}>
        <Text style={styles.errorTitle}>{title}</Text>
        <Text style={styles.errorMeta}>
          {stage} · {path}
        </Text>
        <Text style={styles.errorMessage}>{message}</Text>
        {onFix ? (
          <Pressable style={styles.fixBtn} onPress={onFix}>
            <Text style={styles.fixBtnText}>Ask the agent to fix this</Text>
          </Pressable>
        ) : null}
        {stack ? <Text style={styles.errorStack}>{stack}</Text> : null}
      </View>
    </ScrollView>
  );
}

export function DynamicView({
  entry = 'App.tsx',
  revision = 0,
  onError,
  onClear,
  onFix,
}: Props) {
  const [result, setResult] = React.useState<CompileResult | null>(null);
  const [version, setVersion] = React.useState(0);

  const onErrorRef = React.useRef(onError);
  const onClearRef = React.useRef(onClear);
  React.useEffect(() => {
    onErrorRef.current = onError;
    onClearRef.current = onClear;
  }, [onError, onClear]);

  React.useEffect(() => {
    const unsub = subscribeVfs((change) => {
      invalidate(change.path);
      // Clear result in the same tick so the stale Component doesn't
      // re-render (and potentially re-throw) against the new resetKey
      // before the fresh compile lands.
      setResult(null);
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

  // Only fire onClear from the useEffect when transitioning from
  // compile-error → compile-success. Firing onClear on every successful
  // compile races with boundary.onError (since render can still throw
  // after compile succeeds) and would stomp the banner. Runtime-error
  // recovery is signalled by the boundary's componentDidUpdate instead.
  const prevCompileErroredRef = React.useRef(false);
  React.useEffect(() => {
    if (!result) return;
    if (!result.ok) {
      onErrorRef.current?.(toRenderError(result.error));
      prevCompileErroredRef.current = true;
    } else {
      if (prevCompileErroredRef.current) {
        onClearRef.current?.();
      }
      prevCompileErroredRef.current = false;
    }
  }, [result]);

  return (
    <ErrorBoundary
      resetKey={`${entry}:${version}:${revision}`}
      onError={(e) =>
        onErrorRef.current?.({
          stage: 'runtime',
          path: entry,
          message: e.message,
          stack: e.stack,
        })
      }
      onClear={() => onClearRef.current?.()}
      onFix={onFix}
    >
      {!result ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#666" />
        </View>
      ) : !result.ok ? (
        <ErrorCardFromError error={result.error} onFix={onFix} />
      ) : (
        <View style={styles.renderWrap}>
          <result.Component />
        </View>
      )}
    </ErrorBoundary>
  );
}

function toRenderError(err: CompileError): RenderError {
  return { stage: err.stage, path: err.path, message: err.message, stack: err.stack };
}

function ErrorCardFromError({
  error,
  onFix,
}: {
  error: CompileError;
  onFix?: () => void;
}) {
  return (
    <ErrorCard
      title={`Build failed (${error.stage})`}
      stage={error.stage}
      path={error.path}
      message={error.message}
      stack={error.stack}
      onFix={onFix}
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
  fixBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    marginBottom: 12,
    backgroundColor: '#d93025',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  fixBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AppProbe } from '../debug/AppProbe';
import * as history from '../debug/history';
import { cleanStack } from '../debug/instrument';
import { scheduleAutoCapture } from '../debug/screenshot';
import { subscribe as subscribeVfs } from '../vfs/vfs';
import { compileEntry, invalidate, type CompileError, type CompileResult } from './resolver';

export type RenderError = {
  // 'handler': thrown from an event handler or timer (reported by MainScreen).
  stage: 'missing' | 'transpile' | 'resolve' | 'execute' | 'runtime' | 'handler';
  path: string;
  message: string;
  stack?: string;
  // The matching debug-history event, when it was recorded.
  eventId?: number;
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
  onError?: (err: Error, componentStack?: string) => void;
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

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError?.(error, info.componentStack ?? undefined);
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

  const lastChangeRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const unsub = subscribeVfs((change) => {
      lastChangeRef.current = change.path;
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
      const err = toRenderError(result.error);
      const ev = history.record({
        type: 'error',
        source: 'compile',
        text: `Build failed (${err.stage}) in ${err.path}: ${err.message}`,
        detail: cleanStack(err.stack),
      });
      scheduleAutoCapture('build error');
      onErrorRef.current?.({ ...err, eventId: ev?.id });
      prevCompileErroredRef.current = true;
    } else {
      if (prevCompileErroredRef.current) {
        onClearRef.current?.();
      }
      prevCompileErroredRef.current = false;
    }
  }, [result]);

  // A new debug-history session per freshly compiled app, started during
  // render so the app's own render-time logs land in it. Keyed on the result
  // because React renders again after a render error.
  const sessionForRef = React.useRef<CompileResult | null>(null);
  if (result?.ok && sessionForRef.current !== result) {
    sessionForRef.current = result;
    history.startSession(
      lastChangeRef.current ? `App remounted after edit to ${lastChangeRef.current}` : 'App mounted',
    );
  }

  return (
    <AppProbe>
      <ErrorBoundary
        resetKey={`${entry}:${version}:${revision}`}
        onError={(e, componentStack) => {
          const ev = history.record({
            type: 'error',
            source: 'render',
            text: `${e.name}: ${e.message} (while rendering)`,
            detail: [
              cleanStack(e.stack),
              componentStack && `Component stack:${trimComponentStack(componentStack)}`,
            ]
              .filter(Boolean)
              .join('\n'),
          });
          scheduleAutoCapture('render error');
          onErrorRef.current?.({
            stage: 'runtime',
            path: entry,
            message: e.message,
            stack: e.stack,
            eventId: ev?.id,
          });
        }}
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
    </AppProbe>
  );
}


function trimComponentStack(stack: string): string {
  return stack
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((l) => `\n  ${l}`)
    .join('');
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

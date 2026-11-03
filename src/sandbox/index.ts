import { BUILTIN_MODULES } from '../dynamic/requireShim';
import { createScopedAsyncStorage } from './asyncStorage';
import { STORAGE_NATIVE_MODULE, hideMatching, sandboxScope, type Scope } from './globals';
import { createScopedSQLite } from './sqlite';

// Per-app sandboxing for generated code. See src/storage/namespaces.ts for
// the key layout and globals.ts for what this does and doesn't protect
// against.

type Sandbox = { modules: Record<string, unknown>; scope: Scope };

const sandboxes = new Map<string, Sandbox>();

// react-native as generated code sees it, minus raw access to the native
// storage modules (RNCAsyncStorage etc. would bypass the scoped wrappers).
function sandboxedReactNative(rn: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(rn)) {
    if (key === 'NativeModules' || key === 'TurboModuleRegistry') continue;
    Object.defineProperty(out, key, { enumerable: true, get: () => rn[key] });
  }
  Object.defineProperty(out, 'NativeModules', {
    enumerable: true,
    value: hideMatching(rn.NativeModules as object, STORAGE_NATIVE_MODULE),
  });
  const tmr = rn.TurboModuleRegistry as { get: (n: string) => unknown; getEnforcing: (n: string) => unknown };
  Object.defineProperty(out, 'TurboModuleRegistry', {
    enumerable: true,
    value: Object.freeze({
      get: (n: string) => (STORAGE_NATIVE_MODULE.test(n) ? null : tmr.get(n)),
      getEnforcing: (n: string) => {
        if (STORAGE_NATIVE_MODULE.test(n)) throw new Error(`TurboModule ${n} is not available.`);
        return tmr.getEnforcing(n);
      },
    }),
  });
  return Object.freeze(out);
}

let selfTested = false;

function sandboxFor(projectId: string): Sandbox {
  let sb = sandboxes.get(projectId);
  if (sb) return sb;
  if (__DEV__ && !selfTested) {
    selfTested = true;
    import('./selfTest')
      .then((m) => m.runSandboxSelfTest())
      .then(({ passed, failures }) =>
        failures.length
          ? console.warn(`[sandbox] self-test: ${failures.length} failed, ${passed} passed\n${failures.join('\n')}`)
          : console.log(`[sandbox] self-test passed (${passed} checks)`),
      )
      .catch((e) => console.warn('[sandbox] self-test crashed', e));
  }
  sb = {
    modules: Object.freeze({
      '@react-native-async-storage/async-storage': createScopedAsyncStorage(projectId),
      'expo-sqlite': createScopedSQLite(projectId),
      'react-native': sandboxedReactNative(BUILTIN_MODULES['react-native'] as Record<string, any>),
    }),
    scope: sandboxScope(projectId),
  };
  sandboxes.set(projectId, sb);
  return sb;
}

/** What `require(spec)` returns inside the given project's code. */
export function sandboxedBuiltin(projectId: string, spec: string): unknown {
  const modules = sandboxFor(projectId).modules;
  return Object.prototype.hasOwnProperty.call(modules, spec) ? modules[spec] : BUILTIN_MODULES[spec];
}

/** Extra module-scope bindings (shadowed globals) for the project's code. */
export function sandboxedScope(projectId: string): Scope {
  return sandboxFor(projectId).scope;
}

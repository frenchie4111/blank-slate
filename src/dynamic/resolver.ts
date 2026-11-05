import type { ComponentType } from 'react';
import { loadFontsUsedIn } from '../appkit/fonts';
import * as history from '../debug/history';
import { resetStyleLint } from '../debug/lint';
import { moduleScope } from '../debug/instrument';
import { getCurrentProjectIdSync } from '../project/store';
import { sandboxedBuiltin, sandboxedScope } from '../sandbox';
import { isImagePath, readFile } from '../vfs/vfs';
import { ALLOWLIST, isBuiltin } from './requireShim';
import { transpile } from './transpile';

type Exports = Record<string, unknown>;

type CacheEntry = {
  hash: string;
  exports: Exports;
};

type CompileStage = 'missing' | 'transpile' | 'resolve' | 'execute';

export type CompileError = {
  stage: CompileStage;
  path: string;
  message: string;
  stack?: string;
};

export type CompileResult =
  | { ok: true; Component: ComponentType<unknown> }
  | { ok: false; error: CompileError };

const moduleCache = new Map<string, CacheEntry>();

export function clearCompileCache(): void {
  moduleCache.clear();
}

// Importers hold references to their dependencies' exports, so evicting only
// the changed file would leave e.g. App.tsx (unchanged hash) serving a stale
// component. Drop everything; recompiling a small VFS is cheap.
export function invalidate(_path: string): void {
  moduleCache.clear();
}

function hashContent(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h.toString(36) + ':' + s.length;
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : '';
}

function normalizeJoined(parts: string[]): string {
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function joinRelative(fromPath: string, spec: string): string {
  const baseDir = dirname(fromPath);
  const combined = baseDir ? baseDir + '/' + spec : spec;
  return normalizeJoined(combined.split('/'));
}

const CANDIDATE_EXTS = ['', '.tsx', '.ts', '.jsx', '.js'];
const INDEX_CANDIDATES = ['/index.tsx', '/index.ts', '/index.jsx', '/index.js'];
// Imported as a string rather than compiled.
const DATA_EXTS = new Set(['.txt', '.md', '.csv', '.svg', '.html', '.css', '.xml', '.yml', '.yaml']);

function extOf(path: string): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot > slash ? path.slice(dot).toLowerCase() : '';
}

async function resolveRelative(fromPath: string, spec: string): Promise<string | null> {
  const joined = joinRelative(fromPath, spec);
  for (const ext of CANDIDATE_EXTS) {
    const c = joined + ext;
    if ((await readFile(c)) !== null) return c;
  }
  for (const idx of INDEX_CANDIDATES) {
    const c = joined + idx;
    if ((await readFile(c)) !== null) return c;
  }
  return null;
}

function findRequireSpecs(js: string): string[] {
  const re = /\brequire\(\s*(['"])([^'"\n]+)\1\s*\)/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(js)) !== null) seen.add(m[2]);
  return [...seen];
}

class CompilationError extends Error {
  readonly compileError: CompileError;
  constructor(err: CompileError) {
    super(err.message);
    this.compileError = err;
  }
}

function fail(stage: CompileStage, path: string, cause: unknown): never {
  const message =
    cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : String(cause);
  const stack = cause instanceof Error ? cause.stack : undefined;
  throw new CompilationError({ stage, path, message, stack });
}

// Compiled exports close over the project's sandboxed modules, so the cache
// is per project: identical files in two apps must not share exports.
async function compileFile(
  path: string,
  inFlight: Map<string, Exports>,
  projectId: string,
  sources: string[],
): Promise<Exports> {
  const cacheKey = `${projectId}\0${path}`;
  const content = await readFile(path);
  if (content === null) fail('missing', path, `File not found: ${path}`);

  // Images resolve to an RN image source, so `import logo from './logo.png'`
  // can be passed straight to <Image source={logo} />.
  if (isImagePath(path)) {
    if (!content.startsWith('data:image/')) {
      fail('execute', path, `${path} is not an image (expected a data:image/ URL).`);
    }
    return { uri: content };
  }

  // Data files (often ones the user uploaded) import as their contents:
  // `import rows from './uploads/data.csv'` is the text, a .json is parsed.
  const ext = extOf(path);
  if (ext === '.json') {
    try {
      return JSON.parse(content) as Exports;
    } catch (e) {
      fail('execute', path, `${path} is not valid JSON: ${(e as Error).message}`);
    }
  }
  if (DATA_EXTS.has(ext)) return content as unknown as Exports;

  sources.push(content);
  const hash = hashContent(content);
  const cached = moduleCache.get(cacheKey);
  if (cached && cached.hash === hash) return cached.exports;

  const inProgress = inFlight.get(path);
  if (inProgress) return inProgress;

  let js: string;
  try {
    js = transpile(content, path);
  } catch (e) {
    fail('transpile', path, e);
  }

  const moduleExports: Exports = {};
  inFlight.set(path, moduleExports);

  const specs = findRequireSpecs(js);
  const resolvedDeps = new Map<string, Exports | unknown>();

  for (const spec of specs) {
    if (isBuiltin(spec)) {
      resolvedDeps.set(spec, sandboxedBuiltin(projectId, spec));
      continue;
    }
    if (spec.startsWith('.') || spec.startsWith('/')) {
      const resolved = await resolveRelative(path, spec);
      if (!resolved) {
        fail(
          'resolve',
          path,
          `Cannot resolve "${spec}" from ${path}. ` +
            `Tried ${CANDIDATE_EXTS.map((e) => `<path>${e}`).join(', ')} and index variants.`,
        );
      }
      const depExports = await compileFile(resolved, inFlight, projectId, sources);
      resolvedDeps.set(spec, depExports);
      continue;
    }
    fail(
      'resolve',
      path,
      `Module "${spec}" is not in the allowlist. Allowed: ${ALLOWLIST.join(', ')}. ` +
        `For cross-file imports use relative paths (e.g. "./components/Button").`,
    );
  }

  const requireFn = (spec: string): unknown => {
    if (resolvedDeps.has(spec)) return resolvedDeps.get(spec);
    if (isBuiltin(spec)) return sandboxedBuiltin(projectId, spec);
    throw new Error(`Runtime require for unresolved "${spec}" in ${path}`);
  };

  const moduleObj = { exports: moduleExports };
  try {
    // console, fetch, timers etc. are scoped bindings that feed the debug
    // history; the sandbox scope shadows storage globals (localStorage,
    // window, document…) per project. sourceURL makes stack frames read
    // `vfs:///App.tsx:12:5`.
    const scope = moduleScope();
    const sandbox = sandboxedScope(projectId);
    const fn = new Function(
      'require',
      'module',
      'exports',
      ...scope.names,
      ...sandbox.names,
      `${js}\n//# sourceURL=vfs:///${path}`,
    );
    fn(requireFn, moduleObj, moduleObj.exports, ...scope.values, ...sandbox.values);
  } catch (e) {
    inFlight.delete(path);
    fail('execute', path, e);
  }

  const finalExports = moduleObj.exports as Exports;
  moduleCache.set(cacheKey, { hash, exports: finalExports });
  inFlight.delete(path);
  return finalExports;
}

export async function compileEntry(entry = 'App.tsx'): Promise<CompileResult> {
  try {
    // An empty cache means every module is about to be re-evaluated (see
    // invalidate), so style records start over with them.
    if (moduleCache.size === 0) resetStyleLint();
    const sources: string[] = [];
    const exports = await compileFile(entry, new Map(), getCurrentProjectIdSync(), sources);
    // Catalogue fonts the app names, loaded before it mounts so the first
    // frame isn't in the system font. A failed load just falls back.
    const failed = await loadFontsUsedIn(sources);
    if (failed.length) {
      history.record({ type: 'log', level: 'warn', text: `Fonts falling back to the system font: ${failed.join('; ')}` });
    }
    const candidate = (exports.default ?? exports) as unknown;
    if (typeof candidate !== 'function' && typeof candidate !== 'object') {
      return {
        ok: false,
        error: {
          stage: 'resolve',
          path: entry,
          message: `${entry} does not export a default component.`,
        },
      };
    }
    return { ok: true, Component: candidate as ComponentType<unknown> };
  } catch (e) {
    if (e instanceof CompilationError) return { ok: false, error: e.compileError };
    return {
      ok: false,
      error: {
        stage: 'execute',
        path: entry,
        message: (e as Error).message,
        stack: (e as Error).stack,
      },
    };
  }
}

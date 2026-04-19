import * as Babel from '@babel/standalone';
import type { ComponentType } from 'react';
import { requireShim } from './requireShim';

export type EvalResult =
  | { ok: true; Component: ComponentType<unknown> }
  | { ok: false; stage: 'extract' | 'transpile' | 'execute' | 'resolve'; error: Error };

const FENCE_RE = /```(?:tsx|jsx|ts|js|typescript|javascript)?\s*\n([\s\S]*?)```/i;

export function extractCode(message: string): string | null {
  const match = message.match(FENCE_RE);
  if (match) return match[1].trim();
  const trimmed = message.trim();
  if (trimmed.includes('export default')) return trimmed;
  return null;
}

export function transpile(tsx: string): string {
  const result = Babel.transform(tsx, {
    presets: [
      ['typescript', { allExtensions: true, isTSX: true, onlyRemoveTypeImports: false }],
      ['react', { runtime: 'classic' }],
    ],
    plugins: [
      ['transform-modules-commonjs', { strictMode: false }],
    ],
    filename: 'Dynamic.tsx',
  });
  if (!result || !result.code) {
    throw new Error('Babel produced no output');
  }
  return result.code;
}

export function evaluate(tsx: string): EvalResult {
  let js: string;
  try {
    js = transpile(tsx);
  } catch (e) {
    return { ok: false, stage: 'transpile', error: e as Error };
  }

  const module: { exports: Record<string, unknown> } = { exports: {} };
  try {
    const fn = new Function('require', 'module', 'exports', js);
    fn(requireShim, module, module.exports);
  } catch (e) {
    return { ok: false, stage: 'execute', error: e as Error };
  }

  const exported = module.exports as Record<string, unknown>;
  const Component = (exported.default ?? exported) as ComponentType<unknown>;
  if (typeof Component !== 'function' && typeof Component !== 'object') {
    return {
      ok: false,
      stage: 'resolve',
      error: new Error('No default export found — did you forget `export default`?'),
    };
  }
  return { ok: true, Component };
}

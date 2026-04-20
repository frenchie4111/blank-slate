import * as Babel from '@babel/standalone';

export function transpile(source: string, filename: string): string {
  const result = Babel.transform(source, {
    presets: [
      ['typescript', { allExtensions: true, isTSX: true, onlyRemoveTypeImports: false }],
      ['react', { runtime: 'classic' }],
    ],
    plugins: [['transform-modules-commonjs', { strictMode: false }]],
    filename,
  });
  if (!result || !result.code) throw new Error('Babel produced no output');
  return result.code;
}

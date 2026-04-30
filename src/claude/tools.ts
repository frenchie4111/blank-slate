import type Anthropic from '@anthropic-ai/sdk';
import { deleteFile, listFiles, readFile, writeFile } from '../vfs/vfs';

export const SERVER_TOOL_DEFINITIONS: Anthropic.ToolUnion[] = [
  {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 5,
  },
  {
    type: 'web_fetch_20250910',
    name: 'web_fetch',
    max_uses: 5,
  },
];

export const CUSTOM_TOOL_NAMES = new Set([
  'read_file',
  'write_file',
  'edit_file',
  'list_files',
  'delete_file',
]);

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description:
      'Read the full contents of a file in the app\'s virtual filesystem. Returns the file text, or a "not found" notice if the path does not exist.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'POSIX path, e.g. "App.tsx" or "components/Button.tsx"' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Create a new file or overwrite an existing file with the given content. Prefer edit_file for small changes to existing files.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Replace an exact substring in a file. Fails if old_string is not found, or is found more than once and replace_all is not true. Preferred for small edits.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string', description: 'Exact text to find in the file' },
        new_string: { type: 'string', description: 'Text to replace it with' },
        replace_all: {
          type: 'boolean',
          description: 'Replace every occurrence instead of requiring a unique match',
        },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'list_files',
    description: 'List every path currently in the virtual filesystem.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'delete_file',
    description: 'Remove a file from the virtual filesystem.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
];

export type ToolResult = { ok: boolean; text: string };

export async function executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case 'read_file': {
        const path = requireString(input, 'path');
        const content = await readFile(path);
        if (content === null) return { ok: false, text: `File not found: ${path}` };
        return { ok: true, text: content };
      }
      case 'write_file': {
        const path = requireString(input, 'path');
        const content = requireString(input, 'content');
        await writeFile(path, content);
        return { ok: true, text: `Wrote ${path} (${content.length} chars)` };
      }
      case 'edit_file': {
        const path = requireString(input, 'path');
        const oldStr = requireString(input, 'old_string');
        const newStr = requireString(input, 'new_string');
        const replaceAll = input.replace_all === true;
        if (oldStr === newStr) return { ok: false, text: 'old_string and new_string are identical' };
        const existing = await readFile(path);
        if (existing === null) return { ok: false, text: `File not found: ${path}` };
        const occurrences = countOccurrences(existing, oldStr);
        if (occurrences === 0) {
          return { ok: false, text: `old_string not found in ${path}` };
        }
        if (occurrences > 1 && !replaceAll) {
          return {
            ok: false,
            text: `old_string appears ${occurrences} times in ${path}. Add context to make it unique, or pass replace_all: true.`,
          };
        }
        const next = replaceAll
          ? existing.split(oldStr).join(newStr)
          : existing.replace(oldStr, newStr);
        await writeFile(path, next);
        return {
          ok: true,
          text: `Edited ${path} (${occurrences} ${occurrences === 1 ? 'match' : 'matches'} replaced; file is now ${next.length} chars)`,
        };
      }
      case 'list_files': {
        const files = await listFiles();
        if (files.length === 0) return { ok: true, text: '(empty filesystem)' };
        return { ok: true, text: files.join('\n') };
      }
      case 'delete_file': {
        const path = requireString(input, 'path');
        await deleteFile(path);
        return { ok: true, text: `Deleted ${path}` };
      }
      default:
        return { ok: false, text: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, text: `Tool error: ${(e as Error).message}` };
  }
}

function requireString(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== 'string') throw new Error(`Expected string "${key}" in tool input`);
  return v;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let i = 0;
  while (true) {
    const idx = haystack.indexOf(needle, i);
    if (idx === -1) return count;
    count++;
    i = idx + needle.length;
  }
}

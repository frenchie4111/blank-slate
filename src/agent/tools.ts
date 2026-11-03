import { getCurrentProjectIdSync, setIcon } from '../project/store';
import { deleteFile, isImagePath, listFiles, normalizePath, readFile, writeFile } from '../vfs/vfs';
import { DEBUG_FUNCTION_TOOLS, DEBUG_TOOL_NAMES, executeDebugTool } from './debugTools';
import { IMAGE_MODEL } from './models';
import { generateImage } from './openrouter';

// Hosted by OpenRouter: the model calls these and OpenRouter runs them inside
// the same request, so they never come back to us as tool_calls. What we see is
// the url_citation annotations on the streamed response.
export const SERVER_TOOL_DEFINITIONS = [
  { type: 'openrouter:web_search', parameters: { max_results: 5, max_uses: 5 } },
  { type: 'openrouter:web_fetch', parameters: { max_uses: 5, max_content_tokens: 20000 } },
];

type FunctionTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

const FUNCTION_TOOLS: FunctionTool[] = [
  {
    name: 'read_file',
    description:
      'Read the full contents of a file in the app\'s virtual filesystem. Returns the file text, or a "not found" notice if the path does not exist.',
    parameters: {
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
    parameters: {
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
    parameters: {
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
    name: 'generate_image',
    description:
      'Generate an image (icon, illustration, background, photo) from a text prompt and save it to the project at `path`. The file can then be imported from code: `import hero from "./assets/hero.png"` and rendered with `<Image source={hero} />`. Costs the user about $0.04 per image, so only generate images the app actually needs.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed description of the image: subject, style, colors, composition.',
        },
        path: {
          type: 'string',
          description: 'Where to save it, ending in .png, .jpg or .webp, e.g. "assets/hero.png".',
        },
        aspect_ratio: {
          type: 'string',
          enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
          description: 'Defaults to 1:1.',
        },
      },
      required: ['prompt', 'path'],
    },
  },
  {
    name: 'set_app_icon',
    description:
      'Use an image already in the project (usually one you just made with generate_image) as this app\'s icon in Blank Slate\'s project list and header. Regenerating the same path later updates the icon automatically, so you only need to call this once per path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path of an existing image file, e.g. "assets/icon.png".' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description: 'List every path currently in the virtual filesystem.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'delete_file',
    description: 'Remove a file from the virtual filesystem.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
];

export const TOOL_DEFINITIONS = [...FUNCTION_TOOLS, ...DEBUG_FUNCTION_TOOLS].map((t) => ({
  type: 'function' as const,
  function: t,
}));

export type ToolResult = {
  ok: boolean;
  text: string;
  // A screenshot for the model to look at. Tool results are text-only, so the
  // agent loop sends it as a user message right after the tool results.
  image?: { dataUrl: string; caption: string };
};

export type ToolContext = { apiKey: string; model: string; signal?: AbortSignal };

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    if (DEBUG_TOOL_NAMES.has(name)) return await executeDebugTool(name, input, ctx);
    switch (name) {
      case 'read_file': {
        const path = requireString(input, 'path');
        const content = await readFile(path);
        if (content === null) return { ok: false, text: `File not found: ${path}` };
        // Never dump a base64 image into the context window.
        if (isImagePath(path)) {
          return { ok: true, text: `(image file, ${Math.round(content.length / 1024)} KB; import it from code to display it)` };
        }
        return { ok: true, text: content };
      }
      case 'generate_image': {
        const prompt = requireString(input, 'prompt');
        const path = requireString(input, 'path');
        if (!isImagePath(path)) {
          return { ok: false, text: 'path must end in .png, .jpg, .jpeg, .webp or .gif' };
        }
        const aspect = typeof input.aspect_ratio === 'string' ? input.aspect_ratio : undefined;
        const { dataUrl, cost } = await generateImage(ctx.apiKey, IMAGE_MODEL, prompt, aspect, ctx.signal);
        await writeFile(path, dataUrl);
        const costNote = cost !== null ? `, cost $${cost.toFixed(3)}` : '';
        return {
          ok: true,
          text: `Saved image to ${path} (${Math.round(dataUrl.length / 1024)} KB${costNote}). Import it with a relative path and pass it to <Image source={...} />.`,
        };
      }
      case 'set_app_icon': {
        const path = normalizePath(requireString(input, 'path'));
        if (!isImagePath(path)) {
          return { ok: false, text: `${path} is not an image path (.png, .jpg, .jpeg, .webp or .gif).` };
        }
        const content = await readFile(path);
        if (content === null) {
          return { ok: false, text: `File not found: ${path}. Create it with generate_image first.` };
        }
        if (!content.startsWith('data:image/')) {
          return { ok: false, text: `${path} does not contain image data. Regenerate it with generate_image.` };
        }
        await setIcon(getCurrentProjectIdSync(), path);
        return { ok: true, text: `App icon set to ${path}.` };
      }
      case 'write_file': {
        const path = requireString(input, 'path');
        const content = requireString(input, 'content');
        if (isImagePath(path) && !content.startsWith('data:image/')) {
          return { ok: false, text: 'Use generate_image to create image files.' };
        }
        await writeFile(path, content);
        return { ok: true, text: `Wrote ${path} (${content.length} chars)` };
      }
      case 'edit_file': {
        const path = requireString(input, 'path');
        const oldStr = requireString(input, 'old_string');
        const newStr = requireString(input, 'new_string');
        const replaceAll = input.replace_all === true;
        if (isImagePath(path)) return { ok: false, text: 'Cannot edit an image file; regenerate it instead.' };
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

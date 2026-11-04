import { appContextFor, systemPromptFor } from '../agent/systemPrompt';
import { executeTool, TOOL_DEFINITIONS, type ToolContext } from '../agent/tools';
import * as history from '../debug/history';
import { autoChecks, describeUi } from '../debug/instrument';
import { captureApp, waitForSettled } from '../debug/screenshot';
import { desktopMcpHost, type McpRequest } from '../platform/desktop';
import * as projectStore from '../project/store';
import { getAutoAppIcons, getModel } from '../storage/keyStore';
import * as vfs from '../vfs/vfs';

// The tools behind desktop/src/mcp.js: a coding agent outside Blank Slate
// (Claude Code, Codex…) building apps in it. They are the in-app agent's own
// tools (src/agent/tools.ts), plus app management, and work on whichever app
// the window has open, so the user watches it being built.

type Content =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

type CallResult = { content: Content[]; isError?: boolean };

type McpTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpHostOptions = {
  apiKey: string;
  // Opens an app in the window the way tapping it would (stops the in-app
  // agent's turn first). May not switch: an imported app waits on the user
  // accepting its trust notice.
  openApp(id: string): Promise<void>;
};

const APP_ID = {
  type: 'string',
  description:
    'The app you mean to change (from list_apps / open_app / create_app). Optional, but pass it: the call fails instead of touching another app if the user has switched apps in the window meanwhile.',
};

// Every in-app agent tool is exposed, so new ones show up here too. These are
// reimplemented below instead: an MCP client takes images directly, where the
// in-app agent gets them attached to a later message (or described, for a
// text-only model).
const OWN_IMPLEMENTATION = new Set(['take_screenshot', 'get_screenshot']);

const SHARED = new Set(
  TOOL_DEFINITIONS.map((t) => t.function.name).filter((n) => !OWN_IMPLEMENTATION.has(n)),
);

const SHARED_TOOLS: McpTool[] = TOOL_DEFINITIONS.filter((t) => SHARED.has(t.function.name)).map(
  ({ function: f }) => {
    const params = f.parameters as { properties?: Record<string, unknown>; required?: string[] };
    return {
      name: f.name,
      description: f.description,
      inputSchema: { ...params, type: 'object', properties: { ...params.properties, app_id: APP_ID } },
    };
  },
);

const OWN_TOOLS: McpTool[] = [
  {
    name: 'get_app_guide',
    title: 'Blank Slate app guide',
    description:
      "Read this before writing any code. Blank Slate apps aren't ordinary React Native projects: only an allowlisted set of modules can be imported, there's an in-house design kit, and there are rules for storage, images, icons and layout. Returns the full guide Blank Slate's own agent works from, plus the open app's vibe.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_apps',
    description: 'Every app in Blank Slate: id, name, vibe, and which one is open in the window.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_app',
    description:
      "Create a new app (App.tsx starts as Blank Slate's starter screen) and open it in the window. Returns its id.",
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short Title Case name, e.g. "Memory Journal". Can be set later with set_app_name.' },
        vibe: { type: 'string', description: 'How it should feel, in the user\'s words, e.g. "Cozy" or "iOS native".' },
      },
    },
  },
  {
    name: 'open_app',
    description:
      'Open an existing app in the window. File, screenshot and history tools work on the open app.',
    inputSchema: {
      type: 'object',
      properties: { app_id: { type: 'string' } },
      required: ['app_id'],
    },
  },
  {
    name: 'take_screenshot',
    description:
      "Capture the open app as it looks right now, after it has finished rebuilding. Ends with automatic checks (styles defined but never applied, overlapping or clipped elements, small tap targets). Use it after building or changing UI.",
    inputSchema: { type: 'object', properties: { app_id: APP_ID } },
  },
  {
    name: 'get_screenshot',
    description:
      'Look at an earlier screenshot from the app history by its event id. get_app_history lists them, including ones taken automatically on errors and after in-app agent turns.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Screenshot event id, e.g. 812.' },
        app_id: APP_ID,
      },
      required: ['id'],
    },
  },
];

const TOOLS = [...OWN_TOOLS, ...SHARED_TOOLS];

const GUIDE_PREAMBLE = `# Building in Blank Slate over MCP

You're connected to Blank Slate, a desktop app whose apps are React Native + TypeScript code living in its virtual filesystem, rendered live in its window. The guide below was written for Blank Slate's built-in agent. It applies to you too, with these differences:

- Your tools have the same names (list_files, read_file, write_file, edit_file, …) plus list_apps / create_app / open_app. The files live inside Blank Slate, not on disk; don't look for them in the working directory.
- Pass \`app_id\` to the file tools. The user can switch apps in the window, and the tools only work on the open app.
- \`web_search\` / \`web_fetch\` aren't provided: use your own web tools if you have them.
- \`take_screenshot\` and \`get_screenshot\` return the image itself; they take no \`question\`.
- The user is talking to you, not to Blank Slate's chat. Skip the guide's advice about chat replies.

---

`;

let queue: Promise<unknown> = Promise.resolve();

/**
 * Resolves once no MCP call is running. The VFS writes into whichever app is
 * current, so switching apps waits for this, as it waits for the in-app
 * agent's turn.
 */
export function whenMcpIdle(): Promise<void> {
  return queue.then(
    () => {},
    () => {},
  );
}

/**
 * Starts answering the MCP server. Returns the function that stops. Does
 * nothing outside the desktop shell.
 */
export function registerMcpHost(opts: McpHostOptions): () => void {
  const host = desktopMcpHost();
  if (!host) return () => {};
  let active = true;
  host.onRequest((req) => {
    // One at a time: calls share the current app, and open_app changes it.
    const run = queue.then(() => (active ? answer(req, opts) : Promise.reject(new Error('Blank Slate is not ready.'))));
    queue = run.catch(() => {});
    run.then(
      (result) => host.respond(req.id, { result }),
      (e: Error) => host.respond(req.id, { error: e.message }),
    );
  });
  host.setReady(true).catch(() => {});
  return () => {
    active = false;
    host.setReady(false).catch(() => {});
  };
}

async function answer(req: McpRequest, opts: McpHostOptions): Promise<unknown> {
  await projectStore.init();
  switch (req.method) {
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call': {
      const name = typeof req.params.name === 'string' ? req.params.name : '';
      const args = (req.params.arguments ?? {}) as Record<string, unknown>;
      try {
        return await callTool(name, args, opts);
      } catch (e) {
        return error(`Tool error: ${(e as Error).message}`);
      }
    }
    default:
      throw new Error(`Unknown method ${req.method}`);
  }
}

async function callTool(name: string, args: Record<string, unknown>, opts: McpHostOptions): Promise<CallResult> {
  switch (name) {
    case 'get_app_guide': {
      const [autoIcons, project] = await Promise.all([
        getAutoAppIcons(),
        projectStore.get(projectStore.getCurrentProjectIdSync()),
      ]);
      return text(`${GUIDE_PREAMBLE}${systemPromptFor(autoIcons)}\n\n${appContextFor(project?.vibe)}`);
    }
    case 'list_apps': {
      const current = projectStore.getCurrentProjectIdSync();
      const apps = (await projectStore.list()).map((p) => ({
        id: p.id,
        name: p.name,
        ...(p.vibe ? { vibe: p.vibe } : {}),
        updatedAt: new Date(p.updatedAt).toISOString(),
        open: p.id === current,
      }));
      return text(JSON.stringify(apps, null, 2));
    }
    case 'create_app': {
      const vibe = typeof args.vibe === 'string' ? args.vibe : '';
      // Created unnamed, then named as the agent: a name the user typed would
      // lock set_app_name.
      const project = await projectStore.create('', {}, vibe);
      const typed = typeof args.name === 'string' ? projectStore.cleanName(args.name) : '';
      if (typed) await projectStore.rename(project.id, typed, 'agent');
      await opts.openApp(project.id);
      const opened = projectStore.getCurrentProjectIdSync() === project.id;
      return text(
        `Created "${typed || project.name}" (app_id ${project.id})${opened ? ' and opened it' : ", but couldn't open it"}. App.tsx holds the starter screen; replace it.`,
      );
    }
    case 'open_app': {
      const id = requireString(args, 'app_id');
      const project = await projectStore.get(id);
      if (!project) return error(`No app with id ${id}. list_apps shows them.`);
      await opts.openApp(id);
      if (projectStore.getCurrentProjectIdSync() !== id) {
        return error(
          `"${project.name}" was shared from someone else, so Blank Slate is asking the user to trust it first. Ask them to accept the notice in the window, then call open_app again.`,
        );
      }
      const files = await vfs.listFiles();
      return text(`Opened "${project.name}" (app_id ${id}). Files:\n${files.join('\n') || '(none)'}`);
    }
    case 'take_screenshot': {
      const wrong = checkApp(args);
      if (wrong) return wrong;
      const settled = await waitForSettled();
      const shot = await captureApp('claude-code');
      if (!shot.ok) {
        return text(`No screenshot: ${shot.error}\n\nWhat the app is rendering instead:\n${await describeUi(60)}`);
      }
      const image = await shotImage(shot.event);
      if (!image) return error(`Could not read screenshot #${shot.event.id}.`);
      const note = settled ? '' : '\n(The app was still rebuilding when this was taken; take another once it has loaded.)';
      return {
        content: [
          image,
          {
            type: 'text',
            text: `Screenshot #${shot.event.id}, ${shot.event.w}×${shot.event.h} px.${note}\n\n${await autoChecks()}`,
          },
        ],
      };
    }
    case 'get_screenshot': {
      const wrong = checkApp(args);
      if (wrong) return wrong;
      await history.ready();
      const id = Number(args.id);
      const ev = Number.isFinite(id) ? history.getEvent(id) : undefined;
      if (!ev || ev.type !== 'screenshot') return error(`#${args.id} is not a screenshot in the app history.`);
      if (!ev.uri) return error(`Screenshot #${id} was deleted (only recent ones are kept).`);
      const image = await shotImage(ev);
      if (!image) return error(`Could not read screenshot #${id}.`);
      return {
        content: [
          image,
          {
            type: 'text',
            text: `Screenshot #${id}, ${ev.w}×${ev.h} px, taken ${history.formatTime(ev.ts)} (${ev.source ?? 'auto'}).`,
          },
        ],
      };
    }
    default: {
      if (!SHARED.has(name)) return error(`Unknown tool: ${name}`);
      const wrong = checkApp(args);
      if (wrong) return wrong;
      const ctx: ToolContext = { apiKey: opts.apiKey, model: await getModel() };
      const { app_id: _appId, ...input } = args;
      const res = await executeTool(name, input, ctx);
      return { content: [{ type: 'text', text: res.text }], ...(res.ok ? {} : { isError: true }) };
    }
  }
}

// Refuses a call aimed at an app that isn't the open one.
function checkApp(args: Record<string, unknown>): CallResult | null {
  if (typeof args.app_id !== 'string' || !args.app_id) return null;
  const current = projectStore.getCurrentProjectIdSync();
  if (args.app_id === current) return null;
  return error(
    `App ${args.app_id} isn't open in the window any more (the open app is ${current}; the user may have switched). Call open_app to switch back, or ask the user.`,
  );
}

async function shotImage(ev: history.HistoryEvent): Promise<Content | null> {
  const dataUrl = await history.readShotDataUrl(ev);
  const match = dataUrl?.match(/^data:([^;]+);base64,(.*)$/);
  return match ? { type: 'image', data: match[2], mimeType: match[1] } : null;
}

function text(t: string): CallResult {
  return { content: [{ type: 'text', text: t }] };
}

function error(t: string): CallResult {
  return { content: [{ type: 'text', text: t }], isError: true };
}

function requireString(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== 'string' || !v) throw new Error(`Expected string "${key}"`);
  return v;
}

import * as history from '../debug/history';
import { describeUi } from '../debug/instrument';
import { captureApp } from '../debug/screenshot';
import { describeScreenshot, modelAcceptsImages } from './vision';

// Debugging tools: the generated app's runtime history, screenshots and UI
// tree. Screenshots reach a vision-capable chat model as an image (attached by
// the agent loop as a user message after the tool results). A text-only model
// gets a description from VISION_MODEL instead.

export const DEBUG_FUNCTION_TOOLS = [
  {
    name: 'get_app_history',
    description:
      "What the running app has been doing: console output, errors (with stacks), taps (with the label of what was tapped, and taps where nothing responded), network requests, remounts and screenshots. Newest events last. Defaults to the last 50 events of any type. Use it when the user reports a bug, before guessing.",
    parameters: {
      type: 'object',
      properties: {
        types: {
          type: 'array',
          items: { type: 'string', enum: history.FILTER_GROUPS },
          description: 'Only these kinds. "errors" also includes console.warn/error.',
        },
        since_id: { type: 'number', description: 'Only events after this id, e.g. the last id you saw.' },
        search: { type: 'string', description: 'Case-insensitive substring match on the text and stack.' },
        limit: { type: 'number', description: 'Max events, default 50, max 200.' },
      },
    },
  },
  {
    name: 'take_screenshot',
    description:
      "Capture the app's screen as it looks right now and look at it. Use it after building or changing the UI to check the result, and when the user says something looks wrong. Costs tokens, so don't take one after every small edit.",
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'What you want to check, e.g. "Is there a visible way to add an item?"',
        },
      },
    },
  },
  {
    name: 'get_screenshot',
    description:
      'Look at an earlier screenshot from the app history by its event id (the history lists them, including ones taken automatically after your turns and on errors).',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Screenshot event id, e.g. 812.' },
        question: { type: 'string', description: 'What you want to check in it.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_ui_tree',
    description:
      'Cheap text dump of what is on screen now: every Text, button, input and switch with its label and frame (x,y w×h in points), top to bottom. Good for "where is the add button" or checking that content rendered at all.',
    parameters: { type: 'object', properties: {} },
  },
];

export const DEBUG_TOOL_NAMES = new Set(DEBUG_FUNCTION_TOOLS.map((t) => t.name));

export type DebugToolResult = {
  ok: boolean;
  text: string;
  image?: { dataUrl: string; caption: string };
};

type Ctx = { apiKey: string; model: string; signal?: AbortSignal };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_CHARS = 9000;

export async function executeDebugTool(
  name: string,
  input: Record<string, unknown>,
  ctx: Ctx,
): Promise<DebugToolResult> {
  await history.ready();
  switch (name) {
    case 'get_app_history':
      return { ok: true, text: historyText(input) };
    case 'get_ui_tree':
      return { ok: true, text: await describeUi() };
    case 'take_screenshot': {
      const question = optString(input.question);
      const shot = await captureApp('agent');
      if (!shot.ok) {
        return {
          ok: true,
          text: `No screenshot: ${shot.error}\n\nWhat the app is rendering instead:\n${await describeUi(60)}`,
        };
      }
      return deliver(shot.event, question, ctx, true);
    }
    case 'get_screenshot': {
      const id = Number(input.id);
      const ev = Number.isFinite(id) ? history.getEvent(id) : undefined;
      if (!ev || ev.type !== 'screenshot') {
        return { ok: false, text: `#${input.id} is not a screenshot in the app history.` };
      }
      if (!ev.uri) return { ok: false, text: `Screenshot #${id} was deleted (only recent ones are kept).` };
      return deliver(ev, optString(input.question), ctx, false);
    }
    default:
      return { ok: false, text: `Unknown tool: ${name}` };
  }
}

async function deliver(
  ev: history.HistoryEvent,
  question: string | undefined,
  ctx: Ctx,
  live: boolean,
): Promise<DebugToolResult> {
  const dataUrl = await history.readShotDataUrl(ev);
  if (!dataUrl) return { ok: false, text: `Could not read screenshot #${ev.id}.` };
  const when = live ? 'as it looks now' : `taken ${history.formatTime(ev.ts)} (${ev.source ?? 'auto'})`;
  const head = `Screenshot #${ev.id}, ${ev.w}×${ev.h} px, ${when}.`;
  if (await modelAcceptsImages(ctx.apiKey, ctx.model)) {
    return {
      ok: true,
      text: `${head} The image is attached in the next message.`,
      image: { dataUrl, caption: `Screenshot #${ev.id} of the app${question ? `. Check: ${question}` : ''}` },
    };
  }
  try {
    const d = await describeScreenshot(ctx.apiKey, dataUrl, question, ctx.signal);
    const cost = d.cost !== null ? `, cost $${d.cost.toFixed(4)}` : '';
    if (__DEV__) {
      console.log(`[agent] screenshot #${ev.id} described by ${d.model} prompt=${d.promptTokens ?? '?'} cost=$${d.cost ?? '?'}`);
    }
    // The tree gives exact labels and positions to go with the description.
    const tree = live ? `\n\nUI tree:\n${await describeUi(50)}` : '';
    return {
      ok: true,
      text: `${head} You can't view images, so ${d.model} described it${cost}:\n\n${d.text}${tree}`,
    };
  } catch (e) {
    const tree = live ? `\n\nUI tree instead:\n${await describeUi(60)}` : '';
    return { ok: true, text: `${head} Describing it failed (${(e as Error).message}).${tree}` };
  }
}

function historyText(input: Record<string, unknown>): string {
  const groups = Array.isArray(input.types)
    ? (input.types.filter((t) => history.FILTER_GROUPS.includes(t as history.FilterGroup)) as history.FilterGroup[])
    : undefined;
  const sinceId = typeof input.since_id === 'number' ? input.since_id : undefined;
  const search = optString(input.search);
  const limit = Math.max(1, Math.min(MAX_LIMIT, typeof input.limit === 'number' ? input.limit : DEFAULT_LIMIT));
  const events = history.query({ groups, sinceId, search, limit });
  const session = history.currentSession();
  if (!events.length) {
    const filtered = groups?.length || sinceId !== undefined || search;
    return filtered
      ? `No matching events (current session ${session}).`
      : `No events yet in the app history (current session ${session}).`;
  }
  // Newest lines win when the output is over budget.
  const out: string[] = [];
  let chars = 0;
  let lastSession = -1;
  const lines: string[] = [];
  for (const e of events) {
    if (e.session !== lastSession) {
      lastSession = e.session;
      lines.push(`— session ${e.session}${e.session === session ? ' (current)' : ''}`);
    }
    lines.push(history.formatLine(e, { detailLines: e.type === 'error' ? 5 : e.detail ? 2 : 0 }));
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (chars + lines[i].length > MAX_CHARS) {
      out.unshift(`(${i + 1} older lines cut; narrow with types/search/since_id)`);
      break;
    }
    chars += lines[i].length + 1;
    out.unshift(lines[i]);
  }
  const errors = history.query({ groups: ['errors'], session }).length;
  const shot = history.query({ groups: ['screenshots'], limit: 1 })[0];
  const footer = [
    `${events.length} event${events.length === 1 ? '' : 's'} shown, oldest first.`,
    `Errors/warnings this session: ${errors}.`,
    shot?.uri ? `Latest screenshot: #${shot.id} (get_screenshot).` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return `${out.join('\n')}\n\n${footer}`;
}

function optString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

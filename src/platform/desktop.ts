import { Platform } from 'react-native';

// The bridge `desktop/src/preload.js` exposes when the web build runs inside
// the Electron shell. Absent in a plain browser and on native.
export type DesktopSecureStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

export type McpRequest = { id: number; method: string; params: Record<string, unknown> };

export type McpConnectionInfo = { url: string; token: string; claudeCommand: string };

// desktop/src/mcp.js forwards a coding agent's tool calls here (src/mcp/host.ts).
export type DesktopMcpHost = {
  onRequest(handler: (request: McpRequest) => void): void;
  respond(id: number, payload: { result: unknown } | { error: string }): Promise<void>;
  setReady(ready: boolean): Promise<void>;
  // Null until the server is listening, or if it couldn't start.
  info(): Promise<McpConnectionInfo | null>;
};

export type DesktopBridge = {
  // One-shot: the first call gets the key store, every later call gets null.
  claimSecureStore(): DesktopSecureStore | null;
  // One-shot too. Missing on a desktop build older than the MCP server.
  claimMcpHost?(): DesktopMcpHost | null;
};

declare global {
  interface Window {
    blankSlateDesktop?: DesktopBridge;
  }
}

// Claimed while this module is first evaluated, i.e. during Blank Slate's own
// startup, long before any generated app is compiled. Generated code shares
// this renderer, and after this point `window.blankSlateDesktop` can no
// longer hand the key store to anyone.
const bridge = Platform.OS === 'web' && typeof window !== 'undefined' ? window.blankSlateDesktop : undefined;

// Already claimed (e.g. this module was re-evaluated by a dev hot reload):
// fail loudly rather than let keyStore fall back to plaintext localStorage.
const unclaimable: DesktopSecureStore = {
  get: () => Promise.reject(new Error('Desktop key store already claimed. Reload the window.')),
  set: () => Promise.reject(new Error('Desktop key store already claimed. Reload the window.')),
  delete: () => Promise.reject(new Error('Desktop key store already claimed. Reload the window.')),
};

const secureStore: DesktopSecureStore | null = bridge
  ? (bridge.claimSecureStore?.() ?? unclaimable)
  : null;

const mcpHost: DesktopMcpHost | null = bridge?.claimMcpHost?.() ?? null;

/** The MCP server's renderer side, or null outside the desktop shell. */
export function desktopMcpHost(): DesktopMcpHost | null {
  return mcpHost;
}

/** The Electron key store, or null outside the desktop shell. */
export function desktopSecureStore(): DesktopSecureStore | null {
  return secureStore;
}

export type RuntimePlatform = 'native' | 'desktop' | 'web';

export function runtimePlatform(): RuntimePlatform {
  if (Platform.OS !== 'web') return 'native';
  return typeof window !== 'undefined' && window.blankSlateDesktop ? 'desktop' : 'web';
}

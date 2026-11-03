// Curated OpenRouter model IDs (checked against /api/v1/models, Nov 2026).
// All support tool calling. Users can also type any other model ID in Settings.

export type ModelOption = { id: string; label: string; note: string };

export const DEFAULT_MODEL = 'z-ai/glm-5.3';

// Used by the generate_image tool regardless of the chat model. ~$0.035 per
// 1024px image as of Nov 2026.
export const IMAGE_MODEL = 'google/gemini-nano-banana-2.1';

// Describes screenshots for chat models that can't take images (the default,
// GLM 5.3, is text-only). Cheap and vision-capable.
export const VISION_MODEL = 'z-ai/glm-5.3-flash';

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'z-ai/glm-5.3', label: 'GLM 5.3', note: 'Z.ai flagship, strong agentic coding · $0.08 / $3.60' },
  { id: 'z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash', note: 'Very cheap and fast · $0.03 / $0.09' },
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', note: 'Cheap coding model · $0.05 / $0.50' },
  { id: 'minimax/minimax-m3.1-flash', label: 'MiniMax M3.1 Flash', note: 'Cheap, good at agent tasks · $0.08 / $0.30' },
  { id: 'moonshotai/kimi-k3', label: 'Kimi K3', note: 'Long-horizon coding · $0.28 / $9.60' },
  { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', note: 'Anthropic, fast · $0.10 / $0.50' },
  { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', note: 'Anthropic, strongest here · $2 / $10' },
];

export function labelForModel(id: string): string {
  return MODEL_OPTIONS.find((m) => m.id === id)?.label ?? id;
}

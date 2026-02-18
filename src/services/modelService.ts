import type { ModelInfo, AgentKind } from '../types.js'

export const CLAUDE_MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', contextLength: 200000 },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextLength: 200000 },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', contextLength: 200000 },
  { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', contextLength: 200000 },
]

export const GEMINI_MODELS: ModelInfo[] = [
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', contextLength: 1000000 },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextLength: 1000000 },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextLength: 1000000 },
]

export const OPENAI_MODELS: ModelInfo[] = [
  { id: 'o3', name: 'OpenAI o3', contextLength: 128000 },
  { id: 'o4-mini', name: 'OpenAI o4-mini', contextLength: 128000 },
  { id: 'gpt-4.1', name: 'GPT-4.1', contextLength: 128000 },
]

export async function fetchOpenRouterModels(apiKey: string): Promise<ModelInfo[]> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json() as { data: Array<{ id: string; name: string; context_length?: number }> }
    return data.data.map((m) => ({
      id: m.id,
      name: m.name || m.id,
      contextLength: m.context_length,
    }))
  } catch {
    return []
  }
}

export async function getModelsForAgent(kind: AgentKind): Promise<ModelInfo[]> {
  const openRouterKey = process.env.OPENROUTER_API_KEY
  if (openRouterKey) {
    const models = await fetchOpenRouterModels(openRouterKey)
    if (models.length > 0) return models
  }

  switch (kind) {
    case 'claude':
      return CLAUDE_MODELS
    case 'gemini':
      return GEMINI_MODELS
    case 'goose':
    case 'opencode':
      return [...CLAUDE_MODELS, ...GEMINI_MODELS, ...OPENAI_MODELS]
    default:
      return [...CLAUDE_MODELS, ...GEMINI_MODELS, ...OPENAI_MODELS]
  }
}

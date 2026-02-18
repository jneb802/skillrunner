import type { ModelInfo, AgentKind } from '../types.js'
import { loadConfig } from './configService.js'

// Native (non-OpenRouter) fallback models per agent
const NATIVE_CLAUDE_MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
]

const NATIVE_GEMINI_MODELS: ModelInfo[] = [
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
]

const NATIVE_OPENCODE_MODELS: ModelInfo[] = [
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  { id: 'gpt-4.1', name: 'GPT-4.1' },
]

function nativeModelsFor(kind: AgentKind): ModelInfo[] {
  switch (kind) {
    case 'claude': return NATIVE_CLAUDE_MODELS
    case 'gemini': return NATIVE_GEMINI_MODELS
    case 'goose': return []  // goose uses its own config, no native list
    case 'opencode': return NATIVE_OPENCODE_MODELS
    default: return []
  }
}

export async function getModelsForAgent(kind: AgentKind): Promise<ModelInfo[]> {
  const config = await loadConfig()
  const openRouterModels: ModelInfo[] = (config.openrouter?.models ?? []).map((m) => ({
    id: m.id,
    name: `${m.name} (OpenRouter)`,
  }))

  const native = nativeModelsFor(kind)

  // Deduplicate: openrouter models take precedence, then native
  const seen = new Set<string>()
  const merged: ModelInfo[] = []
  for (const m of [...native, ...openRouterModels]) {
    if (!seen.has(m.id)) {
      seen.add(m.id)
      merged.push(m)
    }
  }
  return merged
}

import { spawn } from 'child_process'
import { Writable, Readable } from 'stream'
import * as acp from '@agentclientprotocol/sdk'
import type { SessionConfig, ToolCallRecord } from '../types.js'
import { spawnAgentInDocker } from './dockerService.js'
import { loadConfig } from './configService.js'

export interface AgentUpdate {
  type: 'output' | 'tool-start' | 'tool-done' | 'tool-error' | 'phase'
  text?: string
  toolCall?: ToolCallRecord
  phase?: string
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>
    if (typeof o['message'] === 'string') return o['message']
    if (o['error'] && typeof o['error'] === 'object') {
      const inner = o['error'] as Record<string, unknown>
      if (typeof inner['message'] === 'string') return inner['message']
    }
    return JSON.stringify(err)
  }
  return String(err)
}

async function buildEnv(config: SessionConfig): Promise<Record<string, string>> {
  const base: Record<string, string> = {}

  // Copy relevant env vars from the current process
  for (const key of [
    'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY',
    'OPENROUTER_API_KEY', 'PATH', 'HOME', 'USER',
  ]) {
    const val = process.env[key]
    if (val) base[key] = val
  }

  // Also read OpenRouter API key from config file (overrides env if set)
  const fileConfig = await loadConfig()
  const fileKey = fileConfig.openrouter?.api_key
  if (fileKey) base['OPENROUTER_API_KEY'] = fileKey

  const modelId = config.model.id
  const openRouterKey = base['OPENROUTER_API_KEY']
  const configuredModels = fileConfig.openrouter?.models ?? []
  const isConfiguredModel = configuredModels.some((m) => m.id === modelId)

  // If model is in the configured openrouter/proxy list, route accordingly
  if (isConfiguredModel && openRouterKey) {
    const proxyUrl = fileConfig.proxy?.base_url
    if (proxyUrl) {
      // Route Claude Code through a local LiteLLM proxy (supports non-Claude models)
      base['ANTHROPIC_BASE_URL'] = proxyUrl
      base['ANTHROPIC_API_KEY'] = openRouterKey
    } else {
      base['ANTHROPIC_BASE_URL'] = 'https://openrouter.ai/api/v1'
      base['ANTHROPIC_API_KEY'] = openRouterKey
    }
    base['OPENAI_BASE_URL'] = 'https://openrouter.ai/api/v1'
    base['OPENAI_API_KEY'] = openRouterKey
    // Goose native OpenRouter support
    base['GOOSE_PROVIDER'] = 'openrouter'
    base['GOOSE_MODEL'] = modelId
  }

  return base
}

function agentCommandAndArgs(config: SessionConfig): { command: string; args: string[] } {
  const { kind } = config.agent
  switch (kind) {
    case 'claude':
      return { command: 'claude-code-acp', args: ['--dangerously-skip-permissions'] }
    case 'gemini':
      return { command: 'gemini', args: ['--experimental-acp'] }
    case 'goose':
      return { command: 'goose', args: ['acp'] }
    case 'opencode':
      return { command: 'opencode', args: ['acp'] }
    case 'custom':
      return { command: config.agent.command, args: config.agent.args }
    default:
      return { command: config.agent.command, args: config.agent.args }
  }
}

export class AgentRunner {
  async run(
    config: SessionConfig,
    onUpdate: (update: AgentUpdate) => void,
    signal: AbortSignal
  ): Promise<void> {
    const workDir = config.worktreePath ?? config.repoPath

    const env = await buildEnv(config)
    const { command, args } = agentCommandAndArgs(config)

    const proc = config.useDocker
      ? spawnAgentInDocker({
          imageName: `skillrunner-${config.repoName}:latest`,
          worktreePath: workDir,
          agent: { ...config.agent, command, args },
          env,
        })
      : spawn(command, args, {
          cwd: workDir,
          stdio: ['pipe', 'pipe', 'inherit'],
          env: { ...process.env, ...env },
        })

    signal.addEventListener('abort', () => {
      try { proc.kill('SIGTERM') } catch { /* ignore */ }
    })

    // Convert Node streams to Web streams for ACP
    const writableWeb = new WritableStream<Uint8Array>({
      write(chunk) {
        return new Promise((resolve, reject) => {
          proc.stdin!.write(chunk, (err) => {
            if (err) reject(err)
            else resolve()
          })
        })
      },
      close() {
        proc.stdin!.end()
      },
    })

    const readableWeb = new ReadableStream<Uint8Array>({
      start(controller) {
        proc.stdout!.on('data', (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk))
        })
        proc.stdout!.on('end', () => controller.close())
        proc.stdout!.on('error', (err) => controller.error(err))
      },
    })

    const stream = acp.ndJsonStream(writableWeb, readableWeb)

    let sessionId: string | undefined

    const clientImpl: acp.Client = {
      async sessionUpdate(params: acp.SessionNotification): Promise<void> {
        const update = params.update
        const kind = update.sessionUpdate

        if (kind === 'agent_message_chunk') {
          // ContentChunk: update.content is a ContentBlock
          const block = (update as any).content
          const text: string =
            block?.type === 'text' ? block.text :
            typeof block === 'string' ? block : ''
          if (text) {
            onUpdate({ type: 'output', text })
          }
        } else if (kind === 'tool_call') {
          // ToolCall: update.toolCallId, update.title, update.status
          const u = update as any
          const id: string = u.toolCallId ?? String(Date.now())
          const name: string = u.title ?? 'tool'
          const status: string = u.status ?? 'in_progress'
          if (status === 'in_progress' || status === 'pending') {
            onUpdate({ type: 'tool-start', toolCall: { id, name, status: 'running' } })
          } else if (status === 'completed') {
            onUpdate({ type: 'tool-done', toolCall: { id, name, status: 'done' } })
          } else if (status === 'failed') {
            onUpdate({ type: 'tool-error', toolCall: { id, name, status: 'error' } })
          }
        } else if (kind === 'tool_call_update') {
          // ToolCallUpdate: update.toolCallId, update.status, update.title
          const u = update as any
          const id: string = u.toolCallId ?? String(Date.now())
          const name: string = u.title ?? 'tool'
          const status: string = u.status ?? ''
          if (status === 'completed') {
            onUpdate({ type: 'tool-done', toolCall: { id, name, status: 'done' } })
          } else if (status === 'failed') {
            onUpdate({ type: 'tool-error', toolCall: { id, name, status: 'error' } })
          }
        }
      },

      async requestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
        const toolName = (params as any).toolCall?.name ?? 'unknown tool'
        onUpdate({ type: 'output', text: `[auto-approve] ${toolName}\n` })

        // Prefer allow_always so we don't get re-prompted for subsequent calls
        const allowAlways = params.options.find((o) => o.kind === 'allow_always')
        const allowOnce = params.options.find((o) => o.kind === 'allow_once')
        const chosen = allowAlways ?? allowOnce ?? params.options[0]

        if (chosen) {
          return {
            outcome: { outcome: 'selected', optionId: chosen.optionId },
          }
        }
        // Fallback: cancel if no options
        return { outcome: { outcome: 'cancelled' } }
      },
    }

    const connection = new acp.ClientSideConnection((_agent) => clientImpl, stream)

    // Initialize
    await connection.initialize({
      protocolVersion: 0,
      clientInfo: { name: 'skillrunner', version: '0.1.0' },
    })

    // Create session
    const sessionResp = await connection.newSession({
      cwd: workDir,
      mcpServers: [],
    })
    sessionId = (sessionResp as any).sessionId ?? (sessionResp as any).session_id

    // Try to set model (unstable, may not be supported)
    if (sessionId) {
      try {
        await connection.unstable_setSessionModel({
          sessionId,
          modelId: config.model.id,
        })
      } catch {
        // Not supported by this agent — continue
      }
    }

    // Signal running phase and send the skill prompt
    onUpdate({ type: 'phase', phase: 'running' })
    onUpdate({ type: 'output', text: `Running skill: ${config.skill.name}\n` })

    // Substitute $ARGUMENTS if an argument was provided
    const skillText = config.argument
      ? config.skill.raw.replace(/\$ARGUMENTS/g, config.argument)
      : config.skill.raw

    // For no-worktree (pipeline) runs, prepend an automation note so the agent
    // doesn't pause waiting for human approval mid-skill
    const automationPrefix = config.noWorktree
      ? 'IMPORTANT: You are running in fully automated mode via skillrunner. ' +
        'Proceed with all actions autonomously — do not pause, ask for confirmation, ' +
        'or wait for user approval at any step. Execute every action the task requires.\n\n'
      : ''

    const promptText = automationPrefix + skillText

    try {
      await connection.prompt({
        sessionId: sessionId ?? '',
        prompt: [{ type: 'text', text: promptText }],
      })
    } finally {
      // prompt() returns when the turn is complete; kill the process so
      // the stream closes rather than blocking indefinitely on more input
      try { proc.kill('SIGTERM') } catch { /* ignore */ }
    }
  }
}

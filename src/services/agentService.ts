import { spawn } from 'child_process'
import { Writable, Readable } from 'stream'
import * as acp from '@agentclientprotocol/sdk'
import type { SessionConfig, ToolCallRecord } from '../types.js'
import { spawnAgentInDocker } from './dockerService.js'

export interface AgentUpdate {
  type: 'output' | 'tool-start' | 'tool-done' | 'tool-error' | 'phase'
  text?: string
  toolCall?: ToolCallRecord
  phase?: string
}

function buildEnv(config: SessionConfig): Record<string, string> {
  const base: Record<string, string> = {}

  // Copy relevant env vars
  for (const key of [
    'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY',
    'OPENROUTER_API_KEY', 'PATH', 'HOME', 'USER',
  ]) {
    const val = process.env[key]
    if (val) base[key] = val
  }

  const modelId = config.model.id
  const openRouterKey = process.env.OPENROUTER_API_KEY

  // If model ID contains '/' it's an OpenRouter model (e.g. "anthropic/claude-opus-4")
  if (modelId.includes('/') && openRouterKey) {
    base['ANTHROPIC_BASE_URL'] = 'https://openrouter.ai/api/v1'
    base['ANTHROPIC_API_KEY'] = openRouterKey
    base['OPENAI_BASE_URL'] = 'https://openrouter.ai/api/v1'
    base['OPENAI_API_KEY'] = openRouterKey
  }

  return base
}

function agentCommandAndArgs(config: SessionConfig): { command: string; args: string[] } {
  const { kind } = config.agent
  switch (kind) {
    case 'claude':
      return { command: 'claude-code-acp', args: [] }
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
    if (!config.worktreePath) throw new Error('worktreePath not set in SessionConfig')

    const env = buildEnv(config)
    const { command, args } = agentCommandAndArgs(config)

    const proc = config.useDocker
      ? spawnAgentInDocker({
          imageName: `skillrunner-${config.repoName}:latest`,
          worktreePath: config.worktreePath,
          agent: { ...config.agent, command, args },
          env,
        })
      : spawn(command, args, {
          cwd: config.worktreePath,
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
        const update = (params as any).update ?? params
        const updateType = (update as any).type ?? (update as any).sessionUpdate

        if (updateType === 'agent_message_chunk' || updateType === 'message_chunk') {
          const content = (update as any).content
          const text = content?.text ?? (typeof content === 'string' ? content : '')
          if (text) {
            onUpdate({ type: 'output', text })
          }
        } else if (updateType === 'tool_call' || updateType === 'tool_use') {
          const toolUse = (update as any).toolUse ?? (update as any).tool_use ?? update
          const toolId = (toolUse as any).id ?? String(Date.now())
          const toolName = (toolUse as any).name ?? 'unknown'
          const toolStatus = (toolUse as any).status ?? 'running'

          if (toolStatus === 'running' || toolStatus === 'started') {
            onUpdate({
              type: 'tool-start',
              toolCall: {
                id: toolId,
                name: toolName,
                status: 'running',
                input: (toolUse as any).input,
              },
            })
          } else if (toolStatus === 'done' || toolStatus === 'completed') {
            onUpdate({
              type: 'tool-done',
              toolCall: { id: toolId, name: toolName, status: 'done' },
            })
          } else if (toolStatus === 'error') {
            onUpdate({
              type: 'tool-error',
              toolCall: { id: toolId, name: toolName, status: 'error' },
            })
          }
        }
      },

      async requestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
        const toolName = (params as any).toolCall?.name ?? 'unknown tool'
        onUpdate({ type: 'output', text: `[auto-approve] ${toolName}\n` })

        // Find the "allow_once" option from the request, or fall back to the first option
        const allowOnce = params.options.find((o) => o.kind === 'allow_once')
        const chosen = allowOnce ?? params.options[0]

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
      cwd: config.worktreePath!,
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

    // Send the skill prompt
    onUpdate({ type: 'output', text: `Running skill: ${config.skill.name}\n` })

    await connection.prompt({
      sessionId: sessionId ?? '',
      prompt: [{ type: 'text', text: config.skill.raw }],
    })

    await connection.closed
  }
}

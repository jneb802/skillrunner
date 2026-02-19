export interface Skill {
  name: string
  description: string
  allowedTools: string[]
  skillPath: string
  dirPath: string
  body: string
  raw: string
  noWorktree?: boolean
  argumentPrompt?: string
  pipelineSteps?: Skill[]
}

export type AgentKind = 'claude' | 'gemini' | 'goose' | 'opencode' | 'custom'

export interface AgentConfig {
  kind: AgentKind
  label: string
  command: string
  args: string[]
}

export interface ModelInfo {
  id: string
  name: string
  contextLength?: number
}

export interface SessionConfig {
  repoPath: string
  repoName: string
  skill: Skill
  agent: AgentConfig
  model: ModelInfo
  useDocker: boolean
  dockerfilePath?: string
  worktreeName: string
  branchName: string
  worktreePath?: string
  prUrl?: string
  argument?: string
  noWorktree?: boolean
}

export interface PipelineStepState {
  name: string
  output: string[]
  partialLine?: string
  toolCalls: ToolCallRecord[]
  status: 'pending' | 'running' | 'done' | 'error'
}

export type RunPhase =
  | 'creating-worktree'
  | 'building-docker'
  | 'starting-agent'
  | 'running'
  | 'committing'
  | 'pushing'
  | 'creating-pr'
  | 'removing-worktree'
  | 'done'

export interface ToolCallRecord {
  id: string
  name: string
  status: 'running' | 'done' | 'error'
  input?: unknown
}

export interface RunState {
  phase: RunPhase
  output: string[]
  partialLine?: string  // current incomplete line being streamed
  toolCalls: ToolCallRecord[]
  error?: string
  steps?: PipelineStepState[]
  currentStepIndex?: number
}

export type RunStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled'

export interface QueuedRun {
  id: string
  sessionConfig: SessionConfig
  status: RunStatus
  runState: RunState
  prUrl?: string
  error?: string
  enqueuedAt: number
  startedAt?: number
  finishedAt?: number
}

export interface QueueSnapshot {
  runs: readonly QueuedRun[]
  concurrency: number
  activeCount: number
  pendingCount: number
}

// Pluggable persistence — no-op by default
export interface RunStore {
  load(): Promise<QueuedRun[]>
  save(runs: QueuedRun[]): Promise<void>
}

export type AppScreen =
  | 'config-wizard'
  | 'skill-picker'
  | 'argument-input'
  | 'agent-picker'
  | 'model-picker'
  | 'config-review'
  | 'running'
  | 'done'

export type AppAction =
  | { type: 'WIZARD_DONE' }
  | { type: 'OPEN_WIZARD' }
  | { type: 'SELECT_SKILL'; skill: Skill }
  | { type: 'SET_ARGUMENT'; argument: string }
  | { type: 'SELECT_AGENT'; agent: AgentConfig }
  | { type: 'SELECT_MODEL'; model: ModelInfo }
  | { type: 'CONFIRM'; useDocker: boolean; dockerfilePath?: string; runId: string }
  | { type: 'QUEUE_UPDATED'; snapshot: QueueSnapshot }
  | { type: 'VIEW_RUN'; runId: string }
  | { type: 'CANCEL_RUN'; runId: string }
  | { type: 'SET_CONCURRENCY'; n: number }
  | { type: 'BACK' }

export interface AppState {
  screen: AppScreen
  repoPath: string
  repoName: string
  skill?: Skill
  argument?: string
  agent?: AgentConfig
  model?: ModelInfo
  queue: QueueSnapshot
  concurrency: number
  selectedRunId?: string
}

export interface Skill {
  name: string
  description: string
  allowedTools: string[]
  skillPath: string
  dirPath: string
  body: string
  raw: string
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
}

export type AppScreen =
  | 'skill-picker'
  | 'agent-picker'
  | 'model-picker'
  | 'config-review'
  | 'running'
  | 'done'

export type AppAction =
  | { type: 'SELECT_SKILL'; skill: Skill }
  | { type: 'SELECT_AGENT'; agent: AgentConfig }
  | { type: 'SELECT_MODEL'; model: ModelInfo }
  | { type: 'CONFIRM'; useDocker: boolean; dockerfilePath?: string }
  | { type: 'START_RUN' }
  | { type: 'UPDATE_RUN'; patch: Partial<RunState> }
  | { type: 'COMPLETE'; prUrl?: string }
  | { type: 'ERROR'; message: string }
  | { type: 'BACK' }

export interface AppState {
  screen: AppScreen
  repoPath: string
  repoName: string
  skill?: Skill
  agent?: AgentConfig
  model?: ModelInfo
  sessionConfig?: SessionConfig
  runState?: RunState
  prUrl?: string
  error?: string
}

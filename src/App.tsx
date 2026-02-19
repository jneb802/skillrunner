import React, { useReducer, useEffect, useRef } from 'react'
import { Box, Text } from 'ink'
import { basename } from 'path'
import type {
  AppState, AppAction, Skill, AgentConfig, ModelInfo, SessionConfig, QueueSnapshot,
} from './types.js'
import { SkillPicker } from './screens/SkillPicker.js'
import { ArgumentInput } from './screens/ArgumentInput.js'
import { AgentPicker } from './screens/AgentPicker.js'
import { ModelPicker } from './screens/ModelPicker.js'
import { ConfigReview } from './screens/ConfigReview.js'
import { Running } from './screens/Running.js'
import { Done } from './screens/Done.js'
import { ConfigWizard } from './screens/ConfigWizard.js'
import { RunQueue } from './services/runQueue.js'
import { detectDockerTemplate } from './services/dockerService.js'
import { configExists } from './services/configService.js'

function makeTimestamp(): string {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')
}

function skillNeedsArgument(skill: Skill): boolean {
  if (skill.argumentPrompt) return true
  if (skill.pipelineSteps) {
    return skill.pipelineSteps.some((s) => s.raw.includes('$ARGUMENTS'))
  }
  return skill.raw.includes('$ARGUMENTS')
}

function buildSessionConfig(
  repoPath: string,
  skill: Skill,
  agent: AgentConfig,
  model: ModelInfo,
  useDocker: boolean,
  dockerfilePath?: string,
  argument?: string
): SessionConfig {
  const ts = makeTimestamp()
  const skillSlug = skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)
  return {
    repoPath,
    repoName: basename(repoPath),
    skill,
    agent,
    model,
    useDocker,
    dockerfilePath,
    worktreeName: `${skillSlug}-${ts}`,
    branchName: `skillrunner/${skillSlug}/${ts}`,
    argument,
    noWorktree: skill.noWorktree ?? false,
  }
}

const emptySnapshot: QueueSnapshot = {
  runs: [],
  concurrency: 1,
  activeCount: 0,
  pendingCount: 0,
}

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'WIZARD_DONE':
      return { ...state, screen: 'skill-picker' }

    case 'OPEN_WIZARD':
      return { ...state, screen: 'config-wizard' }

    case 'SELECT_SKILL': {
      const needsArg = skillNeedsArgument(action.skill)
      return {
        ...state,
        screen: needsArg ? 'argument-input' : 'agent-picker',
        skill: action.skill,
        argument: undefined,
      }
    }

    case 'SET_ARGUMENT':
      return { ...state, screen: 'agent-picker', argument: action.argument }

    case 'SELECT_AGENT':
      return { ...state, screen: 'model-picker', agent: action.agent }

    case 'SELECT_MODEL':
      return { ...state, screen: 'config-review', model: action.model }

    case 'CONFIRM':
      return {
        ...state,
        screen: 'running',
        selectedRunId: action.runId,
        skill: undefined,
        argument: undefined,
        agent: undefined,
        model: undefined,
      }

    case 'QUEUE_UPDATED': {
      const next = { ...state, queue: action.snapshot }
      // Auto-transition running → done when the selected run finishes
      if (state.screen === 'running' && state.selectedRunId) {
        const run = action.snapshot.runs.find(r => r.id === state.selectedRunId)
        if (run && (run.status === 'done' || run.status === 'error' || run.status === 'cancelled')) {
          next.screen = 'done'
        }
      }
      return next
    }

    case 'VIEW_RUN':
      return { ...state, selectedRunId: action.runId }

    case 'SET_CONCURRENCY':
      return { ...state, concurrency: action.n }

    case 'BACK': {
      switch (state.screen) {
        case 'argument-input': return { ...state, screen: 'skill-picker', skill: undefined, argument: undefined }
        case 'agent-picker':
          return state.skill && skillNeedsArgument(state.skill)
            ? { ...state, screen: 'argument-input' }
            : { ...state, screen: 'skill-picker' }
        case 'model-picker': return { ...state, screen: 'agent-picker' }
        case 'config-review': return { ...state, screen: 'model-picker' }
        default: return state
      }
    }

    default:
      return state
  }
}

function initState(repoPath: string): AppState {
  return {
    screen: configExists() ? 'skill-picker' : 'config-wizard',
    repoPath,
    repoName: basename(repoPath),
    queue: emptySnapshot,
    concurrency: 1,
  }
}

interface Props {
  repoPath: string
}

export function App({ repoPath }: Props) {
  const [state, dispatch] = useReducer(reducer, repoPath, initState)

  const queueRef = useRef<RunQueue | null>(null)
  if (queueRef.current === null) {
    queueRef.current = new RunQueue({
      concurrency: 1,
      onStateChange: (snapshot) => dispatch({ type: 'QUEUE_UPDATED', snapshot }),
    })
  }

  useEffect(() => {
    queueRef.current!.hydrate()
    return () => queueRef.current!.destroy()
  }, [])

  function handleCancel() {
    if (state.selectedRunId) queueRef.current!.cancel(state.selectedRunId)
  }

  function buildPreviewConfig(): SessionConfig | null {
    if (!state.skill || !state.agent || !state.model) return null
    const dockerfilePath = state.skill.noWorktree ? undefined : detectDockerTemplate(state.repoPath)
    return buildSessionConfig(
      state.repoPath,
      state.skill,
      state.agent,
      state.model,
      false,
      dockerfilePath,
      state.argument,
    )
  }

  switch (state.screen) {
    case 'config-wizard':
      return (
        <ConfigWizard onDone={() => dispatch({ type: 'WIZARD_DONE' })} />
      )

    case 'skill-picker':
      return (
        <SkillPicker
          repoPath={state.repoPath}
          onSelect={(skill: Skill) => dispatch({ type: 'SELECT_SKILL', skill })}
          onConfigure={() => dispatch({ type: 'OPEN_WIZARD' })}
        />
      )

    case 'argument-input':
      return state.skill ? (
        <ArgumentInput
          skill={state.skill}
          onSubmit={(argument) => dispatch({ type: 'SET_ARGUMENT', argument })}
          onBack={() => dispatch({ type: 'BACK' })}
        />
      ) : null

    case 'agent-picker':
      return (
        <AgentPicker
          onSelect={(agent: AgentConfig) => dispatch({ type: 'SELECT_AGENT', agent })}
          onBack={() => dispatch({ type: 'BACK' })}
        />
      )

    case 'model-picker':
      return state.agent ? (
        <ModelPicker
          agent={state.agent}
          onSelect={(model: ModelInfo) => dispatch({ type: 'SELECT_MODEL', model })}
          onBack={() => dispatch({ type: 'BACK' })}
        />
      ) : null

    case 'config-review': {
      const previewConfig = buildPreviewConfig()
      return previewConfig ? (
        <ConfigReview
          config={previewConfig}
          onConfirm={(useDocker) => {
            const config = buildSessionConfig(
              state.repoPath,
              state.skill!,
              state.agent!,
              state.model!,
              useDocker,
              previewConfig.dockerfilePath,
              state.argument,
            )
            const runId = queueRef.current!.enqueue(config)
            dispatch({ type: 'CONFIRM', useDocker, dockerfilePath: config.dockerfilePath, runId })
          }}
          onBack={() => dispatch({ type: 'BACK' })}
        />
      ) : null
    }

    case 'running': {
      const run = state.queue.runs.find(r => r.id === state.selectedRunId)
      return run ? <Running runState={run.runState} onCancel={handleCancel} /> : null
    }

    case 'done': {
      const run = state.queue.runs.find(r => r.id === state.selectedRunId)
      return run ? (
        <Done config={run.sessionConfig} prUrl={run.prUrl} error={run.error} />
      ) : (
        <Text color="red">Run not found</Text>
      )
    }

    default:
      return <Text>Unknown screen</Text>
  }
}

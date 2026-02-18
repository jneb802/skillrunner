import React, { useReducer, useEffect, useRef } from 'react'
import { Box, Text } from 'ink'
import { basename } from 'path'
import type {
  AppState, AppAction, Skill, AgentConfig, ModelInfo, RunState, SessionConfig,
} from './types.js'
import { SkillPicker } from './screens/SkillPicker.js'
import { AgentPicker } from './screens/AgentPicker.js'
import { ModelPicker } from './screens/ModelPicker.js'
import { ConfigReview } from './screens/ConfigReview.js'
import { Running } from './screens/Running.js'
import { Done } from './screens/Done.js'
import { ConfigWizard } from './screens/ConfigWizard.js'
import { GitService } from './services/gitService.js'
import { GithubService } from './services/githubService.js'
import { DockerImageBuilder } from './services/dockerService.js'
import { AgentRunner } from './services/agentService.js'
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

function buildSessionConfig(
  repoPath: string,
  skill: Skill,
  agent: AgentConfig,
  model: ModelInfo,
  useDocker: boolean,
  dockerfilePath?: string
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
  }
}

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'WIZARD_DONE':
      return { ...state, screen: 'skill-picker' }

    case 'OPEN_WIZARD':
      return { ...state, screen: 'config-wizard' }

    case 'SELECT_SKILL':
      return { ...state, screen: 'agent-picker', skill: action.skill }

    case 'SELECT_AGENT':
      return { ...state, screen: 'model-picker', agent: action.agent }

    case 'SELECT_MODEL':
      return { ...state, screen: 'config-review', model: action.model }

    case 'CONFIRM': {
      if (!state.skill || !state.agent || !state.model) return state
      const sessionConfig = buildSessionConfig(
        state.repoPath,
        state.skill,
        state.agent,
        state.model,
        action.useDocker,
        action.dockerfilePath
      )
      return {
        ...state,
        screen: 'running',
        sessionConfig,
        runState: { phase: 'creating-worktree', output: [], toolCalls: [] },
      }
    }

    case 'UPDATE_RUN': {
      if (!state.runState) return state
      const prevRun = state.runState
      const patch = action.patch

      let toolCalls = prevRun.toolCalls
      if (patch.toolCalls !== undefined) {
        const updated = [...toolCalls]
        for (const tc of patch.toolCalls) {
          const idx = updated.findIndex((t) => t.id === tc.id)
          if (idx >= 0) updated[idx] = { ...updated[idx], ...tc }
          else updated.push(tc)
        }
        toolCalls = updated
      }

      let output = prevRun.output
      if (patch.output !== undefined && patch.output.length > 0) {
        output = [...prevRun.output, ...patch.output]
      }

      return {
        ...state,
        runState: {
          ...prevRun,
          ...patch,
          toolCalls,
          output,
          // partialLine: use patch value if present, keep prev otherwise
          partialLine: 'partialLine' in patch ? patch.partialLine : prevRun.partialLine,
        },
      }
    }

    case 'COMPLETE':
      return {
        ...state,
        screen: 'done',
        prUrl: action.prUrl,
        sessionConfig: state.sessionConfig
          ? { ...state.sessionConfig, prUrl: action.prUrl }
          : state.sessionConfig,
      }

    case 'ERROR':
      return {
        ...state,
        screen: 'done',
        error: action.message,
        runState: state.runState
          ? { ...state.runState, error: action.message }
          : state.runState,
      }

    case 'BACK': {
      switch (state.screen) {
        case 'agent-picker': return { ...state, screen: 'skill-picker' }
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
  }
}

interface Props {
  repoPath: string
}

export function App({ repoPath }: Props) {
  const [state, dispatch] = useReducer(reducer, repoPath, initState)
  const abortRef = useRef<AbortController | null>(null)
  // completed lines waiting to be flushed to state
  const completedBuffer = useRef<string[]>([])
  // current line being built (no newline yet)
  const partialLineRef = useRef('')
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function flushOutput() {
    const lines = completedBuffer.current.splice(0)
    const partial = partialLineRef.current || undefined
    if (lines.length > 0 || partial !== undefined) {
      dispatch({ type: 'UPDATE_RUN', patch: { output: lines, partialLine: partial } })
    }
  }

  function queueOutput(text: string) {
    if (!text) return
    const combined = partialLineRef.current + text
    const parts = combined.split('\n')
    // last part is the new partial (may be '')
    partialLineRef.current = parts[parts.length - 1]
    // everything before the last part is complete lines
    completedBuffer.current.push(...parts.slice(0, -1))

    if (!flushTimer.current) {
      flushTimer.current = setTimeout(() => {
        flushOutput()
        flushTimer.current = null
      }, 50)
    }
  }

  // Run the full orchestration once the screen transitions to 'running'
  const hasStartedRun = useRef(false)
  useEffect(() => {
    if (state.screen !== 'running' || !state.sessionConfig || hasStartedRun.current) return
    hasStartedRun.current = true

    const ctrl = new AbortController()
    abortRef.current = ctrl

    async function run() {
      // config is a mutable local copy so we can set worktreePath
      const config = { ...state.sessionConfig! }

      try {
        // Step 1: Create worktree
        dispatch({ type: 'UPDATE_RUN', patch: { phase: 'creating-worktree' } })
        const worktreePath = await GitService.createWorktree(
          config.repoPath,
          config.worktreeName,
          config.branchName,
          true
        )
        config.worktreePath = worktreePath
        queueOutput(`Worktree created: ${worktreePath}`)

        // Step 2: Build Docker image if needed
        if (config.useDocker && config.dockerfilePath) {
          dispatch({ type: 'UPDATE_RUN', patch: { phase: 'building-docker' } })
          const builder = new DockerImageBuilder()
          builder.on('progress', (text: string) => queueOutput(text))
          const tag = `skillrunner-${config.repoName}:latest`
          const result = await builder.ensureImage(tag, config.dockerfilePath, config.repoPath)
          if (!result.success) throw new Error(`Docker build failed: ${result.error}`)
          if (result.built) queueOutput(`Docker image ${tag} built successfully`)
        }

        // Step 3: Run agent via ACP
        dispatch({ type: 'UPDATE_RUN', patch: { phase: 'starting-agent' } })
        const runner = new AgentRunner()
        await runner.run(
          config,
          (update) => {
            if (update.type === 'output' && update.text) {
              queueOutput(update.text)
            } else if (update.type === 'tool-start' && update.toolCall) {
              dispatch({ type: 'UPDATE_RUN', patch: { phase: 'running', toolCalls: [update.toolCall] } })
            } else if ((update.type === 'tool-done' || update.type === 'tool-error') && update.toolCall) {
              dispatch({ type: 'UPDATE_RUN', patch: { toolCalls: [update.toolCall] } })
            }
          },
          ctrl.signal
        )
        flushOutput()

        // Step 4: Stage + commit
        dispatch({ type: 'UPDATE_RUN', patch: { phase: 'committing' } })
        await GitService.stageAll(worktreePath)
        try {
          await GitService.commit(
            worktreePath,
            `skillrunner: ${config.skill.name} via ${config.agent.label} (${config.model.id})`
          )
        } catch (err) {
          // Nothing to commit is OK
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes('nothing to commit')) throw err
          queueOutput('No changes to commit')
        }

        // Step 5: Push
        dispatch({ type: 'UPDATE_RUN', patch: { phase: 'pushing' } })
        try {
          await GitService.push(worktreePath, config.branchName)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!msg.includes('nothing to commit')) {
            queueOutput(`Push warning: ${msg}`)
          }
        }

        // Step 6: Create PR
        let prUrl: string | undefined
        const ghAvailable = await GithubService.isGhAvailable()
        const isGithub = await GithubService.isGithubRepo(config.repoPath)

        if (ghAvailable && isGithub) {
          dispatch({ type: 'UPDATE_RUN', patch: { phase: 'creating-pr' } })
          prUrl = await GithubService.createPr(
            config.repoPath,
            config.branchName,
            `skillrunner: ${config.skill.name}`,
            [
              'Automated run via skillrunner',
              '',
              `- Skill: ${config.skill.name}`,
              `- Agent: ${config.agent.label}`,
              `- Model: ${config.model.id}`,
            ].join('\n')
          )
        } else {
          queueOutput('Skipping PR creation (gh not available or not a GitHub repo)')
        }

        // Step 7: Remove worktree
        dispatch({ type: 'UPDATE_RUN', patch: { phase: 'removing-worktree' } })
        await GitService.removeWorktree(config.repoPath, worktreePath)

        flushOutput()
        dispatch({ type: 'COMPLETE', prUrl })
      } catch (err) {
        if (ctrl.signal.aborted) return
        flushOutput()
        dispatch({ type: 'ERROR', message: err instanceof Error ? err.message : String(err) })
      }
    }

    run()

    return () => {
      ctrl.abort()
      if (flushTimer.current) {
        clearTimeout(flushTimer.current)
        flushTimer.current = null
      }
    }
  }, [state.screen])

  function handleCancel() {
    abortRef.current?.abort()
    dispatch({ type: 'ERROR', message: 'Cancelled by user' })
  }

  // Build a preview config for ConfigReview before CONFIRM
  function buildPreviewConfig(): SessionConfig | null {
    if (!state.skill || !state.agent || !state.model) return null
    const dockerfilePath = detectDockerTemplate(state.repoPath)
    return buildSessionConfig(
      state.repoPath,
      state.skill,
      state.agent,
      state.model,
      false,
      dockerfilePath
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
          onConfirm={(useDocker) =>
            dispatch({
              type: 'CONFIRM',
              useDocker,
              dockerfilePath: previewConfig.dockerfilePath,
            })
          }
          onBack={() => dispatch({ type: 'BACK' })}
        />
      ) : null
    }

    case 'running':
      return state.runState ? (
        <Running runState={state.runState} onCancel={handleCancel} />
      ) : null

    case 'done':
      return state.sessionConfig ? (
        <Done
          config={state.sessionConfig}
          prUrl={state.prUrl}
          error={state.error}
        />
      ) : (
        <Text color="red">{state.error ?? 'Unknown error'}</Text>
      )

    default:
      return <Text>Unknown screen</Text>
  }
}

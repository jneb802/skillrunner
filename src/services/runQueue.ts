import { randomUUID } from 'crypto'
import type { SessionConfig, QueuedRun, QueueSnapshot, RunStore, RunState, PipelineStepState } from '../types.js'
import { GitService } from './gitService.js'
import { GithubService } from './githubService.js'
import { DockerImageBuilder } from './dockerService.js'
import { AgentRunner, type AgentUpdate } from './agentService.js'

class NoOpRunStore implements RunStore {
  async load(): Promise<QueuedRun[]> { return [] }
  async save(_runs: QueuedRun[]): Promise<void> {}
}

interface RunOutputBuffer {
  completedLines: string[]
  partialLine: string
  flushTimer: ReturnType<typeof setTimeout> | null
  stepIndex?: number
}

interface RunQueueOptions {
  concurrency?: number
  store?: RunStore
  onStateChange: (snapshot: QueueSnapshot) => void
}

export class RunQueue {
  private concurrency: number
  private runs: Map<string, QueuedRun>
  private activeControllers: Map<string, AbortController>
  private outputBuffers: Map<string, RunOutputBuffer>
  private store: RunStore
  private onStateChange: (snapshot: QueueSnapshot) => void
  private cachedSnapshot: QueueSnapshot | null = null
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  constructor(opts: RunQueueOptions) {
    this.concurrency = opts.concurrency ?? 1
    this.runs = new Map()
    this.activeControllers = new Map()
    this.outputBuffers = new Map()
    this.store = opts.store ?? new NoOpRunStore()
    this.onStateChange = opts.onStateChange
  }

  enqueue(sessionConfig: SessionConfig): string {
    const id = randomUUID()
    const run: QueuedRun = {
      id,
      sessionConfig,
      status: 'pending',
      runState: { phase: 'creating-worktree', output: [], toolCalls: [] },
      enqueuedAt: Date.now(),
    }
    this.runs.set(id, run)
    this.invalidateSnapshot()
    this.notifyReact()
    this.schedule()
    return id
  }

  cancel(runId: string): void {
    const run = this.runs.get(runId)
    if (!run) return

    const ctrl = this.activeControllers.get(runId)
    if (ctrl) ctrl.abort()

    if (run.status === 'pending' || run.status === 'running') {
      this.updateRun(runId, { status: 'cancelled', error: 'Cancelled by user', finishedAt: Date.now() })
    }
  }

  setConcurrency(n: number): void {
    this.concurrency = n
    this.invalidateSnapshot()
    this.notifyReact()
    this.schedule()
  }

  getSnapshot(): QueueSnapshot {
    if (this.cachedSnapshot) return this.cachedSnapshot
    const runs = Array.from(this.runs.values())
    this.cachedSnapshot = {
      runs,
      concurrency: this.concurrency,
      activeCount: this.activeControllers.size,
      pendingCount: runs.filter(r => r.status === 'pending').length,
    }
    return this.cachedSnapshot
  }

  async hydrate(): Promise<void> {
    const runs = await this.store.load()
    for (const run of runs) {
      // Mark interrupted-in-progress runs as errored
      if (run.status === 'running') {
        run.status = 'error'
        run.error = 'Run interrupted (app restarted)'
        run.finishedAt = Date.now()
      }
      this.runs.set(run.id, run)
    }
    this.invalidateSnapshot()
    this.notifyReact()
    this.schedule()
  }

  destroy(): void {
    for (const ctrl of this.activeControllers.values()) ctrl.abort()
    this.activeControllers.clear()
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    for (const buf of this.outputBuffers.values()) {
      if (buf.flushTimer) clearTimeout(buf.flushTimer)
    }
    this.outputBuffers.clear()
  }

  private schedule(): void {
    while (this.activeControllers.size < this.concurrency) {
      const next = this.findNextPending()
      if (!next) break
      this.startRun(next)
    }
  }

  private findNextPending(): QueuedRun | undefined {
    for (const run of this.runs.values()) {
      if (run.status === 'pending') return run
    }
    return undefined
  }

  private startRun(run: QueuedRun): void {
    const runId = run.id
    const ctrl = new AbortController()
    this.activeControllers.set(runId, ctrl)

    const buffer: RunOutputBuffer = { completedLines: [], partialLine: '', flushTimer: null }
    this.outputBuffers.set(runId, buffer)

    this.updateRun(runId, { status: 'running', startedAt: Date.now() })

    this.executeRun(runId, ctrl).finally(() => {
      this.activeControllers.delete(runId)
      const buf = this.outputBuffers.get(runId)
      if (buf?.flushTimer) clearTimeout(buf.flushTimer)
      this.outputBuffers.delete(runId)
      this.schedule()
    })
  }

  private makeAgentCallback(runId: string, stepIndex?: number) {
    return (update: AgentUpdate) => {
      if (update.type === 'output' && update.text) {
        this.queueOutput(runId, update.text, stepIndex)
      } else if (update.type === 'tool-start' && update.toolCall) {
        if (stepIndex !== undefined) {
          this.updateStep(runId, stepIndex, { toolCalls: [update.toolCall] })
        } else {
          this.updateRunState(runId, { phase: 'running', toolCalls: [update.toolCall] })
        }
      } else if ((update.type === 'tool-done' || update.type === 'tool-error') && update.toolCall) {
        if (stepIndex !== undefined) {
          this.updateStep(runId, stepIndex, { toolCalls: [update.toolCall] })
        } else {
          this.updateRunState(runId, { toolCalls: [update.toolCall] })
        }
      }
    }
  }

  private async executeNoWorktreeRun(runId: string, config: SessionConfig, ctrl: AbortController): Promise<void> {
    this.updateRunPhase(runId, 'starting-agent')

    const steps =
      config.skill.pipelineSteps && config.skill.pipelineSteps.length > 0
        ? config.skill.pipelineSteps
        : [config.skill]

    const isPipeline = steps.length > 1

    if (isPipeline) {
      this.updateRunState(runId, {
        steps: steps.map((s) => ({
          name: s.name,
          output: [],
          toolCalls: [],
          status: 'pending' as const,
        })),
        currentStepIndex: 0,
      })
    }

    for (let i = 0; i < steps.length; i++) {
      if (ctrl.signal.aborted) return

      const step = steps[i]

      if (isPipeline) {
        this.updateStep(runId, i, { status: 'running' })
        this.updateRunState(runId, { currentStepIndex: i, phase: 'running' })
      }

      const stepConfig: SessionConfig = { ...config, skill: step }
      const runner = new AgentRunner()
      await runner.run(stepConfig, this.makeAgentCallback(runId, isPipeline ? i : undefined), ctrl.signal)
      this.flushOutput(runId)

      if (isPipeline) {
        this.updateStep(runId, i, {
          status: ctrl.signal.aborted ? 'error' : 'done',
          partialLine: undefined,
        })
      }

      if (ctrl.signal.aborted) return
    }

    if (!ctrl.signal.aborted) {
      this.updateRun(runId, { status: 'done', finishedAt: Date.now() })
    }
  }

  private async executeRun(runId: string, ctrl: AbortController): Promise<void> {
    const run = this.runs.get(runId)!
    const config = { ...run.sessionConfig }

    try {
      // No-worktree mode: run agent(s) directly in repoPath, skip all git steps
      if (config.noWorktree) {
        await this.executeNoWorktreeRun(runId, config, ctrl)
        return
      }

      // Step 1: Create worktree
      this.updateRunPhase(runId, 'creating-worktree')
      const worktreePath = await GitService.createWorktree(
        config.repoPath,
        config.worktreeName,
        config.branchName,
        true
      )
      config.worktreePath = worktreePath
      this.queueOutput(runId, `Worktree created: ${worktreePath}`)

      // Step 2: Build Docker image if needed
      if (config.useDocker && config.dockerfilePath) {
        this.updateRunPhase(runId, 'building-docker')
        const builder = new DockerImageBuilder()
        builder.on('progress', (text: string) => this.queueOutput(runId, text))
        const tag = `skillrunner-${config.repoName}:latest`
        const result = await builder.ensureImage(tag, config.dockerfilePath, config.repoPath)
        if (!result.success) throw new Error(`Docker build failed: ${result.error}`)
        if (result.built) this.queueOutput(runId, `Docker image ${tag} built successfully`)
      }

      // Step 3: Run agent via ACP
      this.updateRunPhase(runId, 'starting-agent')
      const runner = new AgentRunner()
      await runner.run(config, this.makeAgentCallback(runId), ctrl.signal)
      this.flushOutput(runId)

      // Step 4: Stage + commit
      this.updateRunPhase(runId, 'committing')
      await GitService.stageAll(worktreePath)
      try {
        await GitService.commit(
          worktreePath,
          `skillrunner: ${config.skill.name} via ${config.agent.label} (${config.model.id})`
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes('nothing to commit')) throw err
        this.queueOutput(runId, 'No changes to commit')
      }

      // Step 5: Push
      this.updateRunPhase(runId, 'pushing')
      try {
        await GitService.push(worktreePath, config.branchName)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes('nothing to commit')) {
          this.queueOutput(runId, `Push warning: ${msg}`)
        }
      }

      // Step 6: Create PR
      let prUrl: string | undefined
      const ghAvailable = await GithubService.isGhAvailable()
      const isGithub = await GithubService.isGithubRepo(config.repoPath)
      if (ghAvailable && isGithub) {
        this.updateRunPhase(runId, 'creating-pr')
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
        this.queueOutput(runId, 'Skipping PR creation (gh not available or not a GitHub repo)')
      }

      // Step 7: Remove worktree
      this.updateRunPhase(runId, 'removing-worktree')
      await GitService.removeWorktree(config.repoPath, worktreePath)

      this.flushOutput(runId)

      // Guard: don't overwrite a cancelled status
      if (!ctrl.signal.aborted) {
        this.updateRun(runId, { status: 'done', prUrl, finishedAt: Date.now() })
      }
    } catch (err) {
      if (ctrl.signal.aborted) return
      this.flushOutput(runId)
      let message: string
      if (err instanceof Error) {
        message = err.message
      } else if (err && typeof err === 'object') {
        const o = err as Record<string, unknown>
        message = typeof o['message'] === 'string' ? o['message'] : JSON.stringify(err)
      } else {
        message = String(err)
      }
      this.updateRun(runId, { status: 'error', error: message, finishedAt: Date.now() })
    }
  }

  private updateRunPhase(runId: string, phase: RunState['phase']): void {
    this.updateRunState(runId, { phase })
  }

  // Merge a RunState patch into the run's runState (upserts toolCalls, appends output)
  private updateRunState(runId: string, patch: Partial<RunState>): void {
    const run = this.runs.get(runId)
    if (!run) return

    const prev = run.runState

    let toolCalls = prev.toolCalls
    if (patch.toolCalls !== undefined) {
      const updated = [...toolCalls]
      for (const tc of patch.toolCalls) {
        const idx = updated.findIndex((t) => t.id === tc.id)
        if (idx >= 0) updated[idx] = { ...updated[idx], ...tc }
        else updated.push(tc)
      }
      toolCalls = updated
    }

    let output = prev.output
    if (patch.output !== undefined && patch.output.length > 0) {
      output = [...prev.output, ...patch.output]
    }

    const updatedRunState: RunState = {
      ...prev,
      ...patch,
      toolCalls,
      output,
      partialLine: 'partialLine' in patch ? patch.partialLine : prev.partialLine,
    }

    this.runs.set(runId, { ...run, runState: updatedRunState })
    this.invalidateSnapshot()
    this.notifyReact()
  }

  // Update top-level QueuedRun fields (status, prUrl, error, timestamps)
  private updateRun(runId: string, patch: Partial<Omit<QueuedRun, 'id' | 'sessionConfig' | 'runState'>>): void {
    const run = this.runs.get(runId)
    if (!run) return
    this.runs.set(runId, { ...run, ...patch })
    this.invalidateSnapshot()
    this.persist()
    this.notifyReact()
  }

  private queueOutput(runId: string, text: string, stepIndex?: number): void {
    if (!text) return
    const buf = this.outputBuffers.get(runId)
    if (!buf) return

    // If routing to a different step, flush the current buffer first
    if (stepIndex !== buf.stepIndex) {
      if (buf.flushTimer) {
        clearTimeout(buf.flushTimer)
        buf.flushTimer = null
      }
      this.flushOutput(runId)
      buf.stepIndex = stepIndex
    }

    const combined = buf.partialLine + text
    const parts = combined.split('\n')
    buf.partialLine = parts[parts.length - 1]
    buf.completedLines.push(...parts.slice(0, -1))

    if (!buf.flushTimer) {
      buf.flushTimer = setTimeout(() => {
        this.flushOutput(runId)
        buf.flushTimer = null
      }, 50)
    }
  }

  private flushOutput(runId: string): void {
    const buf = this.outputBuffers.get(runId)
    if (!buf) return

    const lines = buf.completedLines.splice(0)
    const partial = buf.partialLine || undefined

    if (buf.stepIndex !== undefined) {
      if (lines.length > 0 || partial !== undefined) {
        this.updateStep(runId, buf.stepIndex, { output: lines, partialLine: partial })
      }
    } else {
      if (lines.length > 0 || partial !== undefined) {
        this.updateRunState(runId, { output: lines, partialLine: partial })
      }
    }
  }

  private updateStep(runId: string, stepIndex: number, patch: Partial<PipelineStepState>): void {
    const run = this.runs.get(runId)
    if (!run || !run.runState.steps) return

    const steps = [...run.runState.steps]
    const prev = steps[stepIndex]
    if (!prev) return

    let toolCalls = prev.toolCalls
    if (patch.toolCalls !== undefined) {
      const updated = [...toolCalls]
      for (const tc of patch.toolCalls) {
        const idx = updated.findIndex((t) => t.id === tc.id)
        if (idx >= 0) updated[idx] = { ...updated[idx], ...tc }
        else updated.push(tc)
      }
      toolCalls = updated
    }

    let output = prev.output
    if (patch.output !== undefined && patch.output.length > 0) {
      output = [...prev.output, ...patch.output]
    }

    steps[stepIndex] = {
      ...prev,
      ...patch,
      toolCalls,
      output,
      partialLine: 'partialLine' in patch ? patch.partialLine : prev.partialLine,
    }

    const updatedRunState: RunState = { ...run.runState, steps }
    this.runs.set(runId, { ...run, runState: updatedRunState })
    this.invalidateSnapshot()
    this.notifyReact()
  }

  private invalidateSnapshot(): void {
    this.cachedSnapshot = null
  }

  private notifyReact(): void {
    this.onStateChange(this.getSnapshot())
  }

  private persist(): void {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(async () => {
      this.persistTimer = null
      await this.store.save(Array.from(this.runs.values())).catch(() => {})
    }, 500)
  }
}

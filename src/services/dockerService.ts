import { spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { EventEmitter } from 'events'
import type { AgentConfig } from '../types.js'

export function detectDockerTemplate(repoPath: string): string | undefined {
  const dockerfile = join(repoPath, 'Dockerfile')
  if (existsSync(dockerfile)) return dockerfile

  const devcontainer = join(repoPath, '.devcontainer', 'devcontainer.json')
  if (existsSync(devcontainer)) {
    // Check if devcontainer has a dockerfile reference
    try {
      const content = readFileSync(devcontainer, 'utf8')
      const json = JSON.parse(content)
      if (json.dockerFile || json.build?.dockerfile) {
        const df = json.dockerFile || json.build?.dockerfile
        return join(repoPath, '.devcontainer', df)
      }
    } catch {
      // ignore
    }
  }
  return undefined
}

export class DockerImageBuilder extends EventEmitter {
  async imageExists(tag: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('docker', ['image', 'inspect', tag], { stdio: 'ignore' })
      proc.on('error', () => resolve(false))
      proc.on('close', (code) => resolve(code === 0))
    })
  }

  async buildImage(dockerfilePath: string, tag: string, context: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const buildProcess = spawn(
        'docker',
        ['build', '-t', tag, '-f', dockerfilePath, context],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      )

      let stderrOutput = ''

      buildProcess.stdout!.on('data', (data: Buffer) => {
        const output = data.toString()
        this.emit('progress', output)
      })

      buildProcess.stderr!.on('data', (data: Buffer) => {
        const output = data.toString()
        stderrOutput += output
        this.emit('progress', output)
      })

      buildProcess.on('error', reject)

      buildProcess.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          let errorMessage = `Docker build failed with exit code ${code}`
          if (stderrOutput.includes('Cannot connect to the Docker daemon')) {
            errorMessage = 'Cannot connect to Docker daemon. Please start Docker Desktop or OrbStack.'
          }
          reject(new Error(errorMessage))
        }
      })
    })
  }

  async ensureImage(
    tag: string,
    dockerfilePath: string,
    context: string
  ): Promise<{ success: boolean; error?: string; built?: boolean }> {
    try {
      const exists = await this.imageExists(tag)
      if (exists) return { success: true, built: false }

      await this.buildImage(dockerfilePath, tag, context)
      return { success: true, built: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  }
}

export interface SpawnAgentInDockerOpts {
  imageName: string
  worktreePath: string
  agent: AgentConfig
  env: Record<string, string>
}

export function spawnAgentInDocker(opts: SpawnAgentInDockerOpts) {
  const { imageName, worktreePath, agent, env } = opts

  const dockerArgs: string[] = [
    'run',
    '-i',
    '--rm',
    '-v', `${worktreePath}:/workspace`,
    '-w', '/workspace',
    '--network', 'host',
    '--add-host', 'host.docker.internal:host-gateway',
  ]

  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== '') {
      dockerArgs.push('-e', `${key}=${value}`)
    }
  }

  dockerArgs.push(imageName)
  dockerArgs.push(agent.command)
  dockerArgs.push(...agent.args)

  return spawn('docker', dockerArgs, {
    stdio: ['pipe', 'pipe', 'inherit'],
  })
}

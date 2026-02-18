import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export class GithubService {
  private static ghAvailable: boolean | null = null
  private static repoChecks = new Map<string, boolean>()

  static async isGhAvailable(): Promise<boolean> {
    if (this.ghAvailable !== null) return this.ghAvailable
    try {
      await execFileAsync('gh', ['--version'], { timeout: 5000 })
      this.ghAvailable = true
    } catch {
      this.ghAvailable = false
    }
    return this.ghAvailable
  }

  static async isGithubRepo(repoPath: string): Promise<boolean> {
    const cached = this.repoChecks.get(repoPath)
    if (cached !== undefined) return cached
    try {
      const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
        cwd: repoPath,
        timeout: 5000,
      })
      const isGh = stdout.includes('github.com')
      this.repoChecks.set(repoPath, isGh)
      return isGh
    } catch {
      this.repoChecks.set(repoPath, false)
      return false
    }
  }

  static async createPr(
    repoPath: string,
    branch: string,
    title: string,
    body: string
  ): Promise<string> {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'create', '--head', branch, '--title', title, '--body', body],
      { cwd: repoPath, timeout: 30_000 }
    )
    // gh pr create outputs the PR URL as the last line
    const lines = stdout.trim().split('\n')
    return lines[lines.length - 1].trim()
  }
}

import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { rm } from 'fs/promises'
import { promisify } from 'util'
import { basename, dirname, join, resolve } from 'path'

const execFileAsync = promisify(execFile)

export interface WorktreeInfo {
  path: string
  branch: string
  head: string
  isBare: boolean
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  })
  return stdout.trimEnd()
}

function friendlyGitError(err: unknown, fallback: string): string {
  const stderr = (err as any)?.stderr as string | undefined
  if (!stderr) return fallback

  const alreadyUsed = stderr.match(/fatal: '([^']+)' is already (?:checked out|used by worktree) at '([^']+)'/)
  if (alreadyUsed) return 'BRANCH_CHECKED_OUT'

  if (stderr.includes('invalid reference')) {
    const ref = stderr.match(/invalid reference: (.+)/)?.[1]?.trim()
    return ref ? `Branch "${ref}" not found` : 'Branch not found'
  }

  if (stderr.includes('a branch named')) return 'BRANCH_ALREADY_EXISTS'
  if (stderr.includes('already exists')) return 'WORKTREE_PATH_EXISTS'
  if (stderr.includes('not a git repository')) return 'Not a git repository'

  const fatal = stderr.match(/fatal: (.+)/)?.[1]?.trim()
  if (fatal) return fatal

  return fallback
}

export class GitService {
  static async listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
    const output = await git(['worktree', 'list', '--porcelain'], repoPath)
    if (!output) return []

    const worktrees: WorktreeInfo[] = []
    const blocks = output.split('\n\n')

    for (const block of blocks) {
      const lines = block.split('\n')
      const info: Partial<WorktreeInfo> = { isBare: false }
      for (const line of lines) {
        if (line.startsWith('worktree ')) info.path = line.slice(9)
        else if (line.startsWith('HEAD ')) info.head = line.slice(5)
        else if (line.startsWith('branch ')) info.branch = line.slice(7).replace('refs/heads/', '')
        else if (line === 'bare') info.isBare = true
      }
      if (info.path) {
        worktrees.push(info as WorktreeInfo)
      }
    }
    return worktrees
  }

  static async createWorktree(
    repoPath: string,
    name: string,
    branch: string,
    newBranch: boolean,
    force = false
  ): Promise<string> {
    const parentDir = dirname(repoPath)
    const repoName = basename(repoPath)
    const worktreePath = resolve(parentDir, `${repoName}-ws-${name}`)

    await git(['worktree', 'prune'], repoPath).catch(() => {})

    if (existsSync(worktreePath)) {
      if (!force) {
        throw new Error('WORKTREE_PATH_EXISTS')
      }
      await rm(worktreePath, { recursive: true, force: true })
    }

    const branchExists = await git(['rev-parse', '--verify', `refs/heads/${branch}`], repoPath)
      .then(() => true, () => false)

    const args = ['worktree', 'add']
    if (force) args.push('--force')
    if (newBranch && !branchExists) {
      args.push('-b', branch)
    }
    args.push(worktreePath)
    if (!newBranch || branchExists) {
      args.push(branch)
    }

    try {
      await git(args, repoPath)
    } catch (err) {
      const msg = friendlyGitError(err, 'Failed to create worktree')
      if (msg === 'BRANCH_CHECKED_OUT' && !force) throw new Error(msg)
      throw new Error(msg)
    }
    return worktreePath
  }

  static async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    try {
      await git(['worktree', 'remove', worktreePath, '--force'], repoPath)
    } catch (err) {
      throw new Error(friendlyGitError(err, 'Failed to remove worktree'))
    }
  }

  static async getTopLevel(cwd: string): Promise<string> {
    return git(['rev-parse', '--show-toplevel'], cwd)
  }

  static async getCurrentBranch(worktreePath: string): Promise<string> {
    return git(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath)
  }

  static async stageAll(worktreePath: string): Promise<void> {
    await git(['add', '-A'], worktreePath)
  }

  static async commit(worktreePath: string, message: string): Promise<void> {
    await git(['commit', '-m', message], worktreePath)
  }

  static async push(worktreePath: string, branch: string): Promise<void> {
    await git(['push', '-u', 'origin', branch], worktreePath)
  }

  static async getRepoName(repoPath: string): Promise<string> {
    return basename(repoPath)
  }
}

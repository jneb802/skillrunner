import { readdir, readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { join, basename, dirname } from 'path'
import { homedir } from 'os'
import { parse as parseYaml } from 'yaml'
import type { Skill } from '../types.js'

const REPO_SKILL_DIRS = ['.claude/skills', '.agents/skills', '.codex/skills']

function getGlobalSkillDirs(): string[] {
  return [join(homedir(), '.claude', 'commands')]
}

interface ParsedSkill {
  skill: Skill
  pipelineRefs?: string[]
}

async function parseSkillFile(filePath: string, dirPath: string): Promise<ParsedSkill | null> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    return null
  }

  // Parse YAML frontmatter (---\n...\n---\n body)
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!frontmatterMatch) {
    // No frontmatter — treat whole file as body with filename as name
    const name = basename(filePath).replace(/\.(md|txt|yaml|yml)$/, '')
    return {
      skill: {
        name,
        description: '',
        allowedTools: [],
        skillPath: filePath,
        dirPath,
        body: raw.trim(),
        raw,
      },
    }
  }

  let frontmatter: Record<string, unknown> = {}
  try {
    frontmatter = parseYaml(frontmatterMatch[1]) ?? {}
  } catch {
    frontmatter = {}
  }

  const name = (frontmatter['name'] as string) || basename(filePath).replace(/\.(md|txt|yaml|yml)$/, '')
  const description = (frontmatter['description'] as string) || ''
  const allowedTools = (frontmatter['allowed-tools'] as string[]) ||
    (frontmatter['allowedTools'] as string[]) || []
  const body = frontmatterMatch[2].trim()
  const noWorktree = !!(frontmatter['no-worktree'] ?? frontmatter['noWorktree']) || undefined
  const argumentPrompt =
    (frontmatter['argument-prompt'] as string | undefined) ||
    (frontmatter['argumentPrompt'] as string | undefined) ||
    undefined
  const skillType = (frontmatter['type'] as string) || ''

  const skill: Skill = {
    name,
    description,
    allowedTools,
    skillPath: filePath,
    dirPath,
    body,
    raw,
    noWorktree: noWorktree || undefined,
    argumentPrompt,
  }

  if (skillType === 'pipeline') {
    const refs = (frontmatter['skills'] as string[]) ?? []
    return { skill, pipelineRefs: refs }
  }

  return { skill }
}

async function parseSkillDir(dirPath: string, parentDir: string): Promise<ParsedSkill | null> {
  const skillMdPath = join(dirPath, 'SKILL.md')
  if (!existsSync(skillMdPath)) return null
  return parseSkillFile(skillMdPath, parentDir)
}

async function scanDir(skillDir: string): Promise<ParsedSkill[]> {
  if (!existsSync(skillDir)) return []

  let entries: string[]
  try {
    entries = await readdir(skillDir)
  } catch {
    return []
  }

  const parsed: ParsedSkill[] = []
  for (const entry of entries) {
    const fullPath = join(skillDir, entry)
    let s: import('fs').Stats
    try {
      s = await stat(fullPath)
    } catch {
      continue
    }

    if (s.isDirectory()) {
      const result = await parseSkillDir(fullPath, skillDir)
      if (result) parsed.push(result)
    } else if (entry.match(/\.(md|txt|yaml|yml)$/)) {
      const result = await parseSkillFile(fullPath, skillDir)
      if (result) parsed.push(result)
    }
  }
  return parsed
}

async function resolveSkillRef(ref: string, lookup: Map<string, Skill>): Promise<Skill | null> {
  // Absolute path — load directly
  if (ref.startsWith('/')) {
    const parsed = await parseSkillFile(ref, dirname(ref))
    return parsed?.skill ?? null
  }
  // Name lookup (case-insensitive)
  const lower = ref.toLowerCase()
  for (const [, skill] of lookup) {
    if (skill.name.toLowerCase() === lower) return skill
  }
  return null
}

export async function scanSkills(repoPath: string): Promise<Skill[]> {
  const repoDirs = REPO_SKILL_DIRS.map((d) => join(repoPath, d))
  const globalDirs = getGlobalSkillDirs()
  const allDirs = [...repoDirs, ...globalDirs]

  const results = await Promise.all(allDirs.map(scanDir))
  const allParsed = results.flat()

  // Build lookup by skillPath and by lowercase name for pipeline resolution
  const lookup = new Map<string, Skill>()
  for (const { skill } of allParsed) {
    lookup.set(skill.skillPath, skill)
    lookup.set(skill.name.toLowerCase(), skill)
  }

  // Resolve pipeline refs in a second pass
  const skills: Skill[] = []
  for (const { skill, pipelineRefs } of allParsed) {
    if (pipelineRefs && pipelineRefs.length > 0) {
      const steps = await Promise.all(pipelineRefs.map((ref) => resolveSkillRef(ref, lookup)))
      skill.pipelineSteps = steps.filter(Boolean) as Skill[]
    }
    skills.push(skill)
  }

  return skills
}

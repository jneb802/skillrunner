import { readdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, basename } from 'path'
import { parse as parseYaml } from 'yaml'
import type { Skill } from '../types.js'

const SKILL_DIRS = ['.claude/skills', '.agents/skills', '.codex/skills']

async function parseSkillFile(filePath: string, dirPath: string): Promise<Skill | null> {
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
      name,
      description: '',
      allowedTools: [],
      skillPath: filePath,
      dirPath,
      body: raw.trim(),
      raw,
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

  return {
    name,
    description,
    allowedTools,
    skillPath: filePath,
    dirPath,
    body,
    raw,
  }
}

async function scanDir(skillDir: string): Promise<Skill[]> {
  if (!existsSync(skillDir)) return []

  let entries: string[]
  try {
    entries = await readdir(skillDir)
  } catch {
    return []
  }

  const skills: Skill[] = []
  for (const entry of entries) {
    if (!entry.match(/\.(md|txt|yaml|yml)$/)) continue
    const filePath = join(skillDir, entry)
    const skill = await parseSkillFile(filePath, skillDir)
    if (skill) skills.push(skill)
  }
  return skills
}

export async function scanSkills(repoPath: string): Promise<Skill[]> {
  const results = await Promise.all(
    SKILL_DIRS.map((dir) => scanDir(join(repoPath, dir)))
  )
  return results.flat()
}

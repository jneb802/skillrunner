import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { parse, stringify } from 'yaml'

export interface OpenRouterModelConfig {
  id: string
  name: string
}

export interface SkillrunnerConfig {
  openrouter?: {
    api_key?: string
    models?: OpenRouterModelConfig[]
  }
}

const CONFIG_DIR = join(homedir(), '.config', 'skillrunner')
const CONFIG_PATH = join(CONFIG_DIR, 'config.yaml')

export function configExists(): boolean {
  return existsSync(CONFIG_PATH)
}

export async function loadConfig(): Promise<SkillrunnerConfig> {
  if (!existsSync(CONFIG_PATH)) return {}
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8')
    return parse(raw) ?? {}
  } catch {
    return {}
  }
}

export async function saveConfig(config: SkillrunnerConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(CONFIG_PATH, stringify(config), 'utf8')
}

export function getConfigPath(): string {
  return CONFIG_PATH
}

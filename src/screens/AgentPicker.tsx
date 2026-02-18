import React from 'react'
import { Box, Text } from 'ink'
import { Select } from '@inkjs/ui'
import type { AgentConfig } from '../types.js'

interface Props {
  onSelect: (agent: AgentConfig) => void
  onBack: () => void
}

function hasKey(envVar: string): boolean {
  return !!process.env[envVar]
}

const AGENTS: AgentConfig[] = [
  { kind: 'claude', label: 'Claude Code', command: 'claude-code-acp', args: [] },
  { kind: 'gemini', label: 'Gemini CLI', command: 'gemini', args: ['--experimental-acp'] },
  { kind: 'goose', label: 'Goose', command: 'goose', args: ['acp'] },
  { kind: 'opencode', label: 'OpenCode', command: 'opencode', args: ['acp'] },
]

export function AgentPicker({ onSelect, onBack: _onBack }: Props) {
  const options = AGENTS.map((agent) => {
    const keyDetected =
      agent.kind === 'claude' ? hasKey('ANTHROPIC_API_KEY') :
      agent.kind === 'gemini' ? hasKey('GEMINI_API_KEY') :
      false
    return {
      label: `${agent.label}${keyDetected ? ' ✓' : ''}`,
      value: agent.kind,
    }
  })

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Select an agent</Text>
      <Text dimColor>✓ = API key detected in environment</Text>
      <Select
        options={options}
        onChange={(value) => {
          const agent = AGENTS.find((a) => a.kind === value)
          if (agent) onSelect(agent)
        }}
      />
      <Text dimColor>Press Escape to go back</Text>
    </Box>
  )
}

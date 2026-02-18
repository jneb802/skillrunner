import React from 'react'
import { Box, Text, useInput } from 'ink'
import type { RunState } from '../types.js'

const PHASE_LABELS: Record<string, string> = {
  'creating-worktree': 'Creating worktree...',
  'building-docker': 'Building Docker image...',
  'starting-agent': 'Starting agent...',
  'running': 'Agent running...',
  'committing': 'Committing changes...',
  'pushing': 'Pushing branch...',
  'creating-pr': 'Creating pull request...',
  'removing-worktree': 'Cleaning up worktree...',
  'done': 'Done!',
}

interface Props {
  runState: RunState
  onCancel: () => void
}

export function Running({ runState, onCancel }: Props) {
  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      onCancel()
    }
  })

  const lastLines = runState.output.slice(-20)
  const activeTools = runState.toolCalls.filter((t) => t.status === 'running')

  return (
    <Box flexDirection="column" gap={1}>
      <Box>
        <Text color="cyan" bold>⟳ </Text>
        <Text bold>{PHASE_LABELS[runState.phase] ?? runState.phase}</Text>
      </Box>

      {runState.error && (
        <Box borderStyle="round" borderColor="red" paddingX={1}>
          <Text color="red">{runState.error}</Text>
        </Box>
      )}

      {lastLines.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor bold>Output (last 20 lines):</Text>
          <Box
            flexDirection="column"
            borderStyle="single"
            borderColor="gray"
            paddingX={1}
          >
            {lastLines.map((line, i) => (
              <Text key={i} wrap="truncate-end">{line}</Text>
            ))}
          </Box>
        </Box>
      )}

      {activeTools.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor bold>Active tool calls:</Text>
          {activeTools.map((tool) => (
            <Box key={tool.id}>
              <Text color="yellow">  ⟳ {tool.name}</Text>
            </Box>
          ))}
        </Box>
      )}

      <Text dimColor>Press Ctrl+C to cancel</Text>
    </Box>
  )
}

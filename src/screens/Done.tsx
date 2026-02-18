import React from 'react'
import { Box, Text } from 'ink'
import type { SessionConfig } from '../types.js'

interface Props {
  config: SessionConfig
  prUrl?: string
  error?: string
}

export function Done({ config, prUrl, error }: Props) {
  return (
    <Box flexDirection="column" gap={1}>
      {error ? (
        <>
          <Text bold color="red">✗ Run failed</Text>
          <Box borderStyle="round" borderColor="red" paddingX={1}>
            <Text color="red">{error}</Text>
          </Box>
        </>
      ) : (
        <>
          <Text bold color="green">✓ Done!</Text>
          {prUrl && (
            <Box flexDirection="column">
              <Text bold>Pull Request:</Text>
              <Text color="cyan" underline>{prUrl}</Text>
            </Box>
          )}
        </>
      )}
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text dimColor>Skill:  <Text color="white">{config.skill.name}</Text></Text>
        <Text dimColor>Agent:  <Text color="white">{config.agent.label}</Text></Text>
        <Text dimColor>Model:  <Text color="white">{config.model.name}</Text></Text>
        <Text dimColor>Branch: <Text color="white">{config.branchName}</Text></Text>
      </Box>
      <Text dimColor>Press Ctrl+C to exit</Text>
    </Box>
  )
}

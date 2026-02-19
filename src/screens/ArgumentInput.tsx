import React from 'react'
import { Box, Text, useInput } from 'ink'
import { TextInput } from '@inkjs/ui'
import type { Skill } from '../types.js'

interface Props {
  skill: Skill
  onSubmit: (argument: string) => void
  onBack: () => void
}

export function ArgumentInput({ skill, onSubmit, onBack }: Props) {
  useInput((_input, key) => {
    if (key.escape) onBack()
  })

  const prompt = skill.argumentPrompt ?? 'Enter argument'
  const stepCount = skill.pipelineSteps?.length

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="cyan">{prompt}</Text>
      <Box flexDirection="column">
        <Text dimColor>Skill: {skill.name}</Text>
        {stepCount !== undefined && (
          <Text dimColor>Steps: {skill.pipelineSteps!.map((s) => s.name).join(' → ')}</Text>
        )}
      </Box>
      <TextInput placeholder="" onSubmit={(value) => onSubmit(value.trim())} />
      <Text dimColor>Press Esc to go back</Text>
    </Box>
  )
}

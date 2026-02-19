import React from 'react'
import { Box, Text, useInput } from 'ink'
import type { RunState, PipelineStepState } from '../types.js'

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

function StepBox({
  step,
  isCurrent,
  index,
  total,
}: {
  step: PipelineStepState
  isCurrent: boolean
  index: number
  total: number
}) {
  const maxLines = isCurrent ? 15 : step.status === 'done' ? 4 : 0
  const displayLines = [
    ...step.output,
    ...(step.partialLine ? [step.partialLine] : []),
  ].slice(-maxLines)

  const activeTools = step.toolCalls.filter((t) => t.status === 'running')

  const statusIcon =
    step.status === 'done' ? '✓' :
    step.status === 'error' ? '✗' :
    step.status === 'running' ? '⟳' : '○'

  const statusColor =
    step.status === 'done' ? 'green' :
    step.status === 'error' ? 'red' :
    step.status === 'running' ? 'cyan' : 'gray'

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color={statusColor} bold>{statusIcon}</Text>
        <Text bold={isCurrent} dimColor={step.status === 'pending'}>
          [{index + 1}/{total}] {step.name}
        </Text>
      </Box>
      {displayLines.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={isCurrent ? 'cyan' : 'gray'}
          paddingX={1}
        >
          {displayLines.map((line, i) => (
            <Text key={i} wrap="truncate-end" dimColor={!isCurrent}>{line}</Text>
          ))}
        </Box>
      )}
      {isCurrent && activeTools.length > 0 && (
        <Box flexDirection="column">
          {activeTools.map((tool) => (
            <Box key={tool.id}>
              <Text color="yellow">  ⟳ {tool.name}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
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

  // Pipeline view
  if (runState.steps && runState.steps.length > 0) {
    const total = runState.steps.length
    const current = runState.currentStepIndex ?? 0

    return (
      <Box flexDirection="column" gap={1}>
        <Box>
          <Text color="cyan" bold>⟳ </Text>
          <Text bold>{PHASE_LABELS[runState.phase] ?? runState.phase}</Text>
        </Box>
        {runState.steps.map((step, i) => (
          <StepBox
            key={i}
            step={step}
            isCurrent={i === current && step.status === 'running'}
            index={i}
            total={total}
          />
        ))}
        <Text dimColor>Press Ctrl+C to cancel</Text>
      </Box>
    )
  }

  // Single skill view
  const displayLines = [
    ...runState.output,
    ...(runState.partialLine ? [runState.partialLine] : []),
  ].slice(-20)
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

      {displayLines.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor bold>Output (last 20 lines):</Text>
          <Box
            flexDirection="column"
            borderStyle="single"
            borderColor="gray"
            paddingX={1}
          >
            {displayLines.map((line, i) => (
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

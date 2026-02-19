import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { ConfirmInput } from '@inkjs/ui'
import type { SessionConfig } from '../types.js'

interface Props {
  config: SessionConfig
  onConfirm: (useDocker: boolean) => void
  onBack: () => void
}

export function ConfigReview({ config, onConfirm, onBack }: Props) {
  const [dockerStep, setDockerStep] = useState(!config.noWorktree && !!config.dockerfilePath)
  const [useDocker, setUseDocker] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  useInput((input, key) => {
    if (key.escape) onBack()
  })

  if (dockerStep && !confirmed) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold color="cyan">Docker detected</Text>
        <Text>Dockerfile found at: <Text color="yellow">{config.dockerfilePath}</Text></Text>
        <Text>Run the agent inside a Docker container?</Text>
        <ConfirmInput
          defaultChoice="confirm"
          onConfirm={() => {
            setUseDocker(true)
            setDockerStep(false)
            setConfirmed(false)
          }}
          onCancel={() => {
            setUseDocker(false)
            setDockerStep(false)
            setConfirmed(false)
          }}
        />
      </Box>
    )
  }

  if (!confirmed) {
    const stepCount = config.skill.pipelineSteps?.length

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold color="cyan">Configuration review</Text>
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Box>
            <Text bold dimColor>Skill:      </Text>
            <Text color="green">{config.skill.name}</Text>
            {stepCount !== undefined && (
              <Text dimColor> ({stepCount} steps)</Text>
            )}
          </Box>
          {config.argument !== undefined && (
            <Box>
              <Text bold dimColor>Argument:   </Text>
              <Text color="yellow">{config.argument || '(empty)'}</Text>
            </Box>
          )}
          <Box>
            <Text bold dimColor>Agent:      </Text>
            <Text color="green">{config.agent.label}</Text>
          </Box>
          <Box>
            <Text bold dimColor>Model:      </Text>
            <Text color="green">{config.model.name}</Text>
          </Box>
          <Box>
            <Text bold dimColor>Repo:       </Text>
            <Text color="green">{config.repoName}</Text>
          </Box>
          {!config.noWorktree && (
            <>
              <Box>
                <Text bold dimColor>Branch:     </Text>
                <Text color="yellow">{config.branchName}</Text>
              </Box>
              <Box>
                <Text bold dimColor>Worktree:   </Text>
                <Text color="yellow">{config.worktreeName}</Text>
              </Box>
              <Box>
                <Text bold dimColor>Docker:     </Text>
                <Text color={useDocker ? 'green' : 'red'}>{useDocker ? 'yes' : 'no'}</Text>
              </Box>
            </>
          )}
          {config.noWorktree && (
            <Box>
              <Text bold dimColor>Mode:       </Text>
              <Text color="cyan">in-place (no worktree)</Text>
            </Box>
          )}
        </Box>
        <Text>Proceed with these settings?</Text>
        <ConfirmInput
          defaultChoice="confirm"
          onConfirm={() => onConfirm(useDocker)}
          onCancel={onBack}
        />
      </Box>
    )
  }

  return null
}

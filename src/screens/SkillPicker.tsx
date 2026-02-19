import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { Select } from '@inkjs/ui'
import { scanSkills } from '../services/skillScanner.js'
import type { Skill } from '../types.js'

interface Props {
  repoPath: string
  onSelect: (skill: Skill) => void
  onConfigure: () => void
}

export function SkillPicker({ repoPath, onSelect, onConfigure }: Props) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    scanSkills(repoPath)
      .then((found) => {
        setSkills(found)
        setLoading(false)
      })
      .catch((err) => {
        setError(String(err))
        setLoading(false)
      })
  }, [repoPath])

  if (loading) {
    return <Text color="cyan">Scanning for skills...</Text>
  }

  if (error) {
    return <Text color="red">Error: {error}</Text>
  }

  if (skills.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">No skills found.</Text>
        <Text dimColor>Add skills to .claude/skills/, .agents/skills/, or .codex/skills/</Text>
      </Box>
    )
  }

  const CONFIGURE_VALUE = '__configure__'

  const options = [
    ...skills.map((skill) => {
      const prefix = skill.pipelineSteps ? '▶ ' : ''
      const desc = skill.description ? ` — ${skill.description.slice(0, 60)}` : ''
      return {
        label: `${prefix}${skill.name}${desc}`,
        value: skill.skillPath,
      }
    }),
    { label: '⚙ Configure OpenRouter...', value: CONFIGURE_VALUE },
  ]

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Select a skill</Text>
      <Text dimColor>{skills.length} skill(s) found</Text>
      <Select
        options={options}
        onChange={(value) => {
          if (value === CONFIGURE_VALUE) {
            onConfigure()
          } else {
            const skill = skills.find((s) => s.skillPath === value)
            if (skill) onSelect(skill)
          }
        }}
      />
    </Box>
  )
}

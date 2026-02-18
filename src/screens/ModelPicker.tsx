import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import { Select, TextInput } from '@inkjs/ui'
import { getModelsForAgent } from '../services/modelService.js'
import type { AgentConfig, ModelInfo } from '../types.js'

interface Props {
  agent: AgentConfig
  onSelect: (model: ModelInfo) => void
  onBack: () => void
}

export function ModelPicker({ agent, onSelect, onBack: _onBack }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    getModelsForAgent(agent.kind).then((m) => {
      setModels(m)
      setLoading(false)
    })
  }, [agent.kind])

  if (loading) {
    return <Text color="cyan">Loading models...</Text>
  }

  const filtered = filter
    ? models.filter(
        (m) =>
          m.id.toLowerCase().includes(filter.toLowerCase()) ||
          m.name.toLowerCase().includes(filter.toLowerCase())
      )
    : models

  const visible = filtered.slice(0, 30)

  const options = visible.map((m) => ({
    label: m.contextLength
      ? `${m.name} (${Math.round(m.contextLength / 1000)}k ctx)`
      : m.name,
    value: m.id,
  }))

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Select a model</Text>
      <Text dimColor>{models.length} model(s) available</Text>
      <Box marginBottom={1}>
        <Text dimColor>Filter: </Text>
        <TextInput
          placeholder="type to filter..."
          onChange={setFilter}
        />
      </Box>
      {options.length === 0 ? (
        <Text dimColor>No models match filter</Text>
      ) : (
        <Select
          options={options}
          onChange={(value) => {
            const model = models.find((m) => m.id === value)
            if (model) onSelect(model)
          }}
        />
      )}
      <Text dimColor>Press Escape to go back</Text>
    </Box>
  )
}

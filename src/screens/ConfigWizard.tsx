import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { TextInput, ConfirmInput } from '@inkjs/ui'
import { saveConfig, getConfigPath } from '../services/configService.js'
import type { OpenRouterModelConfig } from '../services/configService.js'

type Step = 'api-key' | 'model-id' | 'model-name' | 'confirm'

interface Props {
  onDone: () => void
}

export function ConfigWizard({ onDone }: Props) {
  const [step, setStep] = useState<Step>('api-key')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<OpenRouterModelConfig[]>([])
  const [currentId, setCurrentId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  async function save() {
    setSaving(true)
    try {
      await saveConfig({
        openrouter: {
          api_key: apiKey || undefined,
          models,
        },
      })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  if (saving) {
    return <Text color="cyan">Saving config to {getConfigPath()}...</Text>
  }

  if (error) {
    return <Text color="red">Failed to save config: {error}</Text>
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="cyan">OpenRouter Setup</Text>
      <Text dimColor>Config will be saved to {getConfigPath()}</Text>

      {/* Step 1: API key */}
      {step === 'api-key' && (
        <Box flexDirection="column" gap={1}>
          <Text bold>Step 1/3 — OpenRouter API key</Text>
          <Text dimColor>Leave blank to skip (you can set OPENROUTER_API_KEY env var instead)</Text>
          <TextInput
            placeholder="sk-or-v1-..."
            onSubmit={(val) => {
              setApiKey(val.trim())
              setStep('model-id')
            }}
          />
        </Box>
      )}

      {/* Step 2: Model ID entry loop */}
      {step === 'model-id' && (
        <Box flexDirection="column" gap={1}>
          <Text bold>Step 2/3 — Add models</Text>
          <Text dimColor>Enter an OpenRouter model ID (e.g. anthropic/claude-opus-4-6)</Text>
          <Text dimColor>Leave blank and press Enter when done</Text>

          {models.length > 0 && (
            <Box flexDirection="column">
              <Text dimColor>Added so far:</Text>
              {models.map((m) => (
                <Text key={m.id}>  <Text color="green">✓</Text> {m.id} — {m.name}</Text>
              ))}
            </Box>
          )}

          <TextInput
            placeholder="provider/model-name"
            onSubmit={(val) => {
              const id = val.trim()
              if (!id) {
                // Empty = done adding models
                setStep('confirm')
              } else {
                setCurrentId(id)
                setStep('model-name')
              }
            }}
          />
        </Box>
      )}

      {/* Step 2b: Display name for the model */}
      {step === 'model-name' && (
        <Box flexDirection="column" gap={1}>
          <Text bold>Display name for <Text color="yellow">{currentId}</Text></Text>
          <Text dimColor>Leave blank to use the model ID as the name</Text>
          <TextInput
            placeholder={currentId}
            onSubmit={(val) => {
              const name = val.trim() || currentId
              setModels((prev) => [...prev, { id: currentId, name }])
              setCurrentId('')
              setStep('model-id')
            }}
          />
        </Box>
      )}

      {/* Step 3: Confirm */}
      {step === 'confirm' && (
        <Box flexDirection="column" gap={1}>
          <Text bold>Step 3/3 — Confirm</Text>
          <Box flexDirection="column" borderStyle="round" paddingX={1}>
            <Text dimColor>API key: <Text color="white">{apiKey ? '***' + apiKey.slice(-4) : '(not set)'}</Text></Text>
            <Text dimColor>Models: <Text color="white">{models.length === 0 ? '(none)' : ''}</Text></Text>
            {models.map((m) => (
              <Text key={m.id}>  <Text color="green">{m.id}</Text> — {m.name}</Text>
            ))}
          </Box>
          <Text>Save and continue?</Text>
          <ConfirmInput
            defaultChoice="confirm"
            onConfirm={save}
            onCancel={() => setStep('api-key')}
          />
        </Box>
      )}
    </Box>
  )
}

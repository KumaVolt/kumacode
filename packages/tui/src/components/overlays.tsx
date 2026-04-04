/**
 * Interactive overlay components for slash commands.
 *
 * These render between the chat and input when a slash command needs
 * interactive selection (like /model, /sessions, /mode, /connect).
 * Uses ink-select-input for arrow-key navigation and Enter to select.
 */
import React, { useState } from "react"
import { Box, Text, useInput } from "ink"
import SelectInput from "ink-select-input"

// ─── Model Picker ───────────────────────────────────────────────────────────

interface ModelPickerProps {
  models: Array<{ providerId: string; providerName: string; model: { id: string; name: string } }>
  activeModel: string | null
  onSelect: (modelId: string) => void
  onCancel: () => void
}

export function ModelPicker({ models, activeModel, onSelect, onCancel }: ModelPickerProps) {
  useInput((_input, key) => {
    if (key.escape) onCancel()
  })

  const items = models.map((m) => ({
    label: `${m.model.name === activeModel ? "* " : "  "}${m.model.name}  (${m.providerName})`,
    value: m.model.id,
  }))

  if (items.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="#e8916e" paddingX={2} paddingY={1} marginX={1}>
        <Text bold color="#e8916e">Switch Model</Text>
        <Text dimColor>No models available. Run `kumacode connect` to set up a provider.</Text>
        <Text dimColor color="#555">Press Escape to close</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#e8916e" paddingX={2} paddingY={1} marginX={1}>
      <Text bold color="#e8916e">Switch Model</Text>
      <Text dimColor>Use arrow keys to navigate, Enter to select, Escape to cancel</Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => onSelect(item.value)}
          limit={12}
        />
      </Box>
    </Box>
  )
}

// ─── Mode Picker ────────────────────────────────────────────────────────────

interface ModePickerProps {
  currentMode: string
  onSelect: (mode: string) => void
  onCancel: () => void
}

const MODE_DESCRIPTIONS: Record<string, string> = {
  default: "Ask before file writes and shell commands",
  acceptEdits: "Auto-approve file edits, ask for shell commands",
  plan: "Read-only — describe changes without making them",
}

export function ModePicker({ currentMode, onSelect, onCancel }: ModePickerProps) {
  useInput((_input, key) => {
    if (key.escape) onCancel()
  })

  const items = Object.entries(MODE_DESCRIPTIONS).map(([mode, desc]) => ({
    label: `${mode === currentMode ? "* " : "  "}${mode}  — ${desc}`,
    value: mode,
  }))

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#e8916e" paddingX={2} paddingY={1} marginX={1}>
      <Text bold color="#e8916e">Permission Mode</Text>
      <Text dimColor>Enter to select, Escape to cancel</Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => onSelect(item.value)}
          initialIndex={Object.keys(MODE_DESCRIPTIONS).indexOf(currentMode)}
        />
      </Box>
    </Box>
  )
}

// ─── Session Picker ─────────────────────────────────────────────────────────

interface SessionPickerProps {
  sessions: Array<{
    id: string
    name: string | null
    updatedAt: string
    messageCount: number
    model: string
  }>
  onResume: (sessionId: string) => void
  onDelete: (sessionId: string) => void
  onCancel: () => void
}

export function SessionPicker({ sessions, onResume, onDelete, onCancel }: SessionPickerProps) {
  const [mode, setMode] = useState<"list" | "action">("list")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useInput((_input, key) => {
    if (key.escape) {
      if (mode === "action") {
        setMode("list")
        setSelectedId(null)
      } else {
        onCancel()
      }
    }
  })

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="#e8916e" paddingX={2} paddingY={1} marginX={1}>
        <Text bold color="#e8916e">Sessions</Text>
        <Text dimColor>No saved sessions found.</Text>
        <Text dimColor color="#555">Press Escape to close</Text>
      </Box>
    )
  }

  // Action submenu for a selected session
  if (mode === "action" && selectedId) {
    const session = sessions.find((s) => s.id === selectedId)
    const name = session?.name ?? "(unnamed)"
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="#e8916e" paddingX={2} paddingY={1} marginX={1}>
        <Text bold color="#e8916e">Session: {name}</Text>
        <Text dimColor>{selectedId.slice(0, 8)}...</Text>
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: "  Resume this session", value: "resume" },
              { label: "  Delete this session", value: "delete" },
              { label: "  Back", value: "back" },
            ]}
            onSelect={(item) => {
              if (item.value === "resume") {
                onResume(selectedId)
              } else if (item.value === "delete") {
                onDelete(selectedId)
              } else {
                setMode("list")
                setSelectedId(null)
              }
            }}
          />
        </Box>
      </Box>
    )
  }

  // Session list
  const items = sessions.map((s) => {
    const date = new Date(s.updatedAt)
    const relative = formatRelativeTime(date)
    const name = s.name ?? "(unnamed)"
    return {
      label: `  ${s.id.slice(0, 8)}  ${name.slice(0, 30).padEnd(30)}  ${relative.padEnd(8)}  ${s.messageCount} msgs  ${s.model}`,
      value: s.id,
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#e8916e" paddingX={2} paddingY={1} marginX={1}>
      <Text bold color="#e8916e">Sessions</Text>
      <Text dimColor>Enter to select, Escape to cancel</Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => {
            setSelectedId(item.value)
            setMode("action")
          }}
          limit={10}
        />
      </Box>
    </Box>
  )
}

// ─── Connect Menu ───────────────────────────────────────────────────────────

interface ConnectMenuProps {
  currentProviders: Array<{ providerName: string; models: string[] }>
  onSelect: (provider: string) => void
  onCancel: () => void
}

const PROVIDER_OPTIONS = [
  { label: "  GitHub Copilot       (Recommended — Claude, GPT, Gemini)", value: "copilot" },
  { label: "  OpenAI               (GPT-4.1, GPT-4o, o3)", value: "openai" },
  { label: "  Google Gemini        (Gemini 2.5 Pro, Flash)", value: "google" },
  { label: "  Ollama               (Local models)", value: "ollama" },
  { label: "  OpenAI-Compatible    (Groq, OpenRouter, Together...)", value: "compatible" },
  { label: "  Zhipu AI             (GLM models)", value: "zhipu" },
  { label: "  ChatGPT Plus/Pro     (Use your subscription)", value: "chatgpt" },
]

export function ConnectMenu({ currentProviders, onSelect, onCancel }: ConnectMenuProps) {
  useInput((_input, key) => {
    if (key.escape) onCancel()
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#e8916e" paddingX={2} paddingY={1} marginX={1}>
      <Text bold color="#e8916e">Add Provider</Text>
      {currentProviders.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>Currently configured:</Text>
          {currentProviders.map((p) => (
            <Text key={p.providerName} dimColor color="#88c0d0">
              {"  "}{p.providerName} ({p.models.length} models)
            </Text>
          ))}
        </Box>
      )}
      <Text dimColor>Select a provider to configure. Escape to cancel.</Text>
      <Box marginTop={1}>
        <SelectInput
          items={PROVIDER_OPTIONS}
          onSelect={(item) => onSelect(item.value)}
        />
      </Box>
    </Box>
  )
}

// ─── Memory Menu ────────────────────────────────────────────────────────────

interface MemoryMenuProps {
  onSelect: (action: string) => void
  onCancel: () => void
}

export function MemoryMenu({ onSelect, onCancel }: MemoryMenuProps) {
  useInput((_input, key) => {
    if (key.escape) onCancel()
  })

  const items = [
    { label: "  View stored memory", value: "view" },
    { label: "  Learn from this conversation (project)", value: "learn-project" },
    { label: "  Learn from this conversation (user)", value: "learn-user" },
  ]

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#e8916e" paddingX={2} paddingY={1} marginX={1}>
      <Text bold color="#e8916e">Memory</Text>
      <Text dimColor>Manage learned conventions. Escape to cancel.</Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => onSelect(item.value)}
        />
      </Box>
    </Box>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatRelativeTime(date: Date): string {
  const now = Date.now()
  const diff = now - date.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return "just now"
}

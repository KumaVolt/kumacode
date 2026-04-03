import React from "react"
import { Box, Text } from "ink"

interface StatusBarProps {
  model?: string
  mode?: string
  tokens?: number
  cost?: number
  /** Number of undoable changes */
  undoCount?: number
  /** Whether there's an active sub-agent */
  hasSubagent?: boolean
  /** Update available indicator */
  updateAvailable?: boolean
  /** Whether an update is in progress */
  isUpdating?: boolean
}

export function StatusBar({
  model,
  mode = "default",
  tokens = 0,
  cost = 0,
  undoCount = 0,
  hasSubagent = false,
  updateAvailable = false,
  isUpdating = false,
}: StatusBarProps) {
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Box>
        <Text dimColor>
          {model ?? "no model"} · {mode}
        </Text>
        {undoCount > 0 && (
          <Text dimColor color="#88c0d0">{" "}· {undoCount} undo</Text>
        )}
        {hasSubagent && (
          <Text dimColor color="cyan">{" "}· task running</Text>
        )}
        {isUpdating && (
          <Text dimColor color="yellow">{" "}· updating...</Text>
        )}
      </Box>
      <Box>
        {updateAvailable && !isUpdating && (
          <Text color="#e8916e">/update available · </Text>
        )}
        <Text dimColor>
          {tokens > 0 ? `${tokens.toLocaleString()} tokens · $${cost.toFixed(4)}` : ""}
        </Text>
      </Box>
    </Box>
  )
}

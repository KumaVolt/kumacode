import React from "react"
import { Box, Text } from "ink"

interface StatusBarProps {
  model?: string
  mode?: string
  tokens?: number
  cost?: number
}

export function StatusBar({ model, mode = "default", tokens = 0, cost = 0 }: StatusBarProps) {
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Text dimColor>
        {model ?? "no model"} · {mode}
      </Text>
      <Text dimColor>
        {tokens > 0 ? `${tokens.toLocaleString()} tokens · $${cost.toFixed(4)}` : ""}
      </Text>
    </Box>
  )
}

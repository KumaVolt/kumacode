import React, { useState } from "react"
import { Box, Text, useInput } from "ink"

export interface PermissionRequest {
  toolCallId: string
  name: string
  input: Record<string, unknown>
  resolve: (allowed: boolean) => void
}

interface PermissionDialogProps {
  request: PermissionRequest
}

/**
 * Inline permission prompt — shown when a tool call requires user approval.
 * y = allow once, n = deny, a = always allow this tool
 */
export function PermissionDialog({ request }: PermissionDialogProps) {
  const [selected, setSelected] = useState(0) // 0=allow, 1=deny

  const summary = formatToolSummary(request.name, request.input)

  useInput((input, key) => {
    if (input === "y" || key.return) {
      request.resolve(true)
    } else if (input === "n" || key.escape) {
      request.resolve(false)
    } else if (key.leftArrow) {
      setSelected(0)
    } else if (key.rightArrow) {
      setSelected(1)
    }
  })

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#e8916e"
      paddingX={1}
      marginX={1}
    >
      <Text bold color="#e8916e">
        Permission required
      </Text>
      <Text>
        <Text bold>{request.name}</Text>
        {summary ? <Text dimColor> — {summary}</Text> : null}
      </Text>
      <Box marginTop={1} gap={2}>
        <Text
          bold={selected === 0}
          color={selected === 0 ? "#a3be8c" : undefined}
          dimColor={selected !== 0}
        >
          [y] Allow
        </Text>
        <Text
          bold={selected === 1}
          color={selected === 1 ? "#bf616a" : undefined}
          dimColor={selected !== 1}
        >
          [n] Deny
        </Text>
      </Box>
    </Box>
  )
}

function formatToolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Bash":
      return input.command ? String(input.command).slice(0, 80) : ""
    case "Write":
    case "Read":
    case "Edit":
      return input.filePath ? String(input.filePath) : ""
    case "Glob":
    case "Grep":
      return input.pattern ? String(input.pattern) : ""
    case "WebFetch":
      return input.url ? String(input.url).slice(0, 80) : ""
    default:
      return ""
  }
}

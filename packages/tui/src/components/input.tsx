import React, { useState } from "react"
import { Box, Text } from "ink"
import TextInput from "ink-text-input"

interface InputProps {
  onSubmit: (text: string) => void
  disabled?: boolean
}

export function Input({ onSubmit, disabled = false }: InputProps) {
  const [value, setValue] = useState("")

  const handleSubmit = (text: string) => {
    if (disabled) return
    if (text.trim()) {
      onSubmit(text.trim())
      setValue("")
    }
  }

  return (
    <Box borderStyle="round" borderColor={disabled ? "#333" : "#555"} paddingX={1}>
      <Text color={disabled ? "#555" : "#e8916e"} bold>
        {">"}{" "}
      </Text>
      {disabled ? (
        <Text dimColor>Kuma is thinking...</Text>
      ) : (
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder="Message Kuma..."
        />
      )}
    </Box>
  )
}

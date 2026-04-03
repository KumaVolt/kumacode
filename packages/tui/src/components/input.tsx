import React, { useState } from "react"
import { Box, Text } from "ink"
import TextInput from "ink-text-input"

interface InputProps {
  onSubmit: (text: string) => void
}

export function Input({ onSubmit }: InputProps) {
  const [value, setValue] = useState("")

  const handleSubmit = (text: string) => {
    if (text.trim()) {
      onSubmit(text.trim())
      setValue("")
    }
  }

  return (
    <Box borderStyle="round" borderColor="#555" paddingX={1}>
      <Text color="#e8916e" bold>
        {">"}{" "}
      </Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        placeholder="Message Kuma..."
      />
    </Box>
  )
}

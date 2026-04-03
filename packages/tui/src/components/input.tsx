import React, { useState, useCallback, useMemo, useRef } from "react"
import { Box, Text, useInput } from "ink"
import TextInput from "ink-text-input"

export interface SlashCommand {
  name: string
  description: string
}

interface InputProps {
  onSubmit: (text: string) => void
  disabled?: boolean
  /** Available slash commands for autocomplete */
  commands?: SlashCommand[]
}

export function Input({ onSubmit, disabled = false, commands = [] }: InputProps) {
  const [value, setValue] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [showAutocomplete, setShowAutocomplete] = useState(false)

  // We need a ref to track autocomplete state synchronously inside handleSubmit,
  // because React state updates are async and the submit handler fires before
  // useInput can intercept Enter.
  const autocompleteRef = useRef({ show: false, matches: [] as SlashCommand[], selectedIndex: 0 })

  // Compute matching commands based on current input
  const matches = useMemo(() => {
    if (!value.startsWith("/") || value.includes(" ")) return []
    const query = value.slice(1).toLowerCase()
    if (query === "") return commands // Show all commands when just "/"
    return commands.filter((cmd) => cmd.name.toLowerCase().startsWith(query))
  }, [value, commands])

  const shouldShowAutocomplete = showAutocomplete && matches.length > 0 && !disabled

  // Keep ref in sync
  autocompleteRef.current = { show: shouldShowAutocomplete, matches, selectedIndex }

  const handleChange = useCallback((newValue: string) => {
    setValue(newValue)
    setSelectedIndex(0)
    setShowAutocomplete(newValue.startsWith("/") && !newValue.includes(" "))
  }, [])

  const handleSubmit = useCallback((text: string) => {
    if (disabled) return

    // If autocomplete is open, Enter accepts the selected completion
    const ac = autocompleteRef.current
    if (ac.show && ac.matches.length > 0) {
      const selected = ac.matches[ac.selectedIndex]
      if (selected) {
        const completed = `/${selected.name} `
        setValue(completed)
        setShowAutocomplete(false)
        setSelectedIndex(0)
        return // Don't submit — just fill in the completion
      }
    }

    // Normal submit
    if (text.trim()) {
      onSubmit(text.trim())
      setValue("")
      setShowAutocomplete(false)
      setSelectedIndex(0)
    }
  }, [disabled, onSubmit])

  // Handle arrow keys, tab, and escape for autocomplete navigation
  useInput((input, key) => {
    if (disabled || !shouldShowAutocomplete) return

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1))
    } else if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(matches.length - 1, prev + 1))
    } else if (key.tab && !key.shift) {
      // Tab also accepts the current completion
      if (matches[selectedIndex]) {
        const completed = `/${matches[selectedIndex].name} `
        setValue(completed)
        setShowAutocomplete(false)
        setSelectedIndex(0)
      }
    } else if (key.escape) {
      setShowAutocomplete(false)
    }
  })

  return (
    <Box flexDirection="column">
      {/* Autocomplete dropdown — shown above the input */}
      {shouldShowAutocomplete && (
        <Box flexDirection="column" paddingX={2} marginBottom={0}>
          {matches.slice(0, 10).map((cmd, i) => {
            const isSelected = i === selectedIndex
            return (
              <Box key={cmd.name}>
                <Text
                  color={isSelected ? "#e8916e" : "#888"}
                  bold={isSelected}
                  inverse={isSelected}
                >
                  {" "}/{cmd.name}
                </Text>
                <Text dimColor>{"  "}{cmd.description}</Text>
              </Box>
            )
          })}
          {matches.length > 10 && (
            <Text dimColor>  ... and {matches.length - 10} more</Text>
          )}
        </Box>
      )}

      {/* Input box */}
      <Box borderStyle="round" borderColor={disabled ? "#333" : "#555"} paddingX={1}>
        <Text color={disabled ? "#555" : "#e8916e"} bold>
          {">"}{" "}
        </Text>
        {disabled ? (
          <Text dimColor>Kuma is thinking...</Text>
        ) : (
          <TextInput
            value={value}
            onChange={handleChange}
            onSubmit={handleSubmit}
            placeholder="Message Kuma... (/ for commands)"
          />
        )}
      </Box>
    </Box>
  )
}

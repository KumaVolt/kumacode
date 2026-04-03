import React, { useState, useEffect } from "react"
import { Box, Text, useApp, useInput } from "ink"
import { bus } from "@kumacode/core"
import { Banner } from "./components/banner.js"
import { Chat } from "./components/chat.js"
import { Input } from "./components/input.js"
import { StatusBar } from "./components/status-bar.js"

interface AppProps {
  cwd: string
  initialPrompt?: string
}

export function App({ cwd, initialPrompt }: AppProps) {
  const { exit } = useApp()
  const [started, setStarted] = useState(false)

  useInput((input, key) => {
    // Ctrl+D to exit
    if (key.ctrl && input === "d") {
      exit()
    }
  })

  return (
    <Box flexDirection="column" width="100%">
      {!started && <Banner cwd={cwd} />}
      <Chat />
      <Input
        onSubmit={(text) => {
          if (!started) setStarted(true)
          // Will be wired to agent loop
        }}
      />
      <StatusBar />
    </Box>
  )
}

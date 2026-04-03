import React, { useState } from "react"
import { Box, Text } from "ink"
import type { Message, StreamEvent } from "@kumacode/core"

export function Chat() {
  // Placeholder — will be wired to bus events
  const [messages, setMessages] = useState<Message[]>([])

  return (
    <Box flexDirection="column" paddingX={1}>
      {messages.map((msg, i) => (
        <MessageBlock key={i} message={msg} />
      ))}
    </Box>
  )
}

function MessageBlock({ message }: { message: Message }) {
  const isUser = message.role === "user"
  const content = typeof message.content === "string"
    ? message.content
    : message.content.map((b) => b.text ?? b.output ?? "").join("")

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={isUser ? "#88c0d0" : "#e8916e"}>
        {isUser ? "You" : "🐻 Kuma"}
      </Text>
      <Text>{content}</Text>
    </Box>
  )
}

import React, { useMemo } from "react"
import { Box, Text } from "ink"
import { marked } from "marked"
// @ts-ignore — marked-terminal has no type declarations
import TerminalRenderer from "marked-terminal"
import type { ChatMessage, ToolActivity, SubagentActivity } from "../hooks/use-kumacode.js"

// Configure marked with terminal renderer (once)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
marked.setOptions({ renderer: new TerminalRenderer({ reflowText: true, tab: 2 }) as any })

/**
 * Render markdown to terminal-formatted string.
 * Falls back to plain text if rendering fails.
 */
function renderMarkdown(text: string): string {
  try {
    const rendered = marked.parse(text)
    if (typeof rendered !== "string") return text
    // Trim trailing newlines that marked adds
    return rendered.replace(/\n+$/, "")
  } catch {
    return text
  }
}

/**
 * Colorize a unified diff string for terminal display.
 * Returns an array of { text, color } segments.
 */
function formatDiffLines(unified: string): Array<{ text: string; color: string }> {
  const lines = unified.split("\n")
  const result: Array<{ text: string; color: string }> = []

  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      result.push({ text: line, color: "white" })
    } else if (line.startsWith("@@")) {
      result.push({ text: line, color: "cyan" })
    } else if (line.startsWith("+")) {
      result.push({ text: line, color: "green" })
    } else if (line.startsWith("-")) {
      result.push({ text: line, color: "red" })
    } else {
      result.push({ text: line, color: "gray" })
    }
  }

  return result
}

interface ChatProps {
  messages: ChatMessage[]
  streamingText: string
  isStreaming: boolean
  toolActivities: ToolActivity[]
  subagentActivities: SubagentActivity[]
  error: string | null
}

export function Chat({
  messages,
  streamingText,
  isStreaming,
  toolActivities,
  subagentActivities,
  error,
}: ChatProps) {
  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      {messages.map((msg, i) => (
        <MessageBlock key={i} message={msg} />
      ))}

      {/* Tool activity indicators */}
      {toolActivities
        .filter((a) => a.status === "running")
        .map((activity) => (
          <Box key={activity.toolCallId} marginLeft={2}>
            <Text color="yellow">
              ⏳ {activity.name}
              {activity.name === "Bash" && activity.input.command
                ? `: ${String(activity.input.command).slice(0, 60)}`
                : activity.name === "Read" && activity.input.filePath
                  ? `: ${String(activity.input.filePath)}`
                  : activity.name === "Write" && activity.input.filePath
                    ? `: ${String(activity.input.filePath)}`
                    : activity.name === "Edit" && activity.input.filePath
                      ? `: ${String(activity.input.filePath)}`
                      : activity.name === "Glob" && activity.input.pattern
                        ? `: ${String(activity.input.pattern)}`
                        : activity.name === "Grep" && activity.input.pattern
                          ? `: ${String(activity.input.pattern)}`
                          : ""}
            </Text>
          </Box>
        ))}

      {/* Inline diffs for completed Write/Edit tool activities */}
      {toolActivities
        .filter((a) => a.status === "done" && (a.name === "Write" || a.name === "Edit") && a.output?.metadata?.diff)
        .map((activity) => {
          const diff = activity.output!.metadata!.diff as { unified: string; additions: number; deletions: number }
          const diffLines = formatDiffLines(diff.unified)
          // Limit displayed diff lines to avoid flooding the terminal
          const maxLines = 30
          const truncated = diffLines.length > maxLines
          const displayLines = truncated ? diffLines.slice(0, maxLines) : diffLines
          return (
            <Box key={`diff-${activity.toolCallId}`} flexDirection="column" marginLeft={2} marginBottom={1}>
              <Text dimColor>
                {activity.name}: {String(activity.input.filePath)} (+{diff.additions} -{diff.deletions})
              </Text>
              {displayLines.map((line, i) => (
                <Text key={i} color={line.color}>{line.text}</Text>
              ))}
              {truncated && (
                <Text dimColor>  ... ({diffLines.length - maxLines} more lines)</Text>
              )}
            </Box>
          )
        })}

      {/* Sub-agent activity indicators */}
      {subagentActivities
        .filter((a) => a.status === "running")
        .map((agent) => (
          <Box key={agent.taskId} flexDirection="column" marginLeft={2}>
            <Text color="cyan">
              {">"} Task: {agent.description}
            </Text>
            {agent.activeTools.map((tool) => (
              <Box key={tool.toolCallId} marginLeft={4}>
                <Text color="cyan" dimColor>
                  ⏳ {tool.name}
                  {tool.name === "Read" && tool.input.filePath
                    ? `: ${String(tool.input.filePath)}`
                    : tool.name === "Bash" && tool.input.command
                      ? `: ${String(tool.input.command).slice(0, 50)}`
                      : tool.name === "Glob" && tool.input.pattern
                        ? `: ${String(tool.input.pattern)}`
                        : tool.name === "Grep" && tool.input.pattern
                          ? `: ${String(tool.input.pattern)}`
                          : ""}
                </Text>
              </Box>
            ))}
          </Box>
        ))}

      {/* Streaming text (partial response) */}
      {streamingText && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="#e8916e">
            Kuma
          </Text>
          <Text>{streamingText}</Text>
          {isStreaming && <Text dimColor>▌</Text>}
        </Box>
      )}

      {/* Error display */}
      {error && (
        <Box marginBottom={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}
    </Box>
  )
}

function MessageBlock({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"
  const content = message.content

  // Render assistant messages through markdown; user messages stay plain
  const rendered = useMemo(() => {
    if (isUser || !content) return content
    return renderMarkdown(content)
  }, [isUser, content])

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={isUser ? "#88c0d0" : "#e8916e"}>
        {isUser ? "You" : "Kuma"}
      </Text>
      <Text wrap="wrap">{rendered}</Text>
      {/* Show attached image indicators */}
      {message.imageLabels && message.imageLabels.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          {message.imageLabels.map((label, i) => (
            <Text key={i} color="magenta" dimColor>
              [Image: {label}]
            </Text>
          ))}
        </Box>
      )}
      {/* Show tool call summaries */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <Box flexDirection="column" marginLeft={2} marginTop={0}>
          {message.toolCalls.map((tc) => (
            <Text key={tc.id} dimColor>
              ↳ {tc.name}
              {tc.name === "Bash" && tc.input.command
                ? `: ${String(tc.input.command).slice(0, 60)}`
                : tc.name === "Read" && tc.input.filePath
                  ? `: ${String(tc.input.filePath)}`
                  : tc.name === "Write" && tc.input.filePath
                    ? `: ${String(tc.input.filePath)}`
                    : tc.name === "Edit" && tc.input.filePath
                      ? `: ${String(tc.input.filePath)}`
                      : ""}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}

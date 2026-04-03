import React from "react"
import { Box, Text } from "ink"
import type { UpdateInfo } from "@kumacode/core"

// Refined pixel-art bear mascot — Kuma!
// Multi-line ASCII art using block characters for that chunky 8-bit look
const BEAR_LINES = [
  { text: "    ▄█▄     ▄█▄    ", color: "#c06a3e" },
  { text: "   █████████████   ", color: "#e8916e" },
  { text: "   █ ● ▄█▄ ● █   ", color: "#e8916e" },
  { text: "   █   ▀▄▄▀   █   ", color: "#e8916e" },
  { text: "   █  ╰────╯  █   ", color: "#e8916e" },
  { text: "    ▀█████████▀    ", color: "#c06a3e" },
  { text: "      ██  ██       ", color: "#c06a3e" },
]

// Exported for use in other components (e.g., non-interactive mode)
export const BEAR_MASCOT = BEAR_LINES.map((l) => l.text).join("\n")

interface RecentSession {
  id: string
  name?: string | null
  updatedAt: string | number
  messageCount: number
}

interface BannerProps {
  cwd: string
  model?: string
  authType?: string
  version?: string
  updateInfo?: UpdateInfo | null
  recentSessions?: RecentSession[]
}

export function Banner({
  cwd,
  model,
  authType,
  version = "0.1.0",
  updateInfo,
  recentSessions = [],
}: BannerProps) {
  const shortCwd = cwd.replace(process.env.HOME ?? "", "~")

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#e8916e"
      paddingX={1}
      paddingY={0}
    >
      {/* Update notification bar */}
      {updateInfo?.updateAvailable && (
        <Box justifyContent="center" paddingY={0}>
          <Text backgroundColor="#e8916e" color="black" bold>
            {" "}Update available: v{updateInfo.latestVersion} (current: v{updateInfo.currentVersion}) — run /update to upgrade{" "}
          </Text>
        </Box>
      )}

      <Box flexDirection="row">
        {/* Left panel — mascot + info */}
        <Box flexDirection="column" width="50%" alignItems="center" paddingY={1}>
          <Text bold color="#e8916e">
            KumaCode v{version}
          </Text>
          <Box flexDirection="column" alignItems="center" marginY={1}>
            {BEAR_LINES.map((line, i) => (
              <Text key={i} color={line.color}>{line.text}</Text>
            ))}
          </Box>
          <Box flexDirection="column" alignItems="center">
            {model && (
              <Text dimColor>
                {model}{authType ? ` · ${authType}` : ""}
              </Text>
            )}
            <Text dimColor>{shortCwd}</Text>
          </Box>
        </Box>

        {/* Divider */}
        <Box width={1} flexDirection="column" justifyContent="center">
          <Text color="#555">│</Text>
        </Box>

        {/* Right panel — tips + recent sessions */}
        <Box flexDirection="column" width="50%" paddingX={2} paddingY={1}>
          <Text bold color="#e8916e">
            Quick start
          </Text>
          <Text dimColor>  Ask Kuma anything about your codebase</Text>
          <Text dimColor>  Use @file to attach files to your message</Text>
          <Text dimColor>  Type /help for all commands</Text>
          <Text dimColor>  Shift+Tab to cycle permission mode</Text>
          <Text> </Text>

          <Text bold color="#e8916e">
            Recent sessions
          </Text>
          {recentSessions.length === 0 ? (
            <Text dimColor>  No recent sessions</Text>
          ) : (
            recentSessions.slice(0, 5).map((s) => {
              const date = new Date(s.updatedAt)
              const rel = formatRelativeTime(date)
              const name = s.name ?? "(unnamed)"
              const shortId = s.id.slice(0, 8)
              return (
                <Text key={s.id} dimColor>
                  {"  "}{shortId} · {name.slice(0, 30)} · {rel}
                </Text>
              )
            })
          )}
          {recentSessions.length > 0 && (
            <Text dimColor color="#555">  /sessions resume {"<id>"} to continue</Text>
          )}
        </Box>
      </Box>
    </Box>
  )
}

/** Format a date as relative time (e.g., "2h ago", "3d ago") */
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

export function WELCOME_BANNER(version: string): string {
  return `KumaCode v${version}`
}
